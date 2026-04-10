'use client';

import { useState } from 'react';

/**
 * SELCheckIn — Social-Emotional Learning mood check-in.
 *
 * Shows at the start of a study session (Foxy chat or Quiz).
 * Captures student's current mood state to prime the adaptive engine.
 *
 * DB integration:
 * - Writes to quiz_sessions.affective_state or foxy_sessions (whichever caller provides)
 * - The affective_state DB trigger already computes fatigue_detected, frustration_ceiling,
 *   flow_probability from quiz performance. This check-in provides the PRE-session signal.
 *
 * Design principles:
 * - 5 emoji options: fast to answer, no text required
 * - One tap, never blocking — student can always skip
 * - Appears ONCE per session (tracked via sessionStorage per student+date)
 * - Never shown more than once a day to avoid fatigue
 */

export type MoodState = 'great' | 'good' | 'ok' | 'tired' | 'stressed';

interface MoodOption {
  id: MoodState;
  emoji: string;
  label: string;
  labelHi: string;
  // How this state maps to Foxy/quiz adaptation
  hint: string;
}

const MOODS: MoodOption[] = [
  { id: 'great',   emoji: '🤩', label: 'Awesome!',  labelHi: 'बढ़िया!',      hint: 'challenge' },
  { id: 'good',    emoji: '😊', label: 'Good',       labelHi: 'अच्छा',        hint: 'normal' },
  { id: 'ok',      emoji: '😐', label: 'Okay',       labelHi: 'ठीक है',       hint: 'normal' },
  { id: 'tired',   emoji: '😴', label: 'Tired',      labelHi: 'थका हुआ',      hint: 'easy' },
  { id: 'stressed',emoji: '😰', label: 'Stressed',   labelHi: 'परेशान',       hint: 'easy' },
];

interface SELCheckInProps {
  isHi: boolean;
  studentId: string;
  onMoodSelected: (mood: MoodState) => void;
  onSkip: () => void;
}

export default function SELCheckIn({ isHi, studentId, onMoodSelected, onSkip }: SELCheckInProps) {
  const [selected, setSelected] = useState<MoodState | null>(null);

  function handleSelect(mood: MoodState) {
    setSelected(mood);
    // Small delay so the selection animation is visible
    setTimeout(() => onMoodSelected(mood), 300);
  }

  return (
    <div
      className="rounded-2xl p-4"
      style={{
        background: 'var(--surface-1)',
        border: '1px solid var(--border)',
        boxShadow: '0 2px 16px rgba(0,0,0,0.04)',
      }}
    >
      <div className="flex items-start justify-between mb-3">
        <div>
          <p className="text-sm font-bold" style={{ color: 'var(--text-1)' }}>
            {isHi ? 'अभी कैसा महसूस हो रहा है?' : 'How are you feeling right now?'}
          </p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>
            {isHi
              ? 'Foxy तुम्हारे हिसाब से पढ़ाई को आसान या मुश्किल बनाएगी'
              : 'Foxy will adjust your session based on your mood'}
          </p>
        </div>
        <button
          onClick={onSkip}
          className="text-xs ml-2 flex-shrink-0"
          style={{ color: 'var(--text-3)' }}
          aria-label={isHi ? 'छोड़ो' : 'Skip'}
        >
          {isHi ? 'छोड़ो' : 'Skip'}
        </button>
      </div>

      <div className="flex gap-2 justify-between">
        {MOODS.map((mood) => (
          <button
            key={mood.id}
            onClick={() => handleSelect(mood.id)}
            className="flex-1 flex flex-col items-center gap-1 py-2 rounded-xl transition-all active:scale-[0.92]"
            style={{
              background: selected === mood.id ? 'var(--orange)15' : 'var(--surface-2)',
              border: selected === mood.id ? '2px solid var(--orange)' : '2px solid transparent',
              transform: selected === mood.id ? 'scale(1.08)' : 'scale(1)',
            }}
            aria-label={isHi ? mood.labelHi : mood.label}
          >
            <span className="text-2xl">{mood.emoji}</span>
            <span className="text-[9px] font-semibold" style={{ color: selected === mood.id ? 'var(--orange)' : 'var(--text-3)' }}>
              {isHi ? mood.labelHi : mood.label}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Hook: check if SEL check-in should be shown today for this student.
 * Uses sessionStorage to prevent showing more than once per session per day.
 */
export function useSELCheckIn(studentId: string | undefined): {
  shouldShow: boolean;
  markShown: () => void;
} {
  if (typeof window === 'undefined' || !studentId) {
    return { shouldShow: false, markShown: () => {} };
  }
  const key = `sel_checkin_${studentId}_${new Date().toDateString()}`;
  const shouldShow = !sessionStorage.getItem(key);
  const markShown = () => sessionStorage.setItem(key, '1');
  return { shouldShow, markShown };
}
