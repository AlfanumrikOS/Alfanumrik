'use client';

/**
 * FoxySettings — small composable pickers extracted from /foxy/page.tsx.
 *
 * Plan ref: docs/superpowers/plans/2026-05-09-student-quality-upgrade.md
 *           Task 5b: extract subject/mode/lang picker(s)
 *
 * Why two named exports instead of one monolith: the language pills sit
 * inside the dark-gradient page header (mixed with XP/streak/voice toggle),
 * while the mode pills sit inside the lighter toolbar bar (mixed with the
 * chapter dropdown). Combining them into one wrapper would force the page
 * to either restructure those layouts (out of scope) or pass a dozen
 * composition props. Keeping them as siblings preserves the existing
 * markup byte-for-byte.
 *
 * Subject tabs were NOT extracted — they read `studentSubs`, `allowedSubjects`,
 * the per-subject color/icon lookup, and trigger `switchSubject` (which
 * itself touches messages/topics/chatSessionId). Pulling them into a
 * component would multiply prop count without meaningfully shrinking
 * page.tsx.
 */

import { LANGS } from '../_lib/foxy-constants';
import { SIMPLIFIED_MODES, MODE_MAP } from '@/components/foxy/ConversationManager';

/* ──────────────────────────────────────────────────────────────────
   LanguagePicker — header EN / HI / Hing pills
   ────────────────────────────────────────────────────────────────── */

export interface LanguagePickerProps {
  /** Current language code: 'en' | 'hi' | 'hinglish'. */
  language: string;
  /** When true (i.e. on `hindi`/`english` subjects) the pills are read-only. */
  isLocked: boolean;
  onLanguageChange: (code: string) => void;
}

export function LanguagePicker({ language, isLocked, onLanguageChange }: LanguagePickerProps) {
  return (
    <>
      {LANGS.map((l) => (
        <button
          key={l.code}
          onClick={() => {
            if (!isLocked) onLanguageChange(l.code);
          }}
          className={`text-[10px] font-bold px-2 py-1 rounded-lg transition-all ${language !== l.code ? 'hidden sm:inline-block' : ''}`}
          style={{
            background: language === l.code ? 'rgba(255,255,255,0.2)' : 'transparent',
            color: language === l.code ? '#fff' : 'rgba(255,255,255,0.4)',
            opacity: isLocked && language !== l.code ? 0.2 : 1,
            cursor: isLocked ? 'default' : 'pointer',
          }}
        >
          {l.label}
        </button>
      ))}
      {isLocked && <span className="text-[8px] text-white/30">🔒</span>}
    </>
  );
}

/* ──────────────────────────────────────────────────────────────────
   ModePicker — simplified mode pills + Lesson pill
   ────────────────────────────────────────────────────────────────── */

export interface ModePickerProps {
  /** The page-level backendMode. Mapped via MODE_MAP from the simplified IDs. */
  sessionMode: string;
  /** Subject brand color — used for the active-pill highlight. */
  color: string;
  isHi: boolean;
  onSwitchMode: (modeId: string) => void;
}

export function ModePicker({ sessionMode, color, isHi, onSwitchMode }: ModePickerProps) {
  return (
    <div className="foxy-mode-bar ml-auto">
      {SIMPLIFIED_MODES.map((m) => {
        const backendMode = MODE_MAP[m.id] || m.id;
        const isActive =
          sessionMode === backendMode ||
          (m.id === 'ask' && (sessionMode === 'learn' || sessionMode === 'doubt'));
        return (
          <button
            key={m.id}
            onClick={() => onSwitchMode(m.id)}
            className="shrink-0 px-2.5 py-1.5 rounded-lg text-[10px] font-bold transition-all active:scale-95 flex items-center gap-1"
            style={{
              background: isActive ? `${color}15` : 'transparent',
              color: isActive ? color : 'var(--text-3)',
              border: isActive ? `1px solid ${color}30` : '1px solid transparent',
            }}
          >
            <span>{m.icon}</span>
            <span>{isHi ? m.labelHi : m.label}</span>
          </button>
        );
      })}
      {/* Lesson mode — advanced, shown as small pill */}
      <button
        onClick={() => onSwitchMode('lesson')}
        className="shrink-0 px-2 py-1.5 rounded-lg text-[10px] font-bold transition-all active:scale-95 flex items-center gap-1"
        style={{
          background: sessionMode === 'lesson' ? `${color}15` : 'transparent',
          color: sessionMode === 'lesson' ? color : 'var(--text-3)',
          border: sessionMode === 'lesson' ? `1px solid ${color}30` : '1px solid transparent',
        }}
      >
        <span>{'🎓'}</span>
        <span className="hidden sm:inline">{isHi ? 'पाठ' : 'Lesson'}</span>
      </button>
    </div>
  );
}
