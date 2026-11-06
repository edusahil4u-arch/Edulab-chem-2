import React, { useState } from 'react';
import {
  ArrowRight,
  Camera,
  CheckCircle2,
  Eye,
  ImagePlus,
  Loader2,
  Sparkles,
} from 'lucide-react';

interface VisionAnalysisResult {
  identifiedCompound: string;
  formula: string;
  extractedSmiles: string;
  structuralAnalysis: string;
  functionalGroups: string[];
  correctionsOrNotes: string[];
}

interface VisionLabViewProps {
  latestSnapshotUrl: string | null;
  onImportSmilesToWorkbench: (smiles: string, name?: string) => boolean;
}

export const VisionLabView: React.FC<VisionLabViewProps> = ({
  latestSnapshotUrl,
  onImportSmilesToWorkbench,
}) => {
  const [imageData, setImageData] = useState<string | null>(latestSnapshotUrl);
  const [question, setQuestion] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [result, setResult] = useState<VisionAnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importStatus, setImportStatus] = useState<string | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setImageData(reader.result);
        setResult(null);
        setError(null);
        setImportStatus(null);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleAnalyze = async () => {
    if (!imageData) return;
    setIsAnalyzing(true);
    setError(null);
    setImportStatus(null);
    try {
      const res = await fetch('/api/vision/analyze-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageData,
          question: question.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Vision analysis failed.');
      }
      setResult(data.analysis);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Unable to analyze chemistry image.'
      );
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleImport = () => {
    if (!result?.extractedSmiles) return;
    const ok = onImportSmilesToWorkbench(
      result.extractedSmiles,
      result.identifiedCompound
    );
    if (ok) {
      setImportStatus(
        `Imported ${result.identifiedCompound} (${result.extractedSmiles}) into 2D/3D workbench.`
      );
    } else {
      setError(
        `Extracted SMILES "${result.extractedSmiles}" could not be parsed automatically.`
      );
    }
  };

  return (
    <div className="max-w-6xl mx-auto w-full grid grid-cols-1 lg:grid-cols-12 gap-5">
      {/* Left: Image Upload & Question */}
      <section className="lg:col-span-5 bg-white border border-slate-200 rounded-xl shadow-xs p-5 flex flex-col gap-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Eye className="w-4 h-4 text-blue-600 shrink-0" />
            <h1 className="text-sm font-semibold text-slate-900">
              Chemistry Vision &amp; Sketch Reader
            </h1>
          </div>
          <span className="text-[11px] font-mono text-slate-500">
            gemini-4-argon
          </span>
        </div>

        <p className="text-xs text-slate-600 leading-relaxed">
          Upload a photograph of a hand-drawn Lewis/skeletal structure, textbook reaction diagram, or 3D molecular snapshot to verify valences and extract a live 3D model.
        </p>

        {/* Upload & 3D Snapshot Controls */}
        <div className="flex flex-wrap items-center gap-2">
          <label className="px-3 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-medium text-slate-800 flex items-center gap-1.5 cursor-pointer transition-colors">
            <ImagePlus className="w-3.5 h-3.5 text-blue-600" />
            <span>Upload Image File</span>
            <input
              type="file"
              accept="image/*"
              onChange={handleFileChange}
              className="hidden"
            />
          </label>

          {latestSnapshotUrl && (
            <button
              type="button"
              onClick={() => {
                setImageData(latestSnapshotUrl);
                setResult(null);
                setError(null);
              }}
              className="px-3 py-2 rounded-lg border border-slate-300 bg-slate-50 hover:bg-slate-100 text-xs font-medium text-slate-700 flex items-center gap-1.5 transition-colors"
            >
              <Camera className="w-3.5 h-3.5 text-slate-600" />
              <span>Use Latest 3D Snapshot</span>
            </button>
          )}
        </div>

        {/* Preview Stage */}
        <div className="border border-slate-200 rounded-lg bg-slate-50 min-h-[240px] flex items-center justify-center overflow-hidden p-2">
          {imageData ? (
            <img
              src={imageData}
              alt="Chemistry structure for vision analysis"
              className="max-h-[300px] w-auto object-contain rounded"
            />
          ) : (
            <div className="text-center p-6 space-y-1.5">
              <ImagePlus className="w-6 h-6 text-slate-400 mx-auto" />
              <div className="text-xs font-medium text-slate-600">
                No image selected
              </div>
              <div className="text-[11px] text-slate-400">
                Upload a PNG/JPG diagram or capture a snapshot from the 3D Spectrometer
              </div>
            </div>
          )}
        </div>

        <div>
          <label
            htmlFor="vision-question-input"
            className="block text-xs font-medium text-slate-700 mb-1"
          >
            Specific Analysis Question (Optional)
          </label>
          <input
            id="vision-question-input"
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="e.g., Check if any carbon atom in my sketch violates the octet rule"
            className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-blue-500"
          />
        </div>

        <button
          type="button"
          onClick={handleAnalyze}
          disabled={!imageData || isAnalyzing}
          className="w-full py-2.5 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
        >
          {isAnalyzing ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Sparkles className="w-4 h-4" />
          )}
          <span>
            {isAnalyzing ? 'Inspecting Structure...' : 'Analyze Chemistry Image'}
          </span>
        </button>

        {error && (
          <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-800 leading-relaxed">
            {error}
          </div>
        )}
      </section>

      {/* Right: Structured Vision Readout & 1-Click Workbench Import */}
      <section className="lg:col-span-7 bg-white border border-slate-200 rounded-xl shadow-xs p-5 flex flex-col gap-4">
        <div className="flex items-center justify-between border-b border-slate-200 pb-3">
          <h2 className="text-sm font-semibold text-slate-900">
            Extracted Chemical Intelligence
          </h2>
          {result?.formula && (
            <span className="font-mono text-xs font-semibold text-slate-800 tabular-nums">
              {result.formula}
            </span>
          )}
        </div>

        {!result && !isAnalyzing && (
          <div className="flex-1 flex flex-col items-center justify-center text-center py-12 px-6">
            <p className="text-xs font-medium text-slate-600">
              Upload a molecular diagram or 3D snapshot and run analysis to extract IUPAC identification, valence checks, and SMILES coordinates.
            </p>
          </div>
        )}

        {isAnalyzing && (
          <div className="flex-1 flex flex-col items-center justify-center py-12 gap-2.5 text-xs text-slate-600">
            <Loader2 className="w-5 h-5 animate-spin text-blue-600" />
            <span>Running deep multimodal chemistry inspection...</span>
          </div>
        )}

        {result && (
          <div className="space-y-4 text-xs text-slate-700">
            <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">
                  Identified Compound
                </div>
                <div className="text-base font-bold text-slate-900 mt-0.5">
                  {result.identifiedCompound}
                </div>
                <div className="font-mono text-[11px] text-slate-600 mt-1">
                  SMILES: {result.extractedSmiles || 'N/A'}
                </div>
              </div>

              {result.extractedSmiles && (
                <button
                  type="button"
                  onClick={handleImport}
                  className="px-3 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors"
                >
                  <span>Import to 2D/3D Workbench</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {importStatus && (
              <div className="p-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 flex items-center gap-1.5 font-medium">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>{importStatus}</span>
              </div>
            )}

            <div>
              <h3 className="font-semibold text-slate-900 mb-1">
                Structural &amp; Stereochemical Analysis
              </h3>
              <p className="leading-relaxed text-slate-600">
                {result.structuralAnalysis}
              </p>
            </div>

            {result.functionalGroups.length > 0 && (
              <div>
                <h3 className="font-semibold text-slate-900 mb-1">
                  Detected Functional Groups
                </h3>
                <p className="text-slate-700">
                  {result.functionalGroups.join(' · ')}
                </p>
              </div>
            )}

            {result.correctionsOrNotes.length > 0 && (
              <div>
                <h3 className="font-semibold text-slate-900 mb-1">
                  Valence &amp; Bonding Verification
                </h3>
                <ul className="space-y-1 text-slate-600">
                  {result.correctionsOrNotes.map((note, idx) => (
                    <li key={idx}>· {note}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
};
