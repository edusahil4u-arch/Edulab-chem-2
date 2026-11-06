import React, { useEffect, useRef, useState } from 'react';
import {
  Camera,
  ChevronDown,
  ChevronUp,
  Eye,
  Moon,
  Orbit,
  RotateCcw,
  Sun,
} from 'lucide-react';
import {
  MolecularStage,
  type CameraPreset,
  type MotionMode,
  type RepresentationMode,
  type StageTheme,
} from '../scene/MolecularStage';
import type { MoleculeGraph, MoleculeMetrics } from '../chem/types';

interface Viewport3DProps {
  molecule: MoleculeGraph;
  metrics: MoleculeMetrics;
  selectedAtomId: string | null;
  hoveredAtomId: string | null;
  show3DHydrogens: boolean;
  onToggle3DHydrogens: () => void;
  onSelectAtom: (atomId: string | null) => void;
  onHoverAtom: (atomId: string | null) => void;
  onCaptureSnapshot: (dataUrl: string) => void;
}

export const Viewport3D: React.FC<Viewport3DProps> = ({
  molecule,
  metrics,
  selectedAtomId,
  hoveredAtomId,
  show3DHydrogens,
  onToggle3DHydrogens,
  onSelectAtom,
  onHoverAtom,
  onCaptureSnapshot,
}) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<MolecularStage | null>(null);

  // Store latest callbacks in refs so WebGL stage never unmounts on React re-renders
  const onSelectRef = useRef(onSelectAtom);
  const onHoverRef = useRef(onHoverAtom);
  onSelectRef.current = onSelectAtom;
  onHoverRef.current = onHoverAtom;

  const [representation, setRepresentation] =
    useState<RepresentationMode>('ball_stick');
  const [explodedFactor, setExplodedFactor] = useState<number>(1.0);
  const [motionMode, setMotionMode] = useState<MotionMode>('static');
  const [showOrbitals, setShowOrbitals] = useState<boolean>(false);
  const [showElectronShell, setShowElectronShell] = useState<boolean>(false);
  const [stageTheme, setStageTheme] = useState<StageTheme>('light');
  const [dockCollapsed, setDockCollapsed] = useState<boolean>(false);
  const [captureNotice, setCaptureNotice] = useState<string | null>(null);

  // Mount Three.js WebGLRenderer once in dedicated empty div
  useEffect(() => {
    const el = mountRef.current;
    if (!el) return;

    const stage = new MolecularStage(el, {
      onSelectAtom: (id) => onSelectRef.current(id),
      onHoverAtom: (id) => onHoverRef.current(id),
    });
    stageRef.current = stage;

    return () => {
      stage.dispose();
      stageRef.current = null;
    };
  }, []);

  // Keyboard shortcut 'H' to toggle Zen / Cinema dock collapse
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.key === 'h' || e.key === 'H') {
        setDockCollapsed((prev) => !prev);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Sync molecule & metrics to Three.js stage
  useEffect(() => {
    stageRef.current?.setMolecule(molecule, metrics);
  }, [molecule, metrics]);

  // Sync visual options to Three.js stage
  useEffect(() => {
    stageRef.current?.setOptions({
      representation,
      explodedFactor,
      motionMode,
      showOrbitals,
      showElectronShell,
      stageTheme,
      selectedAtomId,
      hoveredAtomId,
    });
  }, [
    representation,
    explodedFactor,
    motionMode,
    showOrbitals,
    showElectronShell,
    stageTheme,
    selectedAtomId,
    hoveredAtomId,
  ]);

  const handleCameraPreset = (preset: CameraPreset) => {
    stageRef.current?.setCameraPreset(preset);
  };

  const handleCapture = () => {
    if (!stageRef.current) return;
    const dataUrl = stageRef.current.captureSnapshotDataUrl();
    onCaptureSnapshot(dataUrl);
    setCaptureNotice('3D Snapshot saved to Vision & Video Studio');
    window.setTimeout(() => setCaptureNotice(null), 2600);
  };

  const isDark = stageTheme === 'dark';

  return (
    <div
      className={`relative w-full h-full overflow-hidden rounded-xl border shadow-xs ${
        isDark
          ? 'bg-[#0B1120] border-slate-800'
          : 'bg-[#EEF3F8] border-slate-200'
      }`}
    >
      {/* Dedicated Isolated WebGL Container (no sibling nodes inside) */}
      <div ref={mountRef} className="w-full h-full" />

      {/* Top-Left Minimal Title & Formula Badge (clean unboxed typography) */}
      <div
        className={`absolute top-3 left-4 pointer-events-none select-none ${
          isDark ? 'text-slate-100' : 'text-slate-900'
        }`}
      >
        <div className="text-sm font-semibold tracking-tight">
          {molecule.name || 'Theoretical Structure'}
        </div>
        <div
          className={`text-xs font-mono tabular-nums flex items-center gap-2 ${
            isDark ? 'text-slate-300' : 'text-slate-600'
          }`}
        >
          <span>{metrics.formula}</span>
          <span aria-hidden="true">·</span>
          <span>{metrics.molecularWeight.toFixed(2)} g/mol</span>
          <span aria-hidden="true">·</span>
          <span>{metrics.totalAtomCountWithH} atoms</span>
        </div>
      </div>

      {/* Top-Right Capture Snapshot Action */}
      <div className="absolute top-3 right-4 flex items-center gap-2">
        {captureNotice && (
          <span className="text-xs font-medium px-2.5 py-1 rounded-md bg-emerald-600 text-white shadow-xs">
            {captureNotice}
          </span>
        )}
        <button
          type="button"
          onClick={handleCapture}
          aria-label="Capture 3D viewport snapshot"
          className={`h-8 px-3 rounded-lg text-xs font-medium flex items-center gap-1.5 border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
            isDark
              ? 'bg-slate-900/95 text-slate-100 border-slate-700 hover:bg-slate-800'
              : 'bg-white/95 text-slate-800 border-slate-200 hover:bg-slate-50 shadow-xs'
          }`}
        >
          <Camera className="w-3.5 h-3.5 text-blue-600" />
          <span>Capture 3D</span>
        </button>
      </div>

      {/* Collapsible Bottom Control Dock (Zero backdrop-filter over WebGL!) */}
      <div
        className="absolute left-2 right-2 bottom-2.5 z-10 flex flex-col items-center pointer-events-none transition-transform duration-200 ease-out"
        style={{
          transform: dockCollapsed
            ? 'translateY(calc(100% - 26px))'
            : 'translateY(0)',
        }}
      >
        {/* Collapse / Expand Toggle Handle */}
        <button
          type="button"
          onClick={() => setDockCollapsed((c) => !c)}
          aria-expanded={!dockCollapsed}
          aria-label={dockCollapsed ? 'Show 3D Controls' : 'Hide 3D Controls'}
          className={`h-6 px-2.5 rounded-t-lg border border-b-0 text-[10.5px] font-medium flex items-center gap-1 cursor-pointer pointer-events-auto ${
            isDark
              ? 'bg-slate-900/95 text-slate-300 border-slate-700 hover:text-white'
              : 'bg-white/95 text-slate-600 border-slate-200 hover:text-slate-900'
          }`}
        >
          {dockCollapsed ? (
            <>
              <ChevronUp className="w-3 h-3" />
              <span>Show Controls</span>
            </>
          ) : (
            <>
              <ChevronDown className="w-3 h-3" />
              <span>Hide Controls</span>
            </>
          )}
        </button>

        {/* Solid/RGBA 2-Row Compact Control Bar (No backdrop-blur over WebGL) */}
        <div
          className={`px-2.5 py-1.5 rounded-xl border shadow-sm flex flex-col items-center gap-1.5 pointer-events-auto max-w-full ${
            isDark
              ? 'bg-slate-900/96 border-slate-700 text-slate-100'
              : 'bg-white/96 border-slate-200 text-slate-800'
          }`}
        >
          {/* Row 1: Representation Modes & Quantum Overlays */}
          <div className="flex flex-wrap items-center justify-center gap-1.5">
            <div
              className={`flex items-center p-0.5 rounded-md ${
                isDark ? 'bg-slate-800' : 'bg-slate-100'
              }`}
            >
              {(
                [
                  { id: 'ball_stick', label: 'Ball & Stick' },
                  { id: 'space_filling', label: 'Space-Fill' },
                  { id: 'wireframe', label: 'Wire' },
                ] as const
              ).map((item) => {
                const active = representation === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setRepresentation(item.id)}
                    className={`h-6 px-2 rounded text-[11px] font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      active
                        ? isDark
                          ? 'bg-blue-600 text-white'
                          : 'bg-white text-slate-900 shadow-2xs'
                        : isDark
                        ? 'text-slate-300 hover:text-white'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={onToggle3DHydrogens}
                aria-pressed={show3DHydrogens}
                title="Toggle explicit 3D hydrogens on spectrometer"
                className={`h-6 px-2 rounded text-[11px] font-medium border whitespace-nowrap shrink-0 cursor-pointer ${
                  show3DHydrogens
                    ? 'bg-blue-600 text-white border-blue-600'
                    : isDark
                    ? 'border-slate-700 text-slate-300 hover:bg-slate-800'
                    : 'border-slate-200 text-slate-700 hover:bg-slate-50'
                }`}
              >
                3D H
              </button>
              <button
                type="button"
                onClick={() => setShowOrbitals((v) => !v)}
                aria-pressed={showOrbitals}
                className={`h-6 px-2 rounded text-[11px] font-medium border flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer ${
                  showOrbitals
                    ? 'bg-blue-600 text-white border-blue-600'
                    : isDark
                    ? 'border-slate-700 text-slate-300 hover:bg-slate-800'
                    : 'border-slate-200 text-slate-700 hover:bg-slate-50'
                }`}
              >
                <Orbit className="w-3 h-3" />
                <span>Lone Pairs</span>
              </button>
              <button
                type="button"
                onClick={() => setShowElectronShell((v) => !v)}
                aria-pressed={showElectronShell}
                className={`h-6 px-2 rounded text-[11px] font-medium border flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer ${
                  showElectronShell
                    ? 'bg-blue-600 text-white border-blue-600'
                    : isDark
                    ? 'border-slate-700 text-slate-300 hover:bg-slate-800'
                    : 'border-slate-200 text-slate-700 hover:bg-slate-50'
                }`}
              >
                <Eye className="w-3 h-3" />
                <span>VDW</span>
              </button>
            </div>
          </div>

          {/* Row 2: Bond Stretch, Motion Mode & Camera Presets */}
          <div className="flex flex-wrap items-center justify-center gap-1.5">
            <div className="flex items-center gap-1">
              <label
                htmlFor="exploded-bond-slider"
                className={`text-[10.5px] font-medium whitespace-nowrap ${
                  isDark ? 'text-slate-300' : 'text-slate-600'
                }`}
              >
                Stretch
              </label>
              <input
                id="exploded-bond-slider"
                type="range"
                min="1.0"
                max="1.75"
                step="0.05"
                value={explodedFactor}
                onChange={(e) => setExplodedFactor(parseFloat(e.target.value))}
                className="w-12 accent-blue-600 cursor-pointer"
              />
              <span className="text-[10.5px] font-mono tabular-nums w-7">
                {explodedFactor.toFixed(1)}x
              </span>
            </div>

            <div
              className={`flex items-center p-0.5 rounded-md ${
                isDark ? 'bg-slate-800' : 'bg-slate-100'
              }`}
            >
              {(
                [
                  { id: 'static', label: 'Static' },
                  { id: 'spin', label: 'Spin' },
                  { id: 'vibrate', label: 'Vibrate' },
                ] as const
              ).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setMotionMode(m.id)}
                  className={`h-6 px-1.5 rounded text-[11px] font-medium whitespace-nowrap shrink-0 cursor-pointer ${
                    motionMode === m.id
                      ? isDark
                        ? 'bg-blue-600 text-white'
                        : 'bg-white text-slate-900 shadow-2xs'
                      : isDark
                      ? 'text-slate-300 hover:text-white'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1">
              {(
                [
                  { id: 'iso', label: 'Iso' },
                  { id: 'top', label: 'Top' },
                  { id: 'front', label: 'Front' },
                ] as const
              ).map((cam) => (
                <button
                  key={cam.id}
                  type="button"
                  onClick={() => handleCameraPreset(cam.id)}
                  className={`h-6 px-1.5 rounded text-[11px] font-medium border whitespace-nowrap shrink-0 cursor-pointer ${
                    isDark
                      ? 'border-slate-700 text-slate-300 hover:bg-slate-800'
                      : 'border-slate-200 text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {cam.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => handleCameraPreset('reset')}
                aria-label="Reset camera view"
                className={`h-6 w-6 rounded border flex items-center justify-center cursor-pointer ${
                  isDark
                    ? 'border-slate-700 text-slate-300 hover:bg-slate-800'
                    : 'border-slate-200 text-slate-700 hover:bg-slate-50'
                }`}
              >
                <RotateCcw className="w-3 h-3" />
              </button>
              <button
                type="button"
                onClick={() =>
                  setStageTheme((t) => (t === 'light' ? 'dark' : 'light'))
                }
                aria-label="Toggle Light Lab or Dark Optical Chamber backdrop"
                className={`h-6 w-6 rounded border flex items-center justify-center cursor-pointer ${
                  isDark
                    ? 'border-slate-700 text-amber-300 hover:bg-slate-800'
                    : 'border-slate-200 text-slate-700 hover:bg-slate-50'
                }`}
              >
                {isDark ? (
                  <Sun className="w-3 h-3" />
                ) : (
                  <Moon className="w-3 h-3" />
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
