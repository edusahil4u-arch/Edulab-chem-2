package com.valencelab.chem.ui

import android.graphics.Paint
import android.graphics.Typeface
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Brightness4
import androidx.compose.material.icons.filled.Brightness7
import androidx.compose.material.icons.filled.CenterFocusStrong
import androidx.compose.material.icons.filled.Remove
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Slider
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.valencelab.chem.chem.AtomNode
import com.valencelab.chem.chem.BondEdge
import com.valencelab.chem.chem.ElementSymbol
import com.valencelab.chem.chem.Elements
import com.valencelab.chem.chem.MoleculeGraph
import com.valencelab.chem.chem.MoleculeMetrics
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.sin

enum class RenderStyle3D(val label: String) {
    BALL_AND_STICK("Ball & Stick"),
    SPACE_FILL("Space-Fill"),
    WIREFRAME("Wireframe")
}

enum class MotionMode3D(val label: String) {
    STATIC("Static"),
    SPIN("Spin"),
    VIBRATE("Vibrate")
}

private data class ProjectedAtom(
    val atom: AtomNode,
    val screenX: Float,
    val screenY: Float,
    val depthZ: Float,
    val radiusPx: Float,
    val vdwRadiusPx: Float
)

private sealed interface RenderItem3D {
    val sortZ: Float

    data class BondItem(
        val a1: ProjectedAtom,
        val a2: ProjectedAtom,
        val bond: BondEdge,
        override val sortZ: Float
    ) : RenderItem3D

    data class AtomItem(
        val projected: ProjectedAtom,
        override val sortZ: Float
    ) : RenderItem3D
}

@Composable
fun Molecule3DViewport(
    molecule: MoleculeGraph,
    metrics: MoleculeMetrics,
    selectedAtomId: String?,
    show3DHydrogens: Boolean,
    onToggle3DHydrogens: () -> Unit,
    onSelectAtom: (String?) -> Unit,
    onOptimize3D: () -> Unit,
    modifier: Modifier = Modifier
) {
    var renderStyle by remember { mutableStateOf(RenderStyle3D.BALL_AND_STICK) }
    var motionMode by remember { mutableStateOf(MotionMode3D.SPIN) }
    var darkStage by remember { mutableStateOf(false) }
    var showLonePairs by remember { mutableStateOf(false) }
    var showVdwShell by remember { mutableStateOf(false) }
    var bondStretch by remember { mutableFloatStateOf(1.0f) }

    var yawRad by remember { mutableFloatStateOf(0.45f) }
    var pitchRad by remember { mutableFloatStateOf(0.32f) }
    var zoomScale by remember { mutableFloatStateOf(1.0f) }
    var animClock by remember { mutableFloatStateOf(0f) }

    val latestMolecule by rememberUpdatedState(molecule)

    // Continuous 60fps animation clock when Spin or Vibrate is active
    LaunchedEffect(motionMode) {
        if (motionMode == MotionMode3D.STATIC) return@LaunchedEffect
        var lastNanos = 0L
        while (true) {
            withFrameNanos { now ->
                if (lastNanos != 0L) {
                    val dt = ((now - lastNanos) / 1_000_000_000f).coerceIn(0f, 0.05f)
                    animClock += dt
                    if (motionMode == MotionMode3D.SPIN) {
                        yawRad = ((yawRad + dt * 0.55f) % (2f * PI.toFloat()))
                    }
                }
                lastNanos = now
            }
        }
    }

    Surface(
        modifier = modifier.fillMaxSize(),
        color = MaterialTheme.colorScheme.surface,
        shape = RoundedCornerShape(12.dp),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)
    ) {
        Column(modifier = Modifier.fillMaxSize()) {
            // Top Spectrometer Mode & Stage Bar
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.6f))
                    .horizontalScroll(rememberScrollState())
                    .padding(horizontal = 8.dp, vertical = 4.dp),
                horizontalArrangement = Arrangement.spacedBy(4.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                RenderStyle3D.entries.forEach { style ->
                    FilterChip(
                        selected = renderStyle == style,
                        onClick = { renderStyle = style },
                        label = { Text(style.label, fontSize = 11.sp) },
                        colors = FilterChipDefaults.filterChipColors(
                            selectedContainerColor = MaterialTheme.colorScheme.primary,
                            selectedLabelColor = Color.White
                        ),
                        modifier = Modifier.height(28.dp)
                    )
                }

                Spacer(Modifier.width(4.dp))

                FilterChip(
                    selected = show3DHydrogens,
                    onClick = onToggle3DHydrogens,
                    label = { Text(if (show3DHydrogens) "3D H: On" else "3D H: Off", fontSize = 11.sp) },
                    modifier = Modifier.height(28.dp)
                )

                FilterChip(
                    selected = showLonePairs,
                    onClick = { showLonePairs = !showLonePairs },
                    label = { Text("Lone Pairs", fontSize = 11.sp) },
                    modifier = Modifier.height(28.dp)
                )

                FilterChip(
                    selected = showVdwShell,
                    onClick = { showVdwShell = !showVdwShell },
                    label = { Text("VDW", fontSize = 11.sp) },
                    modifier = Modifier.height(28.dp)
                )

                IconButton(
                    onClick = { darkStage = !darkStage },
                    modifier = Modifier.size(30.dp)
                ) {
                    Icon(
                        if (darkStage) Icons.Default.Brightness7 else Icons.Default.Brightness4,
                        contentDescription = "Toggle Stage Lighting",
                        modifier = Modifier.size(18.dp)
                    )
                }
            }

            // Secondary Camera & Motion Control Row
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState())
                    .padding(horizontal = 8.dp, vertical = 2.dp),
                horizontalArrangement = Arrangement.spacedBy(4.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                MotionMode3D.entries.forEach { mode ->
                    FilterChip(
                        selected = motionMode == mode,
                        onClick = { motionMode = mode },
                        label = { Text(mode.label, fontSize = 11.sp) },
                        modifier = Modifier.height(26.dp)
                    )
                }

                Spacer(Modifier.width(4.dp))

                OutlinedButton(
                    onClick = {
                        motionMode = MotionMode3D.STATIC
                        yawRad = 0.55f
                        pitchRad = 0.42f
                        zoomScale = 1.0f
                    },
                    contentPadding = PaddingValues(horizontal = 8.dp, vertical = 0.dp),
                    modifier = Modifier.height(26.dp)
                ) {
                    Text("Iso", fontSize = 11.sp)
                }

                OutlinedButton(
                    onClick = {
                        motionMode = MotionMode3D.STATIC
                        yawRad = 0f
                        pitchRad = (PI / 2.0 - 0.05).toFloat()
                        zoomScale = 1.0f
                    },
                    contentPadding = PaddingValues(horizontal = 8.dp, vertical = 0.dp),
                    modifier = Modifier.height(26.dp)
                ) {
                    Text("Top", fontSize = 11.sp)
                }

                OutlinedButton(
                    onClick = {
                        motionMode = MotionMode3D.STATIC
                        yawRad = 0f
                        pitchRad = 0f
                        zoomScale = 1.0f
                    },
                    contentPadding = PaddingValues(horizontal = 8.dp, vertical = 0.dp),
                    modifier = Modifier.height(26.dp)
                ) {
                    Text("Front", fontSize = 11.sp)
                }

                OutlinedButton(
                    onClick = onOptimize3D,
                    contentPadding = PaddingValues(horizontal = 8.dp, vertical = 0.dp),
                    modifier = Modifier.height(26.dp)
                ) {
                    Icon(Icons.Default.CenterFocusStrong, contentDescription = null, modifier = Modifier.size(13.dp))
                    Spacer(Modifier.width(4.dp))
                    Text("Relax 3D", fontSize = 11.sp)
                }
            }

            // Main Interactive 3D Molecular Stage
            val stageBgBrush = if (darkStage) {
                Brush.radialGradient(
                    colors = listOf(Color(0xFF1E293B), Color(0xFF090D16))
                )
            } else {
                Brush.radialGradient(
                    colors = listOf(Color(0xFFFFFFFF), Color(0xFFEEF2F7))
                )
            }

            Box(
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth()
                    .background(stageBgBrush)
            ) {
                Canvas(
                    modifier = Modifier
                        .fillMaxSize()
                        .pointerInput(Unit) {
                            detectDragGestures { change, dragAmount ->
                                change.consume()
                                motionMode = MotionMode3D.STATIC
                                yawRad += dragAmount.x * 0.011f
                                pitchRad = (pitchRad + dragAmount.y * 0.011f)
                                    .coerceIn(-1.45f, 1.45f)
                            }
                        }
                        .pointerInput(Unit) {
                            detectTapGestures { tapOffset ->
                                val mol = latestMolecule
                                if (mol.atoms.isEmpty()) return@detectTapGestures
                                val width = size.width.toFloat()
                                val height = size.height.toFloat()
                                val projected = projectAtoms3D(
                                    molecule = mol,
                                    width = width,
                                    height = height,
                                    yaw = yawRad,
                                    pitch = pitchRad,
                                    zoom = zoomScale,
                                    stretch = bondStretch,
                                    renderStyle = renderStyle,
                                    vibratePhase = if (motionMode == MotionMode3D.VIBRATE) animClock else 0f
                                )
                                val hit = projected
                                    .sortedByDescending { it.depthZ }
                                    .firstOrNull { pa ->
                                        hypot(pa.screenX - tapOffset.x, pa.screenY - tapOffset.y) <=
                                            max(24f, pa.radiusPx * 1.25f)
                                    }
                                onSelectAtom(hit?.atom?.id)
                            }
                        }
                ) {
                    if (molecule.atoms.isEmpty()) return@Canvas

                    val projected = projectAtoms3D(
                        molecule = molecule,
                        width = size.width,
                        height = size.height,
                        yaw = yawRad,
                        pitch = pitchRad,
                        zoom = zoomScale,
                        stretch = bondStretch,
                        renderStyle = renderStyle,
                        vibratePhase = if (motionMode == MotionMode3D.VIBRATE) animClock else 0f
                    )
                    val projMap = projected.associateBy { it.atom.id }

                    // Build unified back-to-front painter's algorithm draw queue
                    val drawQueue = mutableListOf<RenderItem3D>()
                    molecule.bonds.forEach { bond ->
                        val p1 = projMap[bond.from] ?: return@forEach
                        val p2 = projMap[bond.to] ?: return@forEach
                        drawQueue.add(
                            RenderItem3D.BondItem(
                                a1 = p1,
                                a2 = p2,
                                bond = bond,
                                sortZ = (p1.depthZ + p2.depthZ) / 2f
                            )
                        )
                    }
                    projected.forEach { pa ->
                        drawQueue.add(RenderItem3D.AtomItem(pa, sortZ = pa.depthZ))
                    }
                    drawQueue.sortBy { it.sortZ }

                    for (item in drawQueue) {
                        when (item) {
                            is RenderItem3D.BondItem -> {
                                if (renderStyle != RenderStyle3D.SPACE_FILL) {
                                    drawBond3D(
                                        a1 = item.a1,
                                        a2 = item.a2,
                                        bond = item.bond,
                                        wireframe = renderStyle == RenderStyle3D.WIREFRAME,
                                        darkStage = darkStage
                                    )
                                }
                            }
                            is RenderItem3D.AtomItem -> {
                                val pa = item.projected
                                val analysis = metrics.atomAnalyses[pa.atom.id]

                                if (showVdwShell) {
                                    drawCircle(
                                        color = pa.atom.element.cpkColor().copy(alpha = 0.14f),
                                        radius = pa.vdwRadiusPx,
                                        center = Offset(pa.screenX, pa.screenY)
                                    )
                                    drawCircle(
                                        color = pa.atom.element.cpkColor().copy(alpha = 0.35f),
                                        radius = pa.vdwRadiusPx,
                                        center = Offset(pa.screenX, pa.screenY),
                                        style = Stroke(width = 1.dp.toPx())
                                    )
                                }

                                if (showLonePairs && (analysis?.lonePairs ?: 0) > 0) {
                                    val lpCount = analysis?.lonePairs ?: 0
                                    for (lp in 0 until lpCount) {
                                        val angleOffset = (lp * PI / 2.2) - 0.6
                                        val lobeCenter = Offset(
                                            pa.screenX + (cos(angleOffset) * pa.radiusPx * 1.15f).toFloat(),
                                            pa.screenY + (sin(angleOffset) * pa.radiusPx * 1.15f).toFloat()
                                        )
                                        drawCircle(
                                            color = Color(0xFF38BDF8).copy(alpha = 0.32f),
                                            radius = pa.radiusPx * 0.55f,
                                            center = lobeCenter
                                        )
                                    }
                                }

                                drawAtomSphere3D(
                                    projected = pa,
                                    isSelected = pa.atom.id == selectedAtomId,
                                    isValenceInvalid = analysis?.valenceValid == false,
                                    darkStage = darkStage
                                )
                            }
                        }
                    }
                }

                // Top-left Live Telemetry Badge
                Surface(
                    color = if (darkStage) Color(0xCC0F172A) else Color(0xE6FFFFFF),
                    shape = RoundedCornerShape(8.dp),
                    border = BorderStroke(
                        1.dp,
                        if (darkStage) Color(0xFF334155) else MaterialTheme.colorScheme.outlineVariant
                    ),
                    modifier = Modifier
                        .align(Alignment.TopStart)
                        .padding(10.dp)
                ) {
                    Column(modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp)) {
                        Text(
                            text = "${molecule.name.ifBlank { "Structure" }} • ${metrics.formula}",
                            fontSize = 12.sp,
                            fontWeight = FontWeight.Bold,
                            color = if (darkStage) Color.White else MaterialTheme.colorScheme.onSurface
                        )
                        Text(
                            text = "${molecule.atoms.size} atoms in 3D • MW ${metrics.molecularWeight}",
                            fontSize = 10.sp,
                            color = if (darkStage) Color(0xFFCBD5E1) else MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }

                // Top-right Zoom Controls
                Row(
                    modifier = Modifier
                        .align(Alignment.TopEnd)
                        .padding(8.dp),
                    horizontalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    Surface(
                        color = if (darkStage) Color(0xCC0F172A) else Color(0xE6FFFFFF),
                        shape = RoundedCornerShape(8.dp),
                        border = BorderStroke(
                            1.dp,
                            if (darkStage) Color(0xFF334155) else MaterialTheme.colorScheme.outlineVariant
                        )
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            IconButton(
                                onClick = { zoomScale = (zoomScale - 0.15f).coerceIn(0.45f, 2.4f) },
                                modifier = Modifier.size(32.dp)
                            ) {
                                Icon(
                                    Icons.Default.Remove,
                                    contentDescription = "Zoom Out",
                                    tint = if (darkStage) Color.White else Color(0xFF0F172A),
                                    modifier = Modifier.size(16.dp)
                                )
                            }
                            Text(
                                text = "${(zoomScale * 100).toInt()}%",
                                fontSize = 11.sp,
                                color = if (darkStage) Color.White else Color(0xFF0F172A)
                            )
                            IconButton(
                                onClick = { zoomScale = (zoomScale + 0.15f).coerceIn(0.45f, 2.4f) },
                                modifier = Modifier.size(32.dp)
                            ) {
                                Icon(
                                    Icons.Default.Add,
                                    contentDescription = "Zoom In",
                                    tint = if (darkStage) Color.White else Color(0xFF0F172A),
                                    modifier = Modifier.size(16.dp)
                                )
                            }
                        }
                    }
                }

                // Selected atom floating readout if any
                val selAtom = selectedAtomId?.let { id -> molecule.atoms.firstOrNull { it.id == id } }
                val selAnalysis = selectedAtomId?.let { metrics.atomAnalyses[it] }
                if (selAtom != null && selAnalysis != null) {
                    Surface(
                        color = if (darkStage) Color(0xE60F172A) else Color(0xF2FFFFFF),
                        shape = RoundedCornerShape(8.dp),
                        border = BorderStroke(1.dp, MaterialTheme.colorScheme.primary),
                        modifier = Modifier
                            .align(Alignment.BottomStart)
                            .padding(10.dp)
                    ) {
                        Text(
                            text = "${Elements.specOf(selAtom.element).name} (${selAtom.element.symbol}) • ${selAnalysis.hybridization.label} • ${selAnalysis.vseprGeometry.label}",
                            fontSize = 11.sp,
                            fontWeight = FontWeight.Medium,
                            color = if (darkStage) Color.White else MaterialTheme.colorScheme.onSurface,
                            modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp)
                        )
                    }
                }
            }

            // Bottom Bond Stretch Slider
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f))
                    .padding(horizontal = 12.dp, vertical = 2.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = "Stretch ${String.format("%.2fx", bondStretch)}",
                    fontSize = 11.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.width(86.dp)
                )
                Slider(
                    value = bondStretch,
                    onValueChange = { bondStretch = it },
                    valueRange = 0.75f..1.45f,
                    modifier = Modifier
                        .weight(1f)
                        .height(32.dp)
                )
            }
        }
    }
}

private fun projectAtoms3D(
    molecule: MoleculeGraph,
    width: Float,
    height: Float,
    yaw: Float,
    pitch: Float,
    zoom: Float,
    stretch: Float,
    renderStyle: RenderStyle3D,
    vibratePhase: Float
): List<ProjectedAtom> {
    if (molecule.atoms.isEmpty()) return emptyList()
    val cosY = cos(yaw)
    val sinY = sin(yaw)
    val cosP = cos(pitch)
    val sinP = sin(pitch)

    val minDim = minOf(width, height).coerceAtLeast(180f)
    val basePixelsPerAngstrom = (minDim / 9.5f) * zoom
    val cameraDist = 14f

    return molecule.atoms.mapIndexed { idx, atom ->
        val vib = if (vibratePhase > 0f) {
            0.045f * sin(vibratePhase * 11f + idx * 1.7f)
        } else {
            0f
        }
        val x = atom.x3d * stretch + vib
        val y = atom.y3d * stretch + vib * 0.7f
        val z = atom.z3d * stretch

        // Rotate around Y (yaw)
        val x1 = x * cosY + z * sinY
        val z1 = -x * sinY + z * cosY
        // Rotate around X (pitch)
        val y2 = y * cosP - z1 * sinP
        val z2 = y * sinP + z1 * cosP

        val perspective = (cameraDist / (cameraDist - z2)).coerceIn(0.45f, 2.2f)
        val screenX = width / 2f + x1 * basePixelsPerAngstrom * perspective
        val screenY = height / 2f - y2 * basePixelsPerAngstrom * perspective

        val spec = Elements.specOf(atom.element)
        val radiusAngstrom = when (renderStyle) {
            RenderStyle3D.SPACE_FILL -> spec.vdwRadius.toFloat() * 0.76f
            RenderStyle3D.WIREFRAME -> 0.16f
            RenderStyle3D.BALL_AND_STICK -> {
                if (atom.element == ElementSymbol.H) 0.30f else (spec.covalentRadius.toFloat() * 0.56f).coerceIn(0.36f, 0.62f)
            }
        }
        val radiusPx = (radiusAngstrom * basePixelsPerAngstrom * perspective).coerceIn(4f, 68f)
        val vdwRadiusPx = (spec.vdwRadius.toFloat() * 0.75f * basePixelsPerAngstrom * perspective).coerceIn(10f, 84f)

        ProjectedAtom(
            atom = atom,
            screenX = screenX,
            screenY = screenY,
            depthZ = z2,
            radiusPx = radiusPx,
            vdwRadiusPx = vdwRadiusPx
        )
    }
}

private fun DrawScope.drawAtomSphere3D(
    projected: ProjectedAtom,
    isSelected: Boolean,
    isValenceInvalid: Boolean,
    darkStage: Boolean
) {
    val center = Offset(projected.screenX, projected.screenY)
    val r = projected.radiusPx
    val baseColor = projected.atom.element.cpkColor()

    if (isValenceInvalid) {
        drawCircle(
            color = Color(0xFFEF4444).copy(alpha = 0.45f),
            radius = r * 1.42f,
            center = center
        )
    }

    if (isSelected) {
        drawCircle(
            color = Color(0xFF3B82F6).copy(alpha = 0.35f),
            radius = r * 1.38f,
            center = center
        )
        drawCircle(
            color = Color(0xFF2563EB),
            radius = r * 1.24f,
            center = center,
            style = Stroke(width = 2.dp.toPx())
        )
    }

    // 3D Phong-like radial sphere shading
    val highlightColor = Color(
        red = (baseColor.red + 0.45f).coerceAtMost(1f),
        green = (baseColor.green + 0.45f).coerceAtMost(1f),
        blue = (baseColor.blue + 0.45f).coerceAtMost(1f),
        alpha = 1f
    )
    val shadowColor = Color(
        red = (baseColor.red * 0.42f).coerceIn(0f, 1f),
        green = (baseColor.green * 0.42f).coerceIn(0f, 1f),
        blue = (baseColor.blue * 0.42f).coerceIn(0f, 1f),
        alpha = 1f
    )
    val specularCenter = Offset(center.x - r * 0.32f, center.y - r * 0.32f)

    drawCircle(
        brush = Brush.radialGradient(
            colors = listOf(highlightColor, baseColor, shadowColor),
            center = specularCenter,
            radius = (r * 1.35f).coerceAtLeast(1f)
        ),
        radius = r,
        center = center
    )

    drawCircle(
        color = if (darkStage) Color.White.copy(alpha = 0.22f) else Color.Black.copy(alpha = 0.16f),
        radius = r,
        center = center,
        style = Stroke(width = 0.8.dp.toPx())
    )

    if (r >= 11.dp.toPx()) {
        val label = buildString {
            append(projected.atom.element.symbol)
            if (projected.atom.formalCharge == 1) append("+")
            else if (projected.atom.formalCharge == -1) append("-")
        }
        drawContext.canvas.nativeCanvas.apply {
            val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                textAlign = Paint.Align.CENTER
                textSize = (r * 0.72f).coerceIn(9.sp.toPx(), 14.sp.toPx())
                typeface = Typeface.create(Typeface.SANS_SERIF, Typeface.BOLD)
                color = projected.atom.element.cpkTextColor().toArgb()
            }
            val yBase = center.y - (paint.descent() + paint.ascent()) / 2f
            drawText(label, center.x, yBase, paint)
        }
    }
}

private fun DrawScope.drawBond3D(
    a1: ProjectedAtom,
    a2: ProjectedAtom,
    bond: BondEdge,
    wireframe: Boolean,
    darkStage: Boolean
) {
    val start = Offset(a1.screenX, a1.screenY)
    val end = Offset(a2.screenX, a2.screenY)
    val dx = end.x - start.x
    val dy = end.y - start.y
    val len = hypot(dx, dy).coerceAtLeast(1f)
    val nx = -dy / len
    val ny = dx / len

    val cylinderColor = if (darkStage) Color(0xFF94A3B8) else Color(0xFF64748B)
    val coreHighlight = if (darkStage) Color(0xFFE2E8F0) else Color(0xFFCBD5E1)
    val widthPx = if (wireframe) 2.dp.toPx() else (6.2.dp.toPx()).coerceIn(3f, 9f)

    if (wireframe) {
        val mid = Offset((start.x + end.x) / 2f, (start.y + end.y) / 2f)
        drawLine(a1.atom.element.cpkColor(), start, mid, strokeWidth = widthPx, cap = StrokeCap.Round)
        drawLine(a2.atom.element.cpkColor(), mid, end, strokeWidth = widthPx, cap = StrokeCap.Round)
        return
    }

    if (bond.isAromatic) {
        drawLine(cylinderColor, start, end, strokeWidth = widthPx * 0.72f, cap = StrokeCap.Round)
        val off = widthPx * 0.85f
        drawLine(
            color = coreHighlight,
            start = Offset(start.x + nx * off, start.y + ny * off),
            end = Offset(end.x + nx * off, end.y + ny * off),
            strokeWidth = widthPx * 0.42f,
            pathEffect = PathEffect.dashPathEffect(floatArrayOf(8f, 6f)),
            cap = StrokeCap.Round
        )
        return
    }

    when (bond.order) {
        2 -> {
            val off = widthPx * 0.62f
            for (sign in listOf(-1f, 1f)) {
                val pStart = Offset(start.x + nx * off * sign, start.y + ny * off * sign)
                val pEnd = Offset(end.x + nx * off * sign, end.y + ny * off * sign)
                drawLine(cylinderColor, pStart, pEnd, strokeWidth = widthPx * 0.64f, cap = StrokeCap.Round)
                drawLine(coreHighlight, pStart, pEnd, strokeWidth = widthPx * 0.22f, cap = StrokeCap.Round)
            }
        }
        3 -> {
            val off = widthPx * 0.82f
            for (sign in listOf(-1f, 0f, 1f)) {
                val pStart = Offset(start.x + nx * off * sign, start.y + ny * off * sign)
                val pEnd = Offset(end.x + nx * off * sign, end.y + ny * off * sign)
                drawLine(cylinderColor, pStart, pEnd, strokeWidth = widthPx * 0.50f, cap = StrokeCap.Round)
                drawLine(coreHighlight, pStart, pEnd, strokeWidth = widthPx * 0.18f, cap = StrokeCap.Round)
            }
        }
        else -> {
            drawLine(cylinderColor, start, end, strokeWidth = widthPx, cap = StrokeCap.Round)
            drawLine(coreHighlight, start, end, strokeWidth = widthPx * 0.34f, cap = StrokeCap.Round)
        }
    }
}
