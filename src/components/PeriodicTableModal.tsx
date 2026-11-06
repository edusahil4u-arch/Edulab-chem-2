import React, { useMemo, useState } from 'react';
import { List, Search, Table2, X } from 'lucide-react';
import { ALL_PERIODIC_ELEMENTS, ELEMENTS } from '../chem/elements';
import type { ElementCategory, ElementSpec, ElementSymbol } from '../chem/types';

interface PeriodicTableModalProps {
  isOpen: boolean;
  activeElement: ElementSymbol;
  onSelectElement: (symbol: ElementSymbol) => void;
  onClose: () => void;
}

const CATEGORY_LABELS: Record<ElementCategory, string> = {
  'nonmetal': 'Nonmetal',
  'halogen': 'Halogen',
  'noble-gas': 'Noble Gas',
  'alkali-metal': 'Alkali Metal',
  'alkaline-earth': 'Alkaline Earth',
  'metalloid': 'Metalloid',
  'post-transition': 'Post-Transition',
  'transition-metal': 'Transition Metal',
  'lanthanide': 'Lanthanide',
  'actinide': 'Actinide',
};

const CATEGORY_CELL_STYLES: Record<ElementCategory, string> = {
  'nonmetal': 'bg-blue-50 border-blue-200 text-blue-950 hover:bg-blue-100',
  'halogen': 'bg-emerald-50 border-emerald-200 text-emerald-950 hover:bg-emerald-100',
  'noble-gas': 'bg-cyan-50 border-cyan-200 text-cyan-950 hover:bg-cyan-100',
  'alkali-metal': 'bg-purple-50 border-purple-200 text-purple-950 hover:bg-purple-100',
  'alkaline-earth': 'bg-lime-50 border-lime-200 text-lime-950 hover:bg-lime-100',
  'metalloid': 'bg-amber-50 border-amber-200 text-amber-950 hover:bg-amber-100',
  'post-transition': 'bg-slate-100 border-slate-300 text-slate-900 hover:bg-slate-200',
  'transition-metal': 'bg-orange-50/80 border-orange-200 text-orange-950 hover:bg-orange-100',
  'lanthanide': 'bg-teal-50 border-teal-200 text-teal-950 hover:bg-teal-100',
  'actinide': 'bg-rose-50 border-rose-200 text-rose-950 hover:bg-rose-100',
};

export const PeriodicTableModal: React.FC<PeriodicTableModalProps> = ({
  isOpen,
  activeElement,
  onSelectElement,
  onClose,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<ElementCategory | 'all'>('all');
  const [viewMode, setViewMode] = useState<'both' | 'list' | 'grid'>('both');
  const [hoveredSpec, setHoveredSpec] = useState<ElementSpec | null>(null);

  const filteredElements = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return ALL_PERIODIC_ELEMENTS.filter((el) => {
      if (selectedCategory !== 'all' && el.category !== selectedCategory) {
        return false;
      }
      if (!q) return true;
      return (
        el.name.toLowerCase().includes(q) ||
        el.symbol.toLowerCase().includes(q) ||
        String(el.atomicNumber) === q ||
        CATEGORY_LABELS[el.category].toLowerCase().includes(q)
      );
    });
  }, [searchQuery, selectedCategory]);

  const matchingSet = useMemo(
    () => new Set(filteredElements.map((e) => e.symbol)),
    [filteredElements]
  );

  // Main 18-column grid (periods 1..7, excluding f-block 57..70 and 89..102 which sit in lanthanide/actinide rows)
  const mainGridLookup = useMemo(() => {
    const map = new Map<string, ElementSpec>();
    for (const el of ALL_PERIODIC_ELEMENTS) {
      const isFBlock =
        (el.atomicNumber >= 57 && el.atomicNumber <= 70) ||
        (el.atomicNumber >= 89 && el.atomicNumber <= 102);
      if (!isFBlock) {
        map.set(`${el.period}-${el.group}`, el);
      }
    }
    return map;
  }, []);

  const lanthanides = useMemo(
    () => ALL_PERIODIC_ELEMENTS.filter((e) => e.atomicNumber >= 57 && e.atomicNumber <= 71),
    []
  );
  const actinides = useMemo(
    () => ALL_PERIODIC_ELEMENTS.filter((e) => e.atomicNumber >= 89 && e.atomicNumber <= 103),
    []
  );

  if (!isOpen) return null;

  const previewSpec = hoveredSpec ?? ELEMENTS[activeElement];

  const handlePick = (sym: ElementSymbol) => {
    onSelectElement(sym);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/45 flex items-center justify-center p-2 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Periodic Table Element Selector"
      data-testid="periodic-table-modal"
    >
      <div className="bg-white border border-slate-200 rounded-xl shadow-xl w-full max-w-6xl max-h-[88vh] flex flex-col overflow-hidden">
        {/* Modal Header */}
        <div className="px-4 py-2.5 border-b border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-2">
            <Table2 className="w-4 h-4 text-blue-600 shrink-0" />
            <h2 className="text-sm font-bold text-slate-900">
              IUPAC Periodic Table &amp; Element List (118 Elements)
            </h2>
          </div>

          <div className="flex items-center gap-1.5">
            <div className="flex items-center bg-slate-200/70 p-0.5 rounded-lg text-[11px] font-medium">
              <button
                type="button"
                onClick={() => setViewMode('both')}
                className={`px-2 py-1 rounded-md cursor-pointer transition-colors ${
                  viewMode === 'both'
                    ? 'bg-white text-slate-900 shadow-2xs font-semibold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Table + List
              </button>
              <button
                type="button"
                onClick={() => setViewMode('grid')}
                className={`px-2 py-1 rounded-md flex items-center gap-1 cursor-pointer transition-colors ${
                  viewMode === 'grid'
                    ? 'bg-white text-slate-900 shadow-2xs font-semibold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Table2 className="w-3 h-3" />
                <span>Grid</span>
              </button>
              <button
                type="button"
                onClick={() => setViewMode('list')}
                className={`px-2 py-1 rounded-md flex items-center gap-1 cursor-pointer transition-colors ${
                  viewMode === 'list'
                    ? 'bg-white text-slate-900 shadow-2xs font-semibold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <List className="w-3 h-3" />
                <span>List</span>
              </button>
            </div>

            <button
              type="button"
              onClick={onClose}
              aria-label="Close Periodic Table"
              className="w-7 h-7 rounded-lg border border-slate-200 bg-white text-slate-500 hover:text-slate-900 hover:bg-slate-100 flex items-center justify-center cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Search, Category Filter & Live Element Readout Bar */}
        <div className="px-4 py-2 border-b border-slate-200 bg-white flex flex-col gap-2 shrink-0">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="relative flex-1 max-w-md">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by element name, symbol, or atomic number (e.g. Fe, 26, Gold)..."
                data-testid="periodic-search-input"
                className="w-full h-8 pl-8 pr-3 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:bg-white focus:border-blue-500"
              />
            </div>

            {/* Live Selected / Hovered Element Inspector Readout */}
            {previewSpec && (
              <div className="flex items-center flex-wrap gap-2 px-3 py-1 rounded-lg bg-slate-50 border border-slate-200 text-xs">
                <span className="font-mono font-bold text-blue-700">
                  #{previewSpec.atomicNumber} {previewSpec.symbol}
                </span>
                <span className="font-semibold text-slate-900">
                  {previewSpec.name}
                </span>
                <span className="text-slate-300">·</span>
                <span className="font-mono text-slate-700 tabular-nums">
                  {previewSpec.atomicMass} u
                </span>
                <span className="text-slate-300">·</span>
                <span className="text-slate-600">
                  Valence: {previewSpec.standardValences.join(', ')}
                </span>
                <span className="text-slate-300">·</span>
                <span className="text-slate-600">
                  EN {previewSpec.electronegativity || '—'}
                </span>
              </div>
            )}
          </div>

          {/* Category Filter Chips */}
          <div className="flex items-center gap-1 overflow-x-auto pb-0.5">
            <button
              type="button"
              onClick={() => setSelectedCategory('all')}
              className={`px-2 py-0.5 rounded text-[11px] font-medium whitespace-nowrap shrink-0 border cursor-pointer ${
                selectedCategory === 'all'
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
              }`}
            >
              All (118)
            </button>
            {(Object.keys(CATEGORY_LABELS) as ElementCategory[]).map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setSelectedCategory(cat)}
                className={`px-2 py-0.5 rounded text-[11px] font-medium whitespace-nowrap shrink-0 border cursor-pointer ${
                  selectedCategory === cat
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                }`}
              >
                {CATEGORY_LABELS[cat]}
              </button>
            ))}
          </div>
        </div>

        {/* Scrollable Content: 18-Column Periodic Grid & Searchable Periodic Table List */}
        <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-4">
          {/* 18-Column Mendeleev Periodic Grid */}
          {(viewMode === 'both' || viewMode === 'grid') && (
            <div className="overflow-x-auto pb-1">
              <div className="min-w-[820px] space-y-1">
                {[1, 2, 3, 4, 5, 6, 7].map((period) => (
                  <div
                    key={period}
                    className="grid gap-1"
                    style={{ gridTemplateColumns: 'repeat(18, minmax(0, 1fr))' }}
                  >
                    {Array.from({ length: 18 }, (_, i) => i + 1).map((group) => {
                      if (period === 6 && group === 3) {
                        return (
                          <div
                            key={`${period}-${group}`}
                            className="h-11 rounded border border-dashed border-teal-300 bg-teal-50/40 flex flex-col items-center justify-center text-[9px] font-mono text-teal-800"
                          >
                            <span>57–71</span>
                            <span className="font-bold">La–Lu</span>
                          </div>
                        );
                      }
                      if (period === 7 && group === 3) {
                        return (
                          <div
                            key={`${period}-${group}`}
                            className="h-11 rounded border border-dashed border-rose-300 bg-rose-50/40 flex flex-col items-center justify-center text-[9px] font-mono text-rose-800"
                          >
                            <span>89–103</span>
                            <span className="font-bold">Ac–Lr</span>
                          </div>
                        );
                      }
                      const spec = mainGridLookup.get(`${period}-${group}`);
                      if (!spec) {
                        return <div key={`${period}-${group}`} className="h-11" />;
                      }
                      const isMatch = matchingSet.has(spec.symbol);
                      const isSelected = activeElement === spec.symbol;
                      return (
                        <button
                          key={spec.symbol}
                          type="button"
                          onMouseEnter={() => setHoveredSpec(spec)}
                          onClick={() => handlePick(spec.symbol)}
                          title={`#${spec.atomicNumber} ${spec.name} (${spec.symbol}) — ${spec.atomicMass} u`}
                          className={`h-11 px-0.5 rounded border flex flex-col items-center justify-center transition-all cursor-pointer ${
                            isSelected
                              ? 'ring-2 ring-blue-600 bg-blue-600 text-white border-blue-700 font-bold'
                              : CATEGORY_CELL_STYLES[spec.category]
                          } ${!isMatch ? 'opacity-25' : 'opacity-100'}`}
                        >
                          <span
                            className={`text-[9px] font-mono leading-none ${
                              isSelected ? 'text-blue-100' : 'opacity-70'
                            }`}
                          >
                            {spec.atomicNumber}
                          </span>
                          <span className="text-xs font-bold leading-tight mt-0.5">
                            {spec.symbol}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ))}

                {/* Lanthanides (57 La - 71 Lu) */}
                <div
                  className="pt-1.5 grid gap-1"
                  style={{ gridTemplateColumns: 'repeat(18, minmax(0, 1fr))' }}
                >
                  <div className="col-span-3 h-10 flex items-center justify-end pr-2 text-[10px] font-semibold text-teal-800 uppercase tracking-wide">
                    Lanthanides
                  </div>
                  {lanthanides.map((spec) => {
                    const isMatch = matchingSet.has(spec.symbol);
                    const isSelected = activeElement === spec.symbol;
                    return (
                      <button
                        key={spec.symbol}
                        type="button"
                        onMouseEnter={() => setHoveredSpec(spec)}
                        onClick={() => handlePick(spec.symbol)}
                        title={`#${spec.atomicNumber} ${spec.name} (${spec.symbol}) — ${spec.atomicMass} u`}
                        className={`h-10 px-0.5 rounded border flex flex-col items-center justify-center transition-all cursor-pointer ${
                          isSelected
                            ? 'ring-2 ring-blue-600 bg-blue-600 text-white border-blue-700 font-bold'
                            : CATEGORY_CELL_STYLES[spec.category]
                        } ${!isMatch ? 'opacity-25' : 'opacity-100'}`}
                      >
                        <span
                          className={`text-[9px] font-mono leading-none ${
                            isSelected ? 'text-blue-100' : 'opacity-70'
                          }`}
                        >
                          {spec.atomicNumber}
                        </span>
                        <span className="text-xs font-bold leading-tight mt-0.5">
                          {spec.symbol}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {/* Actinides (89 Ac - 103 Lr) */}
                <div
                  className="grid gap-1"
                  style={{ gridTemplateColumns: 'repeat(18, minmax(0, 1fr))' }}
                >
                  <div className="col-span-3 h-10 flex items-center justify-end pr-2 text-[10px] font-semibold text-rose-800 uppercase tracking-wide">
                    Actinides
                  </div>
                  {actinides.map((spec) => {
                    const isMatch = matchingSet.has(spec.symbol);
                    const isSelected = activeElement === spec.symbol;
                    return (
                      <button
                        key={spec.symbol}
                        type="button"
                        onMouseEnter={() => setHoveredSpec(spec)}
                        onClick={() => handlePick(spec.symbol)}
                        title={`#${spec.atomicNumber} ${spec.name} (${spec.symbol}) — ${spec.atomicMass} u`}
                        className={`h-10 px-0.5 rounded border flex flex-col items-center justify-center transition-all cursor-pointer ${
                          isSelected
                            ? 'ring-2 ring-blue-600 bg-blue-600 text-white border-blue-700 font-bold'
                            : CATEGORY_CELL_STYLES[spec.category]
                        } ${!isMatch ? 'opacity-25' : 'opacity-100'}`}
                      >
                        <span
                          className={`text-[9px] font-mono leading-none ${
                            isSelected ? 'text-blue-100' : 'opacity-70'
                          }`}
                        >
                          {spec.atomicNumber}
                        </span>
                        <span className="text-xs font-bold leading-tight mt-0.5">
                          {spec.symbol}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Structured Searchable Periodic Table List */}
          {(viewMode === 'both' || viewMode === 'list') && (
            <div className="border border-slate-200 rounded-lg overflow-hidden">
              <div className="px-3 py-1.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between text-xs">
                <span className="font-semibold text-slate-800">
                  Periodic Table Element Directory
                </span>
                <span className="font-mono text-[11px] text-slate-500">
                  Showing {filteredElements.length} of 118 elements
                </span>
              </div>

              <div className="overflow-x-auto max-h-72 overflow-y-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500 sticky top-0 border-b border-slate-200">
                    <tr>
                      <th className="py-2 px-3 font-semibold">Z</th>
                      <th className="py-2 px-3 font-semibold">Symbol</th>
                      <th className="py-2 px-3 font-semibold">Element</th>
                      <th className="py-2 px-3 font-semibold">Category</th>
                      <th className="py-2 px-3 font-semibold">Period / Group</th>
                      <th className="py-2 px-3 font-semibold">Atomic Mass</th>
                      <th className="py-2 px-3 font-semibold">Valence</th>
                      <th className="py-2 px-3 font-semibold">EN</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredElements.map((spec) => {
                      const isSelected = activeElement === spec.symbol;
                      return (
                        <tr
                          key={spec.symbol}
                          onClick={() => handlePick(spec.symbol)}
                          onMouseEnter={() => setHoveredSpec(spec)}
                          data-testid={`periodic-row-${spec.symbol}`}
                          className={`cursor-pointer transition-colors ${
                            isSelected
                              ? 'bg-blue-50 text-blue-950 font-semibold'
                              : 'hover:bg-slate-50 text-slate-800'
                          }`}
                        >
                          <td className="py-1.5 px-3 font-mono text-slate-500 tabular-nums">
                            {spec.atomicNumber}
                          </td>
                          <td className="py-1.5 px-3">
                            <span
                              className="inline-flex items-center justify-center w-7 h-6 rounded font-mono font-bold text-xs border"
                              style={{
                                backgroundColor: spec.cpkColor,
                                color: spec.cpkTextColor,
                                borderColor: 'rgba(15, 23, 42, 0.16)',
                              }}
                            >
                              {spec.symbol}
                            </span>
                          </td>
                          <td className="py-1.5 px-3 font-medium text-slate-900">
                            {spec.name}
                          </td>
                          <td className="py-1.5 px-3 text-slate-600">
                            {CATEGORY_LABELS[spec.category]}
                          </td>
                          <td className="py-1.5 px-3 font-mono text-slate-600 tabular-nums">
                            P{spec.period} · G{spec.group}
                          </td>
                          <td className="py-1.5 px-3 font-mono text-slate-700 tabular-nums">
                            {spec.atomicMass}
                          </td>
                          <td className="py-1.5 px-3 font-mono text-slate-700">
                            {spec.standardValences.join(', ')}
                          </td>
                          <td className="py-1.5 px-3 font-mono text-slate-600 tabular-nums">
                            {spec.electronegativity || '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
