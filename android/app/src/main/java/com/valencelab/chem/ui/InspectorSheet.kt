package com.valencelab.chem.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Science
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.valencelab.chem.chem.DeepStructureAnalysis
import com.valencelab.chem.chem.Elements
import com.valencelab.chem.chem.MoleculeGraph
import com.valencelab.chem.chem.MoleculeMetrics
import com.valencelab.chem.data.GeminiChemService
import kotlinx.coroutines.launch

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun InspectorSheet(
    molecule: MoleculeGraph,
    metrics: MoleculeMetrics,
    selectedAtomId: String?,
    modifier: Modifier = Modifier
) {
    var deepAnalysis by remember { mutableStateOf<DeepStructureAnalysis?>(null) }
    var isAnalyzing by remember { mutableStateOf(false) }
    var analysisError by remember { mutableStateOf<String?>(null) }

    var orbitalRoleNote by remember { mutableStateOf<String?>(null) }
    var isExplainingAtom by remember { mutableStateOf(false) }
    var atomExplainError by remember { mutableStateOf<String?>(null) }

    val scope = rememberCoroutineScope()

    LaunchedEffect(molecule.id, molecule.atoms.size, molecule.bonds.size) {
        deepAnalysis = null
        analysisError = null
        orbitalRoleNote = null
        atomExplainError = null
    }

    LaunchedEffect(selectedAtomId) {
        orbitalRoleNote = null
        atomExplainError = null
    }

    Surface(
        modifier = modifier.fillMaxSize(),
        color = MaterialTheme.colorScheme.surface,
        shape = RoundedCornerShape(12.dp),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            // 1. Identity & Formula Header
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(
                    text = molecule.name.ifBlank { "Custom Molecule" },
                    style = MaterialTheme.typography.titleLarge,
                    color = MaterialTheme.colorScheme.onSurface
                )
                if (!molecule.iupacName.isNullOrBlank()) {
                    Text(
                        text = molecule.iupacName,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
                Row(
                    modifier = Modifier.padding(top = 4.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    MetricBadge("Formula", metrics.formula)
                    MetricBadge("Molar Mass", "${metrics.molecularWeight} g/mol")
                    if (metrics.formalCharge != 0) {
                        val sign = if (metrics.formalCharge > 0) "+${metrics.formalCharge}" else "${metrics.formalCharge}"
                        MetricBadge("Charge", sign)
                    }
                }
            }

            // 2. Valence Health Status
            Surface(
                color = if (metrics.valenceValid) Color(0xFFECFDF5) else MaterialTheme.colorScheme.errorContainer,
                shape = RoundedCornerShape(8.dp),
                border = BorderStroke(
                    1.dp,
                    if (metrics.valenceValid) Color(0xFFA7F3D0) else MaterialTheme.colorScheme.error.copy(alpha = 0.4f)
                ),
                modifier = Modifier.fillMaxWidth()
            ) {
                Row(
                    modifier = Modifier.padding(10.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Icon(
                        imageVector = if (metrics.valenceValid) Icons.Default.CheckCircle else Icons.Default.Warning,
                        contentDescription = null,
                        tint = if (metrics.valenceValid) Color(0xFF059669) else MaterialTheme.colorScheme.error,
                        modifier = Modifier.size(18.dp)
                    )
                    Spacer(Modifier.width(8.dp))
                    Column {
                        Text(
                            text = if (metrics.valenceValid) {
                                "Valence Shell Satisfied"
                            } else {
                                "Valence Rule Warning (${metrics.valenceWarnings.size})"
                            },
                            fontSize = 12.sp,
                            fontWeight = FontWeight.Bold,
                            color = if (metrics.valenceValid) Color(0xFF065F46) else MaterialTheme.colorScheme.onErrorContainer
                        )
                        metrics.valenceWarnings.forEach { warn ->
                            Text(
                                text = "• $warn",
                                fontSize = 11.sp,
                                color = MaterialTheme.colorScheme.onErrorContainer
                            )
                        }
                    }
                }
            }

            // 3. Selected Atom VSEPR & Orbital Hybridization Card
            val selectedAtom = selectedAtomId?.let { id -> molecule.atoms.firstOrNull { it.id == id } }
            val selectedAnalysis = selectedAtomId?.let { metrics.atomAnalyses[it] }
            if (selectedAtom != null && selectedAnalysis != null) {
                val spec = Elements.specOf(selectedAtom.element)
                Surface(
                    color = MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.3f),
                    shape = RoundedCornerShape(10.dp),
                    border = BorderStroke(1.dp, MaterialTheme.colorScheme.primary.copy(alpha = 0.35f)),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Column(
                        modifier = Modifier.padding(12.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text(
                                text = "Selected Atom: ${spec.name} (${selectedAtom.element.symbol})",
                                fontSize = 13.sp,
                                fontWeight = FontWeight.Bold,
                                color = MaterialTheme.colorScheme.onSurface
                            )
                            Text(
                                text = "EN ${spec.electronegativity}",
                                fontSize = 11.sp,
                                fontFamily = FontFamily.Monospace,
                                color = MaterialTheme.colorScheme.primary
                            )
                        }

                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            MetricBadge("Hybridization", selectedAnalysis.hybridization.label, Modifier.weight(1f))
                            MetricBadge("Steric #", "${selectedAnalysis.stericNumber}", Modifier.weight(1f))
                            MetricBadge("Implicit H", "${selectedAnalysis.implicitHydrogens}", Modifier.weight(1f))
                        }

                        Text(
                            text = "VSEPR Geometry: ${selectedAnalysis.vseprGeometry.label} • Lone Pairs: ${selectedAnalysis.lonePairs}" +
                                if (selectedAnalysis.isAromatic) " • Aromatic π-system" else "",
                            fontSize = 12.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )

                        OutlinedButton(
                            enabled = !isExplainingAtom,
                            onClick = {
                                isExplainingAtom = true
                                atomExplainError = null
                                scope.launch {
                                    try {
                                        orbitalRoleNote = GeminiChemService.explainAtomOrbital(
                                            atom = selectedAtom,
                                            analysis = selectedAnalysis,
                                            molecule = molecule,
                                            metrics = metrics
                                        )
                                    } catch (e: Exception) {
                                        atomExplainError = e.message ?: "Failed to explain atom role."
                                    } finally {
                                        isExplainingAtom = false
                                    }
                                }
                            },
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            if (isExplainingAtom) {
                                CircularProgressIndicator(modifier = Modifier.size(15.dp), strokeWidth = 2.dp)
                                Spacer(Modifier.width(8.dp))
                            } else {
                                Icon(Icons.Default.Science, contentDescription = null, modifier = Modifier.size(15.dp))
                                Spacer(Modifier.width(6.dp))
                            }
                            Text("Explain Atom Orbital Role", fontSize = 12.sp)
                        }

                        if (atomExplainError != null) {
                            Text(
                                text = atomExplainError.orEmpty(),
                                color = MaterialTheme.colorScheme.error,
                                fontSize = 11.sp
                            )
                        }
                        if (orbitalRoleNote != null) {
                            Text(
                                text = orbitalRoleNote.orEmpty(),
                                fontSize = 12.sp,
                                color = MaterialTheme.colorScheme.onSurface
                            )
                        }
                    }
                }
            } else {
                Text(
                    text = "Tip: Tap any atom in the 2D Sketcher or 3D Viewport to inspect its local VSEPR geometry & hybridization.",
                    fontSize = 11.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }

            // 4. Physicochemical & Hybridization Grid
            Text(
                text = "Physicochemical Descriptors",
                style = MaterialTheme.typography.titleSmall,
                color = MaterialTheme.colorScheme.onSurface
            )

            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                    MetricBadge("LogP (est.)", "${metrics.estimatedLogP}", Modifier.weight(1f))
                    MetricBadge("TPSA", "${metrics.tpsa} Å²", Modifier.weight(1f))
                    MetricBadge("Rings", "${metrics.ringCount}", Modifier.weight(1f))
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                    MetricBadge("HBD / HBA", "${metrics.hbdCount} / ${metrics.hbaCount}", Modifier.weight(1f))
                    MetricBadge("Rotatable Bonds", "${metrics.rotatableBonds}", Modifier.weight(1f))
                    MetricBadge(
                        "Lipinski Ro5",
                        if (metrics.lipinskiPass) "Pass (${metrics.lipinskiViolations} viol.)" else "${metrics.lipinskiViolations} viol.",
                        Modifier.weight(1f)
                    )
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                    MetricBadge("sp³ Centers", "${metrics.hybridizationCounts.sp3}", Modifier.weight(1f))
                    MetricBadge("sp² Centers", "${metrics.hybridizationCounts.sp2}", Modifier.weight(1f))
                    MetricBadge("sp Centers", "${metrics.hybridizationCounts.sp}", Modifier.weight(1f))
                }
            }

            // 5. Canonical SMILES Readout
            Surface(
                color = MaterialTheme.colorScheme.surfaceVariant,
                shape = RoundedCornerShape(8.dp),
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(modifier = Modifier.padding(10.dp)) {
                    Text(
                        text = "CANONICAL SMILES",
                        fontSize = 10.sp,
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    Spacer(Modifier.height(2.dp))
                    Text(
                        text = metrics.canonicalSmiles.ifBlank { "—" },
                        fontFamily = FontFamily.Monospace,
                        fontSize = 12.sp,
                        color = MaterialTheme.colorScheme.onSurface
                    )
                }
            }

            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)

            // 6. Deep Theoretical Evaluation (Gemini 4 Argon)
            Button(
                enabled = !isAnalyzing && molecule.atoms.isNotEmpty(),
                onClick = {
                    isAnalyzing = true
                    analysisError = null
                    scope.launch {
                        try {
                            deepAnalysis = GeminiChemService.analyzeStructure(molecule, metrics)
                        } catch (e: Exception) {
                            analysisError = e.message ?: "Theoretical analysis failed."
                        } finally {
                            isAnalyzing = false
                        }
                    }
                },
                modifier = Modifier.fillMaxWidth()
            ) {
                if (isAnalyzing) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(16.dp),
                        strokeWidth = 2.dp,
                        color = Color.White
                    )
                    Spacer(Modifier.width(8.dp))
                    Text("Running Deep Theoretical Evaluation...", fontSize = 12.sp)
                } else {
                    Icon(Icons.Default.AutoAwesome, contentDescription = null, modifier = Modifier.size(16.dp))
                    Spacer(Modifier.width(8.dp))
                    Text("Analyze Structure & Strain", fontSize = 13.sp)
                }
            }

            if (analysisError != null) {
                Surface(
                    color = MaterialTheme.colorScheme.errorContainer,
                    shape = RoundedCornerShape(8.dp),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text(
                        text = analysisError.orEmpty(),
                        color = MaterialTheme.colorScheme.onErrorContainer,
                        fontSize = 12.sp,
                        modifier = Modifier.padding(10.dp)
                    )
                }
            }

            val report = deepAnalysis
            if (report != null) {
                Surface(
                    color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.55f),
                    shape = RoundedCornerShape(10.dp),
                    border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Column(
                        modifier = Modifier.padding(12.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        Text(
                            text = report.commonName,
                            fontSize = 15.sp,
                            fontWeight = FontWeight.Bold,
                            color = MaterialTheme.colorScheme.onSurface
                        )
                        Text(
                            text = "IUPAC: ${report.iupacName}",
                            fontSize = 11.sp,
                            fontFamily = FontFamily.Monospace,
                            color = MaterialTheme.colorScheme.primary
                        )

                        ReportSection("Stability Verdict", report.stabilityVerdict)
                        ReportSection("3D VSEPR & Conformation", report.vseprAndConformation)
                        ReportSection("Electronic & Resonance", report.electronicAndResonance)

                        if (report.functionalGroups.isNotEmpty()) {
                            Text(
                                text = "Functional Groups",
                                fontSize = 12.sp,
                                fontWeight = FontWeight.Bold,
                                color = MaterialTheme.colorScheme.onSurface
                            )
                            FlowRow(
                                horizontalArrangement = Arrangement.spacedBy(6.dp),
                                verticalArrangement = Arrangement.spacedBy(4.dp)
                            ) {
                                report.functionalGroups.forEach { fg ->
                                    AssistChip(
                                        onClick = {},
                                        label = { Text(fg, fontSize = 11.sp) }
                                    )
                                }
                            }
                        }

                        if (report.predictedSpectroscopy.isNotEmpty()) {
                            Text(
                                text = "Predicted IR / NMR Diagnostic Bands",
                                fontSize = 12.sp,
                                fontWeight = FontWeight.Bold,
                                color = MaterialTheme.colorScheme.onSurface
                            )
                            report.predictedSpectroscopy.forEach { band ->
                                Text("• $band", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }

                        if (report.optimizationSuggestions.isNotEmpty()) {
                            Text(
                                text = "Structural Optimization Suggestions",
                                fontSize = 12.sp,
                                fontWeight = FontWeight.Bold,
                                color = MaterialTheme.colorScheme.onSurface
                            )
                            report.optimizationSuggestions.forEach { tip ->
                                Text("• $tip", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun MetricBadge(
    label: String,
    value: String,
    modifier: Modifier = Modifier
) {
    Surface(
        color = MaterialTheme.colorScheme.surfaceVariant,
        shape = RoundedCornerShape(8.dp),
        modifier = modifier
    ) {
        Column(modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp)) {
            Text(
                text = label.uppercase(),
                fontSize = 9.sp,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Text(
                text = value,
                fontSize = 12.sp,
                fontFamily = FontFamily.Monospace,
                fontWeight = FontWeight.SemiBold,
                color = MaterialTheme.colorScheme.onSurface
            )
        }
    }
}

@Composable
private fun ReportSection(title: String, body: String) {
    if (body.isBlank()) return
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(
            text = title,
            fontSize = 12.sp,
            fontWeight = FontWeight.Bold,
            color = MaterialTheme.colorScheme.onSurface
        )
        Text(
            text = body,
            fontSize = 12.sp,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
    }
}
