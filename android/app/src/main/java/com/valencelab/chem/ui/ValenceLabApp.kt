package com.valencelab.chem.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CameraAlt
import androidx.compose.material.icons.filled.ChatBubbleOutline
import androidx.compose.material.icons.filled.Public
import androidx.compose.material.icons.filled.Science
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.valencelab.chem.chem.ChemistryEngine
import com.valencelab.chem.chem.MoleculeGraph
import com.valencelab.chem.chem.Presets
import com.valencelab.chem.chem.PubChemCompound

private enum class AppDestination(val label: String, val icon: ImageVector) {
    WORKBENCH("Workbench", Icons.Default.Science),
    TUTOR("Tutor", Icons.Default.ChatBubbleOutline),
    VISION("Vision", Icons.Default.CameraAlt),
    PUBCHEM("PubChem", Icons.Default.Public)
}

private enum class WorkbenchPane(val label: String) {
    SKETCH_2D("2D Sketcher"),
    VIEW_3D("3D VSEPR"),
    INSPECTOR("Inspector")
}

@Composable
fun ValenceLabApp() {
    var activeDestination by remember { mutableStateOf(AppDestination.WORKBENCH) }
    var activePane by remember { mutableStateOf(WorkbenchPane.VIEW_3D) }

    var hasExplicitHydrogens by remember { mutableStateOf(false) }
    var show3DHydrogens by remember { mutableStateOf(true) }
    var molecule by remember { mutableStateOf(Presets.buildPreset("aspirin", false)) }
    val undoStack = remember { mutableStateListOf<MoleculeGraph>() }
    val redoStack = remember { mutableStateListOf<MoleculeGraph>() }
    var selectedAtomId by remember { mutableStateOf<String?>(null) }

    val metrics = remember(molecule) { ChemistryEngine.computeMoleculeMetrics(molecule) }

    val moleculeFor3D = remember(molecule, show3DHydrogens, hasExplicitHydrogens) {
        if (molecule.atoms.isEmpty()) {
            molecule
        } else if (show3DHydrogens && !hasExplicitHydrogens) {
            ChemistryEngine.expandHydrogens(molecule)
        } else {
            molecule
        }
    }

    val metricsFor3D = remember(moleculeFor3D, molecule, metrics) {
        if (moleculeFor3D === molecule) metrics else ChemistryEngine.computeMoleculeMetrics(moleculeFor3D)
    }

    fun commitMolecule(nextMol: MoleculeGraph, recordHistory: Boolean = true) {
        val with3d = if (recordHistory) ChemistryEngine.generate3DCoordinates(nextMol) else nextMol
        if (recordHistory) {
            if (undoStack.size >= 25) undoStack.removeAt(0)
            undoStack.add(molecule)
            redoStack.clear()
        }
        molecule = with3d
    }

    fun loadSmilesIntoWorkbench(smiles: String, label: String?, iupac: String? = null): Boolean {
        return try {
            val parsed = ChemistryEngine.parseSmilesToMolecule(smiles, label ?: "Custom Structure")
                .copy(iupacName = iupac)
            val prepared = if (hasExplicitHydrogens) ChemistryEngine.expandHydrogens(parsed) else parsed
            if (undoStack.size >= 25) undoStack.removeAt(0)
            undoStack.add(molecule)
            redoStack.clear()
            molecule = prepared
            selectedAtomId = null
            activeDestination = AppDestination.WORKBENCH
            activePane = WorkbenchPane.VIEW_3D
            true
        } catch (_: Exception) {
            false
        }
    }

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        topBar = {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(MaterialTheme.colorScheme.surface)
            ) {
                // Brand Bar
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 14.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(
                            contentAlignment = Alignment.Center,
                            modifier = Modifier
                                .size(32.dp)
                                .clip(RoundedCornerShape(8.dp))
                                .background(MaterialTheme.colorScheme.primary)
                        ) {
                            Icon(
                                Icons.Default.Science,
                                contentDescription = null,
                                tint = Color.White,
                                modifier = Modifier.size(18.dp)
                            )
                        }
                        Spacer(Modifier.width(10.dp))
                        Column {
                            Text(
                                text = "ValenceLab",
                                style = MaterialTheme.typography.titleMedium,
                                color = MaterialTheme.colorScheme.onSurface
                            )
                            Text(
                                text = "Theoretical Molecular Workbench",
                                fontSize = 10.sp,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    }

                    Surface(
                        color = MaterialTheme.colorScheme.surfaceVariant,
                        shape = RoundedCornerShape(8.dp)
                    ) {
                        Text(
                            text = "${metrics.formula} • ${metrics.molecularWeight} g/mol",
                            fontSize = 11.sp,
                            fontFamily = FontFamily.Monospace,
                            fontWeight = FontWeight.SemiBold,
                            color = MaterialTheme.colorScheme.onSurface,
                            modifier = Modifier.padding(horizontal = 10.dp, vertical = 5.dp)
                        )
                    }
                }

                // Preset Molecules Strip
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .horizontalScroll(rememberScrollState())
                        .padding(start = 12.dp, end = 12.dp, bottom = 8.dp),
                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    Presets.molecules.forEach { preset ->
                        val active = molecule.id == preset.id
                        Surface(
                            shape = RoundedCornerShape(8.dp),
                            color = if (active) {
                                MaterialTheme.colorScheme.primaryContainer
                            } else {
                                MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.7f)
                            },
                            border = BorderStroke(
                                1.dp,
                                if (active) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outlineVariant
                            ),
                            modifier = Modifier
                                .clip(RoundedCornerShape(8.dp))
                                .clickable {
                                    if (undoStack.size >= 25) undoStack.removeAt(0)
                                    undoStack.add(molecule)
                                    redoStack.clear()
                                    molecule = Presets.buildPreset(preset.id, hasExplicitHydrogens)
                                    selectedAtomId = null
                                    activeDestination = AppDestination.WORKBENCH
                                }
                        ) {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                modifier = Modifier.padding(horizontal = 10.dp, vertical = 5.dp)
                            ) {
                                Text(
                                    text = preset.name,
                                    fontSize = 11.sp,
                                    fontWeight = if (active) FontWeight.Bold else FontWeight.Medium,
                                    color = if (active) {
                                        MaterialTheme.colorScheme.onPrimaryContainer
                                    } else {
                                        MaterialTheme.colorScheme.onSurface
                                    }
                                )
                                Spacer(Modifier.width(5.dp))
                                Text(
                                    text = preset.formula,
                                    fontSize = 10.sp,
                                    fontFamily = FontFamily.Monospace,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                            }
                        }
                    }
                }
            }
        },
        bottomBar = {
            NavigationBar(containerColor = MaterialTheme.colorScheme.surface) {
                AppDestination.entries.forEach { dest ->
                    NavigationBarItem(
                        selected = activeDestination == dest,
                        onClick = { activeDestination = dest },
                        icon = { Icon(dest.icon, contentDescription = dest.label) },
                        label = { Text(dest.label, fontSize = 11.sp) }
                    )
                }
            }
        }
    ) { innerPadding ->
        BoxWithConstraints(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
                .padding(8.dp)
        ) {
            val isWideScreen = maxWidth >= 840.dp

            when (activeDestination) {
                AppDestination.WORKBENCH -> {
                    if (isWideScreen) {
                        // Tablet / Chromebook Split Tri-Pane Workbench
                        Row(
                            modifier = Modifier.fillMaxSize(),
                            horizontalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            Molecule2DSketcher(
                                molecule = molecule,
                                metrics = metrics,
                                selectedAtomId = selectedAtomId,
                                hasExplicitHydrogens = hasExplicitHydrogens,
                                canUndo = undoStack.isNotEmpty(),
                                canRedo = redoStack.isNotEmpty(),
                                onSelectAtom = { selectedAtomId = it },
                                onCommitMolecule = { commitMolecule(it, true) },
                                onUndo = {
                                    if (undoStack.isNotEmpty()) {
                                        val prev = undoStack.removeAt(undoStack.lastIndex)
                                        redoStack.add(molecule)
                                        molecule = prev
                                        selectedAtomId = null
                                    }
                                },
                                onRedo = {
                                    if (redoStack.isNotEmpty()) {
                                        val nxt = redoStack.removeAt(redoStack.lastIndex)
                                        undoStack.add(molecule)
                                        molecule = nxt
                                        selectedAtomId = null
                                    }
                                },
                                onToggleHydrogens = {
                                    val nextShow = !hasExplicitHydrogens
                                    hasExplicitHydrogens = nextShow
                                    val transformed = if (nextShow) {
                                        ChemistryEngine.expandHydrogens(molecule)
                                    } else {
                                        ChemistryEngine.collapseHydrogens(molecule)
                                    }
                                    commitMolecule(transformed, true)
                                    selectedAtomId = null
                                },
                                onClean2D = {
                                    commitMolecule(ChemistryEngine.clean2DLayout(molecule), true)
                                },
                                onClearCanvas = {
                                    commitMolecule(
                                        MoleculeGraph(
                                            id = "custom_${System.currentTimeMillis()}",
                                            name = "Untitled Molecule",
                                            atoms = emptyList(),
                                            bonds = emptyList()
                                        ),
                                        true
                                    )
                                    selectedAtomId = null
                                },
                                modifier = Modifier
                                    .weight(1.1f)
                                    .fillMaxHeight()
                            )

                            Molecule3DViewport(
                                molecule = moleculeFor3D,
                                metrics = metricsFor3D,
                                selectedAtomId = selectedAtomId,
                                show3DHydrogens = show3DHydrogens,
                                onToggle3DHydrogens = { show3DHydrogens = !show3DHydrogens },
                                onSelectAtom = { selectedAtomId = it },
                                onOptimize3D = {
                                    commitMolecule(ChemistryEngine.generate3DCoordinates(molecule), true)
                                },
                                modifier = Modifier
                                    .weight(1.15f)
                                    .fillMaxHeight()
                            )

                            InspectorSheet(
                                molecule = molecule,
                                metrics = metrics,
                                selectedAtomId = selectedAtomId,
                                modifier = Modifier
                                    .weight(0.9f)
                                    .fillMaxHeight()
                            )
                        }
                    } else {
                        // Compact Phone Workbench with Single-Choice Pane Switcher
                        Column(
                            modifier = Modifier.fillMaxSize(),
                            verticalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            SingleChoiceSegmentedButtonRow(modifier = Modifier.fillMaxWidth()) {
                                WorkbenchPane.entries.forEachIndexed { idx, pane ->
                                    SegmentedButton(
                                        shape = SegmentedButtonDefaults.itemShape(
                                            index = idx,
                                            count = WorkbenchPane.entries.size
                                        ),
                                        selected = activePane == pane,
                                        onClick = { activePane = pane },
                                        label = { Text(pane.label, fontSize = 12.sp) }
                                    )
                                }
                            }

                            Box(
                                modifier = Modifier
                                    .weight(1f)
                                    .fillMaxWidth()
                            ) {
                                when (activePane) {
                                    WorkbenchPane.SKETCH_2D -> {
                                        Molecule2DSketcher(
                                            molecule = molecule,
                                            metrics = metrics,
                                            selectedAtomId = selectedAtomId,
                                            hasExplicitHydrogens = hasExplicitHydrogens,
                                            canUndo = undoStack.isNotEmpty(),
                                            canRedo = redoStack.isNotEmpty(),
                                            onSelectAtom = { selectedAtomId = it },
                                            onCommitMolecule = { commitMolecule(it, true) },
                                            onUndo = {
                                                if (undoStack.isNotEmpty()) {
                                                    val prev = undoStack.removeAt(undoStack.lastIndex)
                                                    redoStack.add(molecule)
                                                    molecule = prev
                                                    selectedAtomId = null
                                                }
                                            },
                                            onRedo = {
                                                if (redoStack.isNotEmpty()) {
                                                    val nxt = redoStack.removeAt(redoStack.lastIndex)
                                                    undoStack.add(molecule)
                                                    molecule = nxt
                                                    selectedAtomId = null
                                                }
                                            },
                                            onToggleHydrogens = {
                                                val nextShow = !hasExplicitHydrogens
                                                hasExplicitHydrogens = nextShow
                                                val transformed = if (nextShow) {
                                                    ChemistryEngine.expandHydrogens(molecule)
                                                } else {
                                                    ChemistryEngine.collapseHydrogens(molecule)
                                                }
                                                commitMolecule(transformed, true)
                                                selectedAtomId = null
                                            },
                                            onClean2D = {
                                                commitMolecule(ChemistryEngine.clean2DLayout(molecule), true)
                                            },
                                            onClearCanvas = {
                                                commitMolecule(
                                                    MoleculeGraph(
                                                        id = "custom_${System.currentTimeMillis()}",
                                                        name = "Untitled Molecule",
                                                        atoms = emptyList(),
                                                        bonds = emptyList()
                                                    ),
                                                    true
                                                )
                                                selectedAtomId = null
                                            }
                                        )
                                    }
                                    WorkbenchPane.VIEW_3D -> {
                                        Molecule3DViewport(
                                            molecule = moleculeFor3D,
                                            metrics = metricsFor3D,
                                            selectedAtomId = selectedAtomId,
                                            show3DHydrogens = show3DHydrogens,
                                            onToggle3DHydrogens = { show3DHydrogens = !show3DHydrogens },
                                            onSelectAtom = { selectedAtomId = it },
                                            onOptimize3D = {
                                                commitMolecule(ChemistryEngine.generate3DCoordinates(molecule), true)
                                            }
                                        )
                                    }
                                    WorkbenchPane.INSPECTOR -> {
                                        InspectorSheet(
                                            molecule = molecule,
                                            metrics = metrics,
                                            selectedAtomId = selectedAtomId
                                        )
                                    }
                                }
                            }
                        }
                    }
                }
                AppDestination.TUTOR -> {
                    TutorScreen(
                        molecule = molecule,
                        metrics = metrics,
                        onLoadSmilesInWorkbench = { smi, lbl ->
                            loadSmilesIntoWorkbench(smi, lbl)
                        }
                    )
                }
                AppDestination.VISION -> {
                    VisionScreen(
                        onLoadSmilesInWorkbench = { smi, lbl ->
                            loadSmilesIntoWorkbench(smi, lbl)
                        }
                    )
                }
                AppDestination.PUBCHEM -> {
                    PubChemScreen(
                        onLoadCompound = { compound: PubChemCompound ->
                            val smi = compound.smiles ?: return@PubChemScreen false
                            loadSmilesIntoWorkbench(
                                smiles = smi,
                                label = compound.iupacName ?: "CID ${compound.cid}",
                                iupac = compound.iupacName
                            )
                        }
                    )
                }
            }
        }
    }
}
