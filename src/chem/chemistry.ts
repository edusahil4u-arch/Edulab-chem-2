import { ELEMENTS } from './elements';
import type {
  AtomAnalysis,
  AtomNode,
  BondEdge,
  BondOrder,
  ElementSymbol,
  HybridizationType,
  MoleculeGraph,
  MoleculeMetrics,
  VseprGeometry,
} from './types';

const BOND_2D_LENGTH = 54;

export function getTargetBondLength3D(
  a: ElementSymbol,
  b: ElementSymbol,
  order: BondOrder,
  isAromatic?: boolean
): number {
  const rA = ELEMENTS[a]?.covalentRadius ?? 0.76;
  const rB = ELEMENTS[b]?.covalentRadius ?? 0.76;
  const base = rA + rB;
  if (isAromatic) return base * 0.91;
  if (order === 3) return base * 0.79;
  if (order === 2) return base * 0.87;
  return base;
}

/**
 * Finds simple rings up to size 7 containing each atom using bounded BFS/DFS.
 */
function findAtomRings(
  atoms: AtomNode[],
  adj: Map<string, { neighborId: string; bond: BondEdge }[]>
): Map<string, number[]> {
  const ringSizesByAtom = new Map<string, Set<number>>();
  for (const a of atoms) {
    ringSizesByAtom.set(a.id, new Set<number>());
  }

  for (const startAtom of atoms) {
    const startId = startAtom.id;
    const neighbors = adj.get(startId) ?? [];
    if (neighbors.length < 2) continue;

    // DFS up to depth 7 to find chordless / small rings returning to startId
    const stack: { current: string; path: string[] }[] = [];
    for (const n of neighbors) {
      stack.push({ current: n.neighborId, path: [startId, n.neighborId] });
    }

    while (stack.length > 0) {
      const state = stack.pop()!;
      const { current, path } = state;
      if (path.length > 7) continue;

      const nextList = adj.get(current) ?? [];
      for (const next of nextList) {
        if (next.neighborId === startId && path.length >= 3) {
          const size = path.length;
          for (const nodeId of path) {
            ringSizesByAtom.get(nodeId)?.add(size);
          }
        } else if (
          path.length < 7 &&
          !path.includes(next.neighborId) &&
          next.neighborId > startId
        ) {
          stack.push({
            current: next.neighborId,
            path: [...path, next.neighborId],
          });
        }
      }
    }
  }

  const result = new Map<string, number[]>();
  for (const [id, set] of ringSizesByAtom.entries()) {
    result.set(id, Array.from(set).sort((a, b) => a - b));
  }
  return result;
}

/**
 * Computes comprehensive molecular metrics, valence validation, VSEPR geometries,
 * Hill-system molecular formula, molar mass, LogP, TPSA, and simplified SMILES.
 */
export function computeMoleculeMetrics(molecule: MoleculeGraph): MoleculeMetrics {
  const atomMap = new Map<string, AtomNode>();
  const adj = new Map<string, { neighborId: string; bond: BondEdge }[]>();

  for (const atom of molecule.atoms) {
    atomMap.set(atom.id, atom);
    adj.set(atom.id, []);
  }

  const validBonds: BondEdge[] = [];
  for (const bond of molecule.bonds) {
    if (atomMap.has(bond.from) && atomMap.has(bond.to) && bond.from !== bond.to) {
      validBonds.push(bond);
      adj.get(bond.from)!.push({ neighborId: bond.to, bond });
      adj.get(bond.to)!.push({ neighborId: bond.from, bond });
    }
  }

  const ringMap = findAtomRings(molecule.atoms, adj);
  const atomAnalyses: Record<string, AtomAnalysis> = {};
  const valenceWarnings: string[] = [];

  const elementCounts: Record<string, number> = {};
  let totalWeight = 0;
  let heavyAtomCount = 0;
  let formalChargeSum = 0;
  let hbdCount = 0;
  let hbaCount = 0;
  let tpsa = 0;
  let estimatedLogP = 0;
  let sp3Count = 0;
  let sp2Count = 0;
  let spCount = 0;
  let aromaticAtomCount = 0;

  for (let idx = 0; idx < molecule.atoms.length; idx++) {
    const atom = molecule.atoms[idx];
    const spec = ELEMENTS[atom.element] ?? ELEMENTS.C;
    const edges = adj.get(atom.id) ?? [];
    const charge = atom.formalCharge ?? 0;
    formalChargeSum += charge;

    let bondOrderSum = 0;
    let maxBondOrder = 0;
    let doubleBondCount = 0;
    let tripleBondCount = 0;
    let hasAromaticBond = Boolean(atom.isAromatic);

    for (const { bond } of edges) {
      bondOrderSum += bond.order;
      if (bond.order > maxBondOrder) maxBondOrder = bond.order;
      if (bond.order === 2) doubleBondCount++;
      if (bond.order === 3) tripleBondCount++;
      if (bond.isAromatic) hasAromaticBond = true;
    }

    const roundedBondSum = Math.round(bondOrderSum);

    // Determine target valence accounting for formal charge
    let targetValence = spec.defaultValence;
    if (atom.element === 'N' && charge === 1) targetValence = 4;
    else if (atom.element === 'O' && charge === -1) targetValence = 1;
    else if (atom.element === 'O' && charge === 1) targetValence = 3;
    else if (atom.element === 'C' && charge === -1) targetValence = 3;
    else if (atom.element === 'C' && charge === 1) targetValence = 3;
    else {
      // Pick smallest standard valence >= roundedBondSum, or defaultValence
      const matching = spec.standardValences.find((v) => v >= roundedBondSum);
      targetValence = matching ?? spec.standardValences[spec.standardValences.length - 1];
    }

    const implicitH =
      atom.explicitH !== undefined
        ? atom.explicitH
        : Math.max(0, targetValence - roundedBondSum);
    const maxAllowedValence =
      atom.element === 'N' && charge === 1
        ? 4
        : Math.max(...spec.standardValences);
    const valenceValid = roundedBondSum <= maxAllowedValence;

    if (!valenceValid) {
      valenceWarnings.push(
        `Valence exceeded on ${atom.element}${idx + 1} (${roundedBondSum}/${maxAllowedValence})`
      );
    }

    const explicitNeighbors = edges.length;
    const totalCoordination = explicitNeighbors + implicitH;

    // Lone pairs calculation
    let lonePairs = spec.lonePairs;
    if (atom.element === 'N' && charge === 1) lonePairs = 0;
    else if (atom.element === 'O' && charge === -1) lonePairs = 3;
    else if (atom.element === 'B') lonePairs = 0;
    else if (atom.element === 'C' || atom.element === 'Si') lonePairs = 0;
    else if (atom.element === 'S' && roundedBondSum >= 4) {
      lonePairs = Math.max(0, (6 - roundedBondSum) / 2);
    } else if (atom.element === 'P' && roundedBondSum >= 5) {
      lonePairs = 0;
    }

    const stericNumber = totalCoordination + lonePairs;
    const ringSizes = ringMap.get(atom.id) ?? [];
    const inRing = ringSizes.length > 0;
    const isAromatic =
      hasAromaticBond ||
      (inRing &&
        ringSizes.includes(6) &&
        (atom.element === 'C' || atom.element === 'N') &&
        doubleBondCount >= 1 &&
        totalCoordination === 3);

    if (isAromatic) aromaticAtomCount++;

    // Hybridization & VSEPR geometry
    let hybridization: HybridizationType = 'sp3';
    let vseprGeometry: VseprGeometry = 'Tetrahedral (109.5°)';

    if (atom.element === 'H') {
      hybridization = 's';
      vseprGeometry = 'Terminal (1s)';
    } else if (tripleBondCount >= 1 || doubleBondCount >= 2 || stericNumber === 2) {
      hybridization = 'sp';
      vseprGeometry = 'Linear (180°)';
      spCount++;
    } else if (
      doubleBondCount === 1 ||
      isAromatic ||
      stericNumber === 3 ||
      (atom.element === 'B' && totalCoordination === 3)
    ) {
      hybridization = 'sp2';
      vseprGeometry =
        lonePairs === 1 ? 'Bent (104.5°)' : 'Trigonal Planar (120°)';
      sp2Count++;
    } else if (stericNumber > 4) {
      hybridization = 'sp3';
      vseprGeometry = 'Hypervalent / Expanded';
      sp3Count++;
    } else {
      hybridization = 'sp3';
      sp3Count++;
      if (lonePairs === 0) vseprGeometry = 'Tetrahedral (109.5°)';
      else if (lonePairs === 1) vseprGeometry = 'Trigonal Pyramidal (107°)';
      else if (lonePairs >= 2 && totalCoordination === 2)
        vseprGeometry = 'Bent (104.5°)';
      else vseprGeometry = 'Tetrahedral (109.5°)';
    }

    atomAnalyses[atom.id] = {
      atomId: atom.id,
      element: atom.element,
      explicitBondOrderSum: roundedBondSum,
      implicitHydrogens: implicitH,
      totalCoordination,
      lonePairs,
      stericNumber,
      hybridization,
      vseprGeometry,
      valenceValid,
      valenceMessage: valenceValid
        ? undefined
        : `Bond order sum ${roundedBondSum} exceeds max valence ${maxAllowedValence}`,
      inRing,
      ringSizes,
      isAromatic,
    };

    // Accumulate formula & mass
    elementCounts[atom.element] = (elementCounts[atom.element] ?? 0) + 1;
    totalWeight += spec.atomicMass;
    if (atom.element !== 'H') {
      heavyAtomCount++;
    }
    if (implicitH > 0) {
      elementCounts['H'] = (elementCounts['H'] ?? 0) + implicitH;
      totalWeight += implicitH * ELEMENTS.H.atomicMass;
    }

    // HBD / HBA / TPSA / LogP estimates
    if (atom.element === 'N' || atom.element === 'O') {
      hbaCount++;
      const totalHOnAtom =
        implicitH +
        edges.filter((e) => atomMap.get(e.neighborId)?.element === 'H').length;
      if (totalHOnAtom > 0) {
        hbdCount++;
      }
      if (atom.element === 'O') {
        tpsa += doubleBondCount === 1 ? 17.07 : totalHOnAtom > 0 ? 20.23 : 9.23;
        estimatedLogP += doubleBondCount === 1 ? -0.35 : -0.45;
      } else {
        tpsa += isAromatic
          ? 12.89
          : tripleBondCount === 1
          ? 23.79
          : totalHOnAtom === 2
          ? 26.02
          : totalHOnAtom === 1
          ? 12.03
          : 3.24;
        estimatedLogP += isAromatic ? -0.15 : -0.55;
      }
    } else if (atom.element === 'C') {
      estimatedLogP += isAromatic ? 0.32 : 0.24;
    } else if (atom.element === 'F') {
      estimatedLogP += 0.18;
    } else if (atom.element === 'Cl') {
      estimatedLogP += 0.65;
    } else if (atom.element === 'Br') {
      estimatedLogP += 0.85;
    } else if (atom.element === 'I') {
      estimatedLogP += 1.1;
    } else if (atom.element === 'S') {
      tpsa += doubleBondCount >= 1 ? 34.14 : 25.3;
      estimatedLogP += 0.45;
    } else if (atom.element === 'P') {
      tpsa += 34.14;
      estimatedLogP += 0.35;
    }
  }

  // Rotatable bonds: non-ring single bonds between non-terminal heavy atoms (excluding C-N amide bonds)
  let rotatableBonds = 0;
  for (const bond of validBonds) {
    if (bond.order !== 1 || bond.isAromatic) continue;
    const a1 = atomMap.get(bond.from)!;
    const a2 = atomMap.get(bond.to)!;
    if (a1.element === 'H' || a2.element === 'H') continue;
    const an1 = atomAnalyses[a1.id];
    const an2 = atomAnalyses[a2.id];
    if (an1.inRing && an2.inRing) continue;
    const heavyDeg1 = (adj.get(a1.id) ?? []).filter(
      (n) => atomMap.get(n.neighborId)?.element !== 'H'
    ).length;
    const heavyDeg2 = (adj.get(a2.id) ?? []).filter(
      (n) => atomMap.get(n.neighborId)?.element !== 'H'
    ).length;
    if (heavyDeg1 > 1 && heavyDeg2 > 1) {
      rotatableBonds++;
    }
  }

  // Hill system formula: C first, H second, then remaining elements alphabetically
  const formulaParts: string[] = [];
  if (elementCounts['C']) {
    formulaParts.push(
      elementCounts['C'] === 1 ? 'C' : `C${elementCounts['C']}`
    );
  }
  if (elementCounts['H']) {
    formulaParts.push(
      elementCounts['H'] === 1 ? 'H' : `H${elementCounts['H']}`
    );
  }
  const otherSymbols = Object.keys(elementCounts)
    .filter((s) => s !== 'C' && s !== 'H')
    .sort();
  for (const sym of otherSymbols) {
    const count = elementCounts[sym];
    formulaParts.push(count === 1 ? sym : `${sym}${count}`);
  }
  const formula = formulaParts.length > 0 ? formulaParts.join('') : 'Empty';

  const totalAtomCountWithH = Object.values(elementCounts).reduce(
    (acc, v) => acc + v,
    0
  );

  // Lipinski Rule of 5
  let lipinskiViolations = 0;
  if (totalWeight > 500) lipinskiViolations++;
  if (estimatedLogP > 5) lipinskiViolations++;
  if (hbdCount > 5) lipinskiViolations++;
  if (hbaCount > 10) lipinskiViolations++;

  // Circuit rank (cyclomatic number) for ring count: E - V + ConnectedComponents
  const visited = new Set<string>();
  let components = 0;
  for (const a of molecule.atoms) {
    if (!visited.has(a.id)) {
      components++;
      const q = [a.id];
      visited.add(a.id);
      while (q.length > 0) {
        const cur = q.shift()!;
        for (const n of adj.get(cur) ?? []) {
          if (!visited.has(n.neighborId)) {
            visited.add(n.neighborId);
            q.push(n.neighborId);
          }
        }
      }
    }
  }
  const ringCount = Math.max(
    0,
    validBonds.length - molecule.atoms.length + components
  );

  const canonicalSmiles =
    molecule.smiles && molecule.smiles.trim().length > 0
      ? molecule.smiles
      : generateSmilesFromGraph(molecule, adj, atomAnalyses);

  return {
    formula,
    molecularWeight: Number(totalWeight.toFixed(2)),
    heavyAtomCount,
    explicitAtomCount: molecule.atoms.length,
    totalAtomCountWithH,
    bondCount: validBonds.length,
    formalCharge: formalChargeSum,
    estimatedLogP: Number(estimatedLogP.toFixed(2)),
    tpsa: Number(tpsa.toFixed(1)),
    hbdCount,
    hbaCount,
    rotatableBonds,
    ringCount,
    lipinskiViolations,
    lipinskiPass: lipinskiViolations <= 1,
    valenceValid: valenceWarnings.length === 0,
    valenceWarnings,
    hybridizationCounts: {
      sp3: sp3Count,
      sp2: sp2Count,
      sp: spCount,
    },
    canonicalSmiles,
    atomAnalyses,
  };
}

/**
 * Generates a valid SMILES string via DFS spanning tree + ring closure digits.
 */
export function generateSmilesFromGraph(
  molecule: MoleculeGraph,
  adjInput?: Map<string, { neighborId: string; bond: BondEdge }[]>,
  analysesInput?: Record<string, AtomAnalysis>
): string {
  if (molecule.atoms.length === 0) return '';
  const atomMap = new Map<string, AtomNode>();
  const adj =
    adjInput ?? new Map<string, { neighborId: string; bond: BondEdge }[]>();

  for (const a of molecule.atoms) {
    atomMap.set(a.id, a);
    if (!adjInput) adj.set(a.id, []);
  }
  if (!adjInput) {
    for (const b of molecule.bonds) {
      if (atomMap.has(b.from) && atomMap.has(b.to) && b.from !== b.to) {
        adj.get(b.from)!.push({ neighborId: b.to, bond: b });
        adj.get(b.to)!.push({ neighborId: b.from, bond: b });
      }
    }
  }

  // Filter out explicit hydrogens attached to heavy atoms unless molecule is only H
  const hasHeavy = molecule.atoms.some((a) => a.element !== 'H');
  const activeAtoms = hasHeavy
    ? molecule.atoms.filter((a) => a.element !== 'H')
    : molecule.atoms;
  const activeSet = new Set(activeAtoms.map((a) => a.id));

  const visited = new Set<string>();
  const parentMap = new Map<string, string>();
  const ringClosures = new Map<string, { digit: number; bond: BondEdge }[]>();
  const seenBackEdges = new Set<string>();
  let nextRingDigit = 1;

  // First pass: build DFS tree and assign ring closure digits
  function findTree(u: string) {
    visited.add(u);
    const neighbors = (adj.get(u) ?? []).filter((n) =>
      activeSet.has(n.neighborId)
    );
    for (const { neighborId: v, bond } of neighbors) {
      if (!visited.has(v)) {
        parentMap.set(v, u);
        findTree(v);
      } else if (parentMap.get(u) !== v) {
        const edgeKey = u < v ? `${u}|${v}` : `${v}|${u}`;
        if (!seenBackEdges.has(edgeKey)) {
          seenBackEdges.add(edgeKey);
          const digit = nextRingDigit++;
          if (!ringClosures.has(u)) ringClosures.set(u, []);
          if (!ringClosures.has(v)) ringClosures.set(v, []);
          ringClosures.get(u)!.push({ digit, bond });
          ringClosures.get(v)!.push({ digit, bond });
        }
      }
    }
  }

  const componentSmiles: string[] = [];
  const emitted = new Set<string>();

  function formatAtomToken(atom: AtomNode): string {
    const isAromatic =
      analysesInput?.[atom.id]?.isAromatic ?? Boolean(atom.isAromatic);
    const organicSubset = new Set([
      'B',
      'C',
      'N',
      'O',
      'P',
      'S',
      'F',
      'Cl',
      'Br',
      'I',
    ]);
    if (organicSubset.has(atom.element) && !atom.formalCharge) {
      if (isAromatic && ['C', 'N', 'O', 'S', 'P'].includes(atom.element)) {
        return atom.element.toLowerCase();
      }
      return atom.element;
    }
    const chg = atom.formalCharge ?? 0;
    const chgStr =
      chg === 0 ? '' : chg > 0 ? `+${chg > 1 ? chg : ''}` : `${chg < -1 ? chg : '-'}`;
    return `[${atom.element}${chgStr}]`;
  }

  function formatBondPrefix(bond: BondEdge, fromAromatic: boolean, toAromatic: boolean): string {
    if (bond.isAromatic || (fromAromatic && toAromatic)) return '';
    if (bond.order === 2) return '=';
    if (bond.order === 3) return '#';
    return '';
  }

  function emitDfs(u: string): string {
    emitted.add(u);
    const atom = atomMap.get(u)!;
    const uAromatic = Boolean(analysesInput?.[u]?.isAromatic ?? atom.isAromatic);
    let out = formatAtomToken(atom);

    const closures = ringClosures.get(u) ?? [];
    for (const c of closures) {
      const prefix =
        c.bond.order === 2 && !c.bond.isAromatic
          ? '='
          : c.bond.order === 3
          ? '#'
          : '';
      out += `${prefix}${c.digit > 9 ? `%${c.digit}` : c.digit}`;
    }

    const children = (adj.get(u) ?? []).filter(
      (n) =>
        activeSet.has(n.neighborId) &&
        !emitted.has(n.neighborId) &&
        parentMap.get(n.neighborId) === u
    );

    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      const vAtom = atomMap.get(child.neighborId)!;
      const vAromatic = Boolean(
        analysesInput?.[child.neighborId]?.isAromatic ?? vAtom.isAromatic
      );
      const bondStr = formatBondPrefix(child.bond, uAromatic, vAromatic);
      const sub = emitDfs(child.neighborId);
      if (i < children.length - 1) {
        out += `(${bondStr}${sub})`;
      } else {
        out += `${bondStr}${sub}`;
      }
    }
    return out;
  }

  for (const atom of activeAtoms) {
    if (!visited.has(atom.id)) {
      findTree(atom.id);
      componentSmiles.push(emitDfs(atom.id));
    }
  }

  return componentSmiles.join('.');
}

/**
 * Expands implicit hydrogens into explicit AtomNodes and BondEdges with 2D & 3D coordinates.
 */
export function expandHydrogens(molecule: MoleculeGraph): MoleculeGraph {
  const metrics = computeMoleculeMetrics(molecule);
  const newAtoms: AtomNode[] = [...molecule.atoms.map((a) => ({ ...a }))];
  const newBonds: BondEdge[] = [...molecule.bonds.map((b) => ({ ...b }))];

  const adj = new Map<string, AtomNode[]>();
  const atomMap = new Map<string, AtomNode>();
  for (const a of newAtoms) {
    adj.set(a.id, []);
    atomMap.set(a.id, a);
  }
  for (const b of newBonds) {
    if (atomMap.has(b.from) && atomMap.has(b.to)) {
      adj.get(b.from)!.push(atomMap.get(b.to)!);
      adj.get(b.to)!.push(atomMap.get(b.from)!);
    }
  }

  let hCounter = 1;
  for (const atom of molecule.atoms) {
    const analysis = metrics.atomAnalyses[atom.id];
    if (!analysis || analysis.implicitHydrogens <= 0) continue;

    // Once converted to explicit H atoms, clear bracketed explicitH so it isn't double-counted
    const targetAtom = atomMap.get(atom.id);
    if (targetAtom && targetAtom.explicitH !== undefined) {
      targetAtom.explicitH = undefined;
    }

    const existingNeighbors = adj.get(atom.id) ?? [];
    for (let k = 0; k < analysis.implicitHydrogens; k++) {
      // Find open 2D angle farthest from existing neighbors
      const usedAngles = existingNeighbors.map((n) =>
        Math.atan2(n.y2d - atom.y2d, n.x2d - atom.x2d)
      );
      let bestAngle = (k * Math.PI * 2) / Math.max(1, analysis.implicitHydrogens);
      if (usedAngles.length > 0) {
        let maxMinDist = -1;
        for (let step = 0; step < 24; step++) {
          const cand = (step * Math.PI * 2) / 24;
          let minDist = Infinity;
          for (const ua of usedAngles) {
            const diff = Math.abs(Math.atan2(Math.sin(cand - ua), Math.cos(cand - ua)));
            if (diff < minDist) minDist = diff;
          }
          if (minDist > maxMinDist) {
            maxMinDist = minDist;
            bestAngle = cand;
          }
        }
      }

      const hId = `h_${atom.id}_${hCounter++}`;
      const hAtom: AtomNode = {
        id: hId,
        element: 'H',
        x2d: atom.x2d + Math.cos(bestAngle) * (BOND_2D_LENGTH * 0.78),
        y2d: atom.y2d + Math.sin(bestAngle) * (BOND_2D_LENGTH * 0.78),
        x3d: atom.x3d + Math.cos(bestAngle) * 1.09,
        y3d: atom.y3d + Math.sin(bestAngle) * 1.09,
        z3d: atom.z3d + (k % 2 === 0 ? 0.65 : -0.65),
      };
      newAtoms.push(hAtom);
      existingNeighbors.push(hAtom);
      newBonds.push({
        id: `b_${hId}`,
        from: atom.id,
        to: hId,
        order: 1,
      });
    }
  }

  return generate3DCoordinates({
    ...molecule,
    smiles: undefined,
    atoms: newAtoms,
    bonds: newBonds,
  });
}

/**
 * Collapses explicit hydrogen atoms attached to heavy atoms back into implicit hydrogens.
 */
export function collapseHydrogens(molecule: MoleculeGraph): MoleculeGraph {
  const hasHeavy = molecule.atoms.some((a) => a.element !== 'H');
  if (!hasHeavy) return molecule;

  const atomById = new Map(molecule.atoms.map((a) => [a.id, a]));
  const removedHCount = new Map<string, number>();
  for (const b of molecule.bonds) {
    const a1 = atomById.get(b.from);
    const a2 = atomById.get(b.to);
    if (!a1 || !a2) continue;
    if (a1.element === 'H' && a2.element !== 'H') {
      removedHCount.set(a2.id, (removedHCount.get(a2.id) ?? 0) + 1);
    } else if (a2.element === 'H' && a1.element !== 'H') {
      removedHCount.set(a1.id, (removedHCount.get(a1.id) ?? 0) + 1);
    }
  }

  const heavyIds = new Set(
    molecule.atoms.filter((a) => a.element !== 'H').map((a) => a.id)
  );
  const filteredAtoms = molecule.atoms
    .filter((a) => heavyIds.has(a.id))
    .map((a) => {
      if (a.isAromatic && a.element === 'N' && (removedHCount.get(a.id) ?? 0) > 0) {
        return { ...a, explicitH: removedHCount.get(a.id) };
      }
      return { ...a };
    });
  const filteredBonds = molecule.bonds.filter(
    (b) => heavyIds.has(b.from) && heavyIds.has(b.to)
  );

  return generate3DCoordinates({
    ...molecule,
    smiles: undefined,
    atoms: filteredAtoms,
    bonds: filteredBonds,
  });
}

/**
 * Generates chemically realistic 3D VSEPR coordinates from 2D graph topology
 * using hybridization out-of-plane lifting + ring puckering + spring-force relaxation.
 */
export function generate3DCoordinates(molecule: MoleculeGraph): MoleculeGraph {
  if (molecule.atoms.length === 0) return molecule;

  const metrics = computeMoleculeMetrics(molecule);
  const atoms = molecule.atoms.map((a) => ({ ...a }));
  const atomMap = new Map<string, AtomNode>();
  const adj = new Map<string, { neighborId: string; bond: BondEdge }[]>();

  for (const a of atoms) {
    atomMap.set(a.id, a);
    adj.set(a.id, []);
  }
  for (const b of molecule.bonds) {
    if (atomMap.has(b.from) && atomMap.has(b.to) && b.from !== b.to) {
      adj.get(b.from)!.push({ neighborId: b.to, bond: b });
      adj.get(b.to)!.push({ neighborId: b.from, bond: b });
    }
  }

  // Scale 2D pixels to Angstroms (~1.50 A per 54px bond)
  const scale2dTo3d = 1.52 / BOND_2D_LENGTH;
  let cx2 = 0;
  let cy2 = 0;
  for (const a of atoms) {
    cx2 += a.x2d;
    cy2 += a.y2d;
  }
  cx2 /= atoms.length;
  cy2 /= atoms.length;

  // Initial 3D embedding with deterministic VSEPR Z-lifting for sp3 centers & saturated rings
  for (let i = 0; i < atoms.length; i++) {
    const a = atoms[i];
    const analysis = metrics.atomAnalyses[a.id];
    const baseX = (a.x2d - cx2) * scale2dTo3d;
    const baseY = -(a.y2d - cy2) * scale2dTo3d;

    let z = 0;
    if (analysis) {
      if (analysis.isAromatic || analysis.hybridization === 'sp2' || analysis.hybridization === 'sp') {
        z = 0;
      } else if (analysis.inRing && analysis.ringSizes.includes(6)) {
        // Chair conformation alternating Z pucker
        z = i % 2 === 0 ? 0.24 : -0.24;
      } else if (analysis.hybridization === 'sp3') {
        // Out-of-plane tetrahedral Z offset based on neighbor index / stereobond
        const edges = adj.get(a.id) ?? [];
        const wedgeEdge = edges.find((e) => e.bond.stereo === 'wedge');
        const dashEdge = edges.find((e) => e.bond.stereo === 'dash');
        if (wedgeEdge) z = 0.62;
        else if (dashEdge) z = -0.62;
        else z = ((i % 3) - 1) * 0.42;
      }
    }

    a.x3d = baseX;
    a.y3d = baseY;
    a.z3d = z;
  }

  // Apply explicit stereochemical wedge (+Z toward viewer) and hashed dash (-Z away) offsets
  for (const b of molecule.bonds) {
    if (!b.stereo || b.stereo === 'none') continue;
    const fromAtom = atomMap.get(b.from);
    const toAtom = atomMap.get(b.to);
    if (!fromAtom || !toAtom) continue;
    if (b.stereo === 'wedge') {
      toAtom.z3d = fromAtom.z3d + 0.88;
    } else if (b.stereo === 'dash') {
      toAtom.z3d = fromAtom.z3d - 0.88;
    }
  }

  // Precompute 1-3 angle pairs (atoms sharing a common bonded center)
  interface AnglePair {
    id1: string;
    id2: string;
    targetDist: number;
  }
  const anglePairs: AnglePair[] = [];
  const bondedSet = new Set<string>();

  for (const b of molecule.bonds) {
    const k = b.from < b.to ? `${b.from}|${b.to}` : `${b.to}|${b.from}`;
    bondedSet.add(k);
  }

  for (const center of atoms) {
    const neighbors = adj.get(center.id) ?? [];
    const analysis = metrics.atomAnalyses[center.id];
    let thetaRad = (109.47 * Math.PI) / 180;
    if (analysis?.hybridization === 'sp') thetaRad = Math.PI;
    else if (analysis?.hybridization === 'sp2') thetaRad = (120 * Math.PI) / 180;
    else if (analysis?.inRing && analysis.ringSizes.includes(5))
      thetaRad = (108 * Math.PI) / 180;
    else if (analysis?.inRing && analysis.ringSizes.includes(4))
      thetaRad = (90 * Math.PI) / 180;
    else if (analysis?.inRing && analysis.ringSizes.includes(3))
      thetaRad = (60 * Math.PI) / 180;

    for (let i = 0; i < neighbors.length; i++) {
      for (let j = i + 1; j < neighbors.length; j++) {
        const n1 = neighbors[i];
        const n2 = neighbors[j];
        const d1 = getTargetBondLength3D(
          center.element,
          atomMap.get(n1.neighborId)!.element,
          n1.bond.order,
          n1.bond.isAromatic
        );
        const d2 = getTargetBondLength3D(
          center.element,
          atomMap.get(n2.neighborId)!.element,
          n2.bond.order,
          n2.bond.isAromatic
        );
        const targetDist = Math.sqrt(
          Math.max(0.4, d1 * d1 + d2 * d2 - 2 * d1 * d2 * Math.cos(thetaRad))
        );
        anglePairs.push({
          id1: n1.neighborId,
          id2: n2.neighborId,
          targetDist,
        });
      }
    }
  }

  // Iterative force-field relaxation (bond lengths + VSEPR 1-3 angles + sp2 planarity + steric repulsion)
  const forces = new Map<string, { fx: number; fy: number; fz: number }>();
  for (const a of atoms) forces.set(a.id, { fx: 0, fy: 0, fz: 0 });

  const iterations = 90;
  for (let iter = 0; iter < iterations; iter++) {
    for (const f of forces.values()) {
      f.fx = 0;
      f.fy = 0;
      f.fz = 0;
    }

    // 1. Bond length harmonic springs
    for (const bond of molecule.bonds) {
      const a1 = atomMap.get(bond.from);
      const a2 = atomMap.get(bond.to);
      if (!a1 || !a2 || a1 === a2) continue;
      const target = getTargetBondLength3D(
        a1.element,
        a2.element,
        bond.order,
        bond.isAromatic
      );
      let dx = a2.x3d - a1.x3d;
      let dy = a2.y3d - a1.y3d;
      let dz = a2.z3d - a1.z3d;
      let dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist < 1e-4) {
        dx = 0.1;
        dy = 0.05;
        dz = 0.05;
        dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      }
      const diff = (dist - target) * 0.45;
      const ux = (dx / dist) * diff;
      const uy = (dy / dist) * diff;
      const uz = (dz / dist) * diff;
      const f1 = forces.get(a1.id)!;
      const f2 = forces.get(a2.id)!;
      f1.fx += ux;
      f1.fy += uy;
      f1.fz += uz;
      f2.fx -= ux;
      f2.fy -= uy;
      f2.fz -= uz;
    }

    // 2. 1-3 VSEPR bond-angle springs
    for (const pair of anglePairs) {
      const a1 = atomMap.get(pair.id1)!;
      const a2 = atomMap.get(pair.id2)!;
      let dx = a2.x3d - a1.x3d;
      let dy = a2.y3d - a1.y3d;
      let dz = a2.z3d - a1.z3d;
      let dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist < 1e-4) {
        dx = 0.1;
        dy = -0.1;
        dz = 0.1;
        dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      }
      const diff = (dist - pair.targetDist) * 0.25;
      const ux = (dx / dist) * diff;
      const uy = (dy / dist) * diff;
      const uz = (dz / dist) * diff;
      const f1 = forces.get(a1.id)!;
      const f2 = forces.get(a2.id)!;
      f1.fx += ux;
      f1.fy += uy;
      f1.fz += uz;
      f2.fx -= ux;
      f2.fy -= uy;
      f2.fz -= uz;
    }

    // 3. Planarity restraint for sp2 / aromatic centers
    for (const center of atoms) {
      const analysis = metrics.atomAnalyses[center.id];
      if (!analysis || (analysis.hybridization !== 'sp2' && !analysis.isAromatic))
        continue;
      const neighbors = adj.get(center.id) ?? [];
      if (neighbors.length >= 2) {
        let avgZ = center.z3d;
        for (const n of neighbors) {
          avgZ += atomMap.get(n.neighborId)!.z3d;
        }
        avgZ /= neighbors.length + 1;
        forces.get(center.id)!.fz += (avgZ - center.z3d) * 0.35;
        for (const n of neighbors) {
          const na = atomMap.get(n.neighborId)!;
          forces.get(na.id)!.fz += (avgZ - na.z3d) * 0.25;
        }
      }
    }

    // 4. Non-bonded steric clash repulsion
    for (let i = 0; i < atoms.length; i++) {
      for (let j = i + 1; j < atoms.length; j++) {
        const a1 = atoms[i];
        const a2 = atoms[j];
        const k = a1.id < a2.id ? `${a1.id}|${a2.id}` : `${a2.id}|${a1.id}`;
        if (bondedSet.has(k)) continue;
        const minClearance =
          ((ELEMENTS[a1.element]?.covalentRadius ?? 0.76) +
            (ELEMENTS[a2.element]?.covalentRadius ?? 0.76)) *
          1.35;
        const dx = a2.x3d - a1.x3d;
        const dy = a2.y3d - a1.y3d;
        const dz = a2.z3d - a1.z3d;
        const distSq = dx * dx + dy * dy + dz * dz;
        if (distSq < minClearance * minClearance) {
          const dist = Math.max(0.05, Math.sqrt(distSq));
          const push = ((minClearance - dist) / dist) * 0.18;
          const f1 = forces.get(a1.id)!;
          const f2 = forces.get(a2.id)!;
          f1.fx -= dx * push;
          f1.fy -= dy * push;
          f1.fz -= dz * push;
          f2.fx += dx * push;
          f2.fy += dy * push;
          f2.fz += dz * push;
        }
      }
    }

    // Apply damped step
    const step = 0.45 * (1 - iter / (iterations * 1.4));
    for (const a of atoms) {
      const f = forces.get(a.id)!;
      a.x3d += Math.max(-0.4, Math.min(0.4, f.fx * step));
      a.y3d += Math.max(-0.4, Math.min(0.4, f.fy * step));
      a.z3d += Math.max(-0.4, Math.min(0.4, f.fz * step));
    }
  }

  // Center molecule centroid at origin (0, 0, 0)
  let mx = 0;
  let my = 0;
  let mz = 0;
  for (const a of atoms) {
    mx += a.x3d;
    my += a.y3d;
    mz += a.z3d;
  }
  mx /= atoms.length;
  my /= atoms.length;
  mz /= atoms.length;

  for (const a of atoms) {
    a.x3d = Number((a.x3d - mx).toFixed(4));
    a.y3d = Number((a.y3d - my).toFixed(4));
    a.z3d = Number((a.z3d - mz).toFixed(4));
  }

  return {
    ...molecule,
    atoms,
  };
}

/**
 * Cleans and normalizes 2D coordinates to standard bond lengths and centered bounding box.
 */
export function clean2DLayout(
  molecule: MoleculeGraph,
  viewportWidth = 560,
  viewportHeight = 460
): MoleculeGraph {
  if (molecule.atoms.length === 0) return molecule;
  const atoms = molecule.atoms.map((a) => ({ ...a }));
  const atomMap = new Map<string, AtomNode>();
  for (const a of atoms) atomMap.set(a.id, a);

  // Run 40 iterations of 2D bond-length + repulsion relaxation
  for (let iter = 0; iter < 40; iter++) {
    for (const b of molecule.bonds) {
      const a1 = atomMap.get(b.from);
      const a2 = atomMap.get(b.to);
      if (!a1 || !a2 || a1 === a2) continue;
      let dx = a2.x2d - a1.x2d;
      let dy = a2.y2d - a1.y2d;
      let dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 1) {
        dx = BOND_2D_LENGTH;
        dy = 0;
        dist = BOND_2D_LENGTH;
      }
      const diff = ((dist - BOND_2D_LENGTH) / dist) * 0.35;
      a1.x2d += dx * diff;
      a1.y2d += dy * diff;
      a2.x2d -= dx * diff;
      a2.y2d -= dy * diff;
    }

    for (let i = 0; i < atoms.length; i++) {
      for (let j = i + 1; j < atoms.length; j++) {
        const a1 = atoms[i];
        const a2 = atoms[j];
        const dx = a2.x2d - a1.x2d;
        const dy = a2.y2d - a1.y2d;
        const distSq = dx * dx + dy * dy;
        const minD = BOND_2D_LENGTH * 0.92;
        if (distSq < minD * minD) {
          const dist = Math.max(2, Math.sqrt(distSq));
          const push = ((minD - dist) / dist) * 0.25;
          a1.x2d -= dx * push;
          a1.y2d -= dy * push;
          a2.x2d += dx * push;
          a2.y2d += dy * push;
        }
      }
    }
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const a of atoms) {
    if (a.x2d < minX) minX = a.x2d;
    if (a.x2d > maxX) maxX = a.x2d;
    if (a.y2d < minY) minY = a.y2d;
    if (a.y2d > maxY) maxY = a.y2d;
  }

  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const targetCx = viewportWidth / 2;
  const targetCy = viewportHeight / 2;

  for (const a of atoms) {
    a.x2d = Math.round(a.x2d - cx + targetCx);
    a.y2d = Math.round(a.y2d - cy + targetCy);
  }

  return generate3DCoordinates({
    ...molecule,
    atoms,
  });
}

/**
 * Deterministic SMILES parser supporting organic subset, aromatic atoms,
 * branches (...), bond orders (-, =, #, :), bracketed atoms, and ring closures.
 */
export function parseSmilesToMolecule(
  smilesInput: string,
  name = 'Custom Structure'
): MoleculeGraph {
  const smiles = smilesInput.trim();
  if (!smiles) {
    throw new Error('SMILES string cannot be empty.');
  }

  const atoms: AtomNode[] = [];
  const bonds: BondEdge[] = [];
  const ringOpens = new Map<
    number,
    { atomId: string; order: BondOrder; isAromatic: boolean }
  >();
  const branchStack: string[] = [];

  let prevAtomId: string | null = null;
  let pendingBondOrder: BondOrder | null = null;
  let pendingAromatic = false;
  let i = 0;
  let atomCounter = 1;

  const normalizeElement = (raw: string): { element: ElementSymbol; aromatic: boolean } => {
    const aromaticMap: Record<string, ElementSymbol> = {
      c: 'C',
      n: 'N',
      o: 'O',
      s: 'S',
      p: 'P',
      b: 'B',
    };
    if (aromaticMap[raw]) {
      return { element: aromaticMap[raw], aromatic: true };
    }
    const validElements = new Set<string>(Object.keys(ELEMENTS));
    if (validElements.has(raw)) {
      return { element: raw as ElementSymbol, aromatic: false };
    }
    throw new Error(`Unsupported element symbol "${raw}" in SMILES.`);
  };

  while (i < smiles.length) {
    const ch = smiles[i];

    if (ch === ' ') {
      i++;
      continue;
    }

    if (ch === '.') {
      prevAtomId = null;
      pendingBondOrder = null;
      pendingAromatic = false;
      i++;
      continue;
    }

    if (ch === '-') {
      pendingBondOrder = 1;
      pendingAromatic = false;
      i++;
      continue;
    }
    if (ch === '=') {
      pendingBondOrder = 2;
      pendingAromatic = false;
      i++;
      continue;
    }
    if (ch === '#') {
      pendingBondOrder = 3;
      pendingAromatic = false;
      i++;
      continue;
    }
    if (ch === ':') {
      pendingBondOrder = 1;
      pendingAromatic = true;
      i++;
      continue;
    }
    if (ch === '/' || ch === '\\') {
      i++;
      continue;
    }

    if (ch === '(') {
      if (prevAtomId) {
        branchStack.push(prevAtomId);
      }
      i++;
      continue;
    }

    if (ch === ')') {
      const popped = branchStack.pop();
      if (popped !== undefined) {
        prevAtomId = popped;
      }
      pendingBondOrder = null;
      pendingAromatic = false;
      i++;
      continue;
    }

    // Ring closure digit or %NN
    if ((ch >= '0' && ch <= '9') || ch === '%') {
      let ringNum = 0;
      if (ch === '%') {
        ringNum = parseInt(smiles.slice(i + 1, i + 3), 10);
        i += 3;
      } else {
        ringNum = parseInt(ch, 10);
        i += 1;
      }
      if (!prevAtomId) {
        throw new Error(`Ring closure ${ringNum} has no preceding atom.`);
      }
      const existing = ringOpens.get(ringNum);
      if (!existing) {
        ringOpens.set(ringNum, {
          atomId: prevAtomId,
          order: pendingBondOrder ?? 1,
          isAromatic: pendingAromatic,
        });
      } else {
        const fromAtom = atoms.find((a) => a.id === existing.atomId)!;
        const toAtom = atoms.find((a) => a.id === prevAtomId)!;
        const bothAromatic = Boolean(fromAtom.isAromatic && toAtom.isAromatic);
        const order = pendingBondOrder ?? existing.order ?? 1;
        const isAromatic =
          pendingAromatic || existing.isAromatic || (bothAromatic && order === 1);

        bonds.push({
          id: `b_${bonds.length + 1}`,
          from: existing.atomId,
          to: prevAtomId,
          order,
          isAromatic,
        });
        ringOpens.delete(ringNum);
      }
      pendingBondOrder = null;
      pendingAromatic = false;
      continue;
    }

    // Bracketed atom e.g. [NH4+], [O-], [nH], [Si]
    if (ch === '[') {
      const closeIdx = smiles.indexOf(']', i);
      if (closeIdx === -1) {
        throw new Error('Unclosed "[" in SMILES string.');
      }
      const content = smiles.slice(i + 1, closeIdx);
      i = closeIdx + 1;

      // Strip isotope prefix
      const cleaned = content.replace(/^\d+/, '');
      const elemMatch = cleaned.match(/^([A-Z][a-z]?|[cnospb])/);
      if (!elemMatch) {
        throw new Error(`Invalid bracket atom [${content}] in SMILES.`);
      }
      const { element, aromatic } = normalizeElement(elemMatch[1]);

      // Parse formal charge and explicit bracket H (e.g. [nH], [NH4+], [CH2])
      const afterElem = cleaned.slice(elemMatch[1].length);
      let explicitH: number | undefined = undefined;
      const hMatch = afterElem.match(/H(\d*)/);
      if (hMatch) {
        explicitH = hMatch[1] ? parseInt(hMatch[1], 10) : 1;
      }

      let formalCharge = 0;
      const plusMatch = afterElem.match(/\+(\d*)/);
      const minusMatch = afterElem.match(/-(\d*)/);
      if (plusMatch) {
        formalCharge = plusMatch[1] ? parseInt(plusMatch[1], 10) : 1;
      } else if (minusMatch) {
        formalCharge = -(minusMatch[1] ? parseInt(minusMatch[1], 10) : 1);
      }

      const newAtom: AtomNode = {
        id: `a_${atomCounter++}`,
        element,
        x2d: 0,
        y2d: 0,
        x3d: 0,
        y3d: 0,
        z3d: 0,
        formalCharge: formalCharge !== 0 ? formalCharge : undefined,
        isAromatic: aromatic || undefined,
        explicitH,
      };
      atoms.push(newAtom);

      if (prevAtomId) {
        const prevAtom = atoms.find((a) => a.id === prevAtomId)!;
        const bothAromatic = Boolean(prevAtom.isAromatic && newAtom.isAromatic);
        const order = pendingBondOrder ?? 1;
        bonds.push({
          id: `b_${bonds.length + 1}`,
          from: prevAtomId,
          to: newAtom.id,
          order,
          isAromatic: pendingAromatic || (bothAromatic && order === 1),
        });
      }
      prevAtomId = newAtom.id;
      pendingBondOrder = null;
      pendingAromatic = false;
      continue;
    }

    // Two-letter organic subset Cl, Br, Si
    const twoChar = smiles.slice(i, i + 2);
    let rawSym = ch;
    if (twoChar === 'Cl' || twoChar === 'Br' || twoChar === 'Si') {
      rawSym = twoChar;
      i += 2;
    } else {
      i += 1;
    }

    const { element, aromatic } = normalizeElement(rawSym);
    const newAtom: AtomNode = {
      id: `a_${atomCounter++}`,
      element,
      x2d: 0,
      y2d: 0,
      x3d: 0,
      y3d: 0,
      z3d: 0,
      isAromatic: aromatic || undefined,
    };
    atoms.push(newAtom);

    if (prevAtomId) {
      const prevAtom = atoms.find((a) => a.id === prevAtomId)!;
      const bothAromatic = Boolean(prevAtom.isAromatic && newAtom.isAromatic);
      const order = pendingBondOrder ?? 1;
      bonds.push({
        id: `b_${bonds.length + 1}`,
        from: prevAtomId,
        to: newAtom.id,
        order,
        isAromatic: pendingAromatic || (bothAromatic && order === 1),
      });
    }
    prevAtomId = newAtom.id;
    pendingBondOrder = null;
    pendingAromatic = false;
  }

  if (atoms.length === 0) {
    throw new Error('No valid atoms parsed from SMILES.');
  }

  kekulizeAromaticBonds(atoms, bonds);

  // Deterministic ring-aware 2D layout via BFS spanning tree + regular polygon rings
  layoutParsedGraph2D(atoms, bonds);

  return generate3DCoordinates({
    id: `mol_${Date.now()}`,
    name,
    smiles,
    atoms,
    bonds,
  });
}

/**
 * Assigns alternating integer single (1) and double (2) bond orders to aromatic
 * ring systems via exact matching so valence, hybridization, and H-counts are exact.
 */
function kekulizeAromaticBonds(atoms: AtomNode[], bonds: BondEdge[]) {
  const aromaticBonds = bonds.filter((b) => b.isAromatic);
  if (aromaticBonds.length === 0) return;

  for (const b of aromaticBonds) {
    b.order = 1;
  }

  const atomMap = new Map<string, AtomNode>();
  const nonAromaticSum = new Map<string, number>();
  const aromaticEdgesByAtom = new Map<string, BondEdge[]>();

  for (const a of atoms) {
    atomMap.set(a.id, a);
    nonAromaticSum.set(a.id, 0);
    aromaticEdgesByAtom.set(a.id, []);
  }

  for (const b of bonds) {
    if (b.isAromatic) {
      aromaticEdgesByAtom.get(b.from)?.push(b);
      aromaticEdgesByAtom.get(b.to)?.push(b);
    } else {
      nonAromaticSum.set(b.from, (nonAromaticSum.get(b.from) ?? 0) + b.order);
      nonAromaticSum.set(b.to, (nonAromaticSum.get(b.to) ?? 0) + b.order);
    }
  }

  const neededDoubles = new Map<string, number>();
  const aromaticAtomIds: string[] = [];

  for (const a of atoms) {
    const arEdges = aromaticEdgesByAtom.get(a.id) ?? [];
    if (arEdges.length === 0) continue;
    aromaticAtomIds.push(a.id);

    const spec = ELEMENTS[a.element] ?? ELEMENTS.C;
    const charge = a.formalCharge ?? 0;
    let targetValence = spec.defaultValence;
    if (a.element === 'N' && charge === 1) targetValence = 4;
    else if (a.element === 'O' && charge === -1) targetValence = 1;
    else if (a.element === 'C' && charge !== 0) targetValence = 3;

    const nonAr = nonAromaticSum.get(a.id) ?? 0;
    const sigmaCount = nonAr + arEdges.length;
    let needed = 0;
    if (a.explicitH !== undefined) {
      needed = Math.max(0, targetValence - sigmaCount - a.explicitH);
    } else if (a.isAromatic && (a.element === 'O' || a.element === 'S')) {
      needed = 0;
    } else {
      needed = sigmaCount < targetValence ? 1 : 0;
    }
    neededDoubles.set(a.id, needed);
  }

  function solve(): boolean {
    // Pick atom with highest remaining neededDoubles > 0
    let targetId: string | null = null;
    for (const id of aromaticAtomIds) {
      const need = neededDoubles.get(id) ?? 0;
      if (need > 0) {
        targetId = id;
        break;
      }
    }
    if (!targetId) return true;

    const edges = aromaticEdgesByAtom.get(targetId) ?? [];
    for (const edge of edges) {
      if (edge.order !== 1) continue;
      const otherId = edge.from === targetId ? edge.to : edge.from;
      const otherNeed = neededDoubles.get(otherId) ?? 0;
      if (otherNeed <= 0) continue;

      edge.order = 2;
      neededDoubles.set(targetId, (neededDoubles.get(targetId) ?? 0) - 1);
      neededDoubles.set(otherId, otherNeed - 1);

      if (solve()) return true;

      edge.order = 1;
      neededDoubles.set(targetId, (neededDoubles.get(targetId) ?? 0) + 1);
      neededDoubles.set(otherId, otherNeed);
    }
    return false;
  }

  solve();
}

/**
 * Places 2D coordinates cleanly for parsed SMILES graphs (rings as regular polygons, chains at 120 deg).
 */
function layoutParsedGraph2D(atoms: AtomNode[], bonds: BondEdge[]) {
  const atomMap = new Map<string, AtomNode>();
  const adj = new Map<string, string[]>();
  for (const a of atoms) {
    atomMap.set(a.id, a);
    adj.set(a.id, []);
  }
  for (const b of bonds) {
    adj.get(b.from)?.push(b.to);
    adj.get(b.to)?.push(b.from);
  }

  const atomIndex = new Map<string, number>();
  atoms.forEach((a, idx) => atomIndex.set(a.id, idx));

  const placed = new Set<string>();
  const angleMap = new Map<string, number>();

  // Detect small rings first to place polygon vertices cleanly (using numeric atom index, not string order)
  const rings: string[][] = [];
  const seenRings = new Set<string>();

  for (const start of atoms) {
    const startIdx = atomIndex.get(start.id) ?? 0;
    const stack: string[][] = [[start.id]];
    while (stack.length > 0) {
      const path = stack.pop()!;
      const cur = path[path.length - 1];
      if (path.length > 7) continue;
      for (const nxt of adj.get(cur) ?? []) {
        if (nxt === start.id && path.length >= 3) {
          const canonical = [...path]
            .sort((a, b) => (atomIndex.get(a) ?? 0) - (atomIndex.get(b) ?? 0))
            .join(',');
          if (!seenRings.has(canonical)) {
            seenRings.add(canonical);
            rings.push(path);
          }
        } else if (!path.includes(nxt) && (atomIndex.get(nxt) ?? 0) > startIdx) {
          stack.push([...path, nxt]);
        }
      }
    }
  }

  // Sort rings smallest first
  rings.sort((a, b) => a.length - b.length);

  // Place first ring if any
  if (rings.length > 0) {
    const r0 = rings[0];
    const n = r0.length;
    const radius = BOND_2D_LENGTH / (2 * Math.sin(Math.PI / n));
    for (let k = 0; k < n; k++) {
      const theta = (k * 2 * Math.PI) / n - Math.PI / 2;
      const atom = atomMap.get(r0[k])!;
      atom.x2d = 280 + Math.cos(theta) * radius;
      atom.y2d = 230 + Math.sin(theta) * radius;
      placed.add(atom.id);
      angleMap.set(atom.id, theta);
    }
  }

  // Place fused/additional rings connected to placed atoms
  let progress = true;
  while (progress) {
    progress = false;
    for (const ring of rings) {
      const unplacedInRing = ring.filter((id) => !placed.has(id));
      if (unplacedInRing.length === 0) continue;

      const n = ring.length;
      let sharedIdx = -1;
      for (let k = 0; k < n; k++) {
        if (placed.has(ring[k]) && placed.has(ring[(k + 1) % n])) {
          sharedIdx = k;
          break;
        }
      }

      if (sharedIdx !== -1) {
        const a1 = atomMap.get(ring[sharedIdx])!;
        const a2 = atomMap.get(ring[(sharedIdx + 1) % n])!;
        const mx = (a1.x2d + a2.x2d) / 2;
        const my = (a1.y2d + a2.y2d) / 2;
        const dx = a2.x2d - a1.x2d;
        const dy = a2.y2d - a1.y2d;
        const edgeLen = Math.max(1, Math.sqrt(dx * dx + dy * dy));

        let pcx = 0;
        let pcy = 0;
        for (const pid of placed) {
          pcx += atomMap.get(pid)!.x2d;
          pcy += atomMap.get(pid)!.y2d;
        }
        pcx /= placed.size;
        pcy /= placed.size;

        const apothem = (edgeLen / 2) / Math.tan(Math.PI / n);
        const nx1 = -dy / edgeLen;
        const ny1 = dx / edgeLen;
        const c1x = mx + nx1 * apothem;
        const c1y = my + ny1 * apothem;
        const c2x = mx - nx1 * apothem;
        const c2y = my - ny1 * apothem;

        const dist1 = (c1x - pcx) ** 2 + (c1y - pcy) ** 2;
        const dist2 = (c2x - pcx) ** 2 + (c2y - pcy) ** 2;
        const centerX = dist1 >= dist2 ? c1x : c2x;
        const centerY = dist1 >= dist2 ? c1y : c2y;

        const radius = edgeLen / (2 * Math.sin(Math.PI / n));
        const baseAngle = Math.atan2(a1.y2d - centerY, a1.x2d - centerX);
        const cross =
          (a1.x2d - centerX) * (a2.y2d - centerY) -
          (a1.y2d - centerY) * (a2.x2d - centerX);
        const stepSign = cross >= 0 ? 1 : -1;

        for (let step = 0; step < n; step++) {
          const id = ring[(sharedIdx + step) % n];
          if (!placed.has(id)) {
            const theta = baseAngle + stepSign * step * ((2 * Math.PI) / n);
            const atom = atomMap.get(id)!;
            atom.x2d = centerX + Math.cos(theta) * radius;
            atom.y2d = centerY + Math.sin(theta) * radius;
            placed.add(id);
            angleMap.set(id, theta);
          }
        }
        progress = true;
      }
    }
  }

  // Helper: evaluate 2D spatial clearance of candidate coordinates against all placed atoms
  const scoreCandidatePosition = (
    cx: number,
    cy: number,
    usedAngles: number[],
    candAngle: number
  ): number => {
    let minAngDiff = Infinity;
    for (const ua of usedAngles) {
      const d = Math.abs(Math.atan2(Math.sin(candAngle - ua), Math.cos(candAngle - ua)));
      if (d < minAngDiff) minAngDiff = d;
    }

    let minAtomDist = Infinity;
    for (const pid of placed) {
      const pa = atomMap.get(pid)!;
      const dist = Math.hypot(cx - pa.x2d, cy - pa.y2d);
      if (dist < minAtomDist) minAtomDist = dist;
    }

    // Strongly penalize any candidate within 0.85 * BOND_2D_LENGTH of existing placed atoms,
    // and reward both large angular separation and wide spatial clearance
    const clashPenalty = minAtomDist < BOND_2D_LENGTH * 0.82 ? -10 : 0;
    return clashPenalty + minAngDiff * 2.0 + Math.min(minAtomDist, BOND_2D_LENGTH * 2.2) / BOND_2D_LENGTH;
  };

  // Multi-source BFS seeded from already-placed ring/scaffold atoms first so substituents sprout outward cleanly
  const processBfsQueue = (seedIds: string[]) => {
    const queue = [...seedIds];
    while (queue.length > 0) {
      const curId = queue.shift()!;
      const cur = atomMap.get(curId)!;
      const neighbors = adj.get(curId) ?? [];
      const placedNeighbors = neighbors.filter((nid) => placed.has(nid));
      const unplacedNeighbors = neighbors.filter((nid) => !placed.has(nid));

      if (unplacedNeighbors.length === 0) continue;

      const usedAngles = placedNeighbors.map((nid) => {
        const na = atomMap.get(nid)!;
        return Math.atan2(na.y2d - cur.y2d, na.x2d - cur.x2d);
      });

      for (let idx = 0; idx < unplacedNeighbors.length; idx++) {
        const nid = unplacedNeighbors[idx];
        const nAtom = atomMap.get(nid)!;

        let chosenAngle = (angleMap.get(curId) ?? 0) + (idx % 2 === 0 ? Math.PI / 3 : -Math.PI / 3);
        if (usedAngles.length >= 2) {
          // Bisect the largest angular gap between existing bonds (ideal for sp2 ring vertices & trigonal centers)
          const sorted = [...usedAngles].sort((a, b) => a - b);
          const gapCandidates: number[] = [];
          for (let i = 0; i < sorted.length; i++) {
            const a1 = sorted[i];
            const a2 = i + 1 < sorted.length ? sorted[i + 1] : sorted[0] + Math.PI * 2;
            gapCandidates.push(a1 + (a2 - a1) / 2);
          }
          let bestScore = -Infinity;
          for (const cand of gapCandidates) {
            const px = cur.x2d + Math.cos(cand) * BOND_2D_LENGTH;
            const py = cur.y2d + Math.sin(cand) * BOND_2D_LENGTH;
            const s = scoreCandidatePosition(px, py, usedAngles, cand);
            if (s > bestScore) {
              bestScore = s;
              chosenAngle = cand;
            }
          }
        } else if (usedAngles.length === 1) {
          const base = usedAngles[0];
          // Check both 120-deg turns first, plus 180-deg and 90-deg fallbacks if crowded
          const candidates = [
            base + (2 * Math.PI) / 3,
            base - (2 * Math.PI) / 3,
            base + Math.PI,
            base + Math.PI / 2,
            base - Math.PI / 2,
            base + Math.PI / 3,
            base - Math.PI / 3,
          ];
          let bestScore = -Infinity;
          for (const cand of candidates) {
            const px = cur.x2d + Math.cos(cand) * BOND_2D_LENGTH;
            const py = cur.y2d + Math.sin(cand) * BOND_2D_LENGTH;
            const s = scoreCandidatePosition(px, py, usedAngles, cand);
            if (s > bestScore) {
              bestScore = s;
              chosenAngle = cand;
            }
          }
        }

        nAtom.x2d = cur.x2d + Math.cos(chosenAngle) * BOND_2D_LENGTH;
        nAtom.y2d = cur.y2d + Math.sin(chosenAngle) * BOND_2D_LENGTH;
        placed.add(nid);
        angleMap.set(nid, chosenAngle);
        usedAngles.push(chosenAngle);
        queue.push(nid);
      }
    }
  };

  if (placed.size > 0) {
    processBfsQueue(Array.from(placed));
  }

  for (const root of atoms) {
    if (!placed.has(root.id)) {
      root.x2d = 280 + placed.size * 25;
      root.y2d = 230;
      placed.add(root.id);
      angleMap.set(root.id, 0);
      processBfsQueue([root.id]);
    }
  }

  // Center in 560x440 2D canvas
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const a of atoms) {
    if (a.x2d < minX) minX = a.x2d;
    if (a.x2d > maxX) maxX = a.x2d;
    if (a.y2d < minY) minY = a.y2d;
    if (a.y2d > maxY) maxY = a.y2d;
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  for (const a of atoms) {
    a.x2d = Math.round(a.x2d - cx + 280);
    a.y2d = Math.round(a.y2d - cy + 220);
  }
}
