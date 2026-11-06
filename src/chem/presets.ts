import { expandHydrogens, parseSmilesToMolecule } from './chemistry';
import type { MoleculeGraph, PresetMolecule } from './types';

export const PRESET_MOLECULES: PresetMolecule[] = [
  {
    id: 'aspirin',
    name: 'Aspirin',
    category: 'Analgesic Ester',
    smiles: 'CC(=O)OC1=CC=CC=C1C(=O)O',
    formula: 'C9H8O4',
    description:
      'Acetylsalicylic acid featuring an aromatic benzene core, ester linkage, and carboxylic acid.',
  },
  {
    id: 'caffeine',
    name: 'Caffeine',
    category: 'Purine Alkaloid',
    smiles: 'CN1C=NC2=C1C(=O)N(C(=O)N2C)C',
    formula: 'C8H10N4O2',
    description:
      'Fused pyrimidinedione-imidazole ring system with three N-methyl substituents.',
  },
  {
    id: 'ibuprofen',
    name: 'Ibuprofen',
    category: 'NSAID Profen',
    smiles: 'CC(C)CC1=CC=C(C=C1)C(C)C(=O)O',
    formula: 'C13H18O2',
    description:
      'Isobutylphenyl propionic acid combining lipophilic ring and polar carboxyl head.',
  },
  {
    id: 'serotonin',
    name: 'Serotonin',
    category: 'Neurotransmitter',
    smiles: 'NCCc1c[nH]c2ccc(O)cc12',
    formula: 'C10H12N2O',
    description:
      '5-Hydroxytryptamine indoleamine neurotransmitter with planar bicyclic indole core.',
  },
  {
    id: 'acetaminophen',
    name: 'Acetaminophen',
    category: 'Amide Analgesic',
    smiles: 'CC(=O)NC1=CC=C(C=C1)O',
    formula: 'C8H9NO2',
    description:
      'Paracetamol featuring a para-substituted phenol ring and planar resonance-stabilized amide.',
  },
  {
    id: 'benzene',
    name: 'Benzene',
    category: 'Aromatic Ring',
    smiles: 'c1ccccc1',
    formula: 'C6H6',
    description:
      'Planar hexagonal D6h conjugated pi-system with sp2 hybridized carbons.',
  },
  {
    id: 'ethanol',
    name: 'Ethanol',
    category: 'Primary Alcohol',
    smiles: 'CCO',
    formula: 'C2H6O',
    description:
      'Classic tetrahedral sp3 carbon backbone bonded to a bent polar hydroxyl group.',
  },
  {
    id: 'cyclohexane',
    name: 'Cyclohexane',
    category: 'Alicyclic Chair',
    smiles: 'C1CCCCC1',
    formula: 'C6H12',
    description:
      'Non-planar puckered saturated six-membered ring minimizing torsional and angle strain.',
  },
  {
    id: 'acetic_acid',
    name: 'Acetic Acid',
    category: 'Carboxylic Acid',
    smiles: 'CC(=O)O',
    formula: 'C2H4O2',
    description:
      'Simple carboxylic acid contrasting tetrahedral methyl carbon with trigonal planar carbonyl.',
  },
  {
    id: 'acrylonitrile',
    name: 'Acrylonitrile',
    category: 'Conjugated Nitrile',
    smiles: 'C=CC#N',
    formula: 'C3H3N',
    description:
      'Linear sp nitrile triple bond conjugated with an sp2 vinyl double bond.',
  },
];

export function buildPresetMolecule(
  presetId: string,
  withExplicitHydrogens = false
): MoleculeGraph {
  const preset =
    PRESET_MOLECULES.find((p) => p.id === presetId) ?? PRESET_MOLECULES[0];
  const base = parseSmilesToMolecule(preset.smiles, preset.name);
  base.id = preset.id;
  base.iupacName = preset.category;
  return withExplicitHydrogens ? expandHydrogens(base) : base;
}

export interface FragmentTemplate {
  id: string;
  label: string;
  shortLabel: string;
  smiles: string;
}

export const FRAGMENT_TEMPLATES: FragmentTemplate[] = [
  { id: 'oh_group', label: 'Hydroxyl (-OH)', shortLabel: '-OH', smiles: 'O' },
  { id: 'nh2_group', label: 'Amino (-NH2)', shortLabel: '-NH₂', smiles: 'N' },
  {
    id: 'carboxyl_group',
    label: 'Carboxyl (-COOH)',
    shortLabel: '-COOH',
    smiles: 'C(=O)O',
  },
  {
    id: 'aldehyde_group',
    label: 'Aldehyde (-CHO)',
    shortLabel: '-CHO',
    smiles: 'C=O',
  },
  {
    id: 'nitrile_group',
    label: 'Nitrile (-CN)',
    shortLabel: '-CN',
    smiles: 'C#N',
  },
  {
    id: 'nitro_group',
    label: 'Nitro (-NO2)',
    shortLabel: '-NO₂',
    smiles: '[N+](=O)[O-]',
  },
  {
    id: 'naphthalene_ring',
    label: 'Naphthalene',
    shortLabel: 'Naphth',
    smiles: 'c1ccc2ccccc2c1',
  },
  {
    id: 'indole_ring',
    label: 'Indole Ring',
    shortLabel: 'Indole',
    smiles: 'c1ccc2[nH]ccc2c1',
  },
];
