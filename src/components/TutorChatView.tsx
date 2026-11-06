import React, { useEffect, useRef, useState } from 'react';
import { ArrowRight, Loader2, MessageSquare, Send, Sparkles } from 'lucide-react';
import type { MoleculeGraph, MoleculeMetrics } from '../chem/types';

export type TutorModelId =
  | 'gemini-4-argon'
  | 'gemini-3.8-flash'
  | 'gemini-3.1-flash-lite';

export interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  content: string;
  modelUsed?: string;
  suggestedSmiles?: string | null;
}

interface TutorChatViewProps {
  molecule: MoleculeGraph;
  metrics: MoleculeMetrics;
  onLoadSmiles: (smiles: string, label?: string) => boolean;
}

const MODEL_OPTIONS: Array<{
  id: TutorModelId;
  label: string;
  subtitle: string;
}> = [
  {
    id: 'gemini-3.8-flash',
    label: 'Gemini 3.8 Flash',
    subtitle: 'General Chemistry Mentor',
  },
  {
    id: 'gemini-4-argon',
    label: 'Gemini 4 Argon',
    subtitle: 'Deep Orbital & Mechanism Reasoning',
  },
  {
    id: 'gemini-3.1-flash-lite',
    label: 'Gemini 3.1 Flash-Lite',
    subtitle: 'Rapid Q&A',
  },
];

const STARTER_PROMPTS = [
  'Explain the hybridization and 3D bond angles around each functional group in my active molecule.',
  'How would replacing a hydroxyl group with an amine change polarity and H-bonding?',
  'Propose an interesting structural isomer of my molecule and provide its SMILES.',
  'Why does resonance make aromatic rings planar at 120° bond angles?',
];

export const TutorChatView: React.FC<TutorChatViewProps> = ({
  molecule,
  metrics,
  onLoadSmiles,
}) => {
  const [selectedModel, setSelectedModel] =
    useState<TutorModelId>('gemini-3.8-flash');
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome-1',
      role: 'model',
      modelUsed: 'gemini-3.8-flash',
      content:
        'Welcome to the ValenceLab Chemistry Mentor. Ask any question about VSEPR bond angles, orbital hybridization, resonance stability, or stereochemistry. When I suggest a molecule or derivative, you can load its structure directly into your 2D and 3D workbench.',
    },
  ]);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedNotice, setLoadedNotice] = useState<string | null>(null);

  const threadEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isSending]);

  const sendMessage = async (promptText: string) => {
    const trimmed = promptText.trim();
    if (!trimmed || isSending) return;

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      content: trimmed,
    };

    const nextHistory = [...messages, userMsg];
    setMessages(nextHistory);
    setInput('');
    setIsSending(true);
    setError(null);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: selectedModel,
          messages: nextHistory.map((m) => ({
            role: m.role,
            content: m.content,
          })),
          moleculeContext: {
            name: molecule.name,
            formula: metrics.formula,
            molecularWeight: metrics.molecularWeight.toFixed(2),
            smiles: metrics.canonicalSmiles,
            valenceValid: metrics.valenceValid,
            valenceWarnings: metrics.valenceWarnings,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Chat request failed.');
      }

      const botMsg: ChatMessage = {
        id: `m-${Date.now()}`,
        role: 'model',
        content: data.reply,
        modelUsed: data.model,
        suggestedSmiles: data.suggestedSmiles,
      };
      setMessages((prev) => [...prev, botMsg]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to reach tutor.');
    } finally {
      setIsSending(false);
    }
  };

  const handleLoadSuggested = (smiles: string) => {
    const ok = onLoadSmiles(smiles, `Tutor Structure (${smiles})`);
    if (ok) {
      setLoadedNotice(`Loaded ${smiles} into 2D/3D workbench.`);
    } else {
      setError(`Could not parse suggested SMILES "${smiles}".`);
    }
  };

  return (
    <div className="max-w-5xl mx-auto w-full bg-white border border-slate-200 rounded-xl shadow-xs flex flex-col h-[calc(100vh-140px)] min-h-[540px] overflow-hidden">
      {/* Header & Model Selector */}
      <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50/70 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <MessageSquare className="w-4 h-4 text-blue-600 shrink-0" />
          <div className="min-w-0">
            <h1 className="text-sm font-semibold text-slate-900">
              Chemistry Laboratory Mentor
            </h1>
            <p className="text-xs text-slate-500 truncate">
              Active Context: {molecule.name} · {metrics.formula} · {metrics.canonicalSmiles || 'Empty'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap" role="group" aria-label="Tutor Model">
          {MODEL_OPTIONS.map((opt) => {
            const active = selectedModel === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => setSelectedModel(opt.id)}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-slate-900 text-white'
                    : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100'
                }`}
                title={opt.subtitle}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Starter Prompt Strip */}
      <div className="px-5 py-2.5 border-b border-slate-100 bg-white flex items-center gap-2 overflow-x-auto">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 shrink-0">
          Quick Prompts
        </span>
        {STARTER_PROMPTS.map((q, idx) => (
          <button
            key={idx}
            type="button"
            onClick={() => sendMessage(q)}
            disabled={isSending}
            className="px-2.5 py-1 rounded-md border border-slate-200 bg-slate-50 hover:bg-blue-50 hover:border-blue-200 hover:text-blue-700 text-xs text-slate-700 whitespace-nowrap transition-colors shrink-0 disabled:opacity-50"
          >
            {q.length > 52 ? `${q.slice(0, 52)}...` : q}
          </button>
        ))}
      </div>

      {/* Scrollable Conversation Thread */}
      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        {messages.map((msg) => {
          const isUser = msg.role === 'user';
          return (
            <div
              key={msg.id}
              className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}
            >
              <div
                className={`max-w-3xl rounded-xl px-4 py-3 text-[13px] leading-relaxed whitespace-pre-wrap ${
                  isUser
                    ? 'bg-slate-900 text-white'
                    : 'bg-slate-50 border border-slate-200 text-slate-800'
                }`}
              >
                {!isUser && msg.modelUsed && (
                  <div className="text-[11px] font-mono text-slate-500 mb-1.5">
                    {msg.modelUsed}
                  </div>
                )}
                <div>{msg.content}</div>

                {msg.suggestedSmiles && (
                  <div className="mt-3 pt-2.5 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2">
                    <div className="font-mono text-xs text-slate-700">
                      Proposed SMILES: <span className="font-semibold">{msg.suggestedSmiles}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleLoadSuggested(msg.suggestedSmiles!)}
                      className="px-2.5 py-1 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium flex items-center gap-1.5 transition-colors"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>Load in 3D Workbench</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {isSending && (
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-600" />
            <span>Synthesizing explanation ({selectedModel})...</span>
          </div>
        )}

        {error && (
          <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-800">
            {error}
          </div>
        )}

        {loadedNotice && (
          <div className="p-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-800">
            {loadedNotice}
          </div>
        )}

        <div ref={threadEndRef} />
      </div>

      {/* Input Composer */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          sendMessage(input);
        }}
        className="p-3.5 border-t border-slate-200 bg-slate-50/70 flex items-center gap-2.5"
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={`Ask about ${molecule.name} hybridization, bond strain, or reaction pathways...`}
          className="flex-1 bg-white border border-slate-300 rounded-lg px-3.5 py-2 text-[13px] text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-blue-500"
        />
        <button
          type="submit"
          disabled={isSending || !input.trim()}
          className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors disabled:opacity-50 shrink-0"
        >
          <Send className="w-3.5 h-3.5" />
          <span>Send</span>
        </button>
      </form>
    </div>
  );
};
