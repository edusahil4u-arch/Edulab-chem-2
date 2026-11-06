import React, { useState } from 'react';
import { ArrowRight, Database, Loader2, Search } from 'lucide-react';

interface PubChemCompound {
  CID: number;
  IUPACName?: string;
  MolecularFormula?: string;
  MolecularWeight?: string | number;
  CanonicalSMILES?: string;
  ConnectivitySMILES?: string;
  IsomericSMILES?: string;
  XLogP?: number;
  TPSA?: number;
}

interface PubChemDrawerProps {
  onImportCompound: (smiles: string, name: string, iupac?: string) => boolean;
}

const SAMPLE_QUERIES = [
  'Paclitaxel',
  'Dopamine',
  'Penicillin G',
  'Vanillin',
  'Resveratrol',
  'Atorvastatin',
];

export const PubChemDrawer: React.FC<PubChemDrawerProps> = ({
  onImportCompound,
}) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PubChemCompound[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runSearch = async (searchTerm: string) => {
    const clean = searchTerm.trim();
    if (!clean) return;
    setQuery(clean);
    setIsSearching(true);
    setError(null);

    try {
      const res = await fetch(
        `/api/pubchem/search?q=${encodeURIComponent(clean)}`
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `No PubChem entry found for "${clean}".`);
      }
      setResults(data.results ?? []);
      if ((data.results ?? []).length === 0) {
        setError(`No chemical compounds matched "${clean}".`);
      }
    } catch (err) {
      setResults([]);
      setError(err instanceof Error ? err.message : 'PubChem search failed.');
    } finally {
      setIsSearching(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto w-full bg-white border border-slate-200 rounded-xl shadow-xs p-5 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3.5">
        <div className="flex items-center gap-2">
          <Database className="w-4 h-4 text-blue-600 shrink-0" />
          <div>
            <h1 className="text-sm font-semibold text-slate-900">
              PubChem Chemical Structure Lookup
            </h1>
            <p className="text-xs text-slate-500">
              Query verified experimental compounds from NIH PubChem and load directly into the 2D/3D workbench
            </p>
          </div>
        </div>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          runSearch(query);
        }}
        className="flex items-center gap-2.5"
      >
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by compound name (e.g., Dopamine, Oseltamivir, Cholesterol, Caffeine)..."
            className="w-full bg-white border border-slate-300 rounded-lg pl-9 pr-3 py-2 text-[13px] text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-blue-500"
          />
        </div>
        <button
          type="submit"
          disabled={isSearching || !query.trim()}
          className="px-4 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors disabled:opacity-50"
        >
          {isSearching ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Search className="w-3.5 h-3.5" />
          )}
          <span>Search PubChem</span>
        </button>
      </form>

      {/* Quick Compound Examples */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
          Reference Queries
        </span>
        {SAMPLE_QUERIES.map((sample) => (
          <button
            key={sample}
            type="button"
            onClick={() => runSearch(sample)}
            className="px-2.5 py-1 rounded-md border border-slate-200 bg-slate-50 hover:bg-blue-50 hover:border-blue-200 hover:text-blue-700 text-xs font-medium text-slate-700 transition-colors"
          >
            {sample}
          </button>
        ))}
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-800">
          {error}
        </div>
      )}

      {results.length > 0 && (
        <div className="divide-y divide-slate-200 border border-slate-200 rounded-lg overflow-hidden">
          {results.map((item) => {
            const smiles =
              item.CanonicalSMILES ||
              item.ConnectivitySMILES ||
              item.IsomericSMILES ||
              '';
            return (
              <div
                key={item.CID}
                className="p-4 bg-white hover:bg-slate-50/70 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-slate-900">
                      {query || `CID ${item.CID}`}
                    </span>
                    <span className="font-mono text-xs text-slate-600 tabular-nums">
                      CID {item.CID} · {item.MolecularFormula || '—'} ·{' '}
                      {item.MolecularWeight ? `${item.MolecularWeight} g/mol` : '—'}
                    </span>
                  </div>
                  {item.IUPACName && (
                    <div className="text-xs text-slate-600 break-words">
                      IUPAC: {item.IUPACName}
                    </div>
                  )}
                  {smiles && (
                    <div className="font-mono text-[11px] text-slate-500 break-all">
                      SMILES: {smiles}
                    </div>
                  )}
                </div>

                {smiles && (
                  <button
                    type="button"
                    onClick={() =>
                      onImportCompound(
                        smiles,
                        query || `PubChem ${item.CID}`,
                        item.IUPACName
                      )
                    }
                    className="px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors shrink-0 self-start sm:self-center"
                  >
                    <span>Open in 2D/3D Lab</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
