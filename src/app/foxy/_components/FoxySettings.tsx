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
          className={`text-[10px] font-bold px-2 py-1 rounded-lg transition-all ${language !== l.code ? 'inline-block' : ''}`}
          style={{
            background: language === l.code ? 'color-mix(in srgb, var(--on-surface-inverse) 20%, transparent)' : 'transparent',
            color: language === l.code ? 'var(--on-surface-inverse)' : 'color-mix(in srgb, var(--on-surface-inverse) 40%, transparent)',
            opacity: isLocked && language !== l.code ? 0.2 : 1,
            cursor: isLocked ? 'default' : 'pointer',
          }}
        >
          {l.label}
        </button>
      ))}
      {isLocked && <span className="text-[8px] text-[color-mix(in_srgb,var(--on-surface-inverse)_30%,transparent)]">🔒</span>}
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
            className={`foxy-pill shrink-0 px-2.5 py-1.5 rounded-lg text-[10px] font-bold flex items-center gap-1 ${isActive ? 'foxy-pill-active' : ''}`}
            style={{
              ['--pill-tint' as string]: color,
              background: isActive ? `color-mix(in srgb, ${color} 14%, var(--surface-1))` : 'transparent',
              color: isActive ? color : 'var(--text-3)',
              border: isActive ? `1px solid color-mix(in srgb, ${color} 32%, transparent)` : '1px solid transparent',
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
        className={`foxy-pill shrink-0 px-2 py-1.5 rounded-lg text-[10px] font-bold flex items-center gap-1 ${sessionMode === 'lesson' ? 'foxy-pill-active' : ''}`}
        style={{
          ['--pill-tint' as string]: color,
          background: sessionMode === 'lesson' ? `color-mix(in srgb, ${color} 14%, var(--surface-1))` : 'transparent',
          color: sessionMode === 'lesson' ? color : 'var(--text-3)',
          border: sessionMode === 'lesson' ? `1px solid color-mix(in srgb, ${color} 32%, transparent)` : '1px solid transparent',
        }}
      >
        <span>{'🎓'}</span>
        <span className="hidden sm:inline">{isHi ? 'पाठ' : 'Lesson'}</span>
      </button>
    </div>
  );
}
