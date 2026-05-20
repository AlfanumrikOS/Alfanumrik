'use client';

/**
 * AlfaBotLangNudge — Dismissable ribbon shown when the user types Devanagari
 * but the UI is still on English.
 *
 * Trigger: provider detects ≥30% Devanagari chars in the user's message AND
 * lang === 'en' AND the user hasn't already dismissed the nudge in this session.
 */

import { useAlfaBot } from './AlfaBotProvider';
import s from './alfabot.module.css';

export default function AlfaBotLangNudge() {
  const { langNudgeVisible, acceptLangNudge, dismissLangNudge } = useAlfaBot();

  if (!langNudgeVisible) return null;

  return (
    <div className={s.langNudge} role="status" aria-live="polite">
      <span className={s.langNudgeText}>
        Hindi me jawab chahiye? Switch karein?
      </span>
      <div className={s.langNudgeActions}>
        <button type="button" className={s.langNudgeAccept} onClick={acceptLangNudge}>
          हाँ
        </button>
        <button type="button" className={s.langNudgeDismiss} onClick={dismissLangNudge}>
          No thanks
        </button>
      </div>
    </div>
  );
}
