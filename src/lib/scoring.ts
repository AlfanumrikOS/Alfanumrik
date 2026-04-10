/**
 * ALFANUMRIK — Scoring & XP Pure Functions
 *
 * Extracted production invariants for P1 (Score Accuracy) and P2 (XP Economy).
 * These are the single source of truth — used by submitQuizResults(), QuizResults,
 * atomic_quiz_profile_update() RPC, and tests.
 *
 * DO NOT duplicate this logic anywhere. Import from here.
 */

import { XP_RULES } from './xp-rules';

/**
 * P1 Invariant: Score Accuracy
 * score_percent = Math.round((correct_answers / total_questions) * 100)
 */
export function calculateScorePercent(correct: number, total: number): number {
  return total > 0 ? Math.round((correct / total) * 100) : 0;
}

/**
 * P2 Invariant: XP Economy
 * xp = (correct * quiz_per_correct) + (score >= 80 ? high_score_bonus : 0) + (score === 100 ? perfect_bonus : 0)
 */
export function calculateQuizXP(correct: number, scorePct: number): number {
  return (
    correct * XP_RULES.quiz_per_correct +
    (scorePct >= 80 ? XP_RULES.quiz_high_score_bonus : 0) +
    (scorePct === 100 ? XP_RULES.quiz_perfect_bonus : 0)
  );
}
