package com.valencelab.chem.data

import android.util.Base64
import com.valencelab.chem.BuildConfig
import com.valencelab.chem.chem.AtomAnalysis
import com.valencelab.chem.chem.AtomNode
import com.valencelab.chem.chem.DeepStructureAnalysis
import com.valencelab.chem.chem.MoleculeGraph
import com.valencelab.chem.chem.MoleculeMetrics
import com.valencelab.chem.chem.TutorMessage
import com.valencelab.chem.chem.VisionAnalysisResult
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL

data class SynthesizedMoleculeResult(
    val name: String,
    val iupacName: String,
    val smiles: String,
    val geometrySummary: String
)

object GeminiChemService {
    private const val BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models"

    private fun requireApiKey(): String {
        val key = BuildConfig.GEMINI_API_KEY.trim()
        if (key.isEmpty() || key == "MY_GEMINI_API_KEY") {
            throw IllegalStateException(
                "GEMINI_API_KEY is not configured. Add GEMINI_API_KEY=... to android/.env before building."
            )
        }
        return key
    }

    private suspend fun postGenerateContent(model: String, payload: JSONObject): JSONObject =
        withContext(Dispatchers.IO) {
            val apiKey = requireApiKey()
            val url = URL("$BASE_URL/$model:generateContent")
            val conn = (url.openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                connectTimeout = 20000
                readTimeout = 60000
                doOutput = true
                setRequestProperty("Content-Type", "application/json")
                setRequestProperty("x-goog-api-key", apiKey)
                setRequestProperty("User-Agent", "aistudio-build-android")
            }
            try {
                OutputStreamWriter(conn.outputStream, Charsets.UTF_8).use { writer ->
                    writer.write(payload.toString())
                }
                val code = conn.responseCode
                val stream = if (code in 200..299) conn.inputStream else conn.errorStream
                val rawBody = BufferedReader(InputStreamReader(stream, Charsets.UTF_8)).use {
                    it.readText()
                }
                if (code !in 200..299) {
                    throw IllegalStateException("Gemini API HTTP $code: ${rawBody.take(280)}")
                }
                JSONObject(rawBody)
            } finally {
                conn.disconnect()
            }
        }

    private fun extractText(responseJson: JSONObject): String {
        val candidates = responseJson.optJSONArray("candidates") ?: return ""
        val first = candidates.optJSONObject(0) ?: return ""
        val content = first.optJSONObject("content") ?: return ""
        val parts = content.optJSONArray("parts") ?: return ""
        val sb = StringBuilder()
        for (i in 0 until parts.length()) {
            val part = parts.optJSONObject(i) ?: continue
            if (part.has("text")) {
                sb.append(part.optString("text"))
            }
        }
        return sb.toString().trim()
    }

    private fun JSONArray.toStringList(): List<String> =
        (0 until length()).mapNotNull { optString(it).takeIf { s -> s.isNotBlank() } }

    suspend fun synthesizeMolecule(
        prompt: String,
        currentSmiles: String?
    ): SynthesizedMoleculeResult {
        val fullPrompt = if (!currentSmiles.isNullOrBlank()) {
            "Current molecule SMILES: $currentSmiles\nStudent request: $prompt\nGenerate the resulting or requested molecule as a clean, valid canonical SMILES using standard organic subset symbols (B, C, N, O, P, S, F, Cl, Br, I, c, n, o, s) with valid ring closures and balanced valences."
        } else {
            "Student request: $prompt\nGenerate the requested molecule as a clean, valid canonical SMILES using standard organic subset symbols (B, C, N, O, P, S, F, Cl, Br, I, c, n, o, s) with valid ring closures and balanced valences."
        }

        val payload = JSONObject().apply {
            put(
                "systemInstruction",
                JSONObject().put(
                    "parts",
                    JSONArray().put(
                        JSONObject().put(
                            "text",
                            "You are a cheminformatics structure synthesizer. Return a valid, chemically accurate SMILES string without stereochemical @ slashes if unnecessary, plus compound name and brief structural summary."
                        )
                    )
                )
            )
            put(
                "contents",
                JSONArray().put(
                    JSONObject().put("parts", JSONArray().put(JSONObject().put("text", fullPrompt)))
                )
            )
            put(
                "generationConfig",
                JSONObject().apply {
                    put("responseMimeType", "application/json")
                    put(
                        "responseSchema",
                        JSONObject().apply {
                            put("type", "OBJECT")
                            put(
                                "properties",
                                JSONObject().apply {
                                    put("name", JSONObject().put("type", "STRING"))
                                    put("iupacName", JSONObject().put("type", "STRING"))
                                    put("smiles", JSONObject().put("type", "STRING"))
                                    put("geometrySummary", JSONObject().put("type", "STRING"))
                                }
                            )
                            put(
                                "required",
                                JSONArray(listOf("name", "iupacName", "smiles", "geometrySummary"))
                            )
                        }
                    )
                }
            )
        }

        val response = postGenerateContent("gemini-3.8-flash", payload)
        val parsed = JSONObject(extractText(response).ifEmpty { "{}" })
        return SynthesizedMoleculeResult(
            name = parsed.optString("name", prompt),
            iupacName = parsed.optString("iupacName", ""),
            smiles = parsed.optString("smiles", ""),
            geometrySummary = parsed.optString("geometrySummary", "")
        )
    }

    suspend fun analyzeStructure(
        molecule: MoleculeGraph,
        metrics: MoleculeMetrics
    ): DeepStructureAnalysis {
        val warningsText = if (metrics.valenceWarnings.isEmpty()) {
            "None"
        } else {
            metrics.valenceWarnings.joinToString("; ")
        }
        val prompt = """
            Analyze this theoretical molecular structure drawn by a chemistry student:
            - Name / Label: ${molecule.name.ifBlank { "Untitled Structure" }}
            - Molecular Formula: ${metrics.formula}
            - SMILES: ${metrics.canonicalSmiles.ifBlank { "None" }}
            - Molecular Weight: ${metrics.molecularWeight} g/mol
            - Hybridization Counts: sp3=${metrics.hybridizationCounts.sp3}, sp2=${metrics.hybridizationCounts.sp2}, sp=${metrics.hybridizationCounts.sp}
            - Valence Warnings Detected: $warningsText

            Provide a rigorous theoretical chemistry evaluation including IUPAC identification, 3D VSEPR & conformational strain analysis, electronic/resonance effects, key functional groups, predicted IR/NMR diagnostic bands, and actionable structural optimization suggestions.
        """.trimIndent()

        val payload = JSONObject().apply {
            put(
                "systemInstruction",
                JSONObject().put(
                    "parts",
                    JSONArray().put(
                        JSONObject().put(
                            "text",
                            "You are a computational and physical organic chemistry professor evaluating a student-drawn theoretical molecule. Be scientifically accurate, concise, and pedagogical."
                        )
                    )
                )
            )
            put(
                "contents",
                JSONArray().put(
                    JSONObject().put("parts", JSONArray().put(JSONObject().put("text", prompt)))
                )
            )
            put(
                "generationConfig",
                JSONObject().apply {
                    put("thinkingConfig", JSONObject().put("thinkingLevel", "HIGH"))
                    put("responseMimeType", "application/json")
                    put(
                        "responseSchema",
                        JSONObject().apply {
                            put("type", "OBJECT")
                            put(
                                "properties",
                                JSONObject().apply {
                                    put("iupacName", JSONObject().put("type", "STRING"))
                                    put("commonName", JSONObject().put("type", "STRING"))
                                    put("stabilityVerdict", JSONObject().put("type", "STRING"))
                                    put("vseprAndConformation", JSONObject().put("type", "STRING"))
                                    put("electronicAndResonance", JSONObject().put("type", "STRING"))
                                    put(
                                        "functionalGroups",
                                        JSONObject().put("type", "ARRAY")
                                            .put("items", JSONObject().put("type", "STRING"))
                                    )
                                    put(
                                        "predictedSpectroscopy",
                                        JSONObject().put("type", "ARRAY")
                                            .put("items", JSONObject().put("type", "STRING"))
                                    )
                                    put(
                                        "optimizationSuggestions",
                                        JSONObject().put("type", "ARRAY")
                                            .put("items", JSONObject().put("type", "STRING"))
                                    )
                                }
                            )
                            put(
                                "required",
                                JSONArray(
                                    listOf(
                                        "iupacName",
                                        "commonName",
                                        "stabilityVerdict",
                                        "vseprAndConformation",
                                        "electronicAndResonance",
                                        "functionalGroups",
                                        "predictedSpectroscopy",
                                        "optimizationSuggestions"
                                    )
                                )
                            )
                        }
                    )
                }
            )
        }

        val response = postGenerateContent("gemini-4-argon", payload)
        val parsed = JSONObject(extractText(response).ifEmpty { "{}" })
        return DeepStructureAnalysis(
            iupacName = parsed.optString("iupacName", "Unknown IUPAC"),
            commonName = parsed.optString("commonName", molecule.name),
            stabilityVerdict = parsed.optString("stabilityVerdict", ""),
            vseprAndConformation = parsed.optString("vseprAndConformation", ""),
            electronicAndResonance = parsed.optString("electronicAndResonance", ""),
            functionalGroups = parsed.optJSONArray("functionalGroups")?.toStringList().orEmpty(),
            predictedSpectroscopy = parsed.optJSONArray("predictedSpectroscopy")?.toStringList().orEmpty(),
            optimizationSuggestions = parsed.optJSONArray("optimizationSuggestions")?.toStringList().orEmpty()
        )
    }

    suspend fun explainAtomOrbital(
        atom: AtomNode,
        analysis: AtomAnalysis,
        molecule: MoleculeGraph,
        metrics: MoleculeMetrics
    ): String {
        val prompt =
            "In 2 concise sentences for a chemistry student, explain the bonding role, orbital hybridization (${analysis.hybridization.label}), and ${analysis.vseprGeometry.label} local geometry of this ${atom.element.symbol} atom inside ${molecule.name.ifBlank { "the molecule" }} (SMILES: ${metrics.canonicalSmiles.ifBlank { "N/A" }})."

        val payload = JSONObject().put(
            "contents",
            JSONArray().put(
                JSONObject().put("parts", JSONArray().put(JSONObject().put("text", prompt)))
            )
        )
        val response = postGenerateContent("gemini-3.1-flash-lite", payload)
        return extractText(response)
    }

    suspend fun sendTutorMessage(
        history: List<TutorMessage>,
        model: String,
        molecule: MoleculeGraph,
        metrics: MoleculeMetrics
    ): Pair<String, String?> {
        val valenceLine = if (metrics.valenceValid) {
            "Valid"
        } else {
            "Warnings: ${metrics.valenceWarnings.joinToString(", ")}"
        }
        val sysPrompt = """
            You are ValenceLab Tutor, an expert theoretical and organic chemistry laboratory mentor helping a student draw 2D molecules and explore their 3D VSEPR geometries.
            Active Workbench Molecule Context:
            - Name: ${molecule.name}
            - Formula: ${metrics.formula}
            - Molar Mass: ${metrics.molecularWeight} g/mol
            - SMILES: ${metrics.canonicalSmiles}
            - Valence Status: $valenceLine

            Guidelines:
            1. Explain orbital hybridization (sp3, sp2, sp), VSEPR bond angles, resonance, polarity, and reaction mechanisms clearly.
            2. Whenever you propose a specific molecule or structural modification for the student to visualize in 3D, include a standalone line formatted exactly as:
            SMILES: <valid_smiles_here>
            so the student can load it into the 3D workbench with one click.
        """.trimIndent()

        val contents = JSONArray()
        for (msg in history) {
            contents.put(
                JSONObject().apply {
                    put("role", if (msg.isUser) "user" else "model")
                    put("parts", JSONArray().put(JSONObject().put("text", msg.content)))
                }
            )
        }

        val payload = JSONObject().apply {
            put(
                "systemInstruction",
                JSONObject().put("parts", JSONArray().put(JSONObject().put("text", sysPrompt)))
            )
            put("contents", contents)
        }

        val response = postGenerateContent(model, payload)
        val reply = extractText(response)
        val smilesMatch = Regex("^SMILES:\\s*([^\\s]+)\\s*$", RegexOption.MULTILINE).find(reply)
        return reply to smilesMatch?.groupValues?.get(1)
    }

    suspend fun analyzeChemistryImage(
        imageBytes: ByteArray,
        mimeType: String,
        question: String?
    ): VisionAnalysisResult {
        val b64 = Base64.encodeToString(imageBytes, Base64.NO_WRAP)
        val promptText = if (!question.isNullOrBlank()) {
            "Analyze this chemistry image and answer the student's question: \"$question\". Identify any chemical structures, hand-drawn Lewis/skeletal formulas, 3D ball-and-stick models, or laboratory apparatus, check for valence/bonding errors, and provide a valid SMILES string if a primary molecule is depicted."
        } else {
            "Analyze this chemistry image (hand-drawn chemical structure, textbook diagram, 3D molecular model, or lab photo). Identify the chemical compound(s), functional groups, hybridization, stereochemistry, any structural/valence errors in the drawing, and extract a valid canonical SMILES string for the main molecule so the student can load it into the 3D workbench."
        }

        val payload = JSONObject().apply {
            put(
                "contents",
                JSONArray().put(
                    JSONObject().put(
                        "parts",
                        JSONArray().apply {
                            put(
                                JSONObject().put(
                                    "inlineData",
                                    JSONObject().put("mimeType", mimeType).put("data", b64)
                                )
                            )
                            put(JSONObject().put("text", promptText))
                        }
                    )
                )
            )
            put(
                "generationConfig",
                JSONObject().apply {
                    put("thinkingConfig", JSONObject().put("thinkingLevel", "HIGH"))
                    put("responseMimeType", "application/json")
                    put(
                        "responseSchema",
                        JSONObject().apply {
                            put("type", "OBJECT")
                            put(
                                "properties",
                                JSONObject().apply {
                                    put("identifiedCompound", JSONObject().put("type", "STRING"))
                                    put("formula", JSONObject().put("type", "STRING"))
                                    put("extractedSmiles", JSONObject().put("type", "STRING"))
                                    put("structuralAnalysis", JSONObject().put("type", "STRING"))
                                    put(
                                        "functionalGroups",
                                        JSONObject().put("type", "ARRAY")
                                            .put("items", JSONObject().put("type", "STRING"))
                                    )
                                    put(
                                        "correctionsOrNotes",
                                        JSONObject().put("type", "ARRAY")
                                            .put("items", JSONObject().put("type", "STRING"))
                                    )
                                }
                            )
                            put(
                                "required",
                                JSONArray(
                                    listOf(
                                        "identifiedCompound",
                                        "formula",
                                        "extractedSmiles",
                                        "structuralAnalysis",
                                        "functionalGroups",
                                        "correctionsOrNotes"
                                    )
                                )
                            )
                        }
                    )
                }
            )
        }

        val response = postGenerateContent("gemini-4-argon", payload)
        val parsed = JSONObject(extractText(response).ifEmpty { "{}" })
        return VisionAnalysisResult(
            identifiedCompound = parsed.optString("identifiedCompound", "Unknown Compound"),
            formula = parsed.optString("formula", ""),
            extractedSmiles = parsed.optString("extractedSmiles", ""),
            structuralAnalysis = parsed.optString("structuralAnalysis", ""),
            functionalGroups = parsed.optJSONArray("functionalGroups")?.toStringList().orEmpty(),
            correctionsOrNotes = parsed.optJSONArray("correctionsOrNotes")?.toStringList().orEmpty()
        )
    }
}
