'use client';

/**
 * ConfidencePrompt — D6 (Foxy North-Star Phase 2, approved design: sampled +
 * non-blocking).
 *
 * A 1-tap 1-5 confidence scale shown AFTER the student has answered a quiz
 * question (so response time is never affected — P3 anti-cheat timing is
 * untouched). It auto-dismisses and NEVER blocks progression: the student can
 * always tap "Next" without interacting with it.
 *
 * Sampling is deterministic (no Math.random — keeps tests + analytics stable):
 * `shouldPromptConfidence(questionIndex)` samples every 3rd question (~33%).
 *
 * The tapped value (1-5) is reported via `onSelect`; the parent stores it on
 * the response object's `confidence` field (fixed server contract: smallint
 * 1-5, NULL when absent).
 */

import { useEffect, useRef, useState } from 'react';

/**
 * Deterministic ~30% sampling: prompt on every 3rd question (index 0, 3, 6…).
 * Pure function of the question index — no randomness, so a given quiz length
 * always prompts the same positions (stable for tests and analytics).
 */
export function shouldPromptConfidence(questionIndex: number): boolean {
  return questionIndex % 3 === 0;
}

export type ConfidenceValue = 1 | 2 | 3 | 4 | 5;

const LEVELS: Array<{ value: ConfidenceValue; emoji: string; en: string; hi: string }> = [
  { value: 1, emoji: '🎲', en: 'Guessed', hi: 'तुक्का' },
  { value: 2, emoji: '😕', en: 'Not sure', hi: 'पक्का नहीं' },
  { value: 3, emoji: '🙂', en: 'Maybe', hi: 'शायद' },
  { value: 4, emoji: '😃', en: 'Sure', hi: 'यकीन है' },
  { value: 5, emoji: '😎', en: 'Very sure', hi: 'पूरा यकीन' },
];

export interface ConfidencePromptProps {
  isHi: boolean;
  /** Called exactly once when the student taps a level. */
  onSelect: (value: ConfidenceValue) => void;
  /** Called when the prompt auto-dismisses (or is closed) without a tap. */
  onDismiss?: () => void;
  /** Auto-dismiss delay in ms. 0 disables auto-dismiss. Default 6000. */
  autoDismissMs?: number;
}

export default function ConfidencePrompt({
  isHi,
  onSelect,
  onDismiss,
  autoDismissMs = 6000,
}: ConfidencePromptProps) {
  const [visible, setVisible] = useState(true);
  // Guard against double-taps reporting twice.
  const reportedRef = useRef(false);

  useEffect(() => {
    if (!autoDismissMs) return;
    const t = setTimeout(() => {
      if (reportedRef.current) return;
      setVisible(false);
      onDismiss?.();
    }, autoDismissMs);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoDismissMs]);

  if (!visible) return null;

  const handleTap = (value: ConfidenceValue) => {
    if (reportedRef.current) return;
    reportedRef.current = true;
    setVisible(false);
    onSelect(value);
  };

  return (
    <div
      data-testid="confidence-prompt"
      role="group"
      aria-label={isHi ? 'कितना यकीन है?' : 'How sure are you?'}
      className="rounded-2xl p-3 border"
      style={{ background: 'rgba(245,166,35,0.06)', borderColor: 'rgba(245,166,35,0.2)' }}
    >
      <p className="text-xs font-bold mb-2 text-center" style={{ color: 'var(--text-2, #4b5563)' }}>
        {isHi ? 'कितना यकीन है?' : 'How sure are you?'}
      </p>
      <div className="flex items-center justify-center gap-2">
        {LEVELS.map((lvl) => (
          <button
            key={lvl.value}
            type="button"
            data-testid={`confidence-option-${lvl.value}`}
            aria-label={isHi ? lvl.hi : lvl.en}
            title={isHi ? lvl.hi : lvl.en}
            onClick={() => handleTap(lvl.value)}
            className="flex flex-col items-center justify-center rounded-xl transition-all active:scale-95"
            style={{
              minWidth: 44,
              minHeight: 44,
              background: 'var(--surface-1, #fff)',
              border: '1px solid var(--border, #e5e7eb)',
            }}
          >
            <span className="text-lg leading-none" aria-hidden="true">{lvl.emoji}</span>
            <span className="text-[9px] font-medium mt-0.5" style={{ color: 'var(--text-3, #9ca3af)' }}>
              {isHi ? lvl.hi : lvl.en}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
