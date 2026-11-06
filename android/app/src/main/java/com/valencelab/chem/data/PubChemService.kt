package com.valencelab.chem.data

import com.valencelab.chem.chem.PubChemCompound
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

object PubChemService {
    suspend fun searchByName(query: String): List<PubChemCompound> = withContext(Dispatchers.IO) {
        val encoded = URLEncoder.encode(query.trim(), "UTF-8").replace("+", "%20")
        val endpoint =
            "https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/$encoded/property/IUPACName,MolecularFormula,MolecularWeight,CanonicalSMILES,ConnectivitySMILES,IsomericSMILES/JSON"
        val conn = (URL(endpoint).openConnection() as HttpURLConnection).apply {
            requestMethod = "GET"
            connectTimeout = 15000
            readTimeout = 20000
        }
        try {
            val code = conn.responseCode
            val stream = if (code in 200..299) conn.inputStream else conn.errorStream
            val raw = BufferedReader(InputStreamReader(stream, Charsets.UTF_8)).use { it.readText() }
            if (code !in 200..299) {
                throw IllegalStateException("No PubChem entry found for \"$query\" (HTTP $code).")
            }
            val root = JSONObject(raw)
            val props = root.optJSONObject("PropertyTable")?.optJSONArray("Properties")
                ?: return@withContext emptyList()

            val results = mutableListOf<PubChemCompound>()
            for (i in 0 until minOf(6, props.length())) {
                val obj = props.optJSONObject(i) ?: continue
                val smiles = obj.optString("CanonicalSMILES")
                    .ifBlank { obj.optString("ConnectivitySMILES") }
                    .ifBlank { obj.optString("IsomericSMILES") }
                    .ifBlank { null }
                results.add(
                    PubChemCompound(
                        cid = obj.optLong("CID", 0L),
                        iupacName = obj.optString("IUPACName").ifBlank { null },
                        molecularFormula = obj.optString("MolecularFormula").ifBlank { null },
                        molecularWeight = obj.opt("MolecularWeight")?.toString(),
                        smiles = smiles
                    )
                )
            }
            results
        } finally {
            conn.disconnect()
        }
    }
}
