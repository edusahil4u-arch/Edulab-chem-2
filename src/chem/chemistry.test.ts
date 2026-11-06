import test from 'node:test';
import assert from 'node:assert/strict';
import {
  collapseHydrogens,
  computeMoleculeMetrics,
  expandHydrogens,
  generate3DCoordinates,
  parseSmilesToMolecule,
} from './chemistry';
import { ALL_PERIODIC_ELEMENTS, ELEMENTS } from './elements';
import { buildPresetMolecule, PRESET_MOLECULES } from './presets';
import type { MoleculeGraph } from './types';

test('SMILES parser and molecular metrics compute exact formulas and masses', () => {
  const ethanol = parseSmilesToMolecule('CCO', 'Ethanol');
  const metrics = computeMoleculeMetrics(ethanol);
  assert.equal(metrics.formula, 'C2H6O');
  assert.equal(metrics.heavyAtomCount, 3);
  assert.equal(metrics.totalAtomCountWithH, 9);
  assert.ok(Math.abs(metrics.molecularWeight - 46.07) < 0.05);
  assert.equal(metrics.valenceValid, true);
  assert.equal(metrics.hybridizationCounts.sp3, 3);
});

test('Aspirin and Caffeine presets match canonical Hill formulas and valid valences', () => {
  for (const preset of PRESET_MOLECULES) {
    const mol = buildPresetMolecule(preset.id, false);
    const metrics = computeMoleculeMetrics(mol);
    assert.equal(
      metrics.formula,
      preset.formula,
      `Expected ${preset.name} formula ${preset.formula}, got ${metrics.formula}`
    );
    assert.equal(
      metrics.valenceValid,
      true,
      `Expected ${preset.name} valenceValid=true, got warnings: ${metrics.valenceWarnings.join(', ')}`
    );
  }
});

test('Valence checker catches pentavalent carbon violation', () => {
  const badCarbonMol: MoleculeGraph = {
    id: 'bad',
    name: 'Pentavalent Carbon',
    atoms: [
      { id: 'c1', element: 'C', x2d: 100, y2d: 100, x3d: 0, y3d: 0, z3d: 0 },
      { id: 'c2', element: 'C', x2d: 150, y2d: 100, x3d: 1.5, y3d: 0, z3d: 0 },
      { id: 'c3', element: 'C', x2d: 50, y2d: 100, x3d: -1.5, y3d: 0, z3d: 0 },
      { id: 'c4', element: 'C', x2d: 100, y2d: 50, x3d: 0, y3d: 1.5, z3d: 0 },
      { id: 'c5', element: 'C', x2d: 100, y2d: 150, x3d: 0, y3d: -1.5, z3d: 0 },
      { id: 'c6', element: 'C', x2d: 140, y2d: 140, x3d: 1.1, y3d: -1.1, z3d: 0.5 },
    ],
    bonds: [
      { id: 'b1', from: 'c1', to: 'c2', order: 1 },
      { id: 'b2', from: 'c1', to: 'c3', order: 1 },
      { id: 'b3', from: 'c1', to: 'c4', order: 1 },
      { id: 'b4', from: 'c1', to: 'c5', order: 1 },
      { id: 'b5', from: 'c1', to: 'c6', order: 1 },
    ],
  };

  const metrics = computeMoleculeMetrics(badCarbonMol);
  assert.equal(metrics.valenceValid, false);
  assert.equal(metrics.valenceWarnings.length, 1);
  assert.ok(metrics.valenceWarnings[0].includes('C1'));
});

test('Hybridization and VSEPR geometry classification across sp, sp2, sp3', () => {
  const acrylonitrile = parseSmilesToMolecule('C=CC#N', 'Acrylonitrile');
  const metrics = computeMoleculeMetrics(acrylonitrile);
  // C1 (=CH2) sp2, C2 (=CH-) sp2, C3 (#N) sp, N1 (#C) sp
  assert.equal(metrics.hybridizationCounts.sp2, 2);
  assert.equal(metrics.hybridizationCounts.sp, 2);
  assert.equal(metrics.hybridizationCounts.sp3, 0);
});

test('3D coordinate generator creates finite non-planar 3D coordinates and realistic bond lengths', () => {
  const expanded = expandHydrogens(parseSmilesToMolecule('CCO', 'Ethanol'));
  const relaxed = generate3DCoordinates(expanded);

  assert.equal(relaxed.atoms.length, 9);
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const a of relaxed.atoms) {
    assert.ok(Number.isFinite(a.x3d) && Number.isFinite(a.y3d) && Number.isFinite(a.z3d));
    if (a.z3d < minZ) minZ = a.z3d;
    if (a.z3d > maxZ) maxZ = a.z3d;
  }
  assert.ok(maxZ - minZ > 0.4, 'Expected genuine 3D Z-extent for sp3 ethanol');

  // Verify bond lengths are within physical covalent range [0.85 A, 1.85 A]
  const atomMap = new Map(relaxed.atoms.map((a) => [a.id, a]));
  for (const b of relaxed.bonds) {
    const a1 = atomMap.get(b.from)!;
    const a2 = atomMap.get(b.to)!;
    const dist = Math.hypot(a2.x3d - a1.x3d, a2.y3d - a1.y3d, a2.z3d - a1.z3d);
    assert.ok(
      dist >= 0.85 && dist <= 1.85,
      `Bond ${a1.element}-${a2.element} length ${dist.toFixed(3)} out of covalent bounds`
    );
  }

  const collapsed = collapseHydrogens(relaxed);
  assert.equal(collapsed.atoms.length, 3);
});

test('Periodic Table catalog includes all 118 IUPAC elements and supports inorganic/coordination species', () => {
  assert.equal(ALL_PERIODIC_ELEMENTS.length, 118);
  assert.equal(ELEMENTS.H.atomicNumber, 1);
  assert.equal(ELEMENTS.Fe.atomicNumber, 26);
  assert.equal(ELEMENTS.Pt.atomicNumber, 78);
  assert.equal(ELEMENTS.Og.atomicNumber, 118);

  const ferroceneFragment: MoleculeGraph = {
    id: 'fe_test',
    name: 'Iron Chloride',
    atoms: [
      { id: 'fe1', element: 'Fe', x2d: 100, y2d: 100, x3d: 0, y3d: 0, z3d: 0 },
      { id: 'cl1', element: 'Cl', x2d: 150, y2d: 100, x3d: 0, y3d: 0, z3d: 0 },
      { id: 'cl2', element: 'Cl', x2d: 50, y2d: 100, x3d: 0, y3d: 0, z3d: 0 },
      { id: 'cl3', element: 'Cl', x2d: 100, y2d: 50, x3d: 0, y3d: 0, z3d: 0 },
    ],
    bonds: [
      { id: 'b1', from: 'fe1', to: 'cl1', order: 1 },
      { id: 'b2', from: 'fe1', to: 'cl2', order: 1 },
      { id: 'b3', from: 'fe1', to: 'cl3', order: 1 },
    ],
  };

  const relaxed = generate3DCoordinates(ferroceneFragment);
  const metrics = computeMoleculeMetrics(relaxed);
  assert.equal(metrics.formula, 'Cl3Fe');
  assert.equal(metrics.valenceValid, true);
  assert.ok(Math.abs(metrics.molecularWeight - 162.2) < 0.2);
});
