'use client';

import { useState, useRef, memo, useEffect, useCallback } from 'react';
import { Chip, IconButton } from '@/components/ui/primitives';
import { useSubjectLookup } from '@/lib/useSubjectLookup';
import { startListening, isVoiceSupported } from '@/lib/voice';
import { usePythonVoiceEnabled } from '@/lib/voice-feature-flag';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/lib/supabase';
import { toast } from '@/components/ui/toast';

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

// Fallback used only until the subjects service hook resolves. Token-only:
// the emerald default now rides the semantic --success surface var so the
// composer carries no raw hex before the subjects lookup hydrates.
const DEFAULT_CONFIG = { icon: '⚛', color: 'var(--success)' };

export interface ChatInputProps {
  onSubmit: (t: string, image?: File | null) => void;
  subjectKey: string;
  disabled: boolean;
  subjectConfig?: { color: string; icon: string };
  /** Student's current language preference: 'en' | 'hi' | 'hinglish' */
  language?: string;
  /** When provided, final speech result auto-sends instead of requiring manual send */
  onVoiceSend?: (text: string) => void;
  /** Voice 3: fires with the STT-detected language (en/hi/hinglish) so the page
   *  can adapt Foxy's spoken reply to the language the student actually spoke. */
  onDetectedLanguage?: (lang: string) => void;
}

export const ChatInput = memo(function ChatInput({
  onSubmit,
  subjectKey,
  disabled,
  subjectConfig,
  language = 'en',
  onVoiceSend,
  onDetectedLanguage,
}: ChatInputProps) {
  const [text, setText] = useState('');
  const [showSymbols, setShowSymbols] = useState(false);
  const [symTab, setSymTab] = useState('basic');
  const [pointMode, setPointMode] = useState(false);
  const [pointCount, setPointCount] = useState(1);
  const [image, setImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [isInterim, setIsInterim] = useState(false); // true while showing interim text

  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // Holds the { stop } handle returned by startListening
  const listenHandleRef = useRef<{ stop: () => void } | null>(null);

  const lookupSubject = useSubjectLookup();
  const resolved = lookupSubject(subjectKey);
  const cfg = subjectConfig
    || (resolved ? { icon: resolved.icon, color: resolved.color } : DEFAULT_CONFIG);

  // Feature-detect once (SSR-safe)
  const { stt: sttSupported } = isVoiceSupported();

  // Voice 2 — per-student Cloud Run STT routing.
  //
  // When the flag is enabled AND the student is in the rollout bucket, the
  // mic button records via MediaRecorder + posts to Cloud Run Whisper.
  // Otherwise the existing browser Web Speech API path runs unchanged.
  // The fallback path inside startListening catches any Python failure and
  // falls through to Web Speech automatically — see REG-77.
  const { student } = useAuth();
  const pythonVoiceEnabled = usePythonVoiceEnabled(student?.id ?? null);
  // Pull the Supabase session JWT lazily on each mic press. Cached internally
  // by supabase-js, so this is a fast in-memory read in the common case.
  const getJwt = useCallback(async (): Promise<string | null> => {
    try {
      const { data } = await supabase.auth.getSession();
      return data.session?.access_token ?? null;
    } catch {
      return null;
    }
  }, []);

  // Stop recognition on unmount
  useEffect(() => {
    return () => {
      listenHandleRef.current?.stop();
    };
  }, []);

  const resizeTextarea = () => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
  };

  const insertAt = (s: string) => {
    const ta = taRef.current;
    if (!ta) return;
    const start = ta.selectionStart, end = ta.selectionEnd;
    setText(text.substring(0, start) + s + text.substring(end));
    setTimeout(() => {
      ta.focus();
      ta.selectionStart = ta.selectionEnd = start + s.length;
    }, 0);
  };

  const handleImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { toast.error('Image must be under 5MB'); return; }
    setImage(file);
    const reader = new FileReader();
    reader.onload = () => setImagePreview(reader.result as string);
    reader.readAsDataURL(file);
  };

  const stopListening = () => {
    listenHandleRef.current?.stop();
    listenHandleRef.current = null;
    setIsListening(false);
    setIsInterim(false);
  };

  const toggleVoice = () => {
    if (!sttSupported) return;

    if (isListening) {
      stopListening();
      return;
    }

    setIsListening(true);
    setIsInterim(false);

    listenHandleRef.current = startListening({
      language,
      // Voice 2 routing: opt-in fields. When `pythonEnabled` is false the
      // legacy Web Speech path runs immediately and these are no-ops.
      pythonEnabled: pythonVoiceEnabled,
      getJwt,
      // Voice 3: Python STT reports the language the student actually spoke;
      // bubble it up so Foxy's spoken reply can match it.
      onPythonResult: (detected) => {
        onDetectedLanguage?.(detected);
      },
      onResult: (transcript, isFinal) => {
        setText(transcript);
        setIsInterim(!isFinal);
        resizeTextarea();

        if (isFinal) {
          stopListening();
          if (onVoiceSend) {
            // Auto-send when voice mode is active
            onVoiceSend(transcript);
            setText('');
            setPointCount(1);
            setPointMode(false);
            if (taRef.current) taRef.current.style.height = 'auto';
          }
          // Otherwise just leave text in box for manual send
        }
      },
      onError: () => {
        stopListening();
      },
      onEnd: () => {
        setIsListening(false);
        setIsInterim(false);
        listenHandleRef.current = null;
      },
      continuous: false,
    });
  };

  const send = () => {
    if ((!text.trim() && !image) || disabled) return;
    stopListening();
    onSubmit(text.trim(), image || null);
    setText('');
    setPointCount(1);
    setPointMode(false);
    setImage(null);
    setImagePreview(null);
    if (fileRef.current) fileRef.current.value = '';
    if (taRef.current) taRef.current.style.height = 'auto';
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      if (e.shiftKey) {
        if (pointMode) {
          e.preventDefault();
          const n = pointCount + 1;
          insertAt(`\n${n}. `);
          setPointCount(n);
        }
        // Let Shift+Enter naturally insert a newline in standard mode
      } else {
        // Plain Enter (or Ctrl/Meta+Enter) sends the message
        e.preventDefault();
        send();
      }
    }
  };

  const togglePoints = () => {
    if (!pointMode) {
      if (!text.trim()) { setText('1. '); setPointCount(1); }
      else if (!text.startsWith('1.')) { setText(`1. ${text}`); setPointCount(1); }
      setPointMode(true);
      setTimeout(() => {
        const ta = taRef.current;
        if (ta) { ta.focus(); ta.selectionStart = ta.selectionEnd = ta.value.length; }
      }, 0);
    } else {
      setPointMode(false);
    }
  };

  const autoGrow = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = `${Math.min(e.target.scrollHeight, 200)}px`;
  };

  const syms = MATH_SYMBOL_TABS.find(t => t.id === symTab)?.symbols ?? MATH_SYMBOL_TABS[0].symbols;

  return (
    <div className="border-t" style={{ background: 'var(--surface-1)', borderColor: 'var(--border)' }}>
      {/* Pulse animation for mic button */}
      <style>{`
        @keyframes mic-pulse {
          0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent-warm) 40%, transparent); }
          50%       { box-shadow: 0 0 0 10px transparent; }
        }
        .mic-pulsing { animation: mic-pulse 1.2s ease-in-out infinite; }
      `}</style>

      {showSymbols && (
        <div className="px-3 pt-2 pb-1">
          <div className="flex gap-1.5 overflow-x-auto mb-2" style={{ scrollbarWidth: 'none' }}>
            {MATH_SYMBOL_TABS.map(tab => (
              <Chip
                key={tab.id}
                selected={symTab === tab.id}
                icon={tab.emoji}
                onClick={() => setSymTab(tab.id)}
                className="shrink-0 whitespace-nowrap"
              >
                {tab.label}
              </Chip>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {syms.map((s, i) => (
              <IconButton
                key={i}
                label={s}
                icon={s}
                variant="secondary"
                size="sm"
                onClick={() => insertAt(s)}
                className="font-mono"
              />
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5 px-3 pt-2 pb-1">
        <Chip
          selected={showSymbols}
          onClick={() => setShowSymbols(!showSymbols)}
          className="shrink-0 whitespace-nowrap"
        >
          {showSymbols ? (language === 'hi' ? '× बंद करें' : '× Close') : (language === 'hi' ? 'fx गणित' : 'fx Math')}
        </Chip>
        <Chip
          selected={pointMode}
          onClick={togglePoints}
          className="shrink-0 whitespace-nowrap"
        >
          {pointMode ? (language === 'hi' ? '1. चालू' : '1. ON') : (language === 'hi' ? '1. बिंदु' : '1. Points')}
        </Chip>
        <input type="file" ref={fileRef} accept="image/*" capture="environment" onChange={handleImage} className="hidden" />
        <Chip
          selected={!!image}
          onClick={() => fileRef.current?.click()}
          className="shrink-0 whitespace-nowrap"
        >
          {image ? (language === 'hi' ? '1 फ़ोटो' : '1 image') : (language === 'hi' ? 'फ़ोटो' : 'Photo')}
        </Chip>

        {/* Voice button — hidden entirely if browser doesn't support STT */}
        {sttSupported && (
          <Chip
            selected={isListening}
            onClick={toggleVoice}
            aria-label={isListening ? (language === 'hi' ? 'सुनना बंद करें' : 'Stop listening') : (language === 'hi' ? 'आवाज़ इनपुट शुरू करें' : 'Start voice input')}
            title={isListening ? (language === 'hi' ? 'रोकें' : 'Stop') : (language === 'hi' ? 'आवाज़ इनपुट' : 'Voice input')}
            className={`shrink-0 whitespace-nowrap${isListening ? ' mic-pulsing' : ''}`}
          >
            {isListening
              ? (language === 'hi' ? '● सुन रहा हूँ…' : '● Listening…')
              : (language === 'hi' ? '🎤 आवाज़' : '🎤 Voice')}
          </Chip>
        )}

        <span className="flex-1" />
        {text.length > 0 && (
          <span
            className="text-[10px] mr-1"
            style={{
              color: text.length > 900 ? 'var(--danger)' : text.length > 800 ? 'var(--warning)' : 'var(--text-3)',
              fontWeight: text.length > 900 ? 700 : text.length > 800 ? 600 : 400,
            }}
          >
            {text.length}/1000
          </span>
        )}
        {text.length > 0 && <span className="text-[10px] text-[var(--text-3)] hidden sm:inline mr-1.5">·</span>}
        <span className="text-[10px] text-[var(--text-3)] hidden sm:inline">
          {language === 'hi' ? 'Enter से भेजें · Shift+Enter से नई लाइन' : 'Enter to send · Shift+Enter for new line'}
        </span>
      </div>

      {imagePreview && (
        <div className="px-3 pt-2 flex items-center gap-2">
          <div className="relative">
            {/* blob: / data: URLs are not supported by next/image — keep native img */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={imagePreview} alt="Attached" width={48} height={48} loading="lazy" className="w-12 h-12 rounded-lg object-cover border" style={{ borderColor: 'var(--border)' }} />
            <button
              type="button"
              aria-label={language === 'hi' ? 'फ़ोटो हटाएं' : 'Remove image'}
              onClick={() => { setImage(null); setImagePreview(null); if (fileRef.current) fileRef.current.value = ''; }}
              className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold"
              style={{ background: 'var(--danger)', color: 'white' }}>
              x
            </button>
          </div>
          <span className="text-xs" style={{ color: 'var(--text-3)' }}>Image attached</span>
        </div>
      )}

      {/* `foxy-composer-row` is an inert CSS hook: no rule targets it outside
          the `.foxy-os` scope, so the OFF path (and desktop) keep the inline
          `paddingBottom` below byte-for-byte. Under `.foxy-os` a globals.css
          rule overrides padding-bottom to ride above the soft keyboard via
          `--kb-inset` (Phase 2 keyboard-aware composer). */}
      <div className="foxy-composer-row px-3 py-2 flex items-end gap-2" style={{ paddingBottom: 'max(env(safe-area-inset-bottom, 8px), 8px)' }}>
        <textarea
          ref={taRef}
          value={text}
          onChange={autoGrow}
          onKeyDown={handleKey}
          maxLength={1000}
          placeholder={
            isListening
              ? (language === 'hi' ? 'सुन रहा हूँ… अब बोलें' : 'Listening… speak now')
              : pointMode
                ? (language === 'hi' ? '1. अपना उत्तर बिंदुवार लिखें…\n(अगले बिंदु के लिए Shift+Enter दबाएं)' : '1. Write your answer point by point…\n(Shift+Enter for next point)')
                : (language === 'hi' ? 'Foxy से कुछ भी पूछें…\nभेजने के लिए Enter दबाएं, नई लाइन के लिए Shift+Enter' : 'Ask Foxy anything…\nEnter to send, Shift+Enter for new line')
          }
          rows={pointMode ? 3 : 2}
          className="flex-1 min-w-0 text-sm rounded-2xl px-4 py-2.5 resize-none outline-none leading-relaxed"
          style={{
            background: 'var(--surface-2)',
            border: `1.5px solid ${isListening ? 'color-mix(in srgb, var(--accent-warm) 25%, transparent)' : pointMode ? `color-mix(in srgb, ${cfg.color} 25%, transparent)` : 'var(--border)'}`,
            fontFamily: 'var(--font-body)',
            maxHeight: 200,
            minHeight: pointMode ? 80 : 52,
            overflowWrap: 'break-word',
            wordBreak: 'break-word',
            // Interim text shown in muted colour
            color: isInterim ? 'var(--text-3)' : 'var(--text-1)',
            fontStyle: isInterim ? 'italic' : 'normal',
          }}
        />
        <IconButton
          label={language === 'hi' ? 'भेजें' : 'Send'}
          icon={disabled ? '…' : '↑'}
          variant="primary"
          size="sm"
          className="shrink-0"
          onClick={send}
          disabled={disabled || (!text.trim() && !image)}
        />
      </div>
    </div>
  );
});

export default ChatInput;
