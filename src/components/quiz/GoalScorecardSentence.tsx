'use client';

/**
 * Alfanumrik — Goal-Adaptive Learning Layers / Phase 1
 * Goal-aware scorecard sentence card.
 *
 * Owner: frontend (assessment owns the scoring/text logic — this only renders).
 * Founder constraint: pure-new component. Renders nothing when the student has
 * no recognized goal — caller is responsible for the flag gate.
 *
 * Reads strings from `buildScorecardSentence` (assessment-owned). This file
 * only handles layout, language selection, and tone-driven accent color.
 *
 * Invariants honored:
 *  - P1 score accuracy: numeric props are taken AS-IS from the submission
 *    response. No re-derivation here.
 *  - P2 XP economy: xpEarned passes through; no recalculation.
 *  - P7 bilingual: every visible string ships en + hi. We render the active
 *    language sentence prominently and surface the other-language label
 *    underneath in the goal-name caption (the sentence map already returns
 *    both — this component picks based on isHi).
 */

import { resolveGoalProfile, isKnownGoalCode } from '@/lib/goals/goal-profile';
import { buildScorecardSentence } from '@/lib/goals/scorecard-sentence';

interface GoalScorecardSentenceProps {
  /** Raw `students.academic_goal` value. Unrecognized values render null. */
  goal: string | null;
  /** From submission response — DO NOT recompute (P1). */
  correct: number;
  /** From submission response — DO NOT recompute (P1). */
  total: number;
  /** From submission response (Math.round'd by submitQuizResults) — DO NOT recompute. */
  scorePercent: number;
  /** From submission response — DO NOT recompute (P2). */
  xpEarned: number;
  /** AuthContext.isHi. Selects sentence language. */
  isHi: boolean;
}

// Tone → Tailwind palette. Stays inside brand tokens (orange/purple/cream/warm)
// for examiner; uses neutral green/blue for the encouraging/analytical tones
// (these are status colors, already used elsewhere on QuizResults).
const TONE_STYLES = {
  encouraging: {
    bg: 'bg-green-50',
    border: 'border-green-200',
    accent: 'text-green-700',
    label: 'text-green-600',
  },
  analytical: {
    bg: 'bg-blue-50',
    border: 'border-blue-200',
    accent: 'text-blue-700',
    label: 'text-blue-600',
  },
  examiner: {
    bg: 'bg-amber-50',
    border: 'border-amber-200',
    accent: 'text-amber-700',
    label: 'text-amber-600',
  },
} as const;

export default function GoalScorecardSentence({
  goal,
  correct,
  total,
  scorePercent,
  xpEarned,
  isHi,
}: GoalScorecardSentenceProps) {
  // Defensive: if the caller forgot to gate, we still no-op for unknown goals.
  if (!isKnownGoalCode(goal)) return null;
  const profile = resolveGoalProfile(goal);
  if (!profile) return null;

  const sentence = buildScorecardSentence({
    goal,
    correct,
    total,
    scorePercent,
    xpEarned,
    isHi,
  });

  const tone = TONE_STYLES[sentence.tone];
  const message = isHi ? sentence.hi : sentence.en;
  const goalLabel = isHi ? profile.labelHi : profile.labelEn;

  return (
    <div
      data-testid="goal-scorecard-sentence"
      data-tone={sentence.tone}
      className={`rounded-2xl border ${tone.bg} ${tone.border} p-4`}
    >
      <p className={`text-sm font-semibold leading-relaxed ${tone.accent}`}>
        {message}
      </p>
      <p className={`text-[11px] mt-2 font-medium ${tone.label}`}>
        {isHi ? `तुम्हारा लक्ष्य: ${goalLabel}` : `Your goal: ${goalLabel}`}
      </p>
    </div>
  );
}
