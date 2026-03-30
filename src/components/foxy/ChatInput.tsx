'use client';

import { useState, useRef, memo } from 'react';

/* ══════════════════════════════════════════════════════════════
   CHAT INPUT COMPONENT
   Shared component used by both /page.tsx and /foxy/page.tsx
   ══════════════════════════════════════════════════════════════ */

export const MATH_SYMBOL_TABS = [
  { id: 'basic', label: 'Basic', emoji: '±', symbols: ['±', '×', '÷', '≠', '≈', '√', '²', '³', '∞', 'π'] },
  { id: 'algebra', label: 'Algebra', emoji: '∈', symbols: ['≤', '≥', '<', '>', '∈', '∉', '∪', '∩', '∅', '⊆'] },
  { id: 'calculus', label: 'Calc', emoji: '∫', symbols: ['∫', '∂', '∑', '∏', 'Δ', '∇', 'dx', 'dy', 'lim', '∞'] },
  { id: 'greek', label: 'Greek', emoji: 'α', symbols: ['α', 'β', 'γ', 'δ', 'ε', 'θ', 'λ', 'μ', 'σ', 'ω'] },
  { id: 'arrows', label: 'Arrows', emoji: '→', symbols: ['→', '←', '⇒', '⇔', '↑', '↓', '⇌', '∝'] },
  { id: 'science', label: 'Sci', emoji: '⚛', symbols: ['℃', '°', 'Ω', 'Å', 'mol', 'pH', 'atm', 'eV', 'Pa', 'Hz'] },
  { id: 'geometry', label: 'Geo', emoji: '∠', symbols: ['∠', '⊥', '∥', '△', '○', '°', 'π', 'r²'] },
  { id: 'super', label: 'Sup', emoji: 'x²', symbols: ['⁰', '¹', '²', '³', '⁴', '⁵', '⁶', '⁷', '⁸', '⁹'] },
  { id: 'sub', label: 'Sub', emoji: 'x₂', symbols: ['₀', '₁', '₂', '₃', '₄', '₅', '₆', '₇', '₈', '₉'] },
];

const SUBJECTS: Record<string, { icon: string; color: string }> = {
  math: { icon: '∑', color: '#3B82F6' },
  science: { icon: '⚛', color: '#10B981' },
  english: { icon: 'Aa', color: '#8B5CF6' },
  hindi: { icon: 'अ', color: '#F59E0B' },
  physics: { icon: '⚡', color: '#EF4444' },
  chemistry: { icon: '⚗', color: '#06B6D4' },
  biology: { icon: '⚕', color: '#22C55E' },
  social_studies: { icon: '🌍', color: '#D97706' },
  coding: { icon: '💻', color: '#6366F1' },
};

const DEFAULT_CONFIG = SUBJECTS.science;

export interface ChatInputProps {
  onSubmit: (t: string, image?: File | null) => void;
  subjectKey: string;
  disabled: boolean;
  subjectConfig?: { color: string; icon: string };
}

export const ChatInput = memo(function ChatInput({ onSubmit, subjectKey, disabled, subjectConfig }: ChatInputProps) {
  const [text, setText] = useState('');
  const [showSymbols, setShowSymbols] = useState(false);
  const [symTab, setSymTab] = useState('basic');
  const [pointMode, setPointMode] = useState(false);
  const [pointCount, setPointCount] = useState(1);
  const [image, setImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const cfg = subjectConfig || SUBJECTS[subjectKey] || DEFAULT_CONFIG;

  const insertAt = (s: string) => {
    const ta = taRef.current; if (!ta) return;
    const start = ta.selectionStart, end = ta.selectionEnd;
    setText(text.substring(0, start) + s + text.substring(end));
    setTimeout(() => { ta.focus(); ta.selectionStart = ta.selectionEnd = start + s.length; }, 0);
  };

  const handleImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { alert('Image must be under 5MB'); return; }
    setImage(file);
    const reader = new FileReader();
    reader.onload = () => setImagePreview(reader.result as string);
    reader.readAsDataURL(file);
  };

  const send = () => {
    if ((!text.trim() && !image) || disabled) return;
    onSubmit(text.trim(), image || null);
    setText(''); setPointCount(1); setPointMode(false);
    setImage(null); setImagePreview(null);
    if (fileRef.current) fileRef.current.value = '';
    if (taRef.current) taRef.current.style.height = 'auto';
  };

  const handleKey = (e: React.KeyboardEvent) => {
    // Enter = new line (students write multi-line questions)
    // Ctrl+Enter or Cmd+Enter = send (intentional action)
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      send();
    } else if (e.key === 'Enter' && e.shiftKey && pointMode) {
      e.preventDefault();
      const n = pointCount + 1;
      insertAt(`\n${n}. `);
      setPointCount(n);
    }
    // Plain Enter = default textarea behavior (new line)
  };

  const togglePoints = () => {
    if (!pointMode) {
      if (!text.trim()) { setText('1. '); setPointCount(1); }
      else if (!text.startsWith('1.')) { setText(`1. ${text}`); setPointCount(1); }
      setPointMode(true);
      setTimeout(() => { const ta = taRef.current; if (ta) { ta.focus(); ta.selectionStart = ta.selectionEnd = ta.value.length; } }, 0);
    } else setPointMode(false);
  };

  const autoGrow = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value); e.target.style.height = 'auto'; e.target.style.height = `${Math.min(e.target.scrollHeight, 200)}px`;
  };

  const syms = MATH_SYMBOL_TABS.find(t => t.id === symTab)?.symbols ?? MATH_SYMBOL_TABS[0].symbols;

  return (
    <div className="border-t" style={{ background: 'var(--surface-1)', borderColor: 'var(--border)' }}>
      {showSymbols && (
        <div className="px-3 pt-2 pb-1">
          <div className="flex gap-1 overflow-x-auto mb-2" style={{ scrollbarWidth: 'none' }}>
            {MATH_SYMBOL_TABS.map(tab => (
              <button key={tab.id} onClick={() => setSymTab(tab.id)} className="shrink-0 px-2 py-1 rounded-lg text-[10px] font-bold transition-all"
                style={{ background: symTab === tab.id ? `${cfg.color}15` : 'transparent', color: symTab === tab.id ? cfg.color : 'var(--text-3)', border: symTab === tab.id ? `1px solid ${cfg.color}30` : '1px solid transparent' }}>
                <span className="text-sm mr-0.5">{tab.emoji}</span> {tab.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1">
            {syms.map((s, i) => (
              <button key={i} onClick={() => insertAt(s)} className="w-9 h-9 rounded-lg flex items-center justify-center text-sm font-semibold transition-all active:scale-90"
                style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', fontFamily: 'monospace' }}>{s}</button>
            ))}
          </div>
        </div>
      )}
      <div className="flex items-center gap-1.5 px-3 pt-2 pb-1">
        <button onClick={() => setShowSymbols(!showSymbols)} className="px-2 py-1 rounded-lg text-[10px] font-bold transition-all active:scale-95"
          style={{ background: showSymbols ? `${cfg.color}15` : 'var(--surface-2)', color: showSymbols ? cfg.color : 'var(--text-3)', border: `1px solid ${showSymbols ? `${cfg.color}30` : 'var(--border)'}` }}>
          {showSymbols ? '× Close' : 'fx Math'}
        </button>
        <button onClick={togglePoints} className="px-2 py-1 rounded-lg text-[10px] font-bold transition-all active:scale-95"
          style={{ background: pointMode ? `${cfg.color}15` : 'var(--surface-2)', color: pointMode ? cfg.color : 'var(--text-3)', border: `1px solid ${pointMode ? `${cfg.color}30` : 'var(--border)'}` }}>
          {pointMode ? '1. ON' : '1. Points'}
        </button>
        <input type="file" ref={fileRef} accept="image/*" capture="environment" onChange={handleImage} className="hidden" />
        <button onClick={() => fileRef.current?.click()} className="px-2 py-1 rounded-lg text-[10px] font-bold transition-all active:scale-95"
          style={{ background: image ? `${cfg.color}15` : 'var(--surface-2)', color: image ? cfg.color : 'var(--text-3)', border: `1px solid ${image ? `${cfg.color}30` : 'var(--border)'}` }}>
          {image ? '1 image' : 'Photo'}
        </button>
        <span className="flex-1" />
        <span className="text-[10px] text-[var(--text-3)] hidden sm:inline">Enter = new line · Ctrl+Enter = send</span>
      </div>
      {imagePreview && (
        <div className="px-3 pt-2 flex items-center gap-2">
          <div className="relative">
            <img src={imagePreview} alt="Attached" className="w-12 h-12 rounded-lg object-cover border" style={{ borderColor: 'var(--border)' }} />
            <button onClick={() => { setImage(null); setImagePreview(null); if (fileRef.current) fileRef.current.value = ''; }}
              className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold bg-red-500 text-white">
              x
            </button>
          </div>
          <span className="text-xs" style={{ color: 'var(--text-3)' }}>Image attached</span>
        </div>
      )}
      <div className="px-3 py-2 flex items-end gap-2" style={{ paddingBottom: 'max(env(safe-area-inset-bottom, 8px), 8px)' }}>
        <textarea ref={taRef} value={text} onChange={autoGrow} onKeyDown={handleKey}
          placeholder={pointMode ? '1. Write your answer point by point...\n(Shift+Enter for next point)' : 'Ask Foxy anything...\nPress Enter for new line, Ctrl+Enter to send'}
          rows={pointMode ? 3 : 2} className="flex-1 min-w-0 text-sm rounded-2xl px-4 py-2.5 resize-none outline-none leading-relaxed"
          style={{ background: 'var(--surface-2)', border: `1.5px solid ${pointMode ? `${cfg.color}40` : 'var(--border)'}`, fontFamily: 'var(--font-body)', maxHeight: 200, minHeight: pointMode ? 80 : 52, overflowWrap: 'break-word', wordBreak: 'break-word' }} />
        <button onClick={send} disabled={disabled || (!text.trim() && !image)}
          className="shrink-0 w-10 h-10 rounded-xl flex items-center justify-center text-lg font-bold transition-all active:scale-90 disabled:opacity-40"
          style={{ background: (text.trim() || image) ? `linear-gradient(135deg, ${cfg.color}, ${cfg.color}dd)` : 'var(--surface-2)', color: (text.trim() || image) ? '#fff' : 'var(--text-3)' }}>
          {disabled ? '...' : '↑'}
        </button>
      </div>
    </div>
  );
});

export default ChatInput;
