import React, { useMemo, useRef, useState } from 'react';
import {
  Atom,
  Eraser,
  FlipHorizontal,
  Grid,
  Minus,
  MousePointer,
  Redo2,
  Sparkles,
  Table2,
  Trash2,
  Undo2,
} from 'lucide-react';
import { ELEMENT_PALETTE_ORDER, ELEMENTS } from '../chem/elements';
import { FRAGMENT_TEMPLATES } from '../chem/presets';
import { parseSmilesToMolecule } from '../chem/chemistry';
import { PeriodicTableModal } from './PeriodicTableModal';
import type {
  AtomNode,
  BondEdge,
  BondOrder,
  ElementSymbol,
  MoleculeGraph,
  MoleculeMetrics,
  StereoType,
} from '../chem/types';

export type ChemDrawTool =
  | 'select'
  | 'bond1'
  | 'bond2'
  | 'bond3'
  | 'wedge'
  | 'dash'
  | 'chain'
  | 'charge_plus'
  | 'charge_minus'
  | 'erase'
  | 'ring3'
  | 'ring4'
  | 'ring5'
  | 'ring6'
  | 'benzene'
  | 'ring7';

interface MoleculeSketcher2DProps {
  molecule: MoleculeGraph;
  metrics: MoleculeMetrics;
  selectedAtomId: string | null;
  hoveredAtomId: string | null;
  hasExplicitHydrogens: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onSelectAtom: (atomId: string | null) => void;
  onHoverAtom: (atomId: string | null) => void;
  onChangeMolecule: (next: MoleculeGraph, recordHistory?: boolean) => void;
  onToggleHydrogens: () => void;
  onClean2D: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onClear: () => void;
  onSynthesizePrompt: (prompt: string) => Promise<void>;
  isSynthesizing: boolean;
}

const BOND_LEN = 50;
const SVG_W = 560;
const SVG_H = 440;

const CHEMDRAW_ATOM_COLOR: Partial<Record<ElementSymbol, string>> = {
  C: '#0F172A',
  H: '#475569',
  N: '#1D4ED8',
  O: '#DC2626',
  S: '#B45309',
  P: '#C2410C',
  F: '#047857',
  Cl: '#047857',
  Br: '#991B1B',
  I: '#6D28D9',
  B: '#B45309',
  Si: '#92400E',
};

function isRingTool(tool: ChemDrawTool): boolean {
  return (
    tool === 'ring3' ||
    tool === 'ring4' ||
    tool === 'ring5' ||
    tool === 'ring6' ||
    tool === 'benzene' ||
    tool === 'ring7'
  );
}

function getRingToolSpec(tool: ChemDrawTool): { sides: number; aromatic: boolean } {
  switch (tool) {
    case 'ring3':
      return { sides: 3, aromatic: false };
    case 'ring4':
      return { sides: 4, aromatic: false };
    case 'ring5':
      return { sides: 5, aromatic: false };
    case 'ring6':
      return { sides: 6, aromatic: false };
    case 'benzene':
      return { sides: 6, aromatic: true };
    case 'ring7':
      return { sides: 7, aromatic: false };
    default:
      return { sides: 6, aromatic: false };
  }
}

function getBondToolParams(tool: ChemDrawTool): {
  order: BondOrder;
  stereo: StereoType;
} {
  if (tool === 'bond2') return { order: 2, stereo: 'none' };
  if (tool === 'bond3') return { order: 3, stereo: 'none' };
  if (tool === 'wedge') return { order: 1, stereo: 'wedge' };
  if (tool === 'dash') return { order: 1, stereo: 'dash' };
  return { order: 1, stereo: 'none' };
}

/**
 * Finds ring centroids for double-bond inner-offset rendering & optional aromatic ring circles.
 */
function computeRingGeometryInfo(atoms: AtomNode[], bonds: BondEdge[]) {
  const atomMap = new Map(atoms.map((a) => [a.id, a]));
  const atomIndex = new Map(atoms.map((a, idx) => [a.id, idx]));
  const adj = new Map<string, string[]>();
  for (const a of atoms) adj.set(a.id, []);
  for (const b of bonds) {
    adj.get(b.from)?.push(b.to);
    adj.get(b.to)?.push(b.from);
  }

  const rings: string[][] = [];
  const seen = new Set<string>();
  for (const start of atoms) {
    const startIdx = atomIndex.get(start.id) ?? 0;
    const stack: string[][] = [[start.id]];
    while (stack.length > 0) {
      const path = stack.pop()!;
      const cur = path[path.length - 1];
      if (path.length > 7) continue;
      for (const nxt of adj.get(cur) ?? []) {
        if (nxt === start.id && path.length >= 5) {
          const key = [...path]
            .sort((a, b) => (atomIndex.get(a) ?? 0) - (atomIndex.get(b) ?? 0))
            .join(',');
          if (!seen.has(key)) {
            seen.add(key);
            rings.push(path);
          }
        } else if (!path.includes(nxt) && (atomIndex.get(nxt) ?? 0) > startIdx) {
          stack.push([...path, nxt]);
        }
      }
    }
  }

  // Keep smallest rings first so fused rings don't overwrite with 9-cycles
  rings.sort((a, b) => a.length - b.length);

  const bondRingCentroid = new Map<string, { cx: number; cy: number }>();
  const aromaticCircles: Array<{ cx: number; cy: number; r: number }> = [];

  for (const ring of rings) {
    let cx = 0;
    let cy = 0;
    let valid = true;
    for (const id of ring) {
      const a = atomMap.get(id);
      if (!a) {
        valid = false;
        break;
      }
      cx += a.x2d;
      cy += a.y2d;
    }
    if (!valid) continue;
    cx /= ring.length;
    cy /= ring.length;

    let allAromatic = ring.length === 6;
    let avgRadius = 0;

    for (let i = 0; i < ring.length; i++) {
      const u = ring[i];
      const v = ring[(i + 1) % ring.length];
      const ua = atomMap.get(u)!;
      avgRadius += Math.hypot(ua.x2d - cx, ua.y2d - cy);

      const bond = bonds.find(
        (b) => (b.from === u && b.to === v) || (b.from === v && b.to === u)
      );
      if (bond) {
        if (!bondRingCentroid.has(bond.id)) {
          bondRingCentroid.set(bond.id, { cx, cy });
        }
        if (!bond.isAromatic) allAromatic = false;
      } else {
        allAromatic = false;
      }
    }

    if (allAromatic && ring.length === 6) {
      aromaticCircles.push({
        cx,
        cy,
        r: (avgRadius / ring.length) * 0.56,
      });
    }
  }

  return { bondRingCentroid, aromaticCircles };
}

export const MoleculeSketcher2D: React.FC<MoleculeSketcher2DProps> = ({
  molecule,
  metrics,
  selectedAtomId,
  hoveredAtomId,
  hasExplicitHydrogens,
  canUndo,
  canRedo,
  onSelectAtom,
  onHoverAtom,
  onChangeMolecule,
  onToggleHydrogens,
  onClean2D,
  onUndo,
  onRedo,
  onClear,
  onSynthesizePrompt,
  isSynthesizing,
}) => {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [activeElement, setActiveElement] = useState<ElementSymbol>('C');
  const [atomStampMode, setAtomStampMode] = useState<boolean>(false);
  const [tool, setTool] = useState<ChemDrawTool>('bond1');
  const [showGrid, setShowGrid] = useState<boolean>(true);
  const [aromaticCircleStyle, setAromaticCircleStyle] =
    useState<boolean>(false);
  const [isPeriodicTableOpen, setIsPeriodicTableOpen] =
    useState<boolean>(false);

  const [hoveredBondId, setHoveredBondId] = useState<string | null>(null);
  const [cursorPt, setCursorPt] = useState<{ x: number; y: number } | null>(
    null
  );

  const [smilesInput, setSmilesInput] = useState('');
  const [smilesError, setSmilesError] = useState<string | null>(null);
  const [aiPrompt, setAiPrompt] = useState('');

  // Dragging state for bond, zig-zag chain, atom move, or whole-molecule pan
  const [dragState, setDragState] = useState<{
    mode: 'bond' | 'chain' | 'move_atom' | 'pan_all';
    sourceAtomId: string | null;
    startX: number;
    startY: number;
    currX: number;
    currY: number;
    snapTargetAtomId: string | null;
    moved: boolean;
    initialAtoms?: Array<{ id: string; x2d: number; y2d: number }>;
  } | null>(null);

  const atomById = useMemo(
    () => new Map(molecule.atoms.map((a) => [a.id, a])),
    [molecule.atoms]
  );

  const ringGeom = useMemo(
    () => computeRingGeometryInfo(molecule.atoms, molecule.bonds),
    [molecule.atoms, molecule.bonds]
  );

  const getSvgPoint = (clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return { x: SVG_W / 2, y: SVG_H / 2 };
    const rect = svg.getBoundingClientRect();
    const scaleX = SVG_W / Math.max(1, rect.width);
    const scaleY = SVG_H / Math.max(1, rect.height);
    return {
      x: Math.max(20, Math.min(SVG_W - 20, (clientX - rect.left) * scaleX)),
      y: Math.max(20, Math.min(SVG_H - 20, (clientY - rect.top) * scaleY)),
    };
  };

  const findAtomAt = (
    x: number,
    y: number,
    excludeId?: string
  ): AtomNode | null => {
    let best: AtomNode | null = null;
    let bestDist = 19;
    for (const a of molecule.atoms) {
      if (a.id === excludeId) continue;
      const d = Math.hypot(a.x2d - x, a.y2d - y);
      if (d < bestDist) {
        bestDist = d;
        best = a;
      }
    }
    return best;
  };

  const findBondAt = (x: number, y: number): BondEdge | null => {
    let best: BondEdge | null = null;
    let bestDist = 13;
    for (const b of molecule.bonds) {
      const a1 = atomById.get(b.from);
      const a2 = atomById.get(b.to);
      if (!a1 || !a2) continue;
      const dx = a2.x2d - a1.x2d;
      const dy = a2.y2d - a1.y2d;
      const lenSq = dx * dx + dy * dy;
      if (lenSq < 1) continue;
      const t = Math.max(
        0.12,
        Math.min(0.88, ((x - a1.x2d) * dx + (y - a1.y2d) * dy) / lenSq)
      );
      const projX = a1.x2d + t * dx;
      const projY = a1.y2d + t * dy;
      const d = Math.hypot(x - projX, y - projY);
      if (d < bestDist) {
        bestDist = d;
        best = b;
      }
    }
    return best;
  };

  /**
   * Computes optimal 120-degree open VSEPR sprout angle around an existing atom (ChemDraw 1-click sprout).
   */
  const computeOpenSproutPoint = (atom: AtomNode): { x: number; y: number } => {
    const neighbors = molecule.bonds
      .filter((b) => b.from === atom.id || b.to === atom.id)
      .map((b) => atomById.get(b.from === atom.id ? b.to : b.from))
      .filter((n): n is AtomNode => Boolean(n));

    let angle = -Math.PI / 6; // Default 30 deg up-right
    if (neighbors.length === 1) {
      const backAngle = Math.atan2(
        neighbors[0].y2d - atom.y2d,
        neighbors[0].x2d - atom.x2d
      );
      const candidates = [
        backAngle + (2 * Math.PI) / 3,
        backAngle - (2 * Math.PI) / 3,
        backAngle + Math.PI,
      ];
      let bestScore = -Infinity;
      for (const cand of candidates) {
        const px = atom.x2d + Math.cos(cand) * BOND_LEN;
        const py = atom.y2d + Math.sin(cand) * BOND_LEN;
        let minOtherDist = Infinity;
        for (const other of molecule.atoms) {
          if (other.id === atom.id) continue;
          const d = Math.hypot(px - other.x2d, py - other.y2d);
          if (d < minOtherDist) minOtherDist = d;
        }
        const centerDist = Math.hypot(px - SVG_W / 2, py - SVG_H / 2);
        const score = Math.min(minOtherDist, BOND_LEN * 1.8) - centerDist * 0.12;
        if (score > bestScore) {
          bestScore = score;
          angle = cand;
        }
      }
    } else if (neighbors.length >= 2) {
      // Bisect largest angular gap
      const angles = neighbors
        .map((n) => Math.atan2(n.y2d - atom.y2d, n.x2d - atom.x2d))
        .sort((a, b) => a - b);
      let bestGap = -1;
      for (let i = 0; i < angles.length; i++) {
        const a1 = angles[i];
        const a2 =
          i + 1 < angles.length ? angles[i + 1] : angles[0] + Math.PI * 2;
        const gap = a2 - a1;
        if (gap > bestGap) {
          bestGap = gap;
          angle = a1 + gap / 2;
        }
      }
    }

    return {
      x: Math.max(24, Math.min(SVG_W - 24, Math.round(atom.x2d + Math.cos(angle) * BOND_LEN))),
      y: Math.max(24, Math.min(SVG_H - 24, Math.round(atom.y2d + Math.sin(angle) * BOND_LEN))),
    };
  };

  /**
   * Computes polygon vertices for live ring preview or 1-click ring placement / bond fusion.
   */
  const computeRingPlacement = (
    pt: { x: number; y: number },
    sides: number,
    aromatic: boolean
  ): {
    vertices: Array<{
      x: number;
      y: number;
      existingAtomId?: string;
    }>;
    edges: Array<{
      fromIdx: number;
      toIdx: number;
      order: BondOrder;
      isAromatic: boolean;
      existingBondId?: string;
    }>;
    attachBondFromAtomId?: string;
    mode: 'fuse_bond' | 'attach_atom' | 'free';
  } => {
    const hitBond = findBondAt(pt.x, pt.y);
    if (hitBond) {
      const a1 = atomById.get(hitBond.from);
      const a2 = atomById.get(hitBond.to);
      if (a1 && a2) {
        const dx = a2.x2d - a1.x2d;
        const dy = a2.y2d - a1.y2d;
        const edgeLen = Math.max(24, Math.hypot(dx, dy));
        const mx = (a1.x2d + a2.x2d) / 2;
        const my = (a1.y2d + a2.y2d) / 2;
        const nx = -dy / edgeLen;
        const ny = dx / edgeLen;

        // Place polygon center on the side of the bond where cursor is pointing
        const dot = (pt.x - mx) * nx + (pt.y - my) * ny;
        const side = dot >= 0 ? 1 : -1;
        const apothem = (edgeLen / 2) / Math.tan(Math.PI / sides);
        const cx = mx + nx * side * apothem;
        const cy = my + ny * side * apothem;
        const radius = edgeLen / (2 * Math.sin(Math.PI / sides));

        const baseAngle = Math.atan2(a1.y2d - cy, a1.x2d - cx);
        const cross =
          (a1.x2d - cx) * (a2.y2d - cy) - (a1.y2d - cy) * (a2.x2d - cx);
        const stepSign = cross >= 0 ? 1 : -1;

        const vertices = Array.from({ length: sides }, (_, k) => {
          if (k === 0) return { x: a1.x2d, y: a1.y2d, existingAtomId: a1.id };
          if (k === 1) return { x: a2.x2d, y: a2.y2d, existingAtomId: a2.id };
          const theta = baseAngle + stepSign * k * ((2 * Math.PI) / sides);
          return {
            x: Math.round(cx + Math.cos(theta) * radius),
            y: Math.round(cy + Math.sin(theta) * radius),
          };
        });

        const edges = Array.from({ length: sides }, (_, k) => {
          const next = (k + 1) % sides;
          if (k === 0) {
            return {
              fromIdx: 0,
              toIdx: 1,
              order: hitBond.order,
              isAromatic: Boolean(hitBond.isAromatic),
              existingBondId: hitBond.id,
            };
          }
          const order: BondOrder = aromatic && k % 2 === 0 ? 2 : 1;
          return {
            fromIdx: k,
            toIdx: next,
            order,
            isAromatic: aromatic,
          };
        });

        return { vertices, edges, mode: 'fuse_bond' };
      }
    }

    const hitAtom = findAtomAt(pt.x, pt.y);
    const radius = BOND_LEN / (2 * Math.sin(Math.PI / sides));
    if (hitAtom) {
      const sprout = computeOpenSproutPoint(hitAtom);
      const dirAngle = Math.atan2(
        sprout.y - hitAtom.y2d,
        sprout.x - hitAtom.x2d
      );
      const cx = sprout.x + Math.cos(dirAngle) * radius;
      const cy = sprout.y + Math.sin(dirAngle) * radius;
      const startAngle = dirAngle + Math.PI;
      const vertices = Array.from({ length: sides }, (_, k) => {
        const theta = startAngle + (k * 2 * Math.PI) / sides;
        return {
          x: Math.round(cx + Math.cos(theta) * radius),
          y: Math.round(cy + Math.sin(theta) * radius),
        };
      });
      const edges = Array.from({ length: sides }, (_, k) => ({
        fromIdx: k,
        toIdx: (k + 1) % sides,
        order: (aromatic && k % 2 === 0 ? 2 : 1) as BondOrder,
        isAromatic: aromatic,
      }));
      return {
        vertices,
        edges,
        attachBondFromAtomId: hitAtom.id,
        mode: 'attach_atom',
      };
    }

    // Free placement centered at cursor
    const vertices = Array.from({ length: sides }, (_, k) => {
      const theta = (k * 2 * Math.PI) / sides - Math.PI / 2;
      return {
        x: Math.round(pt.x + Math.cos(theta) * radius),
        y: Math.round(pt.y + Math.sin(theta) * radius),
      };
    });
    const edges = Array.from({ length: sides }, (_, k) => ({
      fromIdx: k,
      toIdx: (k + 1) % sides,
      order: (aromatic && k % 2 === 0 ? 2 : 1) as BondOrder,
      isAromatic: aromatic,
    }));
    return { vertices, edges, mode: 'free' };
  };

  /**
   * Computes zig-zag acyclic carbon chain points when dragging with Chain tool.
   */
  const computeZigZagChainPoints = (
    startX: number,
    startY: number,
    currX: number,
    currY: number
  ): Array<{ x: number; y: number }> => {
    const dx = currX - startX;
    const dy = currY - startY;
    const dist = Math.hypot(dx, dy);
    if (dist < 14) return [];

    const steps = Math.max(
      1,
      Math.min(10, Math.round(dist / (BOND_LEN * 0.82)))
    );
    const axisAngle = Math.atan2(dy, dx);
    const pts: Array<{ x: number; y: number }> = [];
    let px = startX;
    let py = startY;
    for (let s = 0; s < steps; s++) {
      const segAngle = axisAngle + (s % 2 === 0 ? -Math.PI / 6 : Math.PI / 6);
      px = Math.max(20, Math.min(SVG_W - 20, Math.round(px + Math.cos(segAngle) * BOND_LEN)));
      py = Math.max(20, Math.min(SVG_H - 20, Math.round(py + Math.sin(segAngle) * BOND_LEN)));
      pts.push({ x: px, y: py });
    }
    return pts;
  };

  const handleSvgPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.focus();
    const pt = getSvgPoint(e.clientX, e.clientY);
    const hitAtom = findAtomAt(pt.x, pt.y);
    const hitBond = hitAtom ? null : findBondAt(pt.x, pt.y);

    // 1. Eraser Tool
    if (tool === 'erase') {
      if (hitAtom) {
        onChangeMolecule({
          ...molecule,
          smiles: undefined,
          atoms: molecule.atoms.filter((a) => a.id !== hitAtom.id),
          bonds: molecule.bonds.filter(
            (b) => b.from !== hitAtom.id && b.to !== hitAtom.id
          ),
        });
        if (selectedAtomId === hitAtom.id) onSelectAtom(null);
      } else if (hitBond) {
        onChangeMolecule({
          ...molecule,
          smiles: undefined,
          bonds: molecule.bonds.filter((b) => b.id !== hitBond.id),
        });
      }
      return;
    }

    // 2. Formal Charge Tools (+1 / -1)
    if (tool === 'charge_plus' || tool === 'charge_minus') {
      if (hitAtom) {
        const delta = tool === 'charge_plus' ? 1 : -1;
        const nextCharge = Math.max(
          -3,
          Math.min(3, (hitAtom.formalCharge ?? 0) + delta)
        );
        onChangeMolecule({
          ...molecule,
          smiles: undefined,
          atoms: molecule.atoms.map((a) =>
            a.id === hitAtom.id ? { ...a, formalCharge: nextCharge } : a
          ),
        });
        onSelectAtom(hitAtom.id);
      }
      return;
    }

    // 3. Interactive Polygon Ring Tools (3, 4, 5, 6, Benzene, 7)
    if (isRingTool(tool)) {
      const { sides, aromatic } = getRingToolSpec(tool);
      const placement = computeRingPlacement(pt, sides, aromatic);
      const stamp = Date.now().toString(36);
      const createdAtoms: AtomNode[] = [];
      const vertexAtomIds: string[] = [];

      placement.vertices.forEach((v, idx) => {
        if (v.existingAtomId) {
          vertexAtomIds.push(v.existingAtomId);
        } else {
          const id = `r_${stamp}_${idx}`;
          vertexAtomIds.push(id);
          createdAtoms.push({
            id,
            element: 'C',
            x2d: v.x,
            y2d: v.y,
            x3d: 0,
            y3d: 0,
            z3d: 0,
            isAromatic: aromatic,
          });
        }
      });

      const createdBonds: BondEdge[] = [];
      placement.edges.forEach((edge, idx) => {
        if (edge.existingBondId) return;
        createdBonds.push({
          id: `rb_${stamp}_${idx}`,
          from: vertexAtomIds[edge.fromIdx],
          to: vertexAtomIds[edge.toIdx],
          order: edge.order,
          isAromatic: edge.isAromatic,
        });
      });

      if (placement.attachBondFromAtomId && vertexAtomIds.length > 0) {
        createdBonds.push({
          id: `rb_${stamp}_link`,
          from: placement.attachBondFromAtomId,
          to: vertexAtomIds[0],
          order: 1,
        });
      }

      onChangeMolecule({
        ...molecule,
        smiles: undefined,
        atoms: [...molecule.atoms, ...createdAtoms],
        bonds: [...molecule.bonds, ...createdBonds],
      });
      if (vertexAtomIds.length > 0) {
        onSelectAtom(vertexAtomIds[vertexAtomIds.length - 1]);
      }
      return;
    }

    // 4. Zig-Zag Chain Tool
    if (tool === 'chain') {
      const sx = hitAtom ? hitAtom.x2d : Math.round(pt.x);
      const sy = hitAtom ? hitAtom.y2d : Math.round(pt.y);
      setDragState({
        mode: 'chain',
        sourceAtomId: hitAtom ? hitAtom.id : null,
        startX: sx,
        startY: sy,
        currX: sx,
        currY: sy,
        snapTargetAtomId: null,
        moved: false,
      });
      return;
    }

    // 5. Select & Move Tool
    if (tool === 'select') {
      if (hitAtom) {
        onSelectAtom(hitAtom.id);
        setDragState({
          mode: 'move_atom',
          sourceAtomId: hitAtom.id,
          startX: hitAtom.x2d,
          startY: hitAtom.y2d,
          currX: hitAtom.x2d,
          currY: hitAtom.y2d,
          snapTargetAtomId: null,
          moved: false,
        });
      } else {
        onSelectAtom(null);
        if (molecule.atoms.length > 0) {
          setDragState({
            mode: 'pan_all',
            sourceAtomId: null,
            startX: pt.x,
            startY: pt.y,
            currX: pt.x,
            currY: pt.y,
            snapTargetAtomId: null,
            moved: false,
            initialAtoms: molecule.atoms.map((a) => ({
              id: a.id,
              x2d: a.x2d,
              y2d: a.y2d,
            })),
          });
        }
      }
      return;
    }

    // 6. Bond Tools (Single, Double, Triple, Solid Wedge, Hashed Wedge)
    if (hitAtom) {
      onSelectAtom(hitAtom.id);
      setDragState({
        mode: 'bond',
        sourceAtomId: hitAtom.id,
        startX: hitAtom.x2d,
        startY: hitAtom.y2d,
        currX: hitAtom.x2d,
        currY: hitAtom.y2d,
        snapTargetAtomId: null,
        moved: false,
      });
      return;
    }

    // Clicked directly on an existing bond -> apply/cycle bond type!
    if (hitBond) {
      const { order, stereo } = getBondToolParams(tool);
      let nextOrder: BondOrder = order;
      let nextStereo: StereoType | undefined =
        stereo !== 'none' ? stereo : undefined;

      if (tool === 'bond1' && !hitBond.stereo) {
        // Classic ChemDraw: clicking a single bond with Single Bond tool upgrades to Double, Double -> Triple -> Single
        nextOrder = hitBond.order === 1 ? 2 : hitBond.order === 2 ? 3 : 1;
      } else if (
        (tool === 'wedge' && hitBond.stereo === 'wedge') ||
        (tool === 'dash' && hitBond.stereo === 'dash')
      ) {
        // Flip stereobond direction if clicked again!
        onChangeMolecule({
          ...molecule,
          smiles: undefined,
          bonds: molecule.bonds.map((b) =>
            b.id === hitBond.id
              ? { ...b, from: b.to, to: b.from }
              : b
          ),
        });
        return;
      }

      onChangeMolecule({
        ...molecule,
        smiles: undefined,
        bonds: molecule.bonds.map((b) =>
          b.id === hitBond.id
            ? {
                ...b,
                order: nextOrder,
                stereo: nextStereo,
                isAromatic: false,
              }
            : b
        ),
      });
      return;
    }

    // Clicked empty drafting paper -> place atom of activeElement
    const newId = `a_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`;
    const newAtom: AtomNode = {
      id: newId,
      element: activeElement,
      x2d: Math.round(pt.x),
      y2d: Math.round(pt.y),
      x3d: 0,
      y3d: 0,
      z3d: 0,
    };
    onChangeMolecule({
      ...molecule,
      smiles: undefined,
      atoms: [...molecule.atoms, newAtom],
    });
    onSelectAtom(newId);
  };

  const handleSvgPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const pt = getSvgPoint(e.clientX, e.clientY);
    setCursorPt(pt);

    if (!dragState) {
      const hoverAtom = findAtomAt(pt.x, pt.y);
      const nextHover = hoverAtom ? hoverAtom.id : null;
      if (nextHover !== hoveredAtomId) {
        onHoverAtom(nextHover);
      }
      const hoverBond = hoverAtom ? null : findBondAt(pt.x, pt.y);
      setHoveredBondId(hoverBond ? hoverBond.id : null);
      return;
    }

    const dist = Math.hypot(pt.x - dragState.startX, pt.y - dragState.startY);
    const moved = dragState.moved || dist > 7;

    if (dragState.mode === 'move_atom' && dragState.sourceAtomId) {
      const updatedAtoms = molecule.atoms.map((a) =>
        a.id === dragState.sourceAtomId
          ? { ...a, x2d: Math.round(pt.x), y2d: Math.round(pt.y) }
          : a
      );
      onChangeMolecule({ ...molecule, atoms: updatedAtoms }, false);
      setDragState({ ...dragState, currX: pt.x, currY: pt.y, moved });
      return;
    }

    if (dragState.mode === 'pan_all' && dragState.initialAtoms) {
      const dx = pt.x - dragState.startX;
      const dy = pt.y - dragState.startY;
      const initMap = new Map(
        dragState.initialAtoms.map((a) => [a.id, a])
      );
      const updatedAtoms = molecule.atoms.map((a) => {
        const init = initMap.get(a.id);
        return init
          ? {
              ...a,
              x2d: Math.max(16, Math.min(SVG_W - 16, Math.round(init.x2d + dx))),
              y2d: Math.max(16, Math.min(SVG_H - 16, Math.round(init.y2d + dy))),
            }
          : a;
      });
      onChangeMolecule({ ...molecule, atoms: updatedAtoms }, false);
      setDragState({ ...dragState, currX: pt.x, currY: pt.y, moved });
      return;
    }

    if (dragState.mode === 'chain') {
      setDragState({ ...dragState, currX: pt.x, currY: pt.y, moved });
      return;
    }

    // Bond drag mode: snap either to existing atom or 15-degree angle at BOND_LEN
    const targetAtom = findAtomAt(
      pt.x,
      pt.y,
      dragState.sourceAtomId ?? undefined
    );
    if (targetAtom) {
      setDragState({
        ...dragState,
        currX: targetAtom.x2d,
        currY: targetAtom.y2d,
        snapTargetAtomId: targetAtom.id,
        moved,
      });
    } else {
      const rawAngle = Math.atan2(
        pt.y - dragState.startY,
        pt.x - dragState.startX
      );
      const snapStep = Math.PI / 12; // 15-degree ChemDraw angle snap
      const snappedAngle = Math.round(rawAngle / snapStep) * snapStep;
      const sx = Math.max(
        22,
        Math.min(
          SVG_W - 22,
          Math.round(dragState.startX + Math.cos(snappedAngle) * BOND_LEN)
        )
      );
      const sy = Math.max(
        22,
        Math.min(
          SVG_H - 22,
          Math.round(dragState.startY + Math.sin(snappedAngle) * BOND_LEN)
        )
      );
      setDragState({
        ...dragState,
        currX: sx,
        currY: sy,
        snapTargetAtomId: null,
        moved,
      });
    }
  };

  const handleSvgPointerUp = () => {
    if (!dragState) return;
    const state = dragState;
    setDragState(null);

    if (state.mode === 'move_atom' || state.mode === 'pan_all') {
      if (state.moved) {
        onChangeMolecule({ ...molecule }, true);
      }
      return;
    }

    if (state.mode === 'chain') {
      const chainPts = computeZigZagChainPoints(
        state.startX,
        state.startY,
        state.currX,
        state.currY
      );
      if (chainPts.length === 0) return;

      const stamp = Date.now().toString(36);
      const newAtoms: AtomNode[] = [];
      const newBonds: BondEdge[] = [];
      let prevId = state.sourceAtomId;

      if (!prevId) {
        prevId = `c_${stamp}_0`;
        newAtoms.push({
          id: prevId,
          element: 'C',
          x2d: state.startX,
          y2d: state.startY,
          x3d: 0,
          y3d: 0,
          z3d: 0,
        });
      }

      chainPts.forEach((pt, idx) => {
        const id = `c_${stamp}_${idx + 1}`;
        newAtoms.push({
          id,
          element: 'C',
          x2d: pt.x,
          y2d: pt.y,
          x3d: 0,
          y3d: 0,
          z3d: 0,
        });
        newBonds.push({
          id: `cb_${stamp}_${idx}`,
          from: prevId!,
          to: id,
          order: 1,
        });
        prevId = id;
      });

      onChangeMolecule({
        ...molecule,
        smiles: undefined,
        atoms: [...molecule.atoms, ...newAtoms],
        bonds: [...molecule.bonds, ...newBonds],
      });
      if (prevId) onSelectAtom(prevId);
      return;
    }

    const sourceAtom = molecule.atoms.find(
      (a) => a.id === state.sourceAtomId
    );
    if (!sourceAtom) return;

    const { order, stereo } = getBondToolParams(tool);

    // Click without dragging on an existing atom:
    // If user explicitly picked an element stamp (atomStampMode), transmute element;
    // Otherwise (ChemDraw Bond Tool behavior), 1-click sprout a new bond + atom at open 120° angle!
    if (!state.moved) {
      if (atomStampMode && sourceAtom.element !== activeElement) {
        onChangeMolecule({
          ...molecule,
          smiles: undefined,
          atoms: molecule.atoms.map((a) =>
            a.id === sourceAtom.id ? { ...a, element: activeElement } : a
          ),
        });
        return;
      }

      const sproutPt = computeOpenSproutPoint(sourceAtom);
      const newId = `a_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`;
      const newAtom: AtomNode = {
        id: newId,
        element: atomStampMode ? activeElement : 'C',
        x2d: sproutPt.x,
        y2d: sproutPt.y,
        x3d: 0,
        y3d: 0,
        z3d: 0,
      };
      const newBond: BondEdge = {
        id: `b_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
        from: sourceAtom.id,
        to: newId,
        order,
        stereo: stereo !== 'none' ? stereo : undefined,
      };
      onChangeMolecule({
        ...molecule,
        smiles: undefined,
        atoms: [...molecule.atoms, newAtom],
        bonds: [...molecule.bonds, newBond],
      });
      onSelectAtom(newId);
      return;
    }

    // Dragged to another existing atom -> add or update bond
    if (state.snapTargetAtomId) {
      const existingIdx = molecule.bonds.findIndex(
        (b) =>
          (b.from === sourceAtom.id && b.to === state.snapTargetAtomId) ||
          (b.from === state.snapTargetAtomId && b.to === sourceAtom.id)
      );
      if (existingIdx >= 0) {
        const nextBonds = molecule.bonds.map((b, i) =>
          i === existingIdx
            ? {
                ...b,
                from: sourceAtom.id,
                to: state.snapTargetAtomId!,
                order,
                stereo: stereo !== 'none' ? stereo : undefined,
                isAromatic: false,
              }
            : b
        );
        onChangeMolecule({
          ...molecule,
          smiles: undefined,
          bonds: nextBonds,
        });
      } else {
        const newBond: BondEdge = {
          id: `b_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
          from: sourceAtom.id,
          to: state.snapTargetAtomId,
          order,
          stereo: stereo !== 'none' ? stereo : undefined,
        };
        onChangeMolecule({
          ...molecule,
          smiles: undefined,
          bonds: [...molecule.bonds, newBond],
        });
      }
      onSelectAtom(state.snapTargetAtomId);
      return;
    }

    // Dragged into empty space -> create new bonded atom at snapped position
    const newId = `a_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`;
    const newAtom: AtomNode = {
      id: newId,
      element: atomStampMode ? activeElement : 'C',
      x2d: state.currX,
      y2d: state.currY,
      x3d: 0,
      y3d: 0,
      z3d: 0,
    };
    const newBond: BondEdge = {
      id: `b_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
      from: sourceAtom.id,
      to: newId,
      order,
      stereo: stereo !== 'none' ? stereo : undefined,
    };
    onChangeMolecule({
      ...molecule,
      smiles: undefined,
      atoms: [...molecule.atoms, newAtom],
      bonds: [...molecule.bonds, newBond],
    });
    onSelectAtom(newId);
  };

  /**
   * ChemDraw / MolDraw keyboard hotkeys when focused on SVG sheet:
   * - C, N, O, S, P, F, B, H: transmute hovered or selected atom (or switch active element)
   * - 1, 2, 3: set bond order on hovered bond or switch bond tool
   * - Delete / Backspace: delete hovered or selected atom/bond
   */
  const handleSvgKeyDown = (e: React.KeyboardEvent<SVGSVGElement>) => {
    const key = e.key.toUpperCase();
    const targetAtomId = hoveredAtomId || selectedAtomId;

    const hotkeyElements: Record<string, ElementSymbol> = {
      C: 'C',
      N: 'N',
      O: 'O',
      S: 'S',
      P: 'P',
      F: 'F',
      B: 'B',
      H: 'H',
    };

    if (hotkeyElements[key] && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const sym = hotkeyElements[key];
      setActiveElement(sym);
      if (targetAtomId) {
        onChangeMolecule({
          ...molecule,
          smiles: undefined,
          atoms: molecule.atoms.map((a) =>
            a.id === targetAtomId ? { ...a, element: sym } : a
          ),
        });
      }
      e.preventDefault();
      return;
    }

    if (e.key === '1' || e.key === '2' || e.key === '3') {
      const ord = Number(e.key) as BondOrder;
      const nextTool: ChemDrawTool =
        ord === 1 ? 'bond1' : ord === 2 ? 'bond2' : 'bond3';
      setTool(nextTool);
      setAtomStampMode(false);
      if (hoveredBondId) {
        onChangeMolecule({
          ...molecule,
          smiles: undefined,
          bonds: molecule.bonds.map((b) =>
            b.id === hoveredBondId
              ? { ...b, order: ord, stereo: undefined, isAromatic: false }
              : b
          ),
        });
      }
      e.preventDefault();
      return;
    }

    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (targetAtomId) {
        onChangeMolecule({
          ...molecule,
          smiles: undefined,
          atoms: molecule.atoms.filter((a) => a.id !== targetAtomId),
          bonds: molecule.bonds.filter(
            (b) => b.from !== targetAtomId && b.to !== targetAtomId
          ),
        });
        if (selectedAtomId === targetAtomId) onSelectAtom(null);
      } else if (hoveredBondId) {
        onChangeMolecule({
          ...molecule,
          smiles: undefined,
          bonds: molecule.bonds.filter((b) => b.id !== hoveredBondId),
        });
      }
      e.preventDefault();
    }
  };

  const handleStampSubstituent = (smiles: string, label: string) => {
    try {
      const frag = parseSmilesToMolecule(smiles, label);
      const idPrefix = `f_${Date.now().toString(36)}_`;
      const idMap = new Map<string, string>();
      for (const a of frag.atoms) {
        idMap.set(a.id, `${idPrefix}${a.id}`);
      }

      // If currently selected atom already has 0 open valences (e.g., an already-substituted ring C),
      // pick the nearest atom in the existing scaffold that still has open valence (implicit H > 0)
      let anchor = molecule.atoms.find((a) => a.id === selectedAtomId) ?? null;
      if (anchor && (metrics.atomAnalyses[anchor.id]?.implicitHydrogens ?? 0) <= 0) {
        const openCandidates = molecule.atoms.filter(
          (a) => (metrics.atomAnalyses[a.id]?.implicitHydrogens ?? 0) > 0
        );
        if (openCandidates.length > 0) {
          openCandidates.sort((a, b) => {
            const cBoostA = a.element === 'C' ? 0 : 120;
            const cBoostB = b.element === 'C' ? 0 : 120;
            const da = Math.hypot(a.x2d - anchor!.x2d, a.y2d - anchor!.y2d) + cBoostA;
            const db = Math.hypot(b.x2d - anchor!.x2d, b.y2d - anchor!.y2d) + cBoostB;
            return da - db;
          });
          anchor = openCandidates[0];
        }
      }

      const sproutPt = anchor
        ? computeOpenSproutPoint(anchor)
        : { x: SVG_W / 2, y: SVG_H / 2 };

      const rootFragAtom = frag.atoms[0];
      let stampedAtoms: AtomNode[] = [];

      if (anchor && rootFragAtom && frag.atoms.length > 1) {
        // Orient multi-atom fragment radially along the outward sprout vector so substituents never fold back
        const targetAngle = Math.atan2(
          sproutPt.y - anchor.y2d,
          sproutPt.x - anchor.x2d
        );
        // Compute first-shell centroid around rootFragAtom so trigonal groups (-COOH, -NO2, -CHO) form symmetric 120° Y-junctions
        const firstShellIds = new Set(
          frag.bonds
            .filter(
              (b) => b.from === rootFragAtom.id || b.to === rootFragAtom.id
            )
            .map((b) => (b.from === rootFragAtom.id ? b.to : b.from))
        );
        const refAtoms =
          firstShellIds.size > 0
            ? frag.atoms.filter((a) => firstShellIds.has(a.id))
            : frag.atoms;

        let avgX = 0;
        let avgY = 0;
        for (const a of refAtoms) {
          avgX += a.x2d - rootFragAtom.x2d;
          avgY += a.y2d - rootFragAtom.y2d;
        }
        const fragAngle =
          Math.hypot(avgX, avgY) > 2 ? Math.atan2(avgY, avgX) : 0;
        const rot = targetAngle - fragAngle;
        const cosR = Math.cos(rot);
        const sinR = Math.sin(rot);

        stampedAtoms = frag.atoms.map((a) => {
          const rx = a.x2d - rootFragAtom.x2d;
          const ry = a.y2d - rootFragAtom.y2d;
          const nx = sproutPt.x + rx * cosR - ry * sinR;
          const ny = sproutPt.y + rx * sinR + ry * cosR;
          return {
            ...a,
            id: idMap.get(a.id)!,
            x2d: Math.max(24, Math.min(SVG_W - 24, Math.round(nx))),
            y2d: Math.max(24, Math.min(SVG_H - 24, Math.round(ny))),
          };
        });
      } else {
        const dx = rootFragAtom ? sproutPt.x - rootFragAtom.x2d : 0;
        const dy = rootFragAtom ? sproutPt.y - rootFragAtom.y2d : 0;
        stampedAtoms = frag.atoms.map((a) => ({
          ...a,
          id: idMap.get(a.id)!,
          x2d: Math.max(24, Math.min(SVG_W - 24, Math.round(a.x2d + dx))),
          y2d: Math.max(24, Math.min(SVG_H - 24, Math.round(a.y2d + dy))),
        }));
      }

      const stampedBonds: BondEdge[] = frag.bonds.map((b) => ({
        ...b,
        id: `${idPrefix}${b.id}`,
        from: idMap.get(b.from)!,
        to: idMap.get(b.to)!,
      }));

      if (anchor && stampedAtoms.length > 0) {
        stampedBonds.push({
          id: `${idPrefix}link`,
          from: anchor.id,
          to: stampedAtoms[0].id,
          order: 1,
        });
      }

      const nextAtoms = [...molecule.atoms, ...stampedAtoms];
      const nextBonds = [...molecule.bonds, ...stampedBonds];

      onChangeMolecule({
        ...molecule,
        smiles: undefined,
        atoms: nextAtoms,
        bonds: nextBonds,
      });

      // If anchor just used its last open valence, advance selection to next open carbon on scaffold
      if (anchor) {
        const anchorRemainingH =
          (metrics.atomAnalyses[anchor.id]?.implicitHydrogens ?? 0) - 1;
        if (anchorRemainingH <= 0) {
          const nextOpen = molecule.atoms.find(
            (a) =>
              a.id !== anchor!.id &&
              a.element === 'C' &&
              (metrics.atomAnalyses[a.id]?.implicitHydrogens ?? 0) > 0
          );
          if (nextOpen) {
            onSelectAtom(nextOpen.id);
          }
        }
      }
    } catch {
      // Ignore fragment stamp errors
    }
  };

  const handleSmilesSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSmilesError(null);
    try {
      const parsed = parseSmilesToMolecule(smilesInput, smilesInput.trim());
      onChangeMolecule(parsed);
      setSmilesInput('');
    } catch (err) {
      setSmilesError(
        err instanceof Error ? err.message : 'Invalid SMILES syntax.'
      );
    }
  };

  const handleAiFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!aiPrompt.trim() || isSynthesizing) return;
    await onSynthesizePrompt(aiPrompt.trim());
    setAiPrompt('');
  };

  // Compute live ghost preview for Ring or Chain tools
  const ringPreview = useMemo(() => {
    if (!cursorPt || dragState || !isRingTool(tool)) return null;
    const { sides, aromatic } = getRingToolSpec(tool);
    return computeRingPlacement(cursorPt, sides, aromatic);
  }, [cursorPt, dragState, tool, molecule.atoms, molecule.bonds]);

  const chainPreview = useMemo(() => {
    if (!dragState || dragState.mode !== 'chain' || !dragState.moved) return null;
    return computeZigZagChainPoints(
      dragState.startX,
      dragState.startY,
      dragState.currX,
      dragState.currY
    );
  }, [dragState]);

  const selectBondTool = (nextTool: ChemDrawTool) => {
    setTool(nextTool);
    setAtomStampMode(false);
  };

  const handleSelectElementFromPalette = (sym: ElementSymbol) => {
    setActiveElement(sym);
    setAtomStampMode(true);
    if (isRingTool(tool) || tool === 'select' || tool === 'erase') {
      setTool('bond1');
    }
    if (selectedAtomId) {
      onChangeMolecule({
        ...molecule,
        smiles: undefined,
        atoms: molecule.atoms.map((a) =>
          a.id === selectedAtomId ? { ...a, element: sym } : a
        ),
      });
    }
  };

  return (
    <div className="flex flex-col h-full bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden select-none">
      {/* Top Bar 1: Element Palette + Periodic Table + Document Actions */}
      <div className="px-3 py-2 border-b border-slate-200 bg-slate-50/70 flex flex-wrap items-center justify-between gap-2">
        {/* Element Hotkey Buttons + Periodic Table List Button */}
        <div className="flex flex-wrap items-center gap-1">
          {ELEMENT_PALETTE_ORDER.map((sym) => {
            const spec = ELEMENTS[sym];
            const active = activeElement === sym && atomStampMode;
            const textColor = CHEMDRAW_ATOM_COLOR[sym] ?? '#0F172A';
            return (
              <button
                key={sym}
                type="button"
                onClick={() => handleSelectElementFromPalette(sym)}
                aria-label={`Element ${spec.name} (${sym})`}
                aria-pressed={active}
                title={`${spec.name} (${sym}) — Click to stamp or transmute selected atom`}
                className={`h-7 px-2 rounded text-xs font-bold font-mono flex items-center gap-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  active
                    ? 'bg-slate-900 text-white'
                    : 'bg-white border border-slate-200 hover:border-slate-400'
                }`}
                style={active ? undefined : { color: textColor }}
              >
                <span>{sym}</span>
              </button>
            );
          })}

          {!ELEMENT_PALETTE_ORDER.includes(activeElement) && (
            <button
              type="button"
              onClick={() => handleSelectElementFromPalette(activeElement)}
              aria-label={`Selected Element ${ELEMENTS[activeElement].name} (${activeElement})`}
              className="h-7 px-2 rounded text-xs font-bold font-mono bg-blue-600 text-white flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
              title={`#${ELEMENTS[activeElement].atomicNumber} ${ELEMENTS[activeElement].name}`}
            >
              <span>{activeElement}</span>
              <span className="text-[10px] opacity-80">
                #{ELEMENTS[activeElement].atomicNumber}
              </span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setIsPeriodicTableOpen(true)}
            data-testid="periodic-table-trigger"
            aria-label="Open Periodic Table Element List"
            title="Open Full 118-Element Periodic Table & Searchable Element List"
            className="h-7 px-2.5 rounded border border-blue-200 bg-blue-50/80 text-blue-700 hover:bg-blue-100 text-[11px] font-semibold flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer transition-colors"
          >
            <Table2 className="w-3.5 h-3.5" />
            <span>Periodic Table</span>
          </button>
        </div>

        {/* Document Edit & Display Actions */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onUndo}
            disabled={!canUndo}
            aria-label="Undo edit"
            title="Undo"
            className="h-7 w-7 rounded border border-slate-200 bg-white flex items-center justify-center text-slate-600 hover:bg-slate-100 disabled:opacity-35 cursor-pointer"
          >
            <Undo2 className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={onRedo}
            disabled={!canRedo}
            aria-label="Redo edit"
            title="Redo"
            className="h-7 w-7 rounded border border-slate-200 bg-white flex items-center justify-center text-slate-600 hover:bg-slate-100 disabled:opacity-35 cursor-pointer"
          >
            <Redo2 className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={onClean2D}
            aria-label="Clean Up Structure"
            title="Clean Up 2D Bond Lengths & Angles"
            className="h-7 px-2 rounded border border-slate-200 bg-white text-[11px] font-medium text-slate-700 hover:bg-slate-100 flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <FlipHorizontal className="w-3 h-3" />
            <span>Clean</span>
          </button>
          <button
            type="button"
            onClick={onToggleHydrogens}
            aria-label={
              hasExplicitHydrogens
                ? 'Switch to Skeletal Formula'
                : 'Show Explicit Hydrogens'
            }
            title="Toggle Skeletal vs Explicit All-H 2D View"
            className={`h-7 px-2 rounded border text-[11px] font-medium flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer ${
              hasExplicitHydrogens
                ? 'bg-blue-50 border-blue-300 text-blue-700'
                : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100'
            }`}
          >
            <Atom className="w-3 h-3" />
            <span>{hasExplicitHydrogens ? 'All-H 2D' : 'Skeletal'}</span>
          </button>
          <button
            type="button"
            onClick={() => setAromaticCircleStyle((v) => !v)}
            title="Toggle Kekulé Double Bonds vs Aromatic Ring Circle"
            className={`h-7 px-2 rounded border text-[11px] font-medium whitespace-nowrap shrink-0 cursor-pointer ${
              aromaticCircleStyle
                ? 'bg-slate-900 border-slate-900 text-white'
                : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100'
            }`}
          >
            {aromaticCircleStyle ? 'Ring ○' : 'Kekulé'}
          </button>
          <button
            type="button"
            onClick={() => setShowGrid((g) => !g)}
            aria-label="Toggle drafting grid"
            title="Toggle Drafting Grid"
            className={`h-7 w-7 rounded border flex items-center justify-center cursor-pointer ${
              showGrid
                ? 'bg-slate-100 border-slate-300 text-slate-800'
                : 'bg-white border-slate-200 text-slate-400 hover:text-slate-700'
            }`}
          >
            <Grid className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={onClear}
            aria-label="Clear drawing canvas"
            title="Clear Canvas"
            className="h-7 w-7 rounded border border-slate-200 bg-white text-rose-600 hover:bg-rose-50 flex items-center justify-center cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Top Bar 2: Quick Functional Group & Bicyclic Substituent Stamps */}
      <div className="px-3 py-1.5 border-b border-slate-200 bg-white flex items-center gap-1.5 overflow-x-auto">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 shrink-0 mr-0.5">
          Groups
        </span>
        {FRAGMENT_TEMPLATES.map((tpl) => (
          <button
            key={tpl.id}
            type="button"
            onClick={() => handleStampSubstituent(tpl.smiles, tpl.label)}
            title={`Attach or place ${tpl.label}`}
            className="h-6 px-2 rounded border border-slate-200 bg-slate-50/70 hover:border-blue-400 hover:bg-blue-50/50 hover:text-blue-700 font-mono text-[11px] font-medium text-slate-700 whitespace-nowrap shrink-0 cursor-pointer transition-colors"
          >
            {tpl.shortLabel}
          </button>
        ))}
      </div>

      {/* Main Editor Body: Left Vertical ChemDraw Tool Dock + White Drafting Sheet */}
      <div className="flex-1 flex min-h-[260px] max-h-[340px] sm:max-h-none overflow-hidden">
        {/* Classic ChemDraw / MolDraw Left Vertical Palette */}
        <div
          role="toolbar"
          aria-label="ChemDraw Structure Drawing Tools"
          className="w-11 border-r border-slate-200 bg-slate-50/80 py-2 px-1 flex flex-col items-center gap-1 overflow-y-auto shrink-0"
        >
          {/* Select / Move / Pan */}
          <button
            type="button"
            onClick={() => setTool('select')}
            aria-label="Select and Move"
            aria-pressed={tool === 'select'}
            title="Select, Move Atom, or Drag Sheet"
            className={`w-8 h-8 rounded-md flex items-center justify-center transition-colors cursor-pointer ${
              tool === 'select'
                ? 'bg-blue-600 text-white shadow-xs'
                : 'text-slate-700 hover:bg-slate-200/70'
            }`}
          >
            <MousePointer className="w-4 h-4" />
          </button>

          {/* Single Bond */}
          <button
            type="button"
            onClick={() => selectBondTool('bond1')}
            aria-label="Single Bond"
            aria-pressed={tool === 'bond1'}
            title="Single Bond (1) — Click atom to sprout or drag"
            className={`w-8 h-8 rounded-md flex items-center justify-center transition-colors cursor-pointer ${
              tool === 'bond1'
                ? 'bg-slate-900 text-white shadow-xs'
                : 'text-slate-700 hover:bg-slate-200/70'
            }`}
          >
            <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <line x1="5" y1="19" x2="19" y2="5" />
            </svg>
          </button>

          {/* Double Bond */}
          <button
            type="button"
            onClick={() => selectBondTool('bond2')}
            aria-label="Double Bond"
            aria-pressed={tool === 'bond2'}
            title="Double Bond (2)"
            className={`w-8 h-8 rounded-md flex items-center justify-center transition-colors cursor-pointer ${
              tool === 'bond2'
                ? 'bg-slate-900 text-white shadow-xs'
                : 'text-slate-700 hover:bg-slate-200/70'
            }`}
          >
            <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="4" y1="16" x2="16" y2="4" />
              <line x1="8" y1="20" x2="20" y2="8" />
            </svg>
          </button>

          {/* Triple Bond */}
          <button
            type="button"
            onClick={() => selectBondTool('bond3')}
            aria-label="Triple Bond"
            aria-pressed={tool === 'bond3'}
            title="Triple Bond (3)"
            className={`w-8 h-8 rounded-md flex items-center justify-center transition-colors cursor-pointer ${
              tool === 'bond3'
                ? 'bg-slate-900 text-white shadow-xs'
                : 'text-slate-700 hover:bg-slate-200/70'
            }`}
          >
            <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <line x1="4" y1="14" x2="14" y2="4" />
              <line x1="6" y1="18" x2="18" y2="6" />
              <line x1="10" y1="20" x2="20" y2="10" />
            </svg>
          </button>

          {/* Solid Wedge Stereobond (Up) */}
          <button
            type="button"
            onClick={() => selectBondTool('wedge')}
            aria-label="Wedge Stereobond"
            aria-pressed={tool === 'wedge'}
            title="Solid Wedged Bond (Up / Beta Stereochemistry)"
            className={`w-8 h-8 rounded-md flex items-center justify-center transition-colors cursor-pointer ${
              tool === 'wedge'
                ? 'bg-slate-900 text-white shadow-xs'
                : 'text-slate-700 hover:bg-slate-200/70'
            }`}
          >
            <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor">
              <polygon points="5,19 16,4 20,8" />
            </svg>
          </button>

          {/* Hashed Dash Wedge Stereobond (Down) */}
          <button
            type="button"
            onClick={() => selectBondTool('dash')}
            aria-label="Hashed Wedge Stereobond"
            aria-pressed={tool === 'dash'}
            title="Hashed Wedged Bond (Down / Alpha Stereochemistry)"
            className={`w-8 h-8 rounded-md flex items-center justify-center transition-colors cursor-pointer ${
              tool === 'dash'
                ? 'bg-slate-900 text-white shadow-xs'
                : 'text-slate-700 hover:bg-slate-200/70'
            }`}
          >
            <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <line x1="5.5" y1="18.5" x2="6.5" y2="19.5" />
              <line x1="8" y1="15" x2="10" y2="17" />
              <line x1="10.5" y1="11.5" x2="13.5" y2="14.5" />
              <line x1="13" y1="8" x2="17" y2="12" />
              <line x1="15.5" y1="4.5" x2="20.5" y2="9.5" />
            </svg>
          </button>

          {/* Acyclic Zig-Zag Chain Tool */}
          <button
            type="button"
            onClick={() => selectBondTool('chain')}
            aria-label="Zig-Zag Carbon Chain"
            aria-pressed={tool === 'chain'}
            title="Acyclic Zig-Zag Chain Tool — Click and drag to draw carbon chain"
            className={`w-8 h-8 rounded-md flex items-center justify-center transition-colors cursor-pointer ${
              tool === 'chain'
                ? 'bg-slate-900 text-white shadow-xs'
                : 'text-slate-700 hover:bg-slate-200/70'
            }`}
          >
            <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3,15 8,9 13,15 18,9 22,13" />
            </svg>
          </button>

          <div className="w-6 h-px bg-slate-200 my-0.5 shrink-0" />

          {/* Polygon Ring Tools (3, 4, 5, 6, Benzene, 7) */}
          <button
            type="button"
            onClick={() => setTool('ring3')}
            aria-label="Cyclopropane Ring"
            aria-pressed={tool === 'ring3'}
            title="Cyclopropane (3-Ring) — Click sheet or click bond to fuse"
            className={`w-8 h-8 rounded-md flex items-center justify-center transition-colors cursor-pointer ${
              tool === 'ring3'
                ? 'bg-blue-600 text-white shadow-xs'
                : 'text-slate-700 hover:bg-slate-200/70'
            }`}
          >
            <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round">
              <polygon points="12,5 19,18 5,18" />
            </svg>
          </button>

          <button
            type="button"
            onClick={() => setTool('ring4')}
            aria-label="Cyclobutane Ring"
            aria-pressed={tool === 'ring4'}
            title="Cyclobutane (4-Ring) — Click sheet or click bond to fuse"
            className={`w-8 h-8 rounded-md flex items-center justify-center transition-colors cursor-pointer ${
              tool === 'ring4'
                ? 'bg-blue-600 text-white shadow-xs'
                : 'text-slate-700 hover:bg-slate-200/70'
            }`}
          >
            <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round">
              <rect x="6" y="6" width="12" height="12" />
            </svg>
          </button>

          <button
            type="button"
            onClick={() => setTool('ring5')}
            aria-label="Cyclopentane Ring"
            aria-pressed={tool === 'ring5'}
            title="Cyclopentane (5-Ring) — Click sheet or click bond to fuse"
            className={`w-8 h-8 rounded-md flex items-center justify-center transition-colors cursor-pointer ${
              tool === 'ring5'
                ? 'bg-blue-600 text-white shadow-xs'
                : 'text-slate-700 hover:bg-slate-200/70'
            }`}
          >
            <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round">
              <polygon points="12,4 20,10 17,19 7,19 4,10" />
            </svg>
          </button>

          <button
            type="button"
            onClick={() => setTool('ring6')}
            aria-label="Cyclohexane Ring"
            aria-pressed={tool === 'ring6'}
            title="Cyclohexane (6-Ring) — Click sheet or click bond to fuse"
            className={`w-8 h-8 rounded-md flex items-center justify-center transition-colors cursor-pointer ${
              tool === 'ring6'
                ? 'bg-blue-600 text-white shadow-xs'
                : 'text-slate-700 hover:bg-slate-200/70'
            }`}
          >
            <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round">
              <polygon points="12,4 19,8 19,16 12,20 5,16 5,8" />
            </svg>
          </button>

          <button
            type="button"
            onClick={() => setTool('benzene')}
            aria-label="Benzene Ring"
            aria-pressed={tool === 'benzene'}
            title="Benzene Aromatic Ring — Click sheet or click bond to fuse"
            className={`w-8 h-8 rounded-md flex items-center justify-center transition-colors cursor-pointer ${
              tool === 'benzene'
                ? 'bg-blue-600 text-white shadow-xs'
                : 'text-slate-700 hover:bg-slate-200/70'
            }`}
          >
            <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
              <polygon points="12,4 19,8 19,16 12,20 5,16 5,8" />
              <circle cx="12" cy="12" r="4.2" />
            </svg>
          </button>

          <button
            type="button"
            onClick={() => setTool('ring7')}
            aria-label="Cycloheptane Ring"
            aria-pressed={tool === 'ring7'}
            title="Cycloheptane (7-Ring) — Click sheet or click bond to fuse"
            className={`w-8 h-8 rounded-md flex items-center justify-center transition-colors cursor-pointer ${
              tool === 'ring7'
                ? 'bg-blue-600 text-white shadow-xs'
                : 'text-slate-700 hover:bg-slate-200/70'
            }`}
          >
            <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
              <polygon points="12,4 18.5,7 20,14 15.5,19.5 8.5,19.5 4,14 5.5,7" />
            </svg>
          </button>

          <div className="w-6 h-px bg-slate-200 my-0.5 shrink-0" />

          {/* Formal Charge +1 / -1 & Eraser */}
          <button
            type="button"
            onClick={() => setTool('charge_plus')}
            aria-label="Positive Formal Charge"
            aria-pressed={tool === 'charge_plus'}
            title="Add +1 Formal Charge to Atom"
            className={`w-8 h-8 rounded-md font-mono text-xs font-bold flex items-center justify-center transition-colors cursor-pointer ${
              tool === 'charge_plus'
                ? 'bg-slate-900 text-white'
                : 'text-slate-700 hover:bg-slate-200/70'
            }`}
          >
            +
          </button>

          <button
            type="button"
            onClick={() => setTool('charge_minus')}
            aria-label="Negative Formal Charge"
            aria-pressed={tool === 'charge_minus'}
            title="Add -1 Formal Charge to Atom"
            className={`w-8 h-8 rounded-md flex items-center justify-center transition-colors cursor-pointer ${
              tool === 'charge_minus'
                ? 'bg-slate-900 text-white'
                : 'text-slate-700 hover:bg-slate-200/70'
            }`}
          >
            <Minus className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={() => setIsPeriodicTableOpen(true)}
            aria-label="Periodic Table Selector"
            title="Periodic Table & Element List (All 118 Elements)"
            className="w-8 h-8 rounded-md text-blue-700 hover:bg-blue-50 flex items-center justify-center transition-colors cursor-pointer"
          >
            <Table2 className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={() => setTool('erase')}
            aria-label="Erase Atom or Bond"
            aria-pressed={tool === 'erase'}
            title="Eraser — Click atom or bond to delete"
            className={`w-8 h-8 rounded-md flex items-center justify-center transition-colors cursor-pointer ${
              tool === 'erase'
                ? 'bg-rose-600 text-white shadow-xs'
                : 'text-rose-600 hover:bg-rose-50'
            }`}
          >
            <Eraser className="w-4 h-4" />
          </button>
        </div>

        {/* Pure White ChemDraw Publication Drafting Sheet */}
        <div className="relative flex-1 bg-white overflow-hidden">
          <svg
            ref={svgRef}
            tabIndex={0}
            viewBox={`0 0 ${SVG_W} ${SVG_H}`}
            data-testid="molecule-2d-canvas"
            onPointerDown={handleSvgPointerDown}
            onPointerMove={handleSvgPointerMove}
            onPointerUp={handleSvgPointerUp}
            onKeyDown={handleSvgKeyDown}
            onPointerLeave={() => {
              if (dragState) handleSvgPointerUp();
              onHoverAtom(null);
              setHoveredBondId(null);
              setCursorPt(null);
            }}
            className={`w-full h-full touch-none focus:outline-none ${
              tool === 'erase'
                ? 'cursor-not-allowed'
                : tool === 'select'
                ? 'cursor-grab'
                : 'cursor-crosshair'
            }`}
          >
            <defs>
              <pattern
                id="chemDrawDotGrid"
                width="25"
                height="25"
                patternUnits="userSpaceOnUse"
              >
                <circle cx="1" cy="1" r="0.85" fill="#CBD5E1" />
              </pattern>
            </defs>

            <rect
              width={SVG_W}
              height={SVG_H}
              fill={showGrid ? 'url(#chemDrawDotGrid)' : '#FFFFFF'}
            />

            {/* Empty Sheet Prompt */}
            {molecule.atoms.length === 0 && (
              <g pointerEvents="none">
                <text
                  x={SVG_W / 2}
                  y={SVG_H / 2 - 10}
                  textAnchor="middle"
                  className="fill-slate-400 text-sm font-medium"
                >
                  Click sheet to place atom, drag for bond/chain, or pick a ring tool
                </text>
                <text
                  x={SVG_W / 2}
                  y={SVG_H / 2 + 12}
                  textAnchor="middle"
                  className="fill-slate-400 text-xs"
                >
                  Hover any atom and press C, N, O, S, P, F, or 1 / 2 / 3
                </text>
              </g>
            )}

            {/* Optional Aromatic Delocalization Circles */}
            {aromaticCircleStyle &&
              ringGeom.aromaticCircles.map((c, idx) => (
                <circle
                  key={`arom_${idx}`}
                  cx={c.cx}
                  cy={c.cy}
                  r={c.r}
                  fill="none"
                  stroke="#0F172A"
                  strokeWidth={1.6}
                  pointerEvents="none"
                />
              ))}

            {/* Covalent & Stereochemical Bonds (ChemDraw ACS 1996 Style) */}
            {molecule.bonds.map((bond) => {
              const a1 = atomById.get(bond.from);
              const a2 = atomById.get(bond.to);
              if (!a1 || !a2) return null;

              const dx = a2.x2d - a1.x2d;
              const dy = a2.y2d - a1.y2d;
              const len = Math.max(1, Math.hypot(dx, dy));
              const ux = dx / len;
              const uy = dy / len;
              const nx = -uy;
              const ny = ux;

              const isHovered = bond.id === hoveredBondId;
              const strokeColor = isHovered ? '#2563EB' : '#0F172A';

              // If aromatic circle mode is active and bond is aromatic, draw single line
              const effectiveOrder =
                aromaticCircleStyle && bond.isAromatic ? 1 : bond.order;

              // Check if double bond is inside a ring so secondary bar sits inside & inset
              const ringCenter = ringGeom.bondRingCentroid.get(bond.id);
              let innerSign = 1;
              if (ringCenter) {
                const mx = (a1.x2d + a2.x2d) / 2;
                const my = (a1.y2d + a2.y2d) / 2;
                const dot =
                  (ringCenter.cx - mx) * nx + (ringCenter.cy - my) * ny;
                innerSign = dot >= 0 ? 1 : -1;
              }

              return (
                <g key={bond.id} pointerEvents="none">
                  {isHovered && (
                    <line
                      x1={a1.x2d}
                      y1={a1.y2d}
                      x2={a2.x2d}
                      y2={a2.y2d}
                      stroke="rgba(37, 99, 235, 0.16)"
                      strokeWidth={10}
                      strokeLinecap="round"
                    />
                  )}

                  {bond.stereo === 'wedge' ? (
                    <polygon
                      points={`${a1.x2d},${a1.y2d} ${a2.x2d + nx * 5.2},${
                        a2.y2d + ny * 5.2
                      } ${a2.x2d - nx * 5.2},${a2.y2d - ny * 5.2}`}
                      fill={strokeColor}
                    />
                  ) : bond.stereo === 'dash' ? (
                    // Classic ChemDraw 6-bar tapered hashed wedge
                    <>
                      {[0.18, 0.34, 0.5, 0.66, 0.82, 0.96].map((t, barIdx) => {
                        const bx = a1.x2d + dx * t;
                        const by = a1.y2d + dy * t;
                        const halfW = 1.0 + t * 4.4;
                        return (
                          <line
                            key={barIdx}
                            x1={bx + nx * halfW}
                            y1={by + ny * halfW}
                            x2={bx - nx * halfW}
                            y2={by - ny * halfW}
                            stroke={strokeColor}
                            strokeWidth={1.65}
                            strokeLinecap="round"
                          />
                        );
                      })}
                    </>
                  ) : effectiveOrder === 1 ? (
                    <line
                      x1={a1.x2d}
                      y1={a1.y2d}
                      x2={a2.x2d}
                      y2={a2.y2d}
                      stroke={strokeColor}
                      strokeWidth={1.85}
                      strokeLinecap="round"
                    />
                  ) : effectiveOrder === 2 ? (
                    ringCenter ? (
                      // Ring-aware ChemDraw asymmetric double bond
                      <>
                        <line
                          x1={a1.x2d}
                          y1={a1.y2d}
                          x2={a2.x2d}
                          y2={a2.y2d}
                          stroke={strokeColor}
                          strokeWidth={1.85}
                          strokeLinecap="round"
                        />
                        <line
                          x1={a1.x2d + ux * (len * 0.13) + nx * innerSign * 4.0}
                          y1={a1.y2d + uy * (len * 0.13) + ny * innerSign * 4.0}
                          x2={a2.x2d - ux * (len * 0.13) + nx * innerSign * 4.0}
                          y2={a2.y2d - uy * (len * 0.13) + ny * innerSign * 4.0}
                          stroke={strokeColor}
                          strokeWidth={1.7}
                          strokeLinecap="round"
                        />
                      </>
                    ) : (
                      // Acyclic symmetric double bond
                      <>
                        <line
                          x1={a1.x2d + nx * 2.1}
                          y1={a1.y2d + ny * 2.1}
                          x2={a2.x2d + nx * 2.1}
                          y2={a2.y2d + ny * 2.1}
                          stroke={strokeColor}
                          strokeWidth={1.7}
                          strokeLinecap="round"
                        />
                        <line
                          x1={a1.x2d - nx * 2.1}
                          y1={a1.y2d - ny * 2.1}
                          x2={a2.x2d - nx * 2.1}
                          y2={a2.y2d - ny * 2.1}
                          stroke={strokeColor}
                          strokeWidth={1.7}
                          strokeLinecap="round"
                        />
                      </>
                    )
                  ) : (
                    // Triple bond (alkyne / nitrile)
                    <>
                      <line
                        x1={a1.x2d}
                        y1={a1.y2d}
                        x2={a2.x2d}
                        y2={a2.y2d}
                        stroke={strokeColor}
                        strokeWidth={1.75}
                        strokeLinecap="round"
                      />
                      <line
                        x1={a1.x2d + ux * (len * 0.08) + nx * 3.8}
                        y1={a1.y2d + uy * (len * 0.08) + ny * 3.8}
                        x2={a2.x2d - ux * (len * 0.08) + nx * 3.8}
                        y2={a2.y2d - uy * (len * 0.08) + ny * 3.8}
                        stroke={strokeColor}
                        strokeWidth={1.6}
                        strokeLinecap="round"
                      />
                      <line
                        x1={a1.x2d + ux * (len * 0.08) - nx * 3.8}
                        y1={a1.y2d + uy * (len * 0.08) - ny * 3.8}
                        x2={a2.x2d - ux * (len * 0.08) - nx * 3.8}
                        y2={a2.y2d - uy * (len * 0.08) - ny * 3.8}
                        stroke={strokeColor}
                        strokeWidth={1.6}
                        strokeLinecap="round"
                      />
                    </>
                  )}
                </g>
              );
            })}

            {/* Live Ring Ghost Preview on Hover */}
            {ringPreview && (
              <g pointerEvents="none">
                {ringPreview.edges.map((e, i) => {
                  const v1 = ringPreview.vertices[e.fromIdx];
                  const v2 = ringPreview.vertices[e.toIdx];
                  return (
                    <line
                      key={i}
                      x1={v1.x}
                      y1={v1.y}
                      x2={v2.x}
                      y2={v2.y}
                      stroke="#2563EB"
                      strokeWidth={2}
                      strokeDasharray={e.existingBondId ? undefined : '4 3'}
                    />
                  );
                })}
              </g>
            )}

            {/* Live Zig-Zag Chain Preview while Dragging */}
            {dragState &&
              dragState.mode === 'chain' &&
              chainPreview &&
              chainPreview.length > 0 && (
                <g pointerEvents="none">
                  <polyline
                    points={[
                      `${dragState.startX},${dragState.startY}`,
                      ...chainPreview.map((p) => `${p.x},${p.y}`),
                    ].join(' ')}
                    fill="none"
                    stroke="#2563EB"
                    strokeWidth={2}
                    strokeDasharray="4 3"
                    strokeLinejoin="round"
                  />
                  {chainPreview.map((p, idx) => (
                    <circle
                      key={idx}
                      cx={p.x}
                      cy={p.y}
                      r={3.5}
                      fill="#2563EB"
                    />
                  ))}
                  <text
                    x={chainPreview[chainPreview.length - 1].x + 10}
                    y={chainPreview[chainPreview.length - 1].y - 8}
                    fontSize="11"
                    fontWeight="700"
                    fontFamily="JetBrains Mono, monospace"
                    fill="#1D4ED8"
                  >
                    C{chainPreview.length + (dragState.sourceAtomId ? 0 : 1)}
                  </text>
                </g>
              )}

            {/* Live Bond / Stereobond Rubber-Band Preview */}
            {dragState && dragState.mode === 'bond' && dragState.moved && (
              <g pointerEvents="none">
                <line
                  x1={dragState.startX}
                  y1={dragState.startY}
                  x2={dragState.currX}
                  y2={dragState.currY}
                  stroke="#2563EB"
                  strokeWidth={2}
                  strokeDasharray="4 3"
                />
                {!dragState.snapTargetAtomId && (
                  <circle
                    cx={dragState.currX}
                    cy={dragState.currY}
                    r={6}
                    fill="rgba(37, 99, 235, 0.14)"
                    stroke="#2563EB"
                    strokeWidth={1.6}
                  />
                )}
              </g>
            )}

            {/* Atom Nodes & ChemDraw Knockout Typography */}
            {molecule.atoms.map((atom) => {
              const analysis = metrics.atomAnalyses[atom.id];
              const isSelected = atom.id === selectedAtomId;
              const isHovered = atom.id === hoveredAtomId;
              const invalidValence = analysis && !analysis.valenceValid;

              const neighborBonds = molecule.bonds.filter(
                (b) => b.from === atom.id || b.to === atom.id
              );
              const neighborCount = neighborBonds.length;

              // In skeletal mode, carbons with >=1 bond are clean vertices unless isolated or formally charged
              const showAtomText =
                atom.element !== 'C' ||
                neighborCount === 0 ||
                Boolean(atom.formalCharge);

              const impH = analysis?.implicitHydrogens ?? 0;
              const showImplicitH =
                !hasExplicitHydrogens &&
                impH > 0 &&
                (atom.element !== 'C' || neighborCount === 0);

              // ChemDraw ACS 1996 rule: flip H before heteroatom (HO-, H2N-) when single bond goes right
              let flipHLeft = false;
              if (showImplicitH && atom.element !== 'C' && neighborCount === 1) {
                const b = neighborBonds[0];
                const nb = atomById.get(b.from === atom.id ? b.to : b.from);
                if (nb && nb.x2d - atom.x2d > 6) {
                  flipHLeft = true;
                }
              }

              const charge = atom.formalCharge ?? 0;
              const chargeStr =
                charge === 0
                  ? ''
                  : charge === 1
                  ? '+'
                  : charge === -1
                  ? '−'
                  : charge > 1
                  ? `${charge}+`
                  : `${Math.abs(charge)}−`;

              const fillColor =
                CHEMDRAW_ATOM_COLOR[atom.element] ?? '#0F172A';

              return (
                <g
                  key={atom.id}
                  transform={`translate(${atom.x2d}, ${atom.y2d})`}
                  pointerEvents="none"
                >
                  {/* Valence Error Warning Halo */}
                  {invalidValence && (
                    <circle
                      r={14}
                      fill="rgba(220, 38, 38, 0.12)"
                      stroke="#DC2626"
                      strokeWidth={1.6}
                      strokeDasharray="3 2"
                    />
                  )}

                  {/* Selection / Hover Reticle */}
                  {(isSelected || isHovered) && (
                    <circle
                      r={12}
                      fill={
                        isSelected
                          ? 'rgba(37, 99, 235, 0.12)'
                          : 'rgba(15, 23, 42, 0.05)'
                      }
                      stroke={isSelected ? '#2563EB' : '#64748B'}
                      strokeWidth={isSelected ? 1.6 : 1.1}
                    />
                  )}

                  {/* Crisp ChemDraw Typography with Pure White Halo Knockout */}
                  {showAtomText && (
                    <text
                      textAnchor="middle"
                      dominantBaseline="central"
                      fontSize="13"
                      fontWeight="700"
                      fontFamily="'Plus Jakarta Sans', 'JetBrains Mono', sans-serif"
                      fill={fillColor}
                      style={{
                        paintOrder: 'stroke',
                        stroke: '#FFFFFF',
                        strokeWidth: '6.5px',
                        strokeLinejoin: 'round',
                      }}
                    >
                      {flipHLeft ? (
                        <>
                          <tspan>H</tspan>
                          {impH > 1 && (
                            <tspan dy="3.5" fontSize="9.5">
                              {impH}
                            </tspan>
                          )}
                          <tspan dy={impH > 1 ? '-3.5' : '0'}>{atom.element}</tspan>
                          {chargeStr && (
                            <tspan dy="-5" fontSize="9.5" fontWeight="700">
                              {chargeStr}
                            </tspan>
                          )}
                        </>
                      ) : (
                        <>
                          {atom.element}
                          {showImplicitH && (
                            <>
                              <tspan>H</tspan>
                              {impH > 1 && (
                                <tspan dy="3.5" fontSize="9.5">
                                  {impH}
                                </tspan>
                              )}
                            </>
                          )}
                          {chargeStr && (
                            <tspan
                              dy={showImplicitH && impH > 1 ? '-7.5' : '-4.5'}
                              fontSize="9.5"
                              fontWeight="700"
                            >
                              {chargeStr}
                            </tspan>
                          )}
                        </>
                      )}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>

          {/* Subtle Bottom Status Line */}
          <div className="absolute bottom-1.5 left-2.5 right-2.5 flex items-center justify-between gap-2 pointer-events-none">
            <span className="text-[10.5px] text-slate-400 bg-white/95 px-1.5 py-0.5 rounded">
              {isRingTool(tool)
                ? 'Click sheet to place ring, or click any existing bond to fuse'
                : tool === 'chain'
                ? 'Click and drag across sheet to draw zig-zag carbon chain'
                : 'Click atom to sprout bond · Drag to connect · Hover + C/N/O/S/1/2/3'}
            </span>
            {!metrics.valenceValid && (
              <span className="text-[10.5px] font-semibold text-rose-700 bg-rose-50 px-2 py-0.5 rounded border border-rose-200">
                {metrics.valenceWarnings[0]}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Bottom Compact SMILES & Gemini AI Structure Bar */}
      <div className="p-2.5 border-t border-slate-200 bg-slate-50/80 grid grid-cols-1 sm:grid-cols-2 gap-2">
        <form onSubmit={handleSmilesSubmit} className="flex items-center gap-1.5">
          <label htmlFor="smiles-input" className="sr-only">
            Enter SMILES string
          </label>
          <input
            id="smiles-input"
            type="text"
            value={smilesInput}
            onChange={(e) => setSmilesInput(e.target.value)}
            placeholder="SMILES: e.g. CC(=O)O, c1ccccc1O..."
            className="flex-1 min-w-0 h-8 px-2.5 text-xs font-mono bg-white border border-slate-200 rounded-md text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-blue-500"
          />
          <button
            type="submit"
            className="h-8 px-2.5 rounded-md bg-slate-800 text-white text-xs font-medium hover:bg-slate-900 whitespace-nowrap shrink-0 cursor-pointer"
          >
            Load
          </button>
        </form>

        <form onSubmit={handleAiFormSubmit} className="flex items-center gap-1.5">
          <label htmlFor="ai-synth-input" className="sr-only">
            Synthesize or modify molecule with Gemini
          </label>
          <input
            id="ai-synth-input"
            type="text"
            value={aiPrompt}
            onChange={(e) => setAiPrompt(e.target.value)}
            placeholder="AI Build: e.g. 'ibuprofen', 'add -OH'..."
            className="flex-1 min-w-0 h-8 px-2.5 text-xs bg-white border border-slate-200 rounded-md text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-blue-500"
          />
          <button
            type="submit"
            disabled={isSynthesizing || !aiPrompt.trim()}
            className="h-8 px-2.5 rounded-md bg-blue-600 text-white text-xs font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>{isSynthesizing ? 'Building...' : 'AI Build'}</span>
          </button>
        </form>

        {smilesError && (
          <p className="sm:col-span-2 text-[11px] text-rose-600 font-medium">
            {smilesError}
          </p>
        )}
      </div>

      <PeriodicTableModal
        isOpen={isPeriodicTableOpen}
        activeElement={activeElement}
        onSelectElement={handleSelectElementFromPalette}
        onClose={() => setIsPeriodicTableOpen(false)}
      />
    </div>
  );
};
