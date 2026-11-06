import React, { useCallback, useMemo, useState } from 'react';
import { Atom, Sparkles } from 'lucide-react';
import {
  clean2DLayout,
  collapseHydrogens,
  computeMoleculeMetrics,
  expandHydrogens,
  generate3DCoordinates,
  parseSmilesToMolecule,
} from './chem/chemistry';
import { buildPresetMolecule, PRESET_MOLECULES } from './chem/presets';
import type { MoleculeGraph } from './chem/types';
import {
  ChemInspectorPanel,
  type DeepStructureAnalysis,
} from './components/ChemInspectorPanel';
import { MediaStudioView } from './components/MediaStudioView';
import { MoleculeSketcher2D } from './components/MoleculeSketcher2D';
import { PubChemDrawer } from './components/PubChemDrawer';
import { TutorChatView } from './components/TutorChatView';
import { Viewport3D } from './components/Viewport3D';
import { VisionLabView } from './components/VisionLabView';

type ActiveView = 'workbench' | 'tutor' | 'vision' | 'media' | 'pubchem';

export default function App() {
  const [activeView, setActiveView] = useState<ActiveView>('workbench');
  // ChemDraw / MolDraw 2D sheet defaults to clean Skeletal representation; 3D spectrometer shows all H by default
  const [hasExplicitHydrogens, setHasExplicitHydrogens] =
    useState<boolean>(false);
  const [show3DHydrogens, setShow3DHydrogens] = useState<boolean>(true);

  const [molecule, setMolecule] = useState<MoleculeGraph>(() =>
    buildPresetMolecule('aspirin', false)
  );
  const [undoStack, setUndoStack] = useState<MoleculeGraph[]>([]);
  const [redoStack, setRedoStack] = useState<MoleculeGraph[]>([]);

  const [selectedAtomId, setSelectedAtomId] = useState<string | null>(null);
  const [hoveredAtomId, setHoveredAtomId] = useState<string | null>(null);

  // Gemini AI States
  const [isSynthesizing, setIsSynthesizing] = useState<boolean>(false);
  const [synthesizeError, setSynthesizeError] = useState<string | null>(null);

  const [deepAnalysis, setDeepAnalysis] =
    useState<DeepStructureAnalysis | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  // Snapshot shared across Vision Lab & Media Studio
  const [latestSnapshotUrl, setLatestSnapshotUrl] = useState<string | null>(
    null
  );
  const [snapshotBanner, setSnapshotBanner] = useState<boolean>(false);

  const metrics = useMemo(() => computeMoleculeMetrics(molecule), [molecule]);

  // 3D Stage receives full-atom 3D VSEPR coordinates when show3DHydrogens is enabled
  const moleculeFor3D = useMemo(() => {
    if (molecule.atoms.length === 0) return molecule;
    if (show3DHydrogens && !hasExplicitHydrogens) {
      return expandHydrogens(molecule);
    }
    return molecule;
  }, [molecule, show3DHydrogens, hasExplicitHydrogens]);

  const metricsFor3D = useMemo(
    () =>
      moleculeFor3D === molecule
        ? metrics
        : computeMoleculeMetrics(moleculeFor3D),
    [moleculeFor3D, molecule, metrics]
  );

  const commitMolecule = useCallback(
    (nextMol: MoleculeGraph, recordHistory = true) => {
      const with3d = recordHistory ? generate3DCoordinates(nextMol) : nextMol;
      if (recordHistory) {
        setUndoStack((prev) => [...prev.slice(-24), molecule]);
        setRedoStack([]);
        setDeepAnalysis(null);
        setAnalysisError(null);
      }
      setMolecule(with3d);
      setSynthesizeError(null);
    },
    [molecule]
  );

  const handleSelectPreset = (presetId: string) => {
    const next = buildPresetMolecule(presetId, hasExplicitHydrogens);
    setUndoStack((prev) => [...prev.slice(-24), molecule]);
    setRedoStack([]);
    setSelectedAtomId(null);
    setDeepAnalysis(null);
    setAnalysisError(null);
    setSynthesizeError(null);
    setMolecule(next);
  };

  const handleUndo = () => {
    if (undoStack.length === 0) return;
    const previous = undoStack[undoStack.length - 1];
    setRedoStack((prev) => [...prev, molecule]);
    setUndoStack((prev) => prev.slice(0, -1));
    setMolecule(previous);
    setSelectedAtomId(null);
  };

  const handleRedo = () => {
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    setUndoStack((prev) => [...prev, molecule]);
    setRedoStack((prev) => prev.slice(0, -1));
    setMolecule(next);
    setSelectedAtomId(null);
  };

  const handleToggleHydrogens = () => {
    const nextShowH = !hasExplicitHydrogens;
    setHasExplicitHydrogens(nextShowH);
    const transformed = nextShowH
      ? expandHydrogens(molecule)
      : collapseHydrogens(molecule);
    commitMolecule(transformed, true);
    setSelectedAtomId(null);
  };

  const handleClean2D = () => {
    const cleaned = clean2DLayout(molecule);
    commitMolecule(cleaned, true);
  };

  const handleOptimize3D = () => {
    const relaxed = generate3DCoordinates(molecule);
    commitMolecule(relaxed, true);
    setActiveView('workbench');
  };

  const handleClearCanvas = () => {
    commitMolecule(
      {
        id: `custom_${Date.now()}`,
        name: 'Untitled Molecule',
        atoms: [],
        bonds: [],
      },
      true
    );
    setSelectedAtomId(null);
  };

  const handleLoadSmiles = useCallback(
    (smiles: string, label?: string, iupac?: string): boolean => {
      try {
        const parsed = parseSmilesToMolecule(
          smiles,
          label || 'Custom Structure'
        );
        if (iupac) parsed.iupacName = iupac;
        const prepared = hasExplicitHydrogens ? expandHydrogens(parsed) : parsed;
        setUndoStack((prev) => [...prev.slice(-24), molecule]);
        setRedoStack([]);
        setMolecule(prepared);
        setSelectedAtomId(null);
        setDeepAnalysis(null);
        setAnalysisError(null);
        setSynthesizeError(null);
        setActiveView('workbench');
        return true;
      } catch {
        return false;
      }
    },
    [hasExplicitHydrogens, molecule]
  );

  const handleSynthesizePrompt = async (prompt: string) => {
    setIsSynthesizing(true);
    setSynthesizeError(null);
    try {
      const res = await fetch('/api/chem/synthesize-molecule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          currentSmiles: metrics.canonicalSmiles || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Could not synthesize structure.');
      }
      const { name, iupacName, smiles } = data.result ?? {};
      if (!smiles) {
        throw new Error('Model returned an empty SMILES string.');
      }
      const ok = handleLoadSmiles(smiles, name || prompt, iupacName);
      if (!ok) {
        throw new Error(`Generated SMILES "${smiles}" could not be parsed.`);
      }
    } catch (err) {
      setSynthesizeError(
        err instanceof Error ? err.message : 'Structure synthesis failed.'
      );
    } finally {
      setIsSynthesizing(false);
    }
  };

  const handleRunDeepAnalysis = async () => {
    if (molecule.atoms.length === 0 || isAnalyzing) return;
    setIsAnalyzing(true);
    setAnalysisError(null);
    try {
      const res = await fetch('/api/chem/analyze-structure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: molecule.name,
          formula: metrics.formula,
          smiles: metrics.canonicalSmiles,
          molecularWeight: metrics.molecularWeight.toFixed(2),
          valenceWarnings: metrics.valenceWarnings,
          hybridizationCounts: metrics.hybridizationCounts,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Structure evaluation failed.');
      }
      setDeepAnalysis(data.analysis);
    } catch (err) {
      setAnalysisError(
        err instanceof Error ? err.message : 'Failed to analyze structure.'
      );
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleCaptureSnapshot = (dataUrl: string) => {
    setLatestSnapshotUrl(dataUrl);
    setSnapshotBanner(true);
  };

  const handleSelect3DAtom = (atomId: string | null) => {
    if (!atomId) {
      setSelectedAtomId(null);
      return;
    }
    // If user clicked an expanded 3D hydrogen (id starts with "h_"), map to its parent heavy atom when 2D is skeletal
    if (!hasExplicitHydrogens && atomId.startsWith('h_')) {
      const bond = moleculeFor3D.bonds.find(
        (b) => b.from === atomId || b.to === atomId
      );
      if (bond) {
        const parentId = bond.from === atomId ? bond.to : bond.from;
        setSelectedAtomId(parentId);
        return;
      }
    }
    setSelectedAtomId(atomId);
  };

  const navItems: Array<{ id: ActiveView; label: string }> = [
    { id: 'workbench', label: 'Workbench' },
    { id: 'tutor', label: 'AI Tutor' },
    { id: 'vision', label: 'Vision Lab' },
    { id: 'media', label: 'Media Studio' },
    { id: 'pubchem', label: 'PubChem' },
  ];

  return (
    <div
      className={`min-h-screen bg-[#F7F8FA] text-slate-900 flex flex-col ${
        activeView === 'workbench' ? 'xl:h-screen xl:overflow-hidden' : ''
      }`}
    >
      {/* Strict 3-Zone Top Bar */}
      <header className="bg-white border-b border-slate-200 px-3 sm:px-6 h-14 flex items-center justify-between gap-3 sm:gap-6 lg:gap-8 shrink-0">
        {/* Zone 1: Brand */}
        <div className="flex items-center gap-2 whitespace-nowrap shrink-0">
          <Atom className="w-5 h-5 text-blue-600 shrink-0" />
          <span className="text-[15px] font-bold tracking-tight text-slate-900">
            ValenceLab
          </span>
        </div>

        {/* Zone 2: Single-Line Navigation Links */}
        <nav
          aria-label="Primary Workspace Navigation"
          className="flex items-center gap-4 sm:gap-6 overflow-x-auto h-full"
        >
          {navItems.map((item) => {
            const isActive = activeView === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveView(item.id)}
                className={`h-full px-1 text-[13px] font-medium whitespace-nowrap shrink-0 border-b-2 transition-colors flex items-center ${
                  isActive
                    ? 'border-blue-600 text-blue-600 font-semibold'
                    : 'border-transparent text-slate-600 hover:text-slate-900'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </nav>

        {/* Zone 3: Single Primary Action */}
        <button
          type="button"
          onClick={handleOptimize3D}
          className="px-2.5 sm:px-3.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors"
          title="Relax 3D VSEPR bond angles and lengths"
        >
          <Sparkles className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Optimize 3D</span>
          <span className="sm:hidden">Fit 3D</span>
        </button>
      </header>

      {/* Main Content */}
      <main className="flex-1 p-3 sm:p-3.5 flex flex-col gap-2.5 max-w-[1680px] w-full mx-auto min-h-0">
        {activeView === 'workbench' && (
          <>
            {/* Molecule Preset Bar & Unboxed Physicochemical Metadata */}
            <div className="bg-white border border-slate-200 rounded-xl px-3.5 py-1.5 flex flex-col lg:flex-row lg:items-center justify-between gap-2 shrink-0">
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 lg:pb-0">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mr-1 shrink-0">
                  Molecules
                </span>
                {PRESET_MOLECULES.map((preset) => {
                  const isCurrent = molecule.id === preset.id;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => handleSelectPreset(preset.id)}
                      className={`px-2.5 py-1 rounded-md text-xs font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                        isCurrent
                          ? 'bg-blue-600 text-white'
                          : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                      }`}
                    >
                      {preset.name}
                    </button>
                  );
                })}
              </div>

              {/* Unboxed inline typographic metadata separated by middle dots */}
              <div className="text-xs text-slate-600 flex items-center flex-wrap gap-x-2 gap-y-1 shrink-0">
                <span className="font-semibold text-slate-900">
                  {molecule.name}
                </span>
                <span className="text-slate-300">·</span>
                <span className="font-mono text-slate-800 tabular-nums">
                  {metrics.formula}
                </span>
                <span className="text-slate-300">·</span>
                <span className="font-mono tabular-nums">
                  {metrics.molecularWeight.toFixed(2)} g/mol
                </span>
                <span className="text-slate-300">·</span>
                <span
                  className={`font-medium ${
                    metrics.valenceValid ? 'text-emerald-700' : 'text-amber-700'
                  }`}
                >
                  {metrics.valenceValid ? 'Valence Valid' : 'Valence Alert'}
                </span>
              </div>
            </div>

            {synthesizeError && (
              <div className="bg-rose-50 border border-rose-200 rounded-lg px-4 py-2 text-xs text-rose-800 flex items-center justify-between">
                <span>{synthesizeError}</span>
                <button
                  type="button"
                  onClick={() => setSynthesizeError(null)}
                  className="text-rose-600 hover:text-rose-900 font-medium ml-4"
                >
                  Dismiss
                </button>
              </div>
            )}

            {snapshotBanner && latestSnapshotUrl && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-2 text-xs text-blue-900 flex flex-wrap items-center justify-between gap-2">
                <span>
                  3D viewport frame captured. Send it to Vision Lab for structural verification or Media Studio to animate into video.
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setSnapshotBanner(false);
                      setActiveView('vision');
                    }}
                    className="px-2.5 py-1 rounded bg-white border border-blue-300 text-blue-700 font-medium hover:bg-blue-100"
                  >
                    Open Vision Lab
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSnapshotBanner(false);
                      setActiveView('media');
                    }}
                    className="px-2.5 py-1 rounded bg-blue-600 text-white font-medium hover:bg-blue-700"
                  >
                    Animate in Media Studio
                  </button>
                  <button
                    type="button"
                    onClick={() => setSnapshotBanner(false)}
                    className="text-blue-700 hover:text-blue-950 ml-1"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            )}

            {/* 3-Panel Interactive Workbench: ChemDraw 2D Editor | 3D Spectrometer | VSEPR Inspector */}
            <div className="grid grid-cols-1 xl:grid-cols-[minmax(480px,1.32fr)_minmax(430px,1.12fr)_minmax(310px,0.82fr)] gap-3 flex-1 xl:min-h-0">
              {/* 2D ChemDraw / MolDraw Structure Drawing Canvas */}
              <div className="min-h-[480px] xl:min-h-0 flex flex-col">
                <MoleculeSketcher2D
                  molecule={molecule}
                  metrics={metrics}
                  selectedAtomId={selectedAtomId}
                  hoveredAtomId={hoveredAtomId}
                  hasExplicitHydrogens={hasExplicitHydrogens}
                  canUndo={undoStack.length > 0}
                  canRedo={redoStack.length > 0}
                  onSelectAtom={setSelectedAtomId}
                  onHoverAtom={setHoveredAtomId}
                  onChangeMolecule={commitMolecule}
                  onToggleHydrogens={handleToggleHydrogens}
                  onClean2D={handleClean2D}
                  onUndo={handleUndo}
                  onRedo={handleRedo}
                  onClear={handleClearCanvas}
                  onSynthesizePrompt={handleSynthesizePrompt}
                  isSynthesizing={isSynthesizing}
                />
              </div>

              {/* 3D Interactive Spectrometer Viewport */}
              <div className="min-h-[460px] xl:min-h-0 flex flex-col">
                <Viewport3D
                  molecule={moleculeFor3D}
                  metrics={metricsFor3D}
                  selectedAtomId={selectedAtomId}
                  hoveredAtomId={hoveredAtomId}
                  show3DHydrogens={show3DHydrogens}
                  onToggle3DHydrogens={() => setShow3DHydrogens((v) => !v)}
                  onSelectAtom={handleSelect3DAtom}
                  onHoverAtom={setHoveredAtomId}
                  onCaptureSnapshot={handleCaptureSnapshot}
                />
              </div>

              {/* Quantitative Physicochemical & VSEPR Inspector */}
              <div className="min-h-[420px] xl:min-h-0 flex flex-col">
                <ChemInspectorPanel
                  molecule={molecule}
                  metrics={metrics}
                  selectedAtomId={selectedAtomId}
                  analysis={deepAnalysis}
                  isAnalyzing={isAnalyzing}
                  analysisError={analysisError}
                  onRunDeepAnalysis={handleRunDeepAnalysis}
                  onSelectAtom={setSelectedAtomId}
                />
              </div>
            </div>
          </>
        )}

        {activeView === 'tutor' && (
          <TutorChatView
            molecule={molecule}
            metrics={metrics}
            onLoadSmiles={handleLoadSmiles}
          />
        )}

        {activeView === 'vision' && (
          <VisionLabView
            latestSnapshotUrl={latestSnapshotUrl}
            onImportSmilesToWorkbench={handleLoadSmiles}
          />
        )}

        {activeView === 'media' && (
          <MediaStudioView
            molecule={molecule}
            metrics={metrics}
            latestSnapshotUrl={latestSnapshotUrl}
          />
        )}

        {activeView === 'pubchem' && (
          <PubChemDrawer onImportCompound={handleLoadSmiles} />
        )}
      </main>
    </div>
  );
}
