package com.valencelab.chem.chem

import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlin.math.sqrt

object ChemistryEngine {
    const val BOND_2D_LENGTH = 54f
    const val CANVAS_2D_WIDTH = 560f
    const val CANVAS_2D_HEIGHT = 440f

    private data class NeighborEdge(val neighborId: String, val bond: BondEdge)
    private data class MutableAtom(
        val id: String,
        var element: ElementSymbol,
        var x2d: Float,
        var y2d: Float,
        var x3d: Float,
        var y3d: Float,
        var z3d: Float,
        var formalCharge: Int = 0,
        var isAromatic: Boolean = false,
        var explicitH: Int? = null
    ) {
        fun toImmutable(): AtomNode = AtomNode(
            id = id,
            element = element,
            x2d = x2d,
            y2d = y2d,
            x3d = x3d,
            y3d = y3d,
            z3d = z3d,
            formalCharge = formalCharge,
            isAromatic = isAromatic,
            explicitH = explicitH
        )
    }

    private data class MutableBond(
        val id: String,
        var from: String,
        var to: String,
        var order: Int,
        var stereo: StereoType = StereoType.NONE,
        var isAromatic: Boolean = false
    ) {
        fun toImmutable(): BondEdge = BondEdge(
            id = id,
            from = from,
            to = to,
            order = order,
            stereo = stereo,
            isAromatic = isAromatic
        )
    }

    fun getTargetBondLength3D(
        a: ElementSymbol,
        b: ElementSymbol,
        order: Int,
        isAromatic: Boolean = false
    ): Double {
        val rA = Elements.specOf(a).covalentRadius
        val rB = Elements.specOf(b).covalentRadius
        val base = rA + rB
        if (isAromatic) return base * 0.91
        if (order == 3) return base * 0.79
        if (order == 2) return base * 0.87
        return base
    }

    private fun findAtomRings(
        atoms: List<AtomNode>,
        adj: Map<String, List<NeighborEdge>>
    ): Map<String, List<Int>> {
        val ringSizesByAtom = atoms.associate { it.id to mutableSetOf<Int>() }
        for (startAtom in atoms) {
            val startId = startAtom.id
            val neighbors = adj[startId].orEmpty()
            if (neighbors.size < 2) continue

            val stack = ArrayDeque<Pair<String, List<String>>>()
            for (n in neighbors) {
                stack.addLast(n.neighborId to listOf(startId, n.neighborId))
            }

            while (stack.isNotEmpty()) {
                val (current, path) = stack.removeLast()
                if (path.size > 7) continue

                for (next in adj[current].orEmpty()) {
                    if (next.neighborId == startId && path.size >= 3) {
                        val size = path.size
                        for (nodeId in path) {
                            ringSizesByAtom[nodeId]?.add(size)
                        }
                    } else if (
                        path.size < 7 &&
                        !path.contains(next.neighborId) &&
                        next.neighborId > startId
                    ) {
                        stack.addLast(next.neighborId to (path + next.neighborId))
                    }
                }
            }
        }

        return ringSizesByAtom.mapValues { (_, set) -> set.sorted() }
    }

    fun computeMoleculeMetrics(molecule: MoleculeGraph): MoleculeMetrics {
        val atomMap = molecule.atoms.associateBy { it.id }
        val adj = molecule.atoms.associate { it.id to mutableListOf<NeighborEdge>() }
        val validBonds = mutableListOf<BondEdge>()

        for (bond in molecule.bonds) {
            if (atomMap.containsKey(bond.from) && atomMap.containsKey(bond.to) && bond.from != bond.to) {
                validBonds.add(bond)
                adj[bond.from]?.add(NeighborEdge(bond.to, bond))
                adj[bond.to]?.add(NeighborEdge(bond.from, bond))
            }
        }

        val ringMap = findAtomRings(molecule.atoms, adj)
        val atomAnalyses = mutableMapOf<String, AtomAnalysis>()
        val valenceWarnings = mutableListOf<String>()

        val elementCounts = mutableMapOf<String, Int>()
        var totalWeight = 0.0
        var heavyAtomCount = 0
        var formalChargeSum = 0
        var hbdCount = 0
        var hbaCount = 0
        var tpsa = 0.0
        var estimatedLogP = 0.0
        var sp3Count = 0
        var sp2Count = 0
        var spCount = 0

        molecule.atoms.forEachIndexed { idx, atom ->
            val spec = Elements.specOf(atom.element)
            val edges = adj[atom.id].orEmpty()
            val charge = atom.formalCharge
            formalChargeSum += charge

            var bondOrderSum = 0
            var doubleBondCount = 0
            var tripleBondCount = 0
            var hasAromaticBond = atom.isAromatic

            for ((_, bond) in edges) {
                bondOrderSum += bond.order
                if (bond.order == 2) doubleBondCount++
                if (bond.order == 3) tripleBondCount++
                if (bond.isAromatic) hasAromaticBond = true
            }

            val targetValence = when {
                atom.element == ElementSymbol.N && charge == 1 -> 4
                atom.element == ElementSymbol.O && charge == -1 -> 1
                atom.element == ElementSymbol.O && charge == 1 -> 3
                atom.element == ElementSymbol.C && charge != 0 -> 3
                else -> spec.standardValences.firstOrNull { it >= bondOrderSum }
                    ?: spec.standardValences.last()
            }

            val implicitH = atom.explicitH ?: max(0, targetValence - bondOrderSum)
            val maxAllowedValence = if (atom.element == ElementSymbol.N && charge == 1) {
                4
            } else {
                spec.standardValences.max()
            }
            val valenceValid = bondOrderSum <= maxAllowedValence
            if (!valenceValid) {
                valenceWarnings.add(
                    "Valence exceeded on ${atom.element.symbol}${idx + 1} ($bondOrderSum/$maxAllowedValence)"
                )
            }

            val totalCoordination = edges.size + implicitH
            val lonePairs = when {
                atom.element == ElementSymbol.N && charge == 1 -> 0
                atom.element == ElementSymbol.O && charge == -1 -> 3
                atom.element == ElementSymbol.B ||
                    atom.element == ElementSymbol.C ||
                    atom.element == ElementSymbol.Si -> 0
                atom.element == ElementSymbol.S && bondOrderSum >= 4 ->
                    max(0, (6 - bondOrderSum) / 2)
                atom.element == ElementSymbol.P && bondOrderSum >= 5 -> 0
                else -> spec.lonePairs
            }

            val stericNumber = totalCoordination + lonePairs
            val ringSizes = ringMap[atom.id].orEmpty()
            val inRing = ringSizes.isNotEmpty()
            val isAromatic = hasAromaticBond || (
                inRing &&
                    ringSizes.contains(6) &&
                    (atom.element == ElementSymbol.C || atom.element == ElementSymbol.N) &&
                    doubleBondCount >= 1 &&
                    totalCoordination == 3
                )

            val hybridization: HybridizationType
            val vseprGeometry: VseprGeometry

            when {
                atom.element == ElementSymbol.H -> {
                    hybridization = HybridizationType.S
                    vseprGeometry = VseprGeometry.TERMINAL
                }
                tripleBondCount >= 1 || doubleBondCount >= 2 || stericNumber == 2 -> {
                    hybridization = HybridizationType.SP
                    vseprGeometry = VseprGeometry.LINEAR
                    spCount++
                }
                doubleBondCount == 1 || isAromatic || stericNumber == 3 ||
                    (atom.element == ElementSymbol.B && totalCoordination == 3) -> {
                    hybridization = HybridizationType.SP2
                    vseprGeometry = if (lonePairs == 1) {
                        VseprGeometry.BENT
                    } else {
                        VseprGeometry.TRIGONAL_PLANAR
                    }
                    sp2Count++
                }
                stericNumber > 4 -> {
                    hybridization = HybridizationType.SP3
                    vseprGeometry = VseprGeometry.HYPERVALENT
                    sp3Count++
                }
                else -> {
                    hybridization = HybridizationType.SP3
                    sp3Count++
                    vseprGeometry = when {
                        lonePairs == 0 -> VseprGeometry.TETRAHEDRAL
                        lonePairs == 1 -> VseprGeometry.TRIGONAL_PYRAMIDAL
                        lonePairs >= 2 && totalCoordination == 2 -> VseprGeometry.BENT
                        else -> VseprGeometry.TETRAHEDRAL
                    }
                }
            }

            atomAnalyses[atom.id] = AtomAnalysis(
                atomId = atom.id,
                element = atom.element,
                explicitBondOrderSum = bondOrderSum,
                implicitHydrogens = implicitH,
                totalCoordination = totalCoordination,
                lonePairs = lonePairs,
                stericNumber = stericNumber,
                hybridization = hybridization,
                vseprGeometry = vseprGeometry,
                valenceValid = valenceValid,
                valenceMessage = if (valenceValid) {
                    null
                } else {
                    "Bond order sum $bondOrderSum exceeds max valence $maxAllowedValence"
                },
                inRing = inRing,
                ringSizes = ringSizes,
                isAromatic = isAromatic
            )

            elementCounts[atom.element.symbol] = (elementCounts[atom.element.symbol] ?: 0) + 1
            totalWeight += spec.atomicMass
            if (atom.element != ElementSymbol.H) heavyAtomCount++
            if (implicitH > 0) {
                elementCounts["H"] = (elementCounts["H"] ?: 0) + implicitH
                totalWeight += implicitH * Elements.specOf(ElementSymbol.H).atomicMass
            }

            when (atom.element) {
                ElementSymbol.N, ElementSymbol.O -> {
                    hbaCount++
                    val explicitHNeighbors = edges.count {
                        atomMap[it.neighborId]?.element == ElementSymbol.H
                    }
                    val totalHOnAtom = implicitH + explicitHNeighbors
                    if (totalHOnAtom > 0) hbdCount++
                    if (atom.element == ElementSymbol.O) {
                        tpsa += when {
                            doubleBondCount == 1 -> 17.07
                            totalHOnAtom > 0 -> 20.23
                            else -> 9.23
                        }
                        estimatedLogP += if (doubleBondCount == 1) -0.35 else -0.45
                    } else {
                        tpsa += when {
                            isAromatic -> 12.89
                            tripleBondCount == 1 -> 23.79
                            totalHOnAtom == 2 -> 26.02
                            totalHOnAtom == 1 -> 12.03
                            else -> 3.24
                        }
                        estimatedLogP += if (isAromatic) -0.15 else -0.55
                    }
                }
                ElementSymbol.C -> estimatedLogP += if (isAromatic) 0.32 else 0.24
                ElementSymbol.F -> estimatedLogP += 0.18
                ElementSymbol.Cl -> estimatedLogP += 0.65
                ElementSymbol.Br -> estimatedLogP += 0.85
                ElementSymbol.I -> estimatedLogP += 1.10
                ElementSymbol.S -> {
                    tpsa += if (doubleBondCount >= 1) 34.14 else 25.3
                    estimatedLogP += 0.45
                }
                ElementSymbol.P -> {
                    tpsa += 34.14
                    estimatedLogP += 0.35
                }
                else -> Unit
            }
        }

        var rotatableBonds = 0
        for (bond in validBonds) {
            if (bond.order != 1 || bond.isAromatic) continue
            val a1 = atomMap[bond.from] ?: continue
            val a2 = atomMap[bond.to] ?: continue
            if (a1.element == ElementSymbol.H || a2.element == ElementSymbol.H) continue
            val an1 = atomAnalyses[a1.id] ?: continue
            val an2 = atomAnalyses[a2.id] ?: continue
            if (an1.inRing && an2.inRing) continue
            val heavyDeg1 = adj[a1.id].orEmpty().count {
                atomMap[it.neighborId]?.element != ElementSymbol.H
            }
            val heavyDeg2 = adj[a2.id].orEmpty().count {
                atomMap[it.neighborId]?.element != ElementSymbol.H
            }
            if (heavyDeg1 > 1 && heavyDeg2 > 1) rotatableBonds++
        }

        val formulaParts = mutableListOf<String>()
        elementCounts["C"]?.let { c -> formulaParts.add(if (c == 1) "C" else "C$c") }
        elementCounts["H"]?.let { h -> formulaParts.add(if (h == 1) "H" else "H$h") }
        elementCounts.keys.filter { it != "C" && it != "H" }.sorted().forEach { sym ->
            val cnt = elementCounts.getValue(sym)
            formulaParts.add(if (cnt == 1) sym else "$sym$cnt")
        }
        val formula = if (formulaParts.isEmpty()) "Empty" else formulaParts.joinToString("")
        val totalAtomCountWithH = elementCounts.values.sum()

        var lipinskiViolations = 0
        if (totalWeight > 500) lipinskiViolations++
        if (estimatedLogP > 5) lipinskiViolations++
        if (hbdCount > 5) lipinskiViolations++
        if (hbaCount > 10) lipinskiViolations++

        val visited = mutableSetOf<String>()
        var components = 0
        for (a in molecule.atoms) {
            if (visited.add(a.id)) {
                components++
                val q = ArrayDeque<String>()
                q.addLast(a.id)
                while (q.isNotEmpty()) {
                    val cur = q.removeFirst()
                    for (n in adj[cur].orEmpty()) {
                        if (visited.add(n.neighborId)) {
                            q.addLast(n.neighborId)
                        }
                    }
                }
            }
        }
        val ringCount = max(0, validBonds.size - molecule.atoms.size + components)

        val canonicalSmiles = if (!molecule.smiles.isNullOrBlank()) {
            molecule.smiles.trim()
        } else {
            generateSmilesFromGraph(molecule, adj, atomAnalyses)
        }

        return MoleculeMetrics(
            formula = formula,
            molecularWeight = (totalWeight * 100.0).roundToInt() / 100.0,
            heavyAtomCount = heavyAtomCount,
            explicitAtomCount = molecule.atoms.size,
            totalAtomCountWithH = totalAtomCountWithH,
            bondCount = validBonds.size,
            formalCharge = formalChargeSum,
            estimatedLogP = (estimatedLogP * 100.0).roundToInt() / 100.0,
            tpsa = (tpsa * 10.0).roundToInt() / 10.0,
            hbdCount = hbdCount,
            hbaCount = hbaCount,
            rotatableBonds = rotatableBonds,
            ringCount = ringCount,
            lipinskiViolations = lipinskiViolations,
            lipinskiPass = lipinskiViolations <= 1,
            valenceValid = valenceWarnings.isEmpty(),
            valenceWarnings = valenceWarnings,
            hybridizationCounts = HybridizationCounts(sp3Count, sp2Count, spCount),
            canonicalSmiles = canonicalSmiles,
            atomAnalyses = atomAnalyses
        )
    }

    private fun generateSmilesFromGraph(
        molecule: MoleculeGraph,
        adj: Map<String, List<NeighborEdge>>,
        analyses: Map<String, AtomAnalysis>
    ): String {
        if (molecule.atoms.isEmpty()) return ""
        val atomMap = molecule.atoms.associateBy { it.id }
        val hasHeavy = molecule.atoms.any { it.element != ElementSymbol.H }
        val activeAtoms = if (hasHeavy) {
            molecule.atoms.filter { it.element != ElementSymbol.H }
        } else {
            molecule.atoms
        }
        val activeSet = activeAtoms.map { it.id }.toSet()

        val visited = mutableSetOf<String>()
        val parentMap = mutableMapOf<String, String>()
        val ringClosures = mutableMapOf<String, MutableList<Pair<Int, BondEdge>>>()
        val seenBackEdges = mutableSetOf<String>()
        var nextRingDigit = 1

        fun findTree(u: String) {
            visited.add(u)
            for ((v, bond) in adj[u].orEmpty()) {
                if (!activeSet.contains(v)) continue
                if (!visited.contains(v)) {
                    parentMap[v] = u
                    findTree(v)
                } else if (parentMap[u] != v) {
                    val edgeKey = if (u < v) "$u|$v" else "$v|$u"
                    if (seenBackEdges.add(edgeKey)) {
                        val digit = nextRingDigit++
                        ringClosures.getOrPut(u) { mutableListOf() }.add(digit to bond)
                        ringClosures.getOrPut(v) { mutableListOf() }.add(digit to bond)
                    }
                }
            }
        }

        val emitted = mutableSetOf<String>()
        val organicSubset = setOf(
            ElementSymbol.B, ElementSymbol.C, ElementSymbol.N, ElementSymbol.O,
            ElementSymbol.P, ElementSymbol.S, ElementSymbol.F, ElementSymbol.Cl,
            ElementSymbol.Br, ElementSymbol.I
        )

        fun formatAtomToken(atom: AtomNode): String {
            val isAromatic = analyses[atom.id]?.isAromatic ?: atom.isAromatic
            if (organicSubset.contains(atom.element) && atom.formalCharge == 0) {
                if (isAromatic && atom.element in setOf(
                        ElementSymbol.C, ElementSymbol.N, ElementSymbol.O, ElementSymbol.S, ElementSymbol.P
                    )
                ) {
                    return atom.element.symbol.lowercase()
                }
                return atom.element.symbol
            }
            val chg = atom.formalCharge
            val chgStr = when {
                chg == 0 -> ""
                chg > 0 -> "+${if (chg > 1) chg.toString() else ""}"
                else -> "-${if (chg < -1) (-chg).toString() else ""}"
            }
            return "[${atom.element.symbol}$chgStr]"
        }

        fun formatBondPrefix(bond: BondEdge, fromAromatic: Boolean, toAromatic: Boolean): String {
            if (bond.isAromatic || (fromAromatic && toAromatic)) return ""
            return when (bond.order) {
                2 -> "="
                3 -> "#"
                else -> ""
            }
        }

        fun emitDfs(u: String): String {
            emitted.add(u)
            val atom = atomMap.getValue(u)
            val uAromatic = analyses[u]?.isAromatic ?: atom.isAromatic
            val sb = StringBuilder(formatAtomToken(atom))

            for ((digit, bond) in ringClosures[u].orEmpty()) {
                val prefix = when {
                    bond.order == 2 && !bond.isAromatic -> "="
                    bond.order == 3 -> "#"
                    else -> ""
                }
                sb.append(prefix)
                sb.append(if (digit > 9) "%$digit" else digit.toString())
            }

            val children = adj[u].orEmpty().filter {
                activeSet.contains(it.neighborId) &&
                    !emitted.contains(it.neighborId) &&
                    parentMap[it.neighborId] == u
            }

            children.forEachIndexed { idx, child ->
                val vAtom = atomMap.getValue(child.neighborId)
                val vAromatic = analyses[child.neighborId]?.isAromatic ?: vAtom.isAromatic
                val bondStr = formatBondPrefix(child.bond, uAromatic, vAromatic)
                val sub = emitDfs(child.neighborId)
                if (idx < children.size - 1) {
                    sb.append("($bondStr$sub)")
                } else {
                    sb.append("$bondStr$sub")
                }
            }
            return sb.toString()
        }

        val components = mutableListOf<String>()
        for (atom in activeAtoms) {
            if (!visited.contains(atom.id)) {
                findTree(atom.id)
                components.add(emitDfs(atom.id))
            }
        }
        return components.joinToString(".")
    }

    fun expandHydrogens(molecule: MoleculeGraph): MoleculeGraph {
        val metrics = computeMoleculeMetrics(molecule)
        val newAtoms = molecule.atoms.map {
            MutableAtom(
                id = it.id,
                element = it.element,
                x2d = it.x2d,
                y2d = it.y2d,
                x3d = it.x3d,
                y3d = it.y3d,
                z3d = it.z3d,
                formalCharge = it.formalCharge,
                isAromatic = it.isAromatic,
                explicitH = it.explicitH
            )
        }.toMutableList()
        val newBonds = molecule.bonds.map {
            MutableBond(it.id, it.from, it.to, it.order, it.stereo, it.isAromatic)
        }.toMutableList()

        val atomMap = newAtoms.associateBy { it.id }
        val adj = newAtoms.associate { it.id to mutableListOf<MutableAtom>() }
        for (b in newBonds) {
            val a1 = atomMap[b.from]
            val a2 = atomMap[b.to]
            if (a1 != null && a2 != null) {
                adj[a1.id]?.add(a2)
                adj[a2.id]?.add(a1)
            }
        }

        var hCounter = 1
        for (atom in molecule.atoms) {
            val analysis = metrics.atomAnalyses[atom.id] ?: continue
            if (analysis.implicitHydrogens <= 0) continue

            atomMap[atom.id]?.explicitH = null
            val existingNeighbors = adj[atom.id] ?: mutableListOf()

            for (k in 0 until analysis.implicitHydrogens) {
                val usedAngles = existingNeighbors.map {
                    atan2((it.y2d - atom.y2d).toDouble(), (it.x2d - atom.x2d).toDouble())
                }
                var bestAngle = (k * PI * 2.0) / max(1, analysis.implicitHydrogens)
                if (usedAngles.isNotEmpty()) {
                    var maxMinDist = -1.0
                    for (step in 0 until 24) {
                        val cand = (step * PI * 2.0) / 24.0
                        var minDist = Double.POSITIVE_INFINITY
                        for (ua in usedAngles) {
                            val diff = abs(atan2(sin(cand - ua), cos(cand - ua)))
                            if (diff < minDist) minDist = diff
                        }
                        if (minDist > maxMinDist) {
                            maxMinDist = minDist
                            bestAngle = cand
                        }
                    }
                }

                val hId = "h_${atom.id}_${hCounter++}"
                val hAtom = MutableAtom(
                    id = hId,
                    element = ElementSymbol.H,
                    x2d = (atom.x2d + cos(bestAngle) * (BOND_2D_LENGTH * 0.78f)).toFloat(),
                    y2d = (atom.y2d + sin(bestAngle) * (BOND_2D_LENGTH * 0.78f)).toFloat(),
                    x3d = (atom.x3d + cos(bestAngle) * 1.09).toFloat(),
                    y3d = (atom.y3d + sin(bestAngle) * 1.09).toFloat(),
                    z3d = atom.z3d + if (k % 2 == 0) 0.65f else -0.65f
                )
                newAtoms.add(hAtom)
                existingNeighbors.add(hAtom)
                newBonds.add(MutableBond("b_$hId", atom.id, hId, 1))
            }
        }

        return generate3DCoordinates(
            molecule.copy(
                smiles = null,
                atoms = newAtoms.map { it.toImmutable() },
                bonds = newBonds.map { it.toImmutable() }
            )
        )
    }

    fun collapseHydrogens(molecule: MoleculeGraph): MoleculeGraph {
        val hasHeavy = molecule.atoms.any { it.element != ElementSymbol.H }
        if (!hasHeavy) return molecule

        val atomById = molecule.atoms.associateBy { it.id }
        val removedHCount = mutableMapOf<String, Int>()
        for (b in molecule.bonds) {
            val a1 = atomById[b.from] ?: continue
            val a2 = atomById[b.to] ?: continue
            if (a1.element == ElementSymbol.H && a2.element != ElementSymbol.H) {
                removedHCount[a2.id] = (removedHCount[a2.id] ?: 0) + 1
            } else if (a2.element == ElementSymbol.H && a1.element != ElementSymbol.H) {
                removedHCount[a1.id] = (removedHCount[a1.id] ?: 0) + 1
            }
        }

        val heavyIds = molecule.atoms.filter { it.element != ElementSymbol.H }.map { it.id }.toSet()
        val filteredAtoms = molecule.atoms
            .filter { heavyIds.contains(it.id) }
            .map { a ->
                val remH = removedHCount[a.id] ?: 0
                if (a.isAromatic && a.element == ElementSymbol.N && remH > 0) {
                    a.copy(explicitH = remH)
                } else {
                    a
                }
            }
        val filteredBonds = molecule.bonds.filter {
            heavyIds.contains(it.from) && heavyIds.contains(it.to)
        }

        return generate3DCoordinates(
            molecule.copy(smiles = null, atoms = filteredAtoms, bonds = filteredBonds)
        )
    }

    fun generate3DCoordinates(molecule: MoleculeGraph): MoleculeGraph {
        if (molecule.atoms.isEmpty()) return molecule

        val metrics = computeMoleculeMetrics(molecule)
        val atoms = molecule.atoms.map {
            MutableAtom(
                it.id, it.element, it.x2d, it.y2d, it.x3d, it.y3d, it.z3d,
                it.formalCharge, it.isAromatic, it.explicitH
            )
        }
        val atomMap = atoms.associateBy { it.id }
        val adj = atoms.associate { it.id to mutableListOf<NeighborEdge>() }

        for (b in molecule.bonds) {
            if (atomMap.containsKey(b.from) && atomMap.containsKey(b.to) && b.from != b.to) {
                adj[b.from]?.add(NeighborEdge(b.to, b))
                adj[b.to]?.add(NeighborEdge(b.from, b))
            }
        }

        val scale2dTo3d = 1.52 / BOND_2D_LENGTH
        var cx2 = 0.0
        var cy2 = 0.0
        for (a in atoms) {
            cx2 += a.x2d
            cy2 += a.y2d
        }
        cx2 /= atoms.size
        cy2 /= atoms.size

        atoms.forEachIndexed { i, a ->
            val analysis = metrics.atomAnalyses[a.id]
            val baseX = (a.x2d - cx2) * scale2dTo3d
            val baseY = -(a.y2d - cy2) * scale2dTo3d
            var z = 0.0
            if (analysis != null) {
                when {
                    analysis.isAromatic ||
                        analysis.hybridization == HybridizationType.SP2 ||
                        analysis.hybridization == HybridizationType.SP -> z = 0.0
                    analysis.inRing && analysis.ringSizes.contains(6) ->
                        z = if (i % 2 == 0) 0.24 else -0.24
                    analysis.hybridization == HybridizationType.SP3 -> {
                        val edges = adj[a.id].orEmpty()
                        val wedge = edges.any { it.bond.stereo == StereoType.WEDGE }
                        val dash = edges.any { it.bond.stereo == StereoType.DASH }
                        z = when {
                            wedge -> 0.62
                            dash -> -0.62
                            else -> ((i % 3) - 1) * 0.42
                        }
                    }
                }
            }
            a.x3d = baseX.toFloat()
            a.y3d = baseY.toFloat()
            a.z3d = z.toFloat()
        }

        for (b in molecule.bonds) {
            if (b.stereo == StereoType.NONE) continue
            val fromAtom = atomMap[b.from] ?: continue
            val toAtom = atomMap[b.to] ?: continue
            if (b.stereo == StereoType.WEDGE) {
                toAtom.z3d = fromAtom.z3d + 0.88f
            } else if (b.stereo == StereoType.DASH) {
                toAtom.z3d = fromAtom.z3d - 0.88f
            }
        }

        data class AnglePair(val id1: String, val id2: String, val targetDist: Double)
        val anglePairs = mutableListOf<AnglePair>()
        val bondedSet = mutableSetOf<String>()

        for (b in molecule.bonds) {
            val k = if (b.from < b.to) "${b.from}|${b.to}" else "${b.to}|${b.from}"
            bondedSet.add(k)
        }

        for (center in atoms) {
            val neighbors = adj[center.id].orEmpty()
            val analysis = metrics.atomAnalyses[center.id]
            val thetaRad = when {
                analysis?.hybridization == HybridizationType.SP -> PI
                analysis?.hybridization == HybridizationType.SP2 -> 120.0 * PI / 180.0
                analysis?.inRing == true && analysis.ringSizes.contains(5) -> 108.0 * PI / 180.0
                analysis?.inRing == true && analysis.ringSizes.contains(4) -> 90.0 * PI / 180.0
                analysis?.inRing == true && analysis.ringSizes.contains(3) -> 60.0 * PI / 180.0
                else -> 109.47 * PI / 180.0
            }

            for (i in neighbors.indices) {
                for (j in i + 1 until neighbors.size) {
                    val n1 = neighbors[i]
                    val n2 = neighbors[j]
                    val a1 = atomMap.getValue(n1.neighborId)
                    val a2 = atomMap.getValue(n2.neighborId)
                    val d1 = getTargetBondLength3D(center.element, a1.element, n1.bond.order, n1.bond.isAromatic)
                    val d2 = getTargetBondLength3D(center.element, a2.element, n2.bond.order, n2.bond.isAromatic)
                    val targetDist = sqrt(max(0.4, d1 * d1 + d2 * d2 - 2.0 * d1 * d2 * cos(thetaRad)))
                    anglePairs.add(AnglePair(n1.neighborId, n2.neighborId, targetDist))
                }
            }
        }

        val forces = atoms.associate { it.id to DoubleArray(3) }
        val iterations = 90
        for (iter in 0 until iterations) {
            forces.values.forEach { it.fill(0.0) }

            // 1. Bond length springs
            for (bond in molecule.bonds) {
                val a1 = atomMap[bond.from] ?: continue
                val a2 = atomMap[bond.to] ?: continue
                if (a1 === a2) continue
                val target = getTargetBondLength3D(a1.element, a2.element, bond.order, bond.isAromatic)
                var dx = (a2.x3d - a1.x3d).toDouble()
                var dy = (a2.y3d - a1.y3d).toDouble()
                var dz = (a2.z3d - a1.z3d).toDouble()
                var dist = sqrt(dx * dx + dy * dy + dz * dz)
                if (dist < 1e-4) {
                    dx = 0.1; dy = 0.05; dz = 0.05
                    dist = sqrt(dx * dx + dy * dy + dz * dz)
                }
                val diff = (dist - target) * 0.45
                val ux = (dx / dist) * diff
                val uy = (dy / dist) * diff
                val uz = (dz / dist) * diff
                val f1 = forces.getValue(a1.id)
                val f2 = forces.getValue(a2.id)
                f1[0] += ux; f1[1] += uy; f1[2] += uz
                f2[0] -= ux; f2[1] -= uy; f2[2] -= uz
            }

            // 2. 1-3 VSEPR angle springs
            for (pair in anglePairs) {
                val a1 = atomMap.getValue(pair.id1)
                val a2 = atomMap.getValue(pair.id2)
                var dx = (a2.x3d - a1.x3d).toDouble()
                var dy = (a2.y3d - a1.y3d).toDouble()
                var dz = (a2.z3d - a1.z3d).toDouble()
                var dist = sqrt(dx * dx + dy * dy + dz * dz)
                if (dist < 1e-4) {
                    dx = 0.1; dy = -0.1; dz = 0.1
                    dist = sqrt(dx * dx + dy * dy + dz * dz)
                }
                val diff = (dist - pair.targetDist) * 0.25
                val ux = (dx / dist) * diff
                val uy = (dy / dist) * diff
                val uz = (dz / dist) * diff
                val f1 = forces.getValue(a1.id)
                val f2 = forces.getValue(a2.id)
                f1[0] += ux; f1[1] += uy; f1[2] += uz
                f2[0] -= ux; f2[1] -= uy; f2[2] -= uz
            }

            // 3. Planarity restraint for sp2 / aromatic centers
            for (center in atoms) {
                val analysis = metrics.atomAnalyses[center.id] ?: continue
                if (analysis.hybridization != HybridizationType.SP2 && !analysis.isAromatic) continue
                val neighbors = adj[center.id].orEmpty()
                if (neighbors.size >= 2) {
                    var avgZ = center.z3d.toDouble()
                    for (n in neighbors) {
                        avgZ += atomMap.getValue(n.neighborId).z3d
                    }
                    avgZ /= (neighbors.size + 1)
                    forces.getValue(center.id)[2] += (avgZ - center.z3d) * 0.35
                    for (n in neighbors) {
                        val na = atomMap.getValue(n.neighborId)
                        forces.getValue(na.id)[2] += (avgZ - na.z3d) * 0.25
                    }
                }
            }

            // 4. Steric clash repulsion
            for (i in atoms.indices) {
                for (j in i + 1 until atoms.size) {
                    val a1 = atoms[i]
                    val a2 = atoms[j]
                    val k = if (a1.id < a2.id) "${a1.id}|${a2.id}" else "${a2.id}|${a1.id}"
                    if (bondedSet.contains(k)) continue
                    val minClearance = (
                        Elements.specOf(a1.element).covalentRadius +
                            Elements.specOf(a2.element).covalentRadius
                        ) * 1.35
                    val dx = (a2.x3d - a1.x3d).toDouble()
                    val dy = (a2.y3d - a1.y3d).toDouble()
                    val dz = (a2.z3d - a1.z3d).toDouble()
                    val distSq = dx * dx + dy * dy + dz * dz
                    if (distSq < minClearance * minClearance) {
                        val dist = max(0.05, sqrt(distSq))
                        val push = ((minClearance - dist) / dist) * 0.18
                        val f1 = forces.getValue(a1.id)
                        val f2 = forces.getValue(a2.id)
                        f1[0] -= dx * push; f1[1] -= dy * push; f1[2] -= dz * push
                        f2[0] += dx * push; f2[1] += dy * push; f2[2] += dz * push
                    }
                }
            }

            val step = 0.45 * (1.0 - iter / (iterations * 1.4))
            for (a in atoms) {
                val f = forces.getValue(a.id)
                a.x3d += max(-0.4, min(0.4, f[0] * step)).toFloat()
                a.y3d += max(-0.4, min(0.4, f[1] * step)).toFloat()
                a.z3d += max(-0.4, min(0.4, f[2] * step)).toFloat()
            }
        }

        var mx = 0.0
        var my = 0.0
        var mz = 0.0
        for (a in atoms) {
            mx += a.x3d
            my += a.y3d
            mz += a.z3d
        }
        mx /= atoms.size
        my /= atoms.size
        mz /= atoms.size

        for (a in atoms) {
            a.x3d = (a.x3d - mx).toFloat()
            a.y3d = (a.y3d - my).toFloat()
            a.z3d = (a.z3d - mz).toFloat()
        }

        return molecule.copy(atoms = atoms.map { it.toImmutable() })
    }

    fun clean2DLayout(
        molecule: MoleculeGraph,
        viewportWidth: Float = CANVAS_2D_WIDTH,
        viewportHeight: Float = CANVAS_2D_HEIGHT
    ): MoleculeGraph {
        if (molecule.atoms.isEmpty()) return molecule
        val atoms = molecule.atoms.map {
            MutableAtom(
                it.id, it.element, it.x2d, it.y2d, it.x3d, it.y3d, it.z3d,
                it.formalCharge, it.isAromatic, it.explicitH
            )
        }
        val atomMap = atoms.associateBy { it.id }

        repeat(40) {
            for (b in molecule.bonds) {
                val a1 = atomMap[b.from] ?: continue
                val a2 = atomMap[b.to] ?: continue
                if (a1 === a2) continue
                var dx = a2.x2d - a1.x2d
                var dy = a2.y2d - a1.y2d
                var dist = hypot(dx, dy)
                if (dist < 1f) {
                    dx = BOND_2D_LENGTH
                    dy = 0f
                    dist = BOND_2D_LENGTH
                }
                val diff = ((dist - BOND_2D_LENGTH) / dist) * 0.35f
                a1.x2d += dx * diff
                a1.y2d += dy * diff
                a2.x2d -= dx * diff
                a2.y2d -= dy * diff
            }

            for (i in atoms.indices) {
                for (j in i + 1 until atoms.size) {
                    val a1 = atoms[i]
                    val a2 = atoms[j]
                    val dx = a2.x2d - a1.x2d
                    val dy = a2.y2d - a1.y2d
                    val distSq = dx * dx + dy * dy
                    val minD = BOND_2D_LENGTH * 0.92f
                    if (distSq < minD * minD) {
                        val dist = max(2f, sqrt(distSq))
                        val push = ((minD - dist) / dist) * 0.25f
                        a1.x2d -= dx * push
                        a1.y2d -= dy * push
                        a2.x2d += dx * push
                        a2.y2d += dy * push
                    }
                }
            }
        }

        val minX = atoms.minOf { it.x2d }
        val maxX = atoms.maxOf { it.x2d }
        val minY = atoms.minOf { it.y2d }
        val maxY = atoms.maxOf { it.y2d }
        val cx = (minX + maxX) / 2f
        val cy = (minY + maxY) / 2f
        val targetCx = viewportWidth / 2f
        val targetCy = viewportHeight / 2f

        for (a in atoms) {
            a.x2d = (a.x2d - cx + targetCx).roundToInt().toFloat()
            a.y2d = (a.y2d - cy + targetCy).roundToInt().toFloat()
        }

        return generate3DCoordinates(molecule.copy(atoms = atoms.map { it.toImmutable() }))
    }

    fun parseSmilesToMolecule(smilesInput: String, name: String = "Custom Structure"): MoleculeGraph {
        val smiles = smilesInput.trim()
        require(smiles.isNotEmpty()) { "SMILES string cannot be empty." }

        val atoms = mutableListOf<MutableAtom>()
        val bonds = mutableListOf<MutableBond>()
        data class RingOpen(val atomId: String, val order: Int, val isAromatic: Boolean)
        val ringOpens = mutableMapOf<Int, RingOpen>()
        val branchStack = ArrayDeque<String>()

        var prevAtomId: String? = null
        var pendingBondOrder: Int? = null
        var pendingAromatic = false
        var i = 0
        var atomCounter = 1

        fun normalizeElement(raw: String): Pair<ElementSymbol, Boolean> {
            return when (raw) {
                "c" -> ElementSymbol.C to true
                "n" -> ElementSymbol.N to true
                "o" -> ElementSymbol.O to true
                "s" -> ElementSymbol.S to true
                "p" -> ElementSymbol.P to true
                "b" -> ElementSymbol.B to true
                else -> {
                    val sym = ElementSymbol.fromString(raw)
                        ?: throw IllegalArgumentException("Unsupported element symbol \"$raw\" in SMILES.")
                    sym to false
                }
            }
        }

        while (i < smiles.length) {
            val ch = smiles[i]
            when {
                ch == ' ' -> i++
                ch == '.' -> {
                    prevAtomId = null
                    pendingBondOrder = null
                    pendingAromatic = false
                    i++
                }
                ch == '-' -> { pendingBondOrder = 1; pendingAromatic = false; i++ }
                ch == '=' -> { pendingBondOrder = 2; pendingAromatic = false; i++ }
                ch == '#' -> { pendingBondOrder = 3; pendingAromatic = false; i++ }
                ch == ':' -> { pendingBondOrder = 1; pendingAromatic = true; i++ }
                ch == '/' || ch == '\\' -> i++
                ch == '(' -> {
                    prevAtomId?.let { branchStack.addLast(it) }
                    i++
                }
                ch == ')' -> {
                    if (branchStack.isNotEmpty()) {
                        prevAtomId = branchStack.removeLast()
                    }
                    pendingBondOrder = null
                    pendingAromatic = false
                    i++
                }
                (ch in '0'..'9') || ch == '%' -> {
                    val ringNum: Int
                    if (ch == '%') {
                        ringNum = smiles.substring(i + 1, min(smiles.length, i + 3)).toInt()
                        i += 3
                    } else {
                        ringNum = ch.digitToInt()
                        i += 1
                    }
                    val curId = prevAtomId
                        ?: throw IllegalArgumentException("Ring closure $ringNum has no preceding atom.")
                    val existing = ringOpens[ringNum]
                    if (existing == null) {
                        ringOpens[ringNum] = RingOpen(curId, pendingBondOrder ?: 1, pendingAromatic)
                    } else {
                        val fromAtom = atoms.first { it.id == existing.atomId }
                        val toAtom = atoms.first { it.id == curId }
                        val bothAromatic = fromAtom.isAromatic && toAtom.isAromatic
                        val order = pendingBondOrder ?: existing.order
                        val isAr = pendingAromatic || existing.isAromatic || (bothAromatic && order == 1)
                        bonds.add(
                            MutableBond(
                                id = "b_${bonds.size + 1}",
                                from = existing.atomId,
                                to = curId,
                                order = order,
                                isAromatic = isAr
                            )
                        )
                        ringOpens.remove(ringNum)
                    }
                    pendingBondOrder = null
                    pendingAromatic = false
                }
                ch == '[' -> {
                    val closeIdx = smiles.indexOf(']', i)
                    require(closeIdx != -1) { "Unclosed '[' in SMILES string." }
                    val content = smiles.substring(i + 1, closeIdx)
                    i = closeIdx + 1

                    val cleaned = content.replace(Regex("^\\d+"), "")
                    val elemMatch = Regex("^([A-Z][a-z]?|[cnospb])").find(cleaned)
                        ?: throw IllegalArgumentException("Invalid bracket atom [$content] in SMILES.")
                    val (element, aromatic) = normalizeElement(elemMatch.groupValues[1])

                    val afterElem = cleaned.substring(elemMatch.groupValues[1].length)
                    var explicitH: Int? = null
                    Regex("H(\\d*)").find(afterElem)?.let { m ->
                        explicitH = if (m.groupValues[1].isEmpty()) 1 else m.groupValues[1].toInt()
                    }

                    var formalCharge = 0
                    val plusMatch = Regex("\\+(\\d*)").find(afterElem)
                    val minusMatch = Regex("-(\\d*)").find(afterElem)
                    if (plusMatch != null) {
                        formalCharge = if (plusMatch.groupValues[1].isEmpty()) 1 else plusMatch.groupValues[1].toInt()
                    } else if (minusMatch != null) {
                        formalCharge = -(if (minusMatch.groupValues[1].isEmpty()) 1 else minusMatch.groupValues[1].toInt())
                    }

                    val newAtom = MutableAtom(
                        id = "a_${atomCounter++}",
                        element = element,
                        x2d = 0f,
                        y2d = 0f,
                        x3d = 0f,
                        y3d = 0f,
                        z3d = 0f,
                        formalCharge = formalCharge,
                        isAromatic = aromatic,
                        explicitH = explicitH
                    )
                    atoms.add(newAtom)
                    prevAtomId?.let { pid ->
                        val prevAtom = atoms.first { it.id == pid }
                        val bothAromatic = prevAtom.isAromatic && newAtom.isAromatic
                        val order = pendingBondOrder ?: 1
                        bonds.add(
                            MutableBond(
                                id = "b_${bonds.size + 1}",
                                from = pid,
                                to = newAtom.id,
                                order = order,
                                isAromatic = pendingAromatic || (bothAromatic && order == 1)
                            )
                        )
                    }
                    prevAtomId = newAtom.id
                    pendingBondOrder = null
                    pendingAromatic = false
                }
                else -> {
                    val twoChar = if (i + 2 <= smiles.length) smiles.substring(i, i + 2) else ""
                    val rawSym = if (twoChar == "Cl" || twoChar == "Br" || twoChar == "Si") {
                        i += 2
                        twoChar
                    } else {
                        i += 1
                        ch.toString()
                    }
                    val (element, aromatic) = normalizeElement(rawSym)
                    val newAtom = MutableAtom(
                        id = "a_${atomCounter++}",
                        element = element,
                        x2d = 0f,
                        y2d = 0f,
                        x3d = 0f,
                        y3d = 0f,
                        z3d = 0f,
                        isAromatic = aromatic
                    )
                    atoms.add(newAtom)
                    prevAtomId?.let { pid ->
                        val prevAtom = atoms.first { it.id == pid }
                        val bothAromatic = prevAtom.isAromatic && newAtom.isAromatic
                        val order = pendingBondOrder ?: 1
                        bonds.add(
                            MutableBond(
                                id = "b_${bonds.size + 1}",
                                from = pid,
                                to = newAtom.id,
                                order = order,
                                isAromatic = pendingAromatic || (bothAromatic && order == 1)
                            )
                        )
                    }
                    prevAtomId = newAtom.id
                    pendingBondOrder = null
                    pendingAromatic = false
                }
            }
        }

        require(atoms.isNotEmpty()) { "No valid atoms parsed from SMILES." }

        kekulizeAromaticBonds(atoms, bonds)
        layoutParsedGraph2D(atoms, bonds)

        return generate3DCoordinates(
            MoleculeGraph(
                id = "mol_${System.currentTimeMillis()}",
                name = name,
                smiles = smiles,
                atoms = atoms.map { it.toImmutable() },
                bonds = bonds.map { it.toImmutable() }
            )
        )
    }

    private fun kekulizeAromaticBonds(atoms: List<MutableAtom>, bonds: List<MutableBond>) {
        val aromaticBonds = bonds.filter { it.isAromatic }
        if (aromaticBonds.isEmpty()) return
        aromaticBonds.forEach { it.order = 1 }

        val nonAromaticSum = atoms.associate { it.id to 0 }.toMutableMap()
        val aromaticEdgesByAtom = atoms.associate { it.id to mutableListOf<MutableBond>() }

        for (b in bonds) {
            if (b.isAromatic) {
                aromaticEdgesByAtom[b.from]?.add(b)
                aromaticEdgesByAtom[b.to]?.add(b)
            } else {
                nonAromaticSum[b.from] = (nonAromaticSum[b.from] ?: 0) + b.order
                nonAromaticSum[b.to] = (nonAromaticSum[b.to] ?: 0) + b.order
            }
        }

        val neededDoubles = mutableMapOf<String, Int>()
        val aromaticAtomIds = mutableListOf<String>()

        for (a in atoms) {
            val arEdges = aromaticEdgesByAtom[a.id].orEmpty()
            if (arEdges.isEmpty()) continue
            aromaticAtomIds.add(a.id)
            val spec = Elements.specOf(a.element)
            val targetValence = when {
                a.element == ElementSymbol.N && a.formalCharge == 1 -> 4
                a.element == ElementSymbol.O && a.formalCharge == -1 -> 1
                a.element == ElementSymbol.C && a.formalCharge != 0 -> 3
                else -> spec.defaultValence
            }
            val sigmaCount = (nonAromaticSum[a.id] ?: 0) + arEdges.size
            val needed = when {
                a.explicitH != null -> max(0, targetValence - sigmaCount - (a.explicitH ?: 0))
                a.isAromatic && (a.element == ElementSymbol.O || a.element == ElementSymbol.S) -> 0
                else -> if (sigmaCount < targetValence) 1 else 0
            }
            neededDoubles[a.id] = needed
        }

        fun solve(): Boolean {
            val targetId = aromaticAtomIds.firstOrNull { (neededDoubles[it] ?: 0) > 0 } ?: return true
            for (edge in aromaticEdgesByAtom[targetId].orEmpty()) {
                if (edge.order != 1) continue
                val otherId = if (edge.from == targetId) edge.to else edge.from
                val otherNeed = neededDoubles[otherId] ?: 0
                if (otherNeed <= 0) continue

                edge.order = 2
                neededDoubles[targetId] = (neededDoubles[targetId] ?: 0) - 1
                neededDoubles[otherId] = otherNeed - 1

                if (solve()) return true

                edge.order = 1
                neededDoubles[targetId] = (neededDoubles[targetId] ?: 0) + 1
                neededDoubles[otherId] = otherNeed
            }
            return false
        }

        solve()
    }

    private fun layoutParsedGraph2D(atoms: List<MutableAtom>, bonds: List<MutableBond>) {
        val atomMap = atoms.associateBy { it.id }
        val adj = atoms.associate { it.id to mutableListOf<String>() }
        for (b in bonds) {
            adj[b.from]?.add(b.to)
            adj[b.to]?.add(b.from)
        }
        val atomIndex = atoms.mapIndexed { idx, a -> a.id to idx }.toMap()
        val placed = mutableSetOf<String>()
        val angleMap = mutableMapOf<String, Double>()

        val rings = mutableListOf<List<String>>()
        val seenRings = mutableSetOf<String>()
        for (start in atoms) {
            val startIdx = atomIndex.getValue(start.id)
            val stack = ArrayDeque<List<String>>()
            stack.addLast(listOf(start.id))
            while (stack.isNotEmpty()) {
                val path = stack.removeLast()
                val cur = path.last()
                if (path.size > 7) continue
                for (nxt in adj[cur].orEmpty()) {
                    if (nxt == start.id && path.size >= 3) {
                        val canonical = path.sortedBy { atomIndex.getValue(it) }.joinToString(",")
                        if (seenRings.add(canonical)) rings.add(path)
                    } else if (!path.contains(nxt) && atomIndex.getValue(nxt) > startIdx) {
                        stack.addLast(path + nxt)
                    }
                }
            }
        }
        rings.sortBy { it.size }

        if (rings.isNotEmpty()) {
            val r0 = rings[0]
            val n = r0.size
            val radius = BOND_2D_LENGTH / (2.0 * sin(PI / n))
            for (k in 0 until n) {
                val theta = (k * 2.0 * PI) / n - PI / 2.0
                val atom = atomMap.getValue(r0[k])
                atom.x2d = (280.0 + cos(theta) * radius).toFloat()
                atom.y2d = (230.0 + sin(theta) * radius).toFloat()
                placed.add(atom.id)
                angleMap[atom.id] = theta
            }
        }

        var progress = true
        while (progress) {
            progress = false
            for (ring in rings) {
                if (ring.none { !placed.contains(it) }) continue
                val n = ring.size
                val sharedIdx = (0 until n).firstOrNull { k ->
                    placed.contains(ring[k]) && placed.contains(ring[(k + 1) % n])
                } ?: -1
                if (sharedIdx != -1) {
                    val a1 = atomMap.getValue(ring[sharedIdx])
                    val a2 = atomMap.getValue(ring[(sharedIdx + 1) % n])
                    val mx = (a1.x2d + a2.x2d) / 2.0
                    val my = (a1.y2d + a2.y2d) / 2.0
                    val dx = (a2.x2d - a1.x2d).toDouble()
                    val dy = (a2.y2d - a1.y2d).toDouble()
                    val edgeLen = max(1.0, hypot(dx, dy))

                    var pcx = 0.0
                    var pcy = 0.0
                    for (pid in placed) {
                        val pa = atomMap.getValue(pid)
                        pcx += pa.x2d
                        pcy += pa.y2d
                    }
                    pcx /= placed.size
                    pcy /= placed.size

                    val apothem = (edgeLen / 2.0) / kotlin.math.tan(PI / n)
                    val nx1 = -dy / edgeLen
                    val ny1 = dx / edgeLen
                    val c1x = mx + nx1 * apothem
                    val c1y = my + ny1 * apothem
                    val c2x = mx - nx1 * apothem
                    val c2y = my - ny1 * apothem
                    val dist1 = (c1x - pcx) * (c1x - pcx) + (c1y - pcy) * (c1y - pcy)
                    val dist2 = (c2x - pcx) * (c2x - pcx) + (c2y - pcy) * (c2y - pcy)
                    val centerX = if (dist1 >= dist2) c1x else c2x
                    val centerY = if (dist1 >= dist2) c1y else c2y

                    val radius = edgeLen / (2.0 * sin(PI / n))
                    val baseAngle = atan2(a1.y2d - centerY, a1.x2d - centerX)
                    val cross = (a1.x2d - centerX) * (a2.y2d - centerY) -
                        (a1.y2d - centerY) * (a2.x2d - centerX)
                    val stepSign = if (cross >= 0) 1.0 else -1.0

                    for (step in 0 until n) {
                        val id = ring[(sharedIdx + step) % n]
                        if (!placed.contains(id)) {
                            val theta = baseAngle + stepSign * step * ((2.0 * PI) / n)
                            val atom = atomMap.getValue(id)
                            atom.x2d = (centerX + cos(theta) * radius).toFloat()
                            atom.y2d = (centerY + sin(theta) * radius).toFloat()
                            placed.add(id)
                            angleMap[id] = theta
                        }
                    }
                    progress = true
                }
            }
        }

        fun scoreCandidate(cx: Double, cy: Double, usedAngles: List<Double>, candAngle: Double): Double {
            var minAngDiff = Double.POSITIVE_INFINITY
            for (ua in usedAngles) {
                val d = abs(atan2(sin(candAngle - ua), cos(candAngle - ua)))
                if (d < minAngDiff) minAngDiff = d
            }
            var minAtomDist = Double.POSITIVE_INFINITY
            for (pid in placed) {
                val pa = atomMap.getValue(pid)
                val dist = hypot(cx - pa.x2d, cy - pa.y2d)
                if (dist < minAtomDist) minAtomDist = dist
            }
            val clashPenalty = if (minAtomDist < BOND_2D_LENGTH * 0.82) -10.0 else 0.0
            return clashPenalty + minAngDiff * 2.0 + min(minAtomDist, BOND_2D_LENGTH * 2.2) / BOND_2D_LENGTH
        }

        fun processBfsQueue(seedIds: List<String>) {
            val queue = ArrayDeque(seedIds)
            while (queue.isNotEmpty()) {
                val curId = queue.removeFirst()
                val cur = atomMap.getValue(curId)
                val neighbors = adj[curId].orEmpty()
                val placedNeighbors = neighbors.filter { placed.contains(it) }
                val unplacedNeighbors = neighbors.filter { !placed.contains(it) }
                if (unplacedNeighbors.isEmpty()) continue

                val usedAngles = placedNeighbors.map { nid ->
                    val na = atomMap.getValue(nid)
                    atan2((na.y2d - cur.y2d).toDouble(), (na.x2d - cur.x2d).toDouble())
                }.toMutableList()

                unplacedNeighbors.forEachIndexed { idx, nid ->
                    val nAtom = atomMap.getValue(nid)
                    var chosenAngle = (angleMap[curId] ?: 0.0) + if (idx % 2 == 0) PI / 3.0 else -PI / 3.0
                    if (usedAngles.size >= 2) {
                        val sorted = usedAngles.sorted()
                        val gapCands = sorted.indices.map { i ->
                            val a1 = sorted[i]
                            val a2 = if (i + 1 < sorted.size) sorted[i + 1] else sorted[0] + PI * 2.0
                            a1 + (a2 - a1) / 2.0
                        }
                        var bestScore = Double.NEGATIVE_INFINITY
                        for (cand in gapCands) {
                            val px = cur.x2d + cos(cand) * BOND_2D_LENGTH
                            val py = cur.y2d + sin(cand) * BOND_2D_LENGTH
                            val s = scoreCandidate(px, py, usedAngles, cand)
                            if (s > bestScore) {
                                bestScore = s
                                chosenAngle = cand
                            }
                        }
                    } else if (usedAngles.size == 1) {
                        val base = usedAngles[0]
                        val cands = listOf(
                            base + (2.0 * PI) / 3.0,
                            base - (2.0 * PI) / 3.0,
                            base + PI,
                            base + PI / 2.0,
                            base - PI / 2.0,
                            base + PI / 3.0,
                            base - PI / 3.0
                        )
                        var bestScore = Double.NEGATIVE_INFINITY
                        for (cand in cands) {
                            val px = cur.x2d + cos(cand) * BOND_2D_LENGTH
                            val py = cur.y2d + sin(cand) * BOND_2D_LENGTH
                            val s = scoreCandidate(px, py, usedAngles, cand)
                            if (s > bestScore) {
                                bestScore = s
                                chosenAngle = cand
                            }
                        }
                    }

                    nAtom.x2d = (cur.x2d + cos(chosenAngle) * BOND_2D_LENGTH).toFloat()
                    nAtom.y2d = (cur.y2d + sin(chosenAngle) * BOND_2D_LENGTH).toFloat()
                    placed.add(nid)
                    angleMap[nid] = chosenAngle
                    usedAngles.add(chosenAngle)
                    queue.addLast(nid)
                }
            }
        }

        if (placed.isNotEmpty()) {
            processBfsQueue(placed.toList())
        }
        for (root in atoms) {
            if (!placed.contains(root.id)) {
                root.x2d = 280f + placed.size * 25f
                root.y2d = 230f
                placed.add(root.id)
                angleMap[root.id] = 0.0
                processBfsQueue(listOf(root.id))
            }
        }

        val minX = atoms.minOf { it.x2d }
        val maxX = atoms.maxOf { it.x2d }
        val minY = atoms.minOf { it.y2d }
        val maxY = atoms.maxOf { it.y2d }
        val cx = (minX + maxX) / 2f
        val cy = (minY + maxY) / 2f
        for (a in atoms) {
            a.x2d = (a.x2d - cx + 280f).roundToInt().toFloat()
            a.y2d = (a.y2d - cy + 220f).roundToInt().toFloat()
        }
    }
}
