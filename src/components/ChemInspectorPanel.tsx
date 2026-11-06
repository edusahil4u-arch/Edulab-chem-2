import React, { useState } from 'react';
import {
  AlertTriangle,
  Atom,
  BookOpen,
  CheckCircle2,
  FlaskConical,
  Loader2,
  Sparkles,
  Zap,
} from 'lucide-react';
import { ELEMENTS } from '../chem/elements';
import type { MoleculeGraph, MoleculeMetrics } from '../chem/types';

export interface DeepStructureAnalysis {
  iupacName: string;
  commonName: string;
  stabilityVerdict: string;
  vseprAndConformation: string;
  electronicAndResonance: string;
  functionalGroups: string[];
  predictedSpectroscopy: string[];
  optimizationSuggestions: string[];
}

interface ChemInspectorPanelProps {
  molecule: MoleculeGraph;
  metrics: MoleculeMetrics;
  selectedAtomId: string | null;
  analysis: DeepStructureAnalysis | null;
  isAnalyzing: boolean;
  analysisError: string | null;
  onRunDeepAnalysis: () => Promise<void>;
  onSelectAtom: (atomId: string | null) => void;
}

export const ChemInspectorPanel: React.FC<ChemInspectorPanelProps> = ({
  molecule,
  metrics,
  selectedAtomId,
  analysis,
  isAnalyzing,
  analysisError,
  onRunDeepAnalysis,
  onSelectAtom,
}) => {
  const [quickHint, setQuickHint] = useState<{
    atomId: string;
    text: string;
    model: string;
  } | null>(null);
  const [isLoadingHint, setIsLoadingHint] = useState(false);
  const [hintError, setHintError] = useState<string | null>(null);

  const selectedAtom = selectedAtomId
    ? molecule.atoms.find((a) => a.id === selectedAtomId) ?? null
    : null;
  const selectedAnalysis = selectedAtomId
    ? metrics.atomAnalyses[selectedAtomId] ?? null
    : null;

  const handleFetchQuickHint = async () => {
    if (!selectedAtom || !selectedAnalysis) return;
    setIsLoadingHint(true);
    setHintError(null);
    try {
      const res = await fetch('/api/chem/quick-hint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          element: selectedAtom.element,
          hybridization: selectedAnalysis.hybridization,
          vseprGeometry: selectedAnalysis.vseprGeometry,
          moleculeName: molecule.name,
          smiles: metrics.canonicalSmiles,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Could not retrieve orbital hint.');
      }
      setQuickHint({
        atomId: selectedAtom.id,
        text: data.hint,
        model: data.model,
      });
    } catch (err) {
      setHintError(
        err instanceof Error ? err.message : 'Failed to load orbital hint.'
      );
    } finally {
      setIsLoadingHint(false);
    }
  };

  return (
    <aside className="flex flex-col bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between gap-2 bg-slate-50/70">
        <div className="flex items-center gap-2 min-w-0">
          <FlaskConical className="w-4 h-4 text-blue-600 shrink-0" />
          <h2 className="text-[13px] font-semibold text-slate-900 truncate">
            VSEPR &amp; Properties
          </h2>
        </div>
        <span className="text-[11px] font-mono text-slate-500 tabular-nums shrink-0">
          {metrics.heavyAtomCount} heavy · {metrics.totalAtomCountWithH} atoms
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        {/* Valence Status Banner */}
        {!metrics.valenceValid ? (
          <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-900">
            <div className="flex items-center gap-1.5 text-xs font-semibold">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
              <span>Valence Exception Detected</span>
            </div>
            <ul className="mt-1.5 space-y-1 text-xs text-amber-800">
              {metrics.valenceWarnings.map((w, idx) => (
                <li key={idx}>· {w}</li>
              ))}
            </ul>
          </div>
        ) : molecule.atoms.length > 0 ? (
          <div className="flex items-center justify-between text-xs text-emerald-700 bg-emerald-50/70 border border-emerald-200/80 rounded-lg px-3 py-2">
            <span className="flex items-center gap-1.5 font-medium">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
              All atomic valences satisfied
            </span>
            <span className="font-mono text-[11px] text-emerald-800 tabular-nums">
              Charge {metrics.formalCharge >= 0 ? `+${metrics.formalCharge}` : metrics.formalCharge}
            </span>
          </div>
        ) : null}

        {/* Selected Atom VSEPR Inspector */}
        {selectedAtom && selectedAnalysis && (
          <section className="p-3.5 rounded-lg border border-blue-200 bg-blue-50/40 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Atom className="w-4 h-4 text-blue-600 shrink-0" />
                <h3 className="text-xs font-semibold text-slate-900">
                  Selected Atom: {ELEMENTS[selectedAtom.element].name} ({selectedAtom.element})
                </h3>
              </div>
              <button
                type="button"
                onClick={() => onSelectAtom(null)}
                className="text-[11px] font-medium text-slate-500 hover:text-slate-800"
              >
                Clear
              </button>
            </div>

            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs pt-1 border-t border-blue-200/70">
              <div className="flex justify-between">
                <span className="text-slate-500">Hybridization</span>
                <span className="font-mono font-semibold text-slate-900">
                  {selectedAnalysis.hybridization}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Steric No.</span>
                <span className="font-mono font-semibold text-slate-900 tabular-nums">
                  {selectedAnalysis.stericNumber}
                </span>
              </div>
              <div className="col-span-2 flex justify-between">
                <span className="text-slate-500">VSEPR Geometry</span>
                <span className="font-mono font-medium text-slate-900">
                  {selectedAnalysis.vseprGeometry}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Lone Pairs</span>
                <span className="font-mono text-slate-800 tabular-nums">
                  {selectedAnalysis.lonePairs}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Implicit H</span>
                <span className="font-mono text-slate-800 tabular-nums">
                  {selectedAnalysis.implicitHydrogens}
                </span>
              </div>
              <div className="col-span-2 flex justify-between">
                <span className="text-slate-500">3D Position (Å)</span>
                <span className="font-mono text-[11px] text-slate-700 tabular-nums">
                  ({selectedAtom.x3d.toFixed(2)}, {selectedAtom.y3d.toFixed(2)}, {selectedAtom.z3d.toFixed(2)})
                </span>
              </div>
            </div>

            <div className="pt-1">
              <button
                type="button"
                onClick={handleFetchQuickHint}
                disabled={isLoadingHint}
                className="w-full py-1.5 px-2.5 rounded-md border border-blue-300 bg-white hover:bg-blue-50 text-blue-700 text-xs font-medium flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50"
              >
                {isLoadingHint ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Zap className="w-3.5 h-3.5" />
                )}
                <span>Explain Atom Orbital Role</span>
              </button>
            </div>

            {hintError && (
              <p className="text-[11px] text-rose-700 leading-relaxed">{hintError}</p>
            )}

            {quickHint && quickHint.atomId === selectedAtom.id && (
              <div className="text-xs text-slate-700 bg-white border border-blue-100 rounded-md p-2.5 leading-relaxed">
                <p>{quickHint.text}</p>
              </div>
            )}
          </section>
        )}

        {/* Quantitative Metrics Grid */}
        <section className="space-y-2.5">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            Molecular Descriptors
          </h3>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200/80">
              <div className="text-[11px] text-slate-500">Formula</div>
              <div className="font-mono font-semibold text-slate-900 mt-0.5 tabular-nums">
                {metrics.formula}
              </div>
            </div>
            <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200/80">
              <div className="text-[11px] text-slate-500">Molar Mass</div>
              <div className="font-mono font-semibold text-slate-900 mt-0.5 tabular-nums">
                {metrics.molecularWeight.toFixed(2)} g/mol
              </div>
            </div>
            <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200/80">
              <div className="text-[11px] text-slate-500">Estimated LogP</div>
              <div className="font-mono font-semibold text-slate-900 mt-0.5 tabular-nums">
                {metrics.estimatedLogP.toFixed(2)}
              </div>
            </div>
            <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200/80">
              <div className="text-[11px] text-slate-500">Polar Surface (TPSA)</div>
              <div className="font-mono font-semibold text-slate-900 mt-0.5 tabular-nums">
                {metrics.tpsa.toFixed(1)} Å²
              </div>
            </div>
          </div>

          {/* Unboxed typographic summary rows */}
          <div className="divide-y divide-slate-100 text-xs border-t border-b border-slate-200/80">
            <div className="py-2 flex items-center justify-between">
              <span className="text-slate-500">Carbon Hybridization</span>
              <span className="font-mono text-slate-900 tabular-nums">
                sp³: {metrics.hybridizationCounts.sp3} · sp²: {metrics.hybridizationCounts.sp2} · sp: {metrics.hybridizationCounts.sp}
              </span>
            </div>
            <div className="py-2 flex items-center justify-between">
              <span className="text-slate-500">H-Bond Donors / Acceptors</span>
              <span className="font-mono text-slate-900 tabular-nums">
                {metrics.hbdCount} HBD · {metrics.hbaCount} HBA
              </span>
            </div>
            <div className="py-2 flex items-center justify-between">
              <span className="text-slate-500">Topology &amp; Flexibility</span>
              <span className="font-mono text-slate-900 tabular-nums">
                {metrics.ringCount} rings · {metrics.rotatableBonds} rotatable
              </span>
            </div>
            <div className="py-2 flex items-center justify-between">
              <span className="text-slate-500">Lipinski Rule of 5</span>
              <span
                className={`font-mono font-semibold tabular-nums ${
                  metrics.lipinskiPass ? 'text-emerald-700' : 'text-amber-700'
                }`}
              >
                {metrics.lipinskiPass
                  ? 'Pass (0 violations)'
                  : `${metrics.lipinskiViolations} violation(s)`}
              </span>
            </div>
          </div>

          <div className="pt-0.5">
            <div className="text-[11px] text-slate-500 mb-1">Canonical SMILES</div>
            <div className="font-mono text-[11px] text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-2.5 py-1.5 break-all select-all">
              {metrics.canonicalSmiles || '—'}
            </div>
          </div>
        </section>

        {/* Deep Theoretical Evaluation */}
        <section className="pt-2 border-t border-slate-200 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <BookOpen className="w-3.5 h-3.5 text-blue-600 shrink-0" />
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-600">
                Theoretical Structure Evaluation
              </h3>
            </div>
          </div>

          <button
            type="button"
            onClick={onRunDeepAnalysis}
            disabled={isAnalyzing || molecule.atoms.length === 0}
            className="w-full py-2 px-3 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
          >
            {isAnalyzing ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Sparkles className="w-3.5 h-3.5" />
            )}
            <span>
              {isAnalyzing
                ? 'Evaluating Conformation & Orbitals...'
                : 'Analyze Structure & Strain'}
            </span>
          </button>

          {analysisError && (
            <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-800 leading-relaxed">
              {analysisError}
            </div>
          )}

          {analysis && (
            <div className="space-y-3 text-xs text-slate-700 pt-1">
              <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-1">
                <div className="font-semibold text-slate-900">
                  {analysis.commonName || molecule.name}
                </div>
                <div className="font-mono text-[11px] text-slate-600 break-words">
                  IUPAC: {analysis.iupacName}
                </div>
                <p className="text-slate-700 pt-1 leading-relaxed">
                  {analysis.stabilityVerdict}
                </p>
              </div>

              <div>
                <h4 className="font-semibold text-slate-900 mb-1">
                  3D VSEPR &amp; Conformational Strain
                </h4>
                <p className="leading-relaxed text-slate-600">
                  {analysis.vseprAndConformation}
                </p>
              </div>

              <div>
                <h4 className="font-semibold text-slate-900 mb-1">
                  Electronic &amp; Resonance Effects
                </h4>
                <p className="leading-relaxed text-slate-600">
                  {analysis.electronicAndResonance}
                </p>
              </div>

              {analysis.functionalGroups.length > 0 && (
                <div>
                  <h4 className="font-semibold text-slate-900 mb-1">
                    Identified Functional Groups
                  </h4>
                  <p className="text-slate-700 leading-relaxed">
                    {analysis.functionalGroups.join(' · ')}
                  </p>
                </div>
              )}

              {analysis.predictedSpectroscopy.length > 0 && (
                <div>
                  <h4 className="font-semibold text-slate-900 mb-1">
                    Diagnostic IR / NMR Bands
                  </h4>
                  <ul className="space-y-1 text-slate-600">
                    {analysis.predictedSpectroscopy.map((band, i) => (
                      <li key={i}>· {band}</li>
                    ))}
                  </ul>
                </div>
              )}

              {analysis.optimizationSuggestions.length > 0 && (
                <div>
                  <h4 className="font-semibold text-slate-900 mb-1">
                    Structural Optimization Notes
                  </h4>
                  <ul className="space-y-1 text-slate-600">
                    {analysis.optimizationSuggestions.map((note, i) => (
                      <li key={i}>· {note}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </aside>
  );
};
