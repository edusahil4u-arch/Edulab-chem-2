export type ElementSymbol =
  | 'H'  | 'He'
  | 'Li' | 'Be' | 'B'  | 'C'  | 'N'  | 'O'  | 'F'  | 'Ne'
  | 'Na' | 'Mg' | 'Al' | 'Si' | 'P'  | 'S'  | 'Cl' | 'Ar'
  | 'K'  | 'Ca' | 'Sc' | 'Ti' | 'V'  | 'Cr' | 'Mn' | 'Fe' | 'Co' | 'Ni' | 'Cu' | 'Zn' | 'Ga' | 'Ge' | 'As' | 'Se' | 'Br' | 'Kr'
  | 'Rb' | 'Sr' | 'Y'  | 'Zr' | 'Nb' | 'Mo' | 'Tc' | 'Ru' | 'Rh' | 'Pd' | 'Ag' | 'Cd' | 'In' | 'Sn' | 'Sb' | 'Te' | 'I'  | 'Xe'
  | 'Cs' | 'Ba'
  | 'La' | 'Ce' | 'Pr' | 'Nd' | 'Pm' | 'Sm' | 'Eu' | 'Gd' | 'Tb' | 'Dy' | 'Ho' | 'Er' | 'Tm' | 'Yb' | 'Lu'
  | 'Hf' | 'Ta' | 'W'  | 'Re' | 'Os' | 'Ir' | 'Pt' | 'Au' | 'Hg' | 'Tl' | 'Pb' | 'Bi' | 'Po' | 'At' | 'Rn'
  | 'Fr' | 'Ra'
  | 'Ac' | 'Th' | 'Pa' | 'U'  | 'Np' | 'Pu' | 'Am' | 'Cm' | 'Bk' | 'Cf' | 'Es' | 'Fm' | 'Md' | 'No' | 'Lr'
  | 'Rf' | 'Db' | 'Sg' | 'Bh' | 'Hs' | 'Mt' | 'Ds' | 'Rg' | 'Cn' | 'Nh' | 'Fl' | 'Mc' | 'Lv' | 'Ts' | 'Og';

export type ElementCategory =
  | 'nonmetal'
  | 'noble-gas'
  | 'alkali-metal'
  | 'alkaline-earth'
  | 'metalloid'
  | 'halogen'
  | 'transition-metal'
  | 'post-transition'
  | 'lanthanide'
  | 'actinide';

export type BondOrder = 1 | 2 | 3;

export type StereoType = 'none' | 'wedge' | 'dash';

export type HybridizationType = 'sp3' | 'sp2' | 'sp' | 's' | 'unhybridized';

export type VseprGeometry =
  | 'Tetrahedral (109.5°)'
  | 'Trigonal Planar (120°)'
  | 'Trigonal Pyramidal (107°)'
  | 'Bent (104.5°)'
  | 'Linear (180°)'
  | 'Terminal (1s)'
  | 'Hypervalent / Expanded';

export interface ElementSpec {
  symbol: ElementSymbol;
  name: string;
  atomicNumber: number;
  atomicMass: number;
  period: number;
  group: number;
  category: ElementCategory;
  cpkColor: string;
  cpkTextColor: string;
  covalentRadius: number; // in Angstroms
  vdwRadius: number; // in Angstroms
  standardValences: number[];
  defaultValence: number;
  electronegativity: number;
  lonePairs: number;
  roughness: number;
  metalness: number;
}

export interface AtomNode {
  id: string;
  element: ElementSymbol;
  x2d: number;
  y2d: number;
  x3d: number;
  y3d: number;
  z3d: number;
  formalCharge?: number;
  isAromatic?: boolean;
  explicitH?: number;
}

export interface BondEdge {
  id: string;
  from: string;
  to: string;
  order: BondOrder;
  stereo?: StereoType;
  isAromatic?: boolean;
}

export interface MoleculeGraph {
  id: string;
  name: string;
  iupacName?: string;
  smiles?: string;
  atoms: AtomNode[];
  bonds: BondEdge[];
}

export interface AtomAnalysis {
  atomId: string;
  element: ElementSymbol;
  explicitBondOrderSum: number;
  implicitHydrogens: number;
  totalCoordination: number;
  lonePairs: number;
  stericNumber: number;
  hybridization: HybridizationType;
  vseprGeometry: VseprGeometry;
  valenceValid: boolean;
  valenceMessage?: string;
  inRing: boolean;
  ringSizes: number[];
  isAromatic: boolean;
}

export interface MoleculeMetrics {
  formula: string;
  molecularWeight: number;
  heavyAtomCount: number;
  explicitAtomCount: number;
  totalAtomCountWithH: number;
  bondCount: number;
  formalCharge: number;
  estimatedLogP: number;
  tpsa: number;
  hbdCount: number;
  hbaCount: number;
  rotatableBonds: number;
  ringCount: number;
  lipinskiViolations: number;
  lipinskiPass: boolean;
  valenceValid: boolean;
  valenceWarnings: string[];
  hybridizationCounts: {
    sp3: number;
    sp2: number;
    sp: number;
  };
  canonicalSmiles: string;
  atomAnalyses: Record<string, AtomAnalysis>;
}

export interface PresetMolecule {
  id: string;
  name: string;
  category: string;
  smiles: string;
  formula: string;
  description: string;
}
