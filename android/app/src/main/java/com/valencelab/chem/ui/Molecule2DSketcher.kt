package com.valencelab.chem.ui

import android.graphics.Paint
import android.graphics.Typeface
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Redo
import androidx.compose.material.icons.automirrored.filled.Undo
import androidx.compose.material.icons.filled.AutoFixHigh
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.DeleteSweep
import androidx.compose.material.icons.filled.GridView
import androidx.compose.material.icons.filled.Science
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.valencelab.chem.chem.AtomNode
import com.valencelab.chem.chem.BondEdge
import com.valencelab.chem.chem.ChemistryEngine
import com.valencelab.chem.chem.ElementCategory
import com.valencelab.chem.chem.ElementSpec
import com.valencelab.chem.chem.ElementSymbol
import com.valencelab.chem.chem.Elements
import com.valencelab.chem.chem.FragmentTemplate
import com.valencelab.chem.chem.MoleculeGraph
import com.valencelab.chem.chem.MoleculeMetrics
import com.valencelab.chem.chem.Presets
import com.valencelab.chem.chem.StereoType
import com.valencelab.chem.data.GeminiChemService
import kotlinx.coroutines.launch
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlin.math.sqrt

enum class SketchTool(val label: String) {
    SELECT("Select"),
    BOND_1("Single"),
    BOND_2("Double"),
    BOND_3("Triple"),
    WEDGE("Wedge"),
    DASH("Dash"),
    RING6("Ring 6"),
    BENZENE("Benzene"),
    ERASE("Erase")
}

private data class RingCycle(
    val atomIds: Set<String>,
    val cx: Float,
    val cy: Float,
    val isAromatic6: Boolean
)

@Composable
fun Molecule2DSketcher(
    molecule: MoleculeGraph,
    metrics: MoleculeMetrics,
    selectedAtomId: String?,
    hasExplicitHydrogens: Boolean,
    canUndo: Boolean,
    canRedo: Boolean,
    onSelectAtom: (String?) -> Unit,
    onCommitMolecule: (MoleculeGraph) -> Unit,
    onUndo: () -> Unit,
    onRedo: () -> Unit,
    onToggleHydrogens: () -> Unit,
    onClean2D: () -> Unit,
    onClearCanvas: () -> Unit,
    modifier: Modifier = Modifier
) {
    var activeTool by remember { mutableStateOf(SketchTool.BOND_1) }
    var activeElement by remember { mutableStateOf(ElementSymbol.C) }
    var showAiBar by remember { mutableStateOf(false) }
    var aiPrompt by remember { mutableStateOf("") }
    var isSynthesizing by remember { mutableStateOf(false) }
    var aiError by remember { mutableStateOf<String?>(null) }
    var showSmilesInput by remember { mutableStateOf(false) }
    var smilesDraft by remember { mutableStateOf("") }
    var showPeriodicTable by remember { mutableStateOf(false) }

    val scope = rememberCoroutineScope()

    // Live drag preview state
    var dragFromAtomId by remember { mutableStateOf<String?>(null) }
    var dragCurrentScreen by remember { mutableStateOf<Offset?>(null) }
    var dragMovingAtomId by remember { mutableStateOf<String?>(null) }
    var dragLastScreen by remember { mutableStateOf<Offset?>(null) }

    val latestMolecule by rememberUpdatedState(molecule)
    val latestTool by rememberUpdatedState(activeTool)
    val latestElement by rememberUpdatedState(activeElement)
    val latestSelectedAtomId by rememberUpdatedState(selectedAtomId)

    val ringCycles = remember(molecule) { findRingCyclesForDrawing(molecule) }

    Surface(
        modifier = modifier.fillMaxSize(),
        color = MaterialTheme.colorScheme.surface,
        shape = RoundedCornerShape(12.dp),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)
    ) {
        Column(modifier = Modifier.fillMaxSize()) {
            // Top Utility Row
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.6f))
                    .padding(horizontal = 8.dp, vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    IconButton(onClick = onUndo, enabled = canUndo, modifier = Modifier.size(34.dp)) {
                        Icon(
                            Icons.AutoMirrored.Filled.Undo,
                            contentDescription = "Undo",
                            modifier = Modifier.size(18.dp)
                        )
                    }
                    IconButton(onClick = onRedo, enabled = canRedo, modifier = Modifier.size(34.dp)) {
                        Icon(
                            Icons.AutoMirrored.Filled.Redo,
                            contentDescription = "Redo",
                            modifier = Modifier.size(18.dp)
                        )
                    }
                    FilterChip(
                        selected = hasExplicitHydrogens,
                        onClick = onToggleHydrogens,
                        label = { Text(if (hasExplicitHydrogens) "H: Shown" else "H: Skeletal", fontSize = 11.sp) },
                        modifier = Modifier.height(28.dp)
                    )
                    Spacer(Modifier.width(4.dp))
                    IconButton(onClick = onClean2D, modifier = Modifier.size(34.dp)) {
                        Icon(
                            Icons.Default.AutoFixHigh,
                            contentDescription = "Clean 2D Layout",
                            modifier = Modifier.size(18.dp)
                        )
                    }
                    IconButton(onClick = onClearCanvas, modifier = Modifier.size(34.dp)) {
                        Icon(
                            Icons.Default.DeleteSweep,
                            contentDescription = "Clear Sheet",
                            modifier = Modifier.size(18.dp)
                        )
                    }
                }

                Row(verticalAlignment = Alignment.CenterVertically) {
                    OutlinedButton(
                        onClick = {
                            showSmilesInput = !showSmilesInput
                            if (showSmilesInput) showAiBar = false
                            smilesDraft = metrics.canonicalSmiles
                            aiError = null
                        },
                        contentPadding = PaddingValues(horizontal = 8.dp, vertical = 0.dp),
                        modifier = Modifier.height(28.dp)
                    ) {
                        Text("SMILES", fontSize = 11.sp)
                    }
                    Spacer(Modifier.width(4.dp))
                    Button(
                        onClick = {
                            showAiBar = !showAiBar
                            if (showAiBar) showSmilesInput = false
                            aiError = null
                        },
                        contentPadding = PaddingValues(horizontal = 10.dp, vertical = 0.dp),
                        modifier = Modifier.height(28.dp)
                    ) {
                        Icon(Icons.Default.AutoAwesome, contentDescription = null, modifier = Modifier.size(14.dp))
                        Spacer(Modifier.width(4.dp))
                        Text("AI Draw", fontSize = 11.sp)
                    }
                }
            }

            // Optional SMILES Loader Bar
            if (showSmilesInput) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(MaterialTheme.colorScheme.surfaceVariant)
                        .padding(8.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    OutlinedTextField(
                        value = smilesDraft,
                        onValueChange = { smilesDraft = it; aiError = null },
                        label = { Text("Enter SMILES (e.g. CC(=O)O, c1ccccc1)", fontSize = 11.sp) },
                        singleLine = true,
                        modifier = Modifier.weight(1f)
                    )
                    Spacer(Modifier.width(8.dp))
                    Button(
                        onClick = {
                            try {
                                val parsed = ChemistryEngine.parseSmilesToMolecule(
                                    smilesDraft,
                                    "Custom Structure"
                                )
                                val finalMol = if (hasExplicitHydrogens) {
                                    ChemistryEngine.expandHydrogens(parsed)
                                } else {
                                    parsed
                                }
                                onCommitMolecule(finalMol)
                                onSelectAtom(null)
                                showSmilesInput = false
                            } catch (e: Exception) {
                                aiError = e.message ?: "Invalid SMILES syntax."
                            }
                        }
                    ) {
                        Text("Load", fontSize = 12.sp)
                    }
                }
            }

            // Optional AI Molecule Synthesizer Bar
            if (showAiBar) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.45f))
                        .padding(8.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    OutlinedTextField(
                        value = aiPrompt,
                        onValueChange = { aiPrompt = it; aiError = null },
                        label = { Text("Describe molecule or edit (e.g. 'add a nitro group')", fontSize = 11.sp) },
                        singleLine = true,
                        enabled = !isSynthesizing,
                        modifier = Modifier.weight(1f)
                    )
                    Spacer(Modifier.width(8.dp))
                    Button(
                        enabled = !isSynthesizing && aiPrompt.isNotBlank(),
                        onClick = {
                            val promptText = aiPrompt.trim()
                            isSynthesizing = true
                            aiError = null
                            scope.launch {
                                try {
                                    val res = GeminiChemService.synthesizeMolecule(
                                        prompt = promptText,
                                        currentSmiles = metrics.canonicalSmiles.takeIf { molecule.atoms.isNotEmpty() }
                                    )
                                    val parsed = ChemistryEngine.parseSmilesToMolecule(
                                        res.smiles,
                                        res.name.ifBlank { promptText }
                                    ).copy(iupacName = res.iupacName.takeIf { it.isNotBlank() })
                                    val prepared = if (hasExplicitHydrogens) {
                                        ChemistryEngine.expandHydrogens(parsed)
                                    } else {
                                        parsed
                                    }
                                    onCommitMolecule(prepared)
                                    onSelectAtom(null)
                                    aiPrompt = ""
                                    showAiBar = false
                                } catch (e: Exception) {
                                    aiError = e.message ?: "Synthesis failed."
                                } finally {
                                    isSynthesizing = false
                                }
                            }
                        }
                    ) {
                        if (isSynthesizing) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(16.dp),
                                strokeWidth = 2.dp,
                                color = Color.White
                            )
                        } else {
                            Text("Synthesize", fontSize = 12.sp)
                        }
                    }
                }
            }

            if (aiError != null) {
                Surface(
                    color = MaterialTheme.colorScheme.errorContainer,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text(
                        text = aiError.orEmpty(),
                        color = MaterialTheme.colorScheme.onErrorContainer,
                        fontSize = 12.sp,
                        modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp)
                    )
                }
            }

            // Bond & Structure Tool Strip
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState())
                    .padding(horizontal = 8.dp, vertical = 4.dp),
                horizontalArrangement = Arrangement.spacedBy(4.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                SketchTool.entries.forEach { tool ->
                    val selected = activeTool == tool
                    FilterChip(
                        selected = selected,
                        onClick = { activeTool = tool },
                        label = { Text(tool.label, fontSize = 11.sp) },
                        colors = FilterChipDefaults.filterChipColors(
                            selectedContainerColor = MaterialTheme.colorScheme.primary,
                            selectedLabelColor = Color.White
                        ),
                        modifier = Modifier.height(28.dp)
                    )
                }
            }

            // Element & Substituent Fragment Strip
            val activateElement: (ElementSymbol) -> Unit = { sym ->
                activeElement = sym
                if (activeTool in listOf(
                        SketchTool.SELECT,
                        SketchTool.ERASE,
                        SketchTool.RING6,
                        SketchTool.BENZENE
                    )
                ) {
                    activeTool = SketchTool.BOND_1
                }
                if (selectedAtomId != null) {
                    val updated = molecule.atoms.map {
                        if (it.id == selectedAtomId) it.copy(element = sym) else it
                    }
                    onCommitMolecule(molecule.copy(smiles = null, atoms = updated))
                }
            }

            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState())
                    .padding(horizontal = 8.dp, vertical = 2.dp),
                horizontalArrangement = Arrangement.spacedBy(4.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                OutlinedButton(
                    onClick = { showPeriodicTable = true },
                    contentPadding = PaddingValues(horizontal = 8.dp, vertical = 0.dp),
                    modifier = Modifier.height(28.dp)
                ) {
                    Icon(
                        Icons.Default.GridView,
                        contentDescription = "Periodic Table",
                        modifier = Modifier.size(14.dp)
                    )
                    Spacer(Modifier.width(4.dp))
                    Text("Periodic Table", fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
                }

                if (activeElement !in Elements.paletteOrder) {
                    val activeSpec = Elements.specOf(activeElement)
                    Surface(
                        shape = RoundedCornerShape(8.dp),
                        color = MaterialTheme.colorScheme.primaryContainer,
                        border = BorderStroke(1.dp, MaterialTheme.colorScheme.primary),
                        modifier = Modifier
                            .height(28.dp)
                            .clip(RoundedCornerShape(8.dp))
                            .clickable { showPeriodicTable = true }
                    ) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            modifier = Modifier.padding(horizontal = 8.dp)
                        ) {
                            Box(
                                modifier = Modifier
                                    .size(8.dp)
                                    .clip(CircleShape)
                                    .background(activeElement.cpkColor())
                                    .border(0.5.dp, Color(0xFF64748B), CircleShape)
                            )
                            Spacer(Modifier.width(4.dp))
                            Text(
                                text = "${activeSpec.symbol.symbol} (${activeSpec.atomicNumber})",
                                fontSize = 11.sp,
                                fontWeight = FontWeight.Bold,
                                color = MaterialTheme.colorScheme.onPrimaryContainer
                            )
                        }
                    }
                }

                Elements.paletteOrder.forEach { elem ->
                    val isSelected = activeElement == elem && activeTool !in listOf(
                        SketchTool.SELECT,
                        SketchTool.ERASE,
                        SketchTool.RING6,
                        SketchTool.BENZENE
                    )
                    Surface(
                        shape = RoundedCornerShape(8.dp),
                        color = if (isSelected) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceVariant,
                        border = BorderStroke(
                            1.dp,
                            if (isSelected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outlineVariant
                        ),
                        modifier = Modifier
                            .height(28.dp)
                            .clip(RoundedCornerShape(8.dp))
                            .clickable { activateElement(elem) }
                    ) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            modifier = Modifier.padding(horizontal = 8.dp)
                        ) {
                            Box(
                                modifier = Modifier
                                    .size(8.dp)
                                    .clip(CircleShape)
                                    .background(elem.cpkColor())
                                    .border(0.5.dp, Color(0xFF64748B), CircleShape)
                            )
                            Spacer(Modifier.width(4.dp))
                            Text(
                                text = elem.symbol,
                                fontSize = 11.sp,
                                fontWeight = FontWeight.Bold,
                                color = if (isSelected) MaterialTheme.colorScheme.onPrimaryContainer else MaterialTheme.colorScheme.onSurface
                            )
                        }
                    }
                }

                Spacer(Modifier.width(6.dp))

                Presets.fragments.forEach { frag ->
                    OutlinedButton(
                        onClick = {
                            val next = attachFragmentToMolecule(
                                molecule = molecule,
                                anchorAtomId = selectedAtomId ?: molecule.atoms.lastOrNull()?.id,
                                fragment = frag
                            )
                            onCommitMolecule(next)
                        },
                        contentPadding = PaddingValues(horizontal = 8.dp, vertical = 0.dp),
                        modifier = Modifier.height(28.dp)
                    ) {
                        Text(frag.shortLabel, fontSize = 11.sp)
                    }
                }
            }

            // Interactive 2D Chemical Sketching Canvas
            Box(
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth()
                    .background(Color(0xFFFCFDFE))
            ) {
                Canvas(
                    modifier = Modifier
                        .fillMaxSize()
                        .pointerInput(Unit) {
                            detectTapGestures { tapOffset ->
                                val mol = latestMolecule
                                val hitAtom = findAtomAt(mol, tapOffset, 24f)
                                val hitBond = if (hitAtom == null) findBondAt(mol, tapOffset, 16f) else null

                                handleCanvasTap(
                                    mol = mol,
                                    tapPos = tapOffset,
                                    hitAtom = hitAtom,
                                    hitBond = hitBond,
                                    tool = latestTool,
                                    element = latestElement,
                                    onSelectAtom = onSelectAtom,
                                    onCommitMolecule = onCommitMolecule
                                )
                            }
                        }
                        .pointerInput(Unit) {
                            detectDragGestures(
                                onDragStart = { startOffset ->
                                    val mol = latestMolecule
                                    val tool = latestTool
                                    val hitAtom = findAtomAt(mol, startOffset, 24f)
                                    if (tool == SketchTool.SELECT) {
                                        dragMovingAtomId = hitAtom?.id
                                        dragLastScreen = startOffset
                                        if (hitAtom != null) onSelectAtom(hitAtom.id)
                                    } else if (tool in listOf(
                                            SketchTool.BOND_1,
                                            SketchTool.BOND_2,
                                            SketchTool.BOND_3,
                                            SketchTool.WEDGE,
                                            SketchTool.DASH
                                        )
                                    ) {
                                        if (hitAtom != null) {
                                            dragFromAtomId = hitAtom.id
                                            dragCurrentScreen = Offset(hitAtom.x2d, hitAtom.y2d)
                                        } else {
                                            val newId = "a_${System.currentTimeMillis()}"
                                            val newAtom = AtomNode(
                                                id = newId,
                                                element = latestElement,
                                                x2d = startOffset.x,
                                                y2d = startOffset.y
                                            )
                                            onCommitMolecule(
                                                mol.copy(
                                                    smiles = null,
                                                    atoms = mol.atoms + newAtom
                                                )
                                            )
                                            dragFromAtomId = newId
                                            dragCurrentScreen = startOffset
                                        }
                                    }
                                },
                                onDrag = { change, _ ->
                                    change.consume()
                                    val pos = change.position
                                    val mol = latestMolecule
                                    val tool = latestTool
                                    if (tool == SketchTool.SELECT) {
                                        val prev = dragLastScreen ?: pos
                                        val dx = pos.x - prev.x
                                        val dy = pos.y - prev.y
                                        dragLastScreen = pos
                                        val movingId = dragMovingAtomId
                                        val updatedAtoms = if (movingId != null) {
                                            mol.atoms.map {
                                                if (it.id == movingId) {
                                                    it.copy(x2d = it.x2d + dx, y2d = it.y2d + dy)
                                                } else {
                                                    it
                                                }
                                            }
                                        } else {
                                            mol.atoms.map {
                                                it.copy(x2d = it.x2d + dx, y2d = it.y2d + dy)
                                            }
                                        }
                                        onCommitMolecule(
                                            ChemistryEngine.generate3DCoordinates(
                                                mol.copy(atoms = updatedAtoms)
                                            )
                                        )
                                    } else if (dragFromAtomId != null) {
                                        val fromAtom = mol.atoms.firstOrNull { it.id == dragFromAtomId }
                                        if (fromAtom != null) {
                                            val snapTarget = findAtomAt(mol, pos, 22f)
                                                ?.takeIf { it.id != fromAtom.id }
                                            dragCurrentScreen = if (snapTarget != null) {
                                                Offset(snapTarget.x2d, snapTarget.y2d)
                                            } else {
                                                snapAngleOffset(
                                                    origin = Offset(fromAtom.x2d, fromAtom.y2d),
                                                    raw = pos,
                                                    fixedLength = ChemistryEngine.BOND_2D_LENGTH
                                                )
                                            }
                                        }
                                    }
                                },
                                onDragEnd = {
                                    val fromId = dragFromAtomId
                                    val endPos = dragCurrentScreen
                                    dragFromAtomId = null
                                    dragCurrentScreen = null
                                    dragMovingAtomId = null
                                    dragLastScreen = null

                                    if (fromId != null && endPos != null) {
                                        val mol = latestMolecule
                                        val fromAtom = mol.atoms.firstOrNull { it.id == fromId }
                                            ?: return@detectDragGestures
                                        val dist = hypot(endPos.x - fromAtom.x2d, endPos.y - fromAtom.y2d)
                                        if (dist > 14f) {
                                            val targetAtom = findAtomAt(mol, endPos, 22f)
                                                ?.takeIf { it.id != fromId }
                                            val (order, stereo) = toolBondSpec(latestTool)
                                            if (targetAtom != null) {
                                                val next = upsertBond(
                                                    mol = mol,
                                                    fromId = fromId,
                                                    toId = targetAtom.id,
                                                    order = order,
                                                    stereo = stereo
                                                )
                                                onCommitMolecule(next)
                                            } else {
                                                val newAtomId = "a_${System.currentTimeMillis()}"
                                                val newAtom = AtomNode(
                                                    id = newAtomId,
                                                    element = latestElement,
                                                    x2d = endPos.x,
                                                    y2d = endPos.y
                                                )
                                                val newBond = BondEdge(
                                                    id = "b_${System.currentTimeMillis()}",
                                                    from = fromId,
                                                    to = newAtomId,
                                                    order = order,
                                                    stereo = stereo
                                                )
                                                onCommitMolecule(
                                                    mol.copy(
                                                        smiles = null,
                                                        atoms = mol.atoms + newAtom,
                                                        bonds = mol.bonds + newBond
                                                    )
                                                )
                                            }
                                        }
                                    }
                                },
                                onDragCancel = {
                                    dragFromAtomId = null
                                    dragCurrentScreen = null
                                    dragMovingAtomId = null
                                    dragLastScreen = null
                                }
                            )
                        }
                ) {
                    // 1. Subtle laboratory grid
                    val step = 28.dp.toPx()
                    val gridColor = Color(0xFFF1F5F9)
                    var gx = step
                    while (gx < size.width) {
                        drawLine(gridColor, Offset(gx, 0f), Offset(gx, size.height), strokeWidth = 1f)
                        gx += step
                    }
                    var gy = step
                    while (gy < size.height) {
                        drawLine(gridColor, Offset(0f, gy), Offset(size.width, gy), strokeWidth = 1f)
                        gy += step
                    }

                    // 2. Aromatic 6-membered ring inner circles
                    ringCycles.filter { it.isAromatic6 }.forEach { ring ->
                        drawCircle(
                            color = Color(0xFF475569).copy(alpha = 0.55f),
                            radius = ChemistryEngine.BOND_2D_LENGTH * 0.62f,
                            center = Offset(ring.cx, ring.cy),
                            style = Stroke(width = 1.6.dp.toPx())
                        )
                    }

                    val atomMap = molecule.atoms.associateBy { it.id }

                    // 3. Draw chemical bonds
                    molecule.bonds.forEach { bond ->
                        val a1 = atomMap[bond.from] ?: return@forEach
                        val a2 = atomMap[bond.to] ?: return@forEach
                        val enclosingRing = ringCycles.firstOrNull {
                            it.atomIds.contains(a1.id) && it.atomIds.contains(a2.id)
                        }
                        drawChemicalBond2D(
                            a1 = a1,
                            a2 = a2,
                            bond = bond,
                            ringCenter = enclosingRing?.let { Offset(it.cx, it.cy) }
                        )
                    }

                    // 4. Rubber-band preview bond while dragging
                    val previewFrom = dragFromAtomId?.let { atomMap[it] }
                    val previewTo = dragCurrentScreen
                    if (previewFrom != null && previewTo != null) {
                        drawLine(
                            color = Color(0xFF2563EB),
                            start = Offset(previewFrom.x2d, previewFrom.y2d),
                            end = previewTo,
                            strokeWidth = 2.5.dp.toPx(),
                            pathEffect = PathEffect.dashPathEffect(floatArrayOf(10f, 8f)),
                            cap = StrokeCap.Round
                        )
                    }

                    // 5. Draw atoms & labels
                    val neighborCounts = mutableMapOf<String, Int>()
                    molecule.bonds.forEach {
                        neighborCounts[it.from] = (neighborCounts[it.from] ?: 0) + 1
                        neighborCounts[it.to] = (neighborCounts[it.to] ?: 0) + 1
                    }

                    molecule.atoms.forEach { atom ->
                        val analysis = metrics.atomAnalyses[atom.id]
                        val isSelected = atom.id == selectedAtomId
                        val isValenceInvalid = analysis?.valenceValid == false
                        val deg = neighborCounts[atom.id] ?: 0

                        if (isSelected) {
                            drawCircle(
                                color = Color(0xFF2563EB).copy(alpha = 0.18f),
                                radius = 19.dp.toPx(),
                                center = Offset(atom.x2d, atom.y2d)
                            )
                            drawCircle(
                                color = Color(0xFF2563EB),
                                radius = 15.dp.toPx(),
                                center = Offset(atom.x2d, atom.y2d),
                                style = Stroke(width = 1.6.dp.toPx())
                            )
                        }

                        if (isValenceInvalid) {
                            drawCircle(
                                color = Color(0xFFDC2626).copy(alpha = 0.28f),
                                radius = 21.dp.toPx(),
                                center = Offset(atom.x2d, atom.y2d)
                            )
                        }

                        val showLabel = atom.element != ElementSymbol.C ||
                            hasExplicitHydrogens ||
                            deg == 0 ||
                            atom.formalCharge != 0

                        if (showLabel) {
                            val implicitH = analysis?.implicitHydrogens ?: 0
                            val hText = if (!hasExplicitHydrogens && implicitH > 0) {
                                if (implicitH == 1) "H" else "H$implicitH"
                            } else {
                                ""
                            }
                            val chgText = when {
                                atom.formalCharge > 1 -> "+${atom.formalCharge}"
                                atom.formalCharge == 1 -> "+"
                                atom.formalCharge < -1 -> "${atom.formalCharge}"
                                atom.formalCharge == -1 -> "-"
                                else -> ""
                            }
                            val fullLabel = "${atom.element.symbol}$hText$chgText"

                            // Knock-out white backing disc so bond lines don't cross letters
                            drawCircle(
                                color = Color(0xFFFCFDFE),
                                radius = 12.dp.toPx(),
                                center = Offset(atom.x2d, atom.y2d)
                            )

                            drawContext.canvas.nativeCanvas.apply {
                                val textPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                                    textAlign = Paint.Align.CENTER
                                    textSize = 13.sp.toPx()
                                    typeface = Typeface.create(Typeface.SANS_SERIF, Typeface.BOLD)
                                    color = if (atom.element == ElementSymbol.C) {
                                        Color(0xFF0F172A).toArgb()
                                    } else {
                                        atom.element.cpkColor().toArgb()
                                    }
                                }
                                val yBaseline = atom.y2d - (textPaint.descent() + textPaint.ascent()) / 2f
                                drawText(fullLabel, atom.x2d, yBaseline, textPaint)
                            }
                        } else if (isSelected) {
                            drawCircle(
                                color = Color(0xFF2563EB),
                                radius = 4.dp.toPx(),
                                center = Offset(atom.x2d, atom.y2d)
                            )
                        }
                    }
                }

                // Bottom-left helpful hint
                Surface(
                    color = MaterialTheme.colorScheme.surface.copy(alpha = 0.88f),
                    shape = RoundedCornerShape(6.dp),
                    border = BorderStroke(0.5.dp, MaterialTheme.colorScheme.outlineVariant),
                    modifier = Modifier
                        .align(Alignment.BottomStart)
                        .padding(8.dp)
                ) {
                    Text(
                        text = if (molecule.atoms.isEmpty()) {
                            "Tap or drag anywhere to draw atoms, bonds, or rings"
                        } else {
                            "Tap atom to sprout/inspect • Drag from atom to bond"
                        },
                        fontSize = 10.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp)
                    )
                }
            }
        }
    }

    if (showPeriodicTable) {
        PeriodicTableDialog(
            activeElement = activeElement,
            onSelectElement = { chosen ->
                activeElement = chosen
                if (activeTool in listOf(
                        SketchTool.SELECT,
                        SketchTool.ERASE,
                        SketchTool.RING6,
                        SketchTool.BENZENE
                    )
                ) {
                    activeTool = SketchTool.BOND_1
                }
                if (selectedAtomId != null) {
                    val updated = molecule.atoms.map {
                        if (it.id == selectedAtomId) it.copy(element = chosen) else it
                    }
                    onCommitMolecule(molecule.copy(smiles = null, atoms = updated))
                }
                showPeriodicTable = false
            },
            onDismiss = { showPeriodicTable = false }
        )
    }
}

@Composable
private fun PeriodicTableDialog(
    activeElement: ElementSymbol,
    onSelectElement: (ElementSymbol) -> Unit,
    onDismiss: () -> Unit
) {
    var searchQuery by remember { mutableStateOf("") }
    var selectedCategory by remember { mutableStateOf<ElementCategory?>(null) }
    var showGridView by remember { mutableStateOf(false) }

    val filteredElements = remember(searchQuery, selectedCategory) {
        val q = searchQuery.trim().lowercase()
        Elements.allPeriodicElements.filter { spec ->
            val catOk = selectedCategory == null || spec.category == selectedCategory
            if (!catOk) return@filter false
            if (q.isEmpty()) return@filter true
            spec.symbol.symbol.lowercase().contains(q) ||
                spec.name.lowercase().contains(q) ||
                spec.atomicNumber.toString() == q ||
                spec.category.label.lowercase().contains(q)
        }
    }

    val activeSpec = remember(activeElement) { Elements.specOf(activeElement) }

    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false)
    ) {
        Surface(
            modifier = Modifier
                .fillMaxWidth(0.95f)
                .fillMaxHeight(0.88f),
            shape = RoundedCornerShape(16.dp),
            color = MaterialTheme.colorScheme.surface,
            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)
        ) {
            Column(modifier = Modifier.fillMaxSize()) {
                // Header
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.65f))
                        .padding(horizontal = 14.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = "Periodic Table & Element Directory",
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.Bold
                        )
                        Text(
                            text = "118 IUPAC elements • Tap any element to draw",
                            fontSize = 11.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        FilterChip(
                            selected = showGridView,
                            onClick = { showGridView = !showGridView },
                            label = { Text(if (showGridView) "18-Col Grid" else "List (118)", fontSize = 11.sp) },
                            modifier = Modifier.height(30.dp)
                        )
                        Spacer(Modifier.width(4.dp))
                        IconButton(onClick = onDismiss, modifier = Modifier.size(34.dp)) {
                            Icon(Icons.Default.Close, contentDescription = "Close Periodic Table")
                        }
                    }
                }

                // Active Element Summary Strip
                Surface(
                    color = MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.35f),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 14.dp, vertical = 6.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Box(
                                contentAlignment = Alignment.Center,
                                modifier = Modifier
                                    .size(28.dp)
                                    .clip(RoundedCornerShape(6.dp))
                                    .background(Color(activeSpec.cpkColorHex))
                                    .border(1.dp, Color(0xFF94A3B8), RoundedCornerShape(6.dp))
                            ) {
                                Text(
                                    text = activeSpec.symbol.symbol,
                                    fontSize = 12.sp,
                                    fontWeight = FontWeight.Bold,
                                    color = Color(activeSpec.cpkTextColorHex)
                                )
                            }
                            Spacer(Modifier.width(8.dp))
                            Column {
                                Text(
                                    text = "${activeSpec.name} (Z=${activeSpec.atomicNumber})",
                                    fontSize = 12.sp,
                                    fontWeight = FontWeight.SemiBold
                                )
                                Text(
                                    text = "${activeSpec.category.label} • ${activeSpec.atomicMass} u • Valences ${activeSpec.standardValences.joinToString("/")}",
                                    fontSize = 10.sp,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                            }
                        }
                        Text(
                            text = "${filteredElements.size} shown",
                            fontSize = 11.sp,
                            fontFamily = FontFamily.Monospace,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }

                // Search Bar + Category Filter Chips
                Column(modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp)) {
                    OutlinedTextField(
                        value = searchQuery,
                        onValueChange = { searchQuery = it },
                        leadingIcon = {
                            Icon(Icons.Default.Search, contentDescription = null, modifier = Modifier.size(18.dp))
                        },
                        placeholder = {
                            Text("Search symbol, name, or atomic # (e.g. Fe, Gold, 79)", fontSize = 12.sp)
                        },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )

                    Spacer(Modifier.height(6.dp))

                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .horizontalScroll(rememberScrollState()),
                        horizontalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        FilterChip(
                            selected = selectedCategory == null,
                            onClick = { selectedCategory = null },
                            label = { Text("All (118)", fontSize = 11.sp) },
                            modifier = Modifier.height(28.dp)
                        )
                        ElementCategory.entries.forEach { cat ->
                            FilterChip(
                                selected = selectedCategory == cat,
                                onClick = {
                                    selectedCategory = if (selectedCategory == cat) null else cat
                                },
                                label = { Text(cat.label, fontSize = 11.sp) },
                                modifier = Modifier.height(28.dp)
                            )
                        }
                    }
                }

                if (showGridView) {
                    // Horizontally scrollable 18-column Periodic Table Grid
                    val filteredSet = remember(filteredElements) {
                        filteredElements.map { it.symbol }.toSet()
                    }
                    val mainTable = remember {
                        Elements.allPeriodicElements.filter {
                            it.atomicNumber !in 57..71 && it.atomicNumber !in 89..103
                        }
                    }
                    val lanthanides = remember {
                        Elements.allPeriodicElements.filter { it.atomicNumber in 57..71 }
                    }
                    val actinides = remember {
                        Elements.allPeriodicElements.filter { it.atomicNumber in 89..103 }
                    }

                    LazyColumn(
                        modifier = Modifier
                            .weight(1f)
                            .fillMaxWidth()
                            .padding(horizontal = 10.dp),
                        contentPadding = PaddingValues(bottom = 12.dp)
                    ) {
                        item {
                            Column(
                                modifier = Modifier.horizontalScroll(rememberScrollState()),
                                verticalArrangement = Arrangement.spacedBy(3.dp)
                            ) {
                                for (period in 1..7) {
                                    Row(horizontalArrangement = Arrangement.spacedBy(3.dp)) {
                                        for (group in 1..18) {
                                            val cellSpec = mainTable.firstOrNull {
                                                it.period == period && it.group == group
                                            }
                                            if (cellSpec != null) {
                                                PeriodicGridCell(
                                                    spec = cellSpec,
                                                    isSelected = cellSpec.symbol == activeElement,
                                                    isHighlighted = cellSpec.symbol in filteredSet,
                                                    onClick = { onSelectElement(cellSpec.symbol) }
                                                )
                                            } else if (period == 6 && group == 3) {
                                                Spacer(Modifier.width(40.dp))
                                            } else if (period == 7 && group == 3) {
                                                Spacer(Modifier.width(40.dp))
                                            } else {
                                                Spacer(Modifier.width(40.dp))
                                            }
                                        }
                                    }
                                }

                                Spacer(Modifier.height(8.dp))

                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(3.dp)
                                ) {
                                    Text(
                                        text = "57–71",
                                        fontSize = 9.sp,
                                        fontFamily = FontFamily.Monospace,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                        modifier = Modifier.width(83.dp),
                                        textAlign = TextAlign.End
                                    )
                                    lanthanides.forEach { spec ->
                                        PeriodicGridCell(
                                            spec = spec,
                                            isSelected = spec.symbol == activeElement,
                                            isHighlighted = spec.symbol in filteredSet,
                                            onClick = { onSelectElement(spec.symbol) }
                                        )
                                    }
                                }

                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(3.dp)
                                ) {
                                    Text(
                                        text = "89–103",
                                        fontSize = 9.sp,
                                        fontFamily = FontFamily.Monospace,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                        modifier = Modifier.width(83.dp),
                                        textAlign = TextAlign.End
                                    )
                                    actinides.forEach { spec ->
                                        PeriodicGridCell(
                                            spec = spec,
                                            isSelected = spec.symbol == activeElement,
                                            isHighlighted = spec.symbol in filteredSet,
                                            onClick = { onSelectElement(spec.symbol) }
                                        )
                                    }
                                }
                            }
                        }
                    }
                } else {
                    // Searchable 118-Element Directory List
                    LazyColumn(
                        modifier = Modifier
                            .weight(1f)
                            .fillMaxWidth()
                            .padding(horizontal = 12.dp),
                        verticalArrangement = Arrangement.spacedBy(4.dp),
                        contentPadding = PaddingValues(bottom = 12.dp)
                    ) {
                        items(filteredElements, key = { it.atomicNumber }) { spec ->
                            val isSelected = spec.symbol == activeElement
                            Surface(
                                shape = RoundedCornerShape(10.dp),
                                color = if (isSelected) {
                                    MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.55f)
                                } else {
                                    MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.45f)
                                },
                                border = BorderStroke(
                                    width = if (isSelected) 1.5.dp else 0.75.dp,
                                    color = if (isSelected) {
                                        MaterialTheme.colorScheme.primary
                                    } else {
                                        MaterialTheme.colorScheme.outlineVariant
                                    }
                                ),
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clip(RoundedCornerShape(10.dp))
                                    .clickable { onSelectElement(spec.symbol) }
                            ) {
                                Row(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .padding(horizontal = 10.dp, vertical = 8.dp),
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Text(
                                        text = "${spec.atomicNumber}",
                                        fontSize = 11.sp,
                                        fontFamily = FontFamily.Monospace,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                        modifier = Modifier.width(28.dp)
                                    )
                                    Box(
                                        contentAlignment = Alignment.Center,
                                        modifier = Modifier
                                            .size(30.dp)
                                            .clip(RoundedCornerShape(7.dp))
                                            .background(Color(spec.cpkColorHex))
                                            .border(0.75.dp, Color(0xFF94A3B8), RoundedCornerShape(7.dp))
                                    ) {
                                        Text(
                                            text = spec.symbol.symbol,
                                            fontSize = 12.sp,
                                            fontWeight = FontWeight.Bold,
                                            color = Color(spec.cpkTextColorHex)
                                        )
                                    }
                                    Spacer(Modifier.width(10.dp))
                                    Column(modifier = Modifier.weight(1f)) {
                                        Text(
                                            text = spec.name,
                                            fontSize = 13.sp,
                                            fontWeight = FontWeight.SemiBold,
                                            maxLines = 1,
                                            overflow = TextOverflow.Ellipsis
                                        )
                                        Text(
                                            text = "${spec.category.label} • P${spec.period} G${spec.group}",
                                            fontSize = 10.sp,
                                            color = MaterialTheme.colorScheme.onSurfaceVariant
                                        )
                                    }
                                    Column(horizontalAlignment = Alignment.End) {
                                        Text(
                                            text = "${spec.atomicMass} u",
                                            fontSize = 11.sp,
                                            fontFamily = FontFamily.Monospace,
                                            fontWeight = FontWeight.Medium
                                        )
                                        Text(
                                            text = "Val ${spec.standardValences.joinToString("/")}",
                                            fontSize = 10.sp,
                                            fontFamily = FontFamily.Monospace,
                                            color = MaterialTheme.colorScheme.onSurfaceVariant
                                        )
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun PeriodicGridCell(
    spec: ElementSpec,
    isSelected: Boolean,
    isHighlighted: Boolean,
    onClick: () -> Unit
) {
    Surface(
        shape = RoundedCornerShape(6.dp),
        color = Color(spec.cpkColorHex).copy(alpha = if (isHighlighted) 0.92f else 0.25f),
        border = BorderStroke(
            width = if (isSelected) 2.dp else 0.75.dp,
            color = if (isSelected) MaterialTheme.colorScheme.primary else Color(0xFF94A3B8).copy(alpha = 0.6f)
        ),
        modifier = Modifier
            .size(width = 40.dp, height = 44.dp)
            .clip(RoundedCornerShape(6.dp))
            .clickable(onClick = onClick)
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = 2.dp, vertical = 2.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.SpaceBetween
        ) {
            Text(
                text = "${spec.atomicNumber}",
                fontSize = 8.sp,
                fontFamily = FontFamily.Monospace,
                color = Color(spec.cpkTextColorHex).copy(alpha = 0.8f),
                maxLines = 1
            )
            Text(
                text = spec.symbol.symbol,
                fontSize = 12.sp,
                fontWeight = FontWeight.Bold,
                color = Color(spec.cpkTextColorHex),
                maxLines = 1
            )
            Text(
                text = spec.name,
                fontSize = 6.sp,
                color = Color(spec.cpkTextColorHex).copy(alpha = 0.75f),
                maxLines = 1,
                overflow = TextOverflow.Clip
            )
        }
    }
}

private fun DrawScope.drawChemicalBond2D(
    a1: AtomNode,
    a2: AtomNode,
    bond: BondEdge,
    ringCenter: Offset?
) {
    val start = Offset(a1.x2d, a1.y2d)
    val end = Offset(a2.x2d, a2.y2d)
    val dx = end.x - start.x
    val dy = end.y - start.y
    val len = hypot(dx, dy).coerceAtLeast(1f)
    val nx = -dy / len
    val ny = dx / len
    val bondColor = Color(0xFF1E293B)
    val baseStroke = 2.2.dp.toPx()

    if (bond.stereo == StereoType.WEDGE && bond.order == 1) {
        val halfW = 4.2.dp.toPx()
        val wedgePath = Path().apply {
            moveTo(start.x, start.y)
            lineTo(end.x + nx * halfW, end.y + ny * halfW)
            lineTo(end.x - nx * halfW, end.y - ny * halfW)
            close()
        }
        drawPath(wedgePath, color = bondColor)
        return
    }

    if (bond.stereo == StereoType.DASH && bond.order == 1) {
        val steps = 6
        val maxHalfW = 4.2.dp.toPx()
        for (i in 1..steps) {
            val t = i.toFloat() / steps
            val cx = start.x + dx * t
            val cy = start.y + dy * t
            val hw = maxHalfW * t
            drawLine(
                color = bondColor,
                start = Offset(cx + nx * hw, cy + ny * hw),
                end = Offset(cx - nx * hw, cy - ny * hw),
                strokeWidth = 1.5.dp.toPx(),
                cap = StrokeCap.Round
            )
        }
        return
    }

    when (bond.order) {
        2 -> {
            val midX = (start.x + end.x) / 2f
            val midY = (start.y + end.y) / 2f
            val sideSign = if (ringCenter != null) {
                val toCenterX = ringCenter.x - midX
                val toCenterY = ringCenter.y - midY
                if (nx * toCenterX + ny * toCenterY >= 0f) 1f else -1f
            } else {
                1f
            }

            if (ringCenter != null) {
                drawLine(bondColor, start, end, strokeWidth = baseStroke, cap = StrokeCap.Round)
                val offsetDist = 4.6.dp.toPx() * sideSign
                val trim = 0.14f
                val s2 = Offset(start.x + dx * trim + nx * offsetDist, start.y + dy * trim + ny * offsetDist)
                val e2 = Offset(end.x - dx * trim + nx * offsetDist, end.y - dy * trim + ny * offsetDist)
                drawLine(bondColor, s2, e2, strokeWidth = baseStroke * 0.88f, cap = StrokeCap.Round)
            } else {
                val offsetDist = 2.6.dp.toPx()
                drawLine(
                    bondColor,
                    Offset(start.x + nx * offsetDist, start.y + ny * offsetDist),
                    Offset(end.x + nx * offsetDist, end.y + ny * offsetDist),
                    strokeWidth = baseStroke * 0.9f,
                    cap = StrokeCap.Round
                )
                drawLine(
                    bondColor,
                    Offset(start.x - nx * offsetDist, start.y - ny * offsetDist),
                    Offset(end.x - nx * offsetDist, end.y - ny * offsetDist),
                    strokeWidth = baseStroke * 0.9f,
                    cap = StrokeCap.Round
                )
            }
        }
        3 -> {
            drawLine(bondColor, start, end, strokeWidth = baseStroke, cap = StrokeCap.Round)
            val offsetDist = 4.2.dp.toPx()
            drawLine(
                bondColor,
                Offset(start.x + nx * offsetDist, start.y + ny * offsetDist),
                Offset(end.x + nx * offsetDist, end.y + ny * offsetDist),
                strokeWidth = baseStroke * 0.8f,
                cap = StrokeCap.Round
            )
            drawLine(
                bondColor,
                Offset(start.x - nx * offsetDist, start.y - ny * offsetDist),
                Offset(end.x - nx * offsetDist, end.y - ny * offsetDist),
                strokeWidth = baseStroke * 0.8f,
                cap = StrokeCap.Round
            )
        }
        else -> {
            drawLine(bondColor, start, end, strokeWidth = baseStroke, cap = StrokeCap.Round)
        }
    }
}

private fun findAtomAt(mol: MoleculeGraph, point: Offset, radius: Float): AtomNode? =
    mol.atoms.minByOrNull { hypot(it.x2d - point.x, it.y2d - point.y) }
        ?.takeIf { hypot(it.x2d - point.x, it.y2d - point.y) <= radius }

private fun findBondAt(mol: MoleculeGraph, point: Offset, threshold: Float): BondEdge? {
    val atomMap = mol.atoms.associateBy { it.id }
    var bestBond: BondEdge? = null
    var bestDist = threshold
    for (b in mol.bonds) {
        val a1 = atomMap[b.from] ?: continue
        val a2 = atomMap[b.to] ?: continue
        val d = pointToSegmentDistance(point, Offset(a1.x2d, a1.y2d), Offset(a2.x2d, a2.y2d))
        if (d < bestDist) {
            bestDist = d
            bestBond = b
        }
    }
    return bestBond
}

private fun pointToSegmentDistance(p: Offset, a: Offset, b: Offset): Float {
    val dx = b.x - a.x
    val dy = b.y - a.y
    val lenSq = dx * dx + dy * dy
    if (lenSq == 0f) return hypot(p.x - a.x, p.y - a.y)
    val t = (((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq).coerceIn(0f, 1f)
    return hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

private fun snapAngleOffset(origin: Offset, raw: Offset, fixedLength: Float): Offset {
    val dx = raw.x - origin.x
    val dy = raw.y - origin.y
    val dist = hypot(dx, dy)
    if (dist < 10f) return raw
    val angle = atan2(dy.toDouble(), dx.toDouble())
    val step = PI / 12.0
    val snapped = (angle / step).roundToInt() * step
    val useLen = if (abs(dist - fixedLength) < 16f) fixedLength else dist
    return Offset(
        x = origin.x + (cos(snapped) * useLen).toFloat(),
        y = origin.y + (sin(snapped) * useLen).toFloat()
    )
}

private fun toolBondSpec(tool: SketchTool): Pair<Int, StereoType> = when (tool) {
    SketchTool.BOND_2 -> 2 to StereoType.NONE
    SketchTool.BOND_3 -> 3 to StereoType.NONE
    SketchTool.WEDGE -> 1 to StereoType.WEDGE
    SketchTool.DASH -> 1 to StereoType.DASH
    else -> 1 to StereoType.NONE
}

private fun handleCanvasTap(
    mol: MoleculeGraph,
    tapPos: Offset,
    hitAtom: AtomNode?,
    hitBond: BondEdge?,
    tool: SketchTool,
    element: ElementSymbol,
    onSelectAtom: (String?) -> Unit,
    onCommitMolecule: (MoleculeGraph) -> Unit
) {
    if (tool == SketchTool.SELECT) {
        onSelectAtom(hitAtom?.id)
        return
    }

    if (tool == SketchTool.ERASE) {
        if (hitAtom != null) {
            val remAtoms = mol.atoms.filterNot { it.id == hitAtom.id }
            val remBonds = mol.bonds.filterNot { it.from == hitAtom.id || it.to == hitAtom.id }
            onCommitMolecule(mol.copy(smiles = null, atoms = remAtoms, bonds = remBonds))
            onSelectAtom(null)
        } else if (hitBond != null) {
            onCommitMolecule(
                mol.copy(smiles = null, bonds = mol.bonds.filterNot { it.id == hitBond.id })
            )
        }
        return
    }

    if (tool == SketchTool.RING6 || tool == SketchTool.BENZENE) {
        val aromatic = tool == SketchTool.BENZENE
        val next = placeHexagonRing(mol, tapPos, hitAtom, hitBond, aromatic)
        onCommitMolecule(next)
        return
    }

    if (hitBond != null && hitAtom == null) {
        val (order, stereo) = toolBondSpec(tool)
        val updatedBonds = mol.bonds.map { b ->
            if (b.id != hitBond.id) {
                b
            } else if (tool == SketchTool.BOND_1 && b.stereo == StereoType.NONE) {
                b.copy(order = (b.order % 3) + 1)
            } else {
                b.copy(order = order, stereo = stereo, isAromatic = false)
            }
        }
        onCommitMolecule(mol.copy(smiles = null, bonds = updatedBonds))
        return
    }

    if (hitAtom != null) {
        onSelectAtom(hitAtom.id)
        if (hitAtom.element != element) {
            val updatedAtoms = mol.atoms.map {
                if (it.id == hitAtom.id) it.copy(element = element) else it
            }
            onCommitMolecule(mol.copy(smiles = null, atoms = updatedAtoms))
        } else {
            // Sprout a new bonded atom at the widest VSEPR angle
            val next = sproutAtomFrom(mol, hitAtom, element, toolBondSpec(tool))
            onCommitMolecule(next)
        }
        return
    }

    // Tap on empty space creates a new isolated atom
    val newId = "a_${System.currentTimeMillis()}"
    val newAtom = AtomNode(
        id = newId,
        element = element,
        x2d = tapPos.x,
        y2d = tapPos.y
    )
    onSelectAtom(newId)
    onCommitMolecule(mol.copy(smiles = null, atoms = mol.atoms + newAtom))
}

private fun upsertBond(
    mol: MoleculeGraph,
    fromId: String,
    toId: String,
    order: Int,
    stereo: StereoType
): MoleculeGraph {
    val existing = mol.bonds.firstOrNull {
        (it.from == fromId && it.to == toId) || (it.from == toId && it.to == fromId)
    }
    return if (existing != null) {
        mol.copy(
            smiles = null,
            bonds = mol.bonds.map {
                if (it.id == existing.id) {
                    it.copy(from = fromId, to = toId, order = order, stereo = stereo, isAromatic = false)
                } else {
                    it
                }
            }
        )
    } else {
        val newBond = BondEdge(
            id = "b_${System.currentTimeMillis()}",
            from = fromId,
            to = toId,
            order = order,
            stereo = stereo
        )
        mol.copy(smiles = null, bonds = mol.bonds + newBond)
    }
}

private fun sproutAtomFrom(
    mol: MoleculeGraph,
    anchor: AtomNode,
    newElement: ElementSymbol,
    bondSpec: Pair<Int, StereoType>
): MoleculeGraph {
    val atomMap = mol.atoms.associateBy { it.id }
    val neighborAngles = mol.bonds.mapNotNull { b ->
        when {
            b.from == anchor.id -> atomMap[b.to]
            b.to == anchor.id -> atomMap[b.from]
            else -> null
        }?.let { nbr ->
            atan2((nbr.y2d - anchor.y2d).toDouble(), (nbr.x2d - anchor.x2d).toDouble())
        }
    }

    val angle = when {
        neighborAngles.isEmpty() -> -PI / 6.0
        neighborAngles.size == 1 -> {
            val base = neighborAngles[0]
            val c1 = base + (2.0 * PI) / 3.0
            val c2 = base - (2.0 * PI) / 3.0
            val p1x = anchor.x2d + cos(c1) * ChemistryEngine.BOND_2D_LENGTH
            val p1y = anchor.y2d + sin(c1) * ChemistryEngine.BOND_2D_LENGTH
            val p2x = anchor.x2d + cos(c2) * ChemistryEngine.BOND_2D_LENGTH
            val p2y = anchor.y2d + sin(c2) * ChemistryEngine.BOND_2D_LENGTH
            val d1 = mol.atoms.filter { it.id != anchor.id }
                .minOfOrNull { hypot(p1x - it.x2d, p1y - it.y2d) } ?: 999.0
            val d2 = mol.atoms.filter { it.id != anchor.id }
                .minOfOrNull { hypot(p2x - it.x2d, p2y - it.y2d) } ?: 999.0
            if (d1 >= d2) c1 else c2
        }
        else -> {
            val sorted = neighborAngles.sorted()
            var bestMid = 0.0
            var bestGap = -1.0
            for (i in sorted.indices) {
                val a1 = sorted[i]
                val a2 = if (i + 1 < sorted.size) sorted[i + 1] else sorted[0] + 2.0 * PI
                val gap = a2 - a1
                if (gap > bestGap) {
                    bestGap = gap
                    bestMid = a1 + gap / 2.0
                }
            }
            bestMid
        }
    }

    val newId = "a_${System.currentTimeMillis()}"
    val newAtom = AtomNode(
        id = newId,
        element = newElement,
        x2d = (anchor.x2d + cos(angle) * ChemistryEngine.BOND_2D_LENGTH).toFloat(),
        y2d = (anchor.y2d + sin(angle) * ChemistryEngine.BOND_2D_LENGTH).toFloat()
    )
    val newBond = BondEdge(
        id = "b_${System.currentTimeMillis()}",
        from = anchor.id,
        to = newId,
        order = bondSpec.first,
        stereo = bondSpec.second
    )
    return mol.copy(
        smiles = null,
        atoms = mol.atoms + newAtom,
        bonds = mol.bonds + newBond
    )
}

private fun placeHexagonRing(
    mol: MoleculeGraph,
    tapPos: Offset,
    hitAtom: AtomNode?,
    hitBond: BondEdge?,
    aromatic: Boolean
): MoleculeGraph {
    val radius = ChemistryEngine.BOND_2D_LENGTH
    val center = when {
        hitBond != null -> {
            val a1 = mol.atoms.first { it.id == hitBond.from }
            val a2 = mol.atoms.first { it.id == hitBond.to }
            val mx = (a1.x2d + a2.x2d) / 2f
            val my = (a1.y2d + a2.y2d) / 2f
            val dx = a2.x2d - a1.x2d
            val dy = a2.y2d - a1.y2d
            val len = hypot(dx, dy).coerceAtLeast(1f)
            val apothem = (len / 2f) * sqrt(3f)
            Offset(mx - (dy / len) * apothem, my + (dx / len) * apothem)
        }
        hitAtom != null -> Offset(hitAtom.x2d + radius, hitAtom.y2d)
        else -> tapPos
    }

    val newAtoms = mol.atoms.toMutableList()
    val newBonds = mol.bonds.toMutableList()
    val ringIds = Array(6) { "" }
    val stamp = System.currentTimeMillis()

    for (k in 0 until 6) {
        val theta = (k * PI) / 3.0 - PI / 2.0
        val px = (center.x + cos(theta) * radius).toFloat()
        val py = (center.y + sin(theta) * radius).toFloat()
        val existing = newAtoms.minByOrNull { hypot(it.x2d - px, it.y2d - py) }
            ?.takeIf { hypot(it.x2d - px, it.y2d - py) < 20f }
        if (existing != null) {
            ringIds[k] = existing.id
        } else {
            val id = "a_${stamp}_$k"
            newAtoms.add(
                AtomNode(
                    id = id,
                    element = ElementSymbol.C,
                    x2d = px,
                    y2d = py,
                    isAromatic = aromatic
                )
            )
            ringIds[k] = id
        }
    }

    for (k in 0 until 6) {
        val u = ringIds[k]
        val v = ringIds[(k + 1) % 6]
        val exists = newBonds.any { (it.from == u && it.to == v) || (it.from == v && it.to == u) }
        if (!exists) {
            newBonds.add(
                BondEdge(
                    id = "b_${stamp}_$k",
                    from = u,
                    to = v,
                    order = if (aromatic && k % 2 == 0) 2 else 1,
                    isAromatic = aromatic
                )
            )
        }
    }

    return mol.copy(smiles = null, atoms = newAtoms, bonds = newBonds)
}

private fun attachFragmentToMolecule(
    molecule: MoleculeGraph,
    anchorAtomId: String?,
    fragment: FragmentTemplate
): MoleculeGraph {
    val parsedFrag = ChemistryEngine.parseSmilesToMolecule(fragment.smiles, fragment.label)
    if (molecule.atoms.isEmpty() || anchorAtomId == null) {
        return parsedFrag.copy(name = fragment.label)
    }
    val anchor = molecule.atoms.firstOrNull { it.id == anchorAtomId } ?: molecule.atoms.first()
    val atomMap = molecule.atoms.associateBy { it.id }
    val nbrAngles = molecule.bonds.mapNotNull { b ->
        when {
            b.from == anchor.id -> atomMap[b.to]
            b.to == anchor.id -> atomMap[b.from]
            else -> null
        }?.let { atan2((it.y2d - anchor.y2d).toDouble(), (it.x2d - anchor.x2d).toDouble()) }
    }
    val sproutAngle = if (nbrAngles.isEmpty()) 0.0 else nbrAngles[0] + (2.0 * PI) / 3.0

    val rootFrag = parsedFrag.atoms.first()
    val targetRootX = anchor.x2d + (cos(sproutAngle) * ChemistryEngine.BOND_2D_LENGTH).toFloat()
    val targetRootY = anchor.y2d + (sin(sproutAngle) * ChemistryEngine.BOND_2D_LENGTH).toFloat()
    val dx = targetRootX - rootFrag.x2d
    val dy = targetRootY - rootFrag.y2d

    val stamp = System.currentTimeMillis()
    val idRemap = parsedFrag.atoms.mapIndexed { idx, a -> a.id to "${a.id}_$stamp$idx" }.toMap()
    val shiftedFragAtoms = parsedFrag.atoms.map { a ->
        a.copy(
            id = idRemap.getValue(a.id),
            x2d = a.x2d + dx,
            y2d = a.y2d + dy
        )
    }
    val shiftedFragBonds = parsedFrag.bonds.mapIndexed { idx, b ->
        b.copy(
            id = "bf_${stamp}_$idx",
            from = idRemap.getValue(b.from),
            to = idRemap.getValue(b.to)
        )
    }
    val linkBond = BondEdge(
        id = "blink_$stamp",
        from = anchor.id,
        to = idRemap.getValue(rootFrag.id),
        order = 1
    )

    return molecule.copy(
        smiles = null,
        atoms = molecule.atoms + shiftedFragAtoms,
        bonds = molecule.bonds + shiftedFragBonds + linkBond
    )
}

private fun findRingCyclesForDrawing(mol: MoleculeGraph): List<RingCycle> {
    if (mol.atoms.size < 3 || mol.bonds.size < 3) return emptyList()
    val atomMap = mol.atoms.associateBy { it.id }
    val adj = mol.atoms.associate { it.id to mutableListOf<Pair<String, BondEdge>>() }
    for (b in mol.bonds) {
        adj[b.from]?.add(b.to to b)
        adj[b.to]?.add(b.from to b)
    }
    val indexMap = mol.atoms.mapIndexed { idx, a -> a.id to idx }.toMap()
    val seen = mutableSetOf<String>()
    val cycles = mutableListOf<RingCycle>()

    for (start in mol.atoms) {
        val startIdx = indexMap.getValue(start.id)
        val stack = ArrayDeque<List<String>>()
        stack.addLast(listOf(start.id))
        while (stack.isNotEmpty()) {
            val path = stack.removeLast()
            val cur = path.last()
            if (path.size > 6) continue
            for ((nxt, _) in adj[cur].orEmpty()) {
                if (nxt == start.id && path.size in 5..6) {
                    val key = path.sortedBy { indexMap.getValue(it) }.joinToString(",")
                    if (seen.add(key)) {
                        val pts = path.mapNotNull { atomMap[it] }
                        val cx = pts.map { it.x2d }.average().toFloat()
                        val cy = pts.map { it.y2d }.average().toFloat()
                        var doubles = 0
                        var aromaticCount = 0
                        for (k in path.indices) {
                            val u = path[k]
                            val v = path[(k + 1) % path.size]
                            val bond = adj[u].orEmpty().firstOrNull { it.first == v }?.second
                            if (bond != null) {
                                if (bond.order == 2) doubles++
                                if (bond.isAromatic) aromaticCount++
                            }
                        }
                        val isAr6 = path.size == 6 && (aromaticCount >= 5 || doubles == 3)
                        cycles.add(RingCycle(path.toSet(), cx, cy, isAr6))
                    }
                } else if (!path.contains(nxt) && indexMap.getValue(nxt) > startIdx) {
                    stack.addLast(path + nxt)
                }
            }
        }
    }
    return cycles
}
