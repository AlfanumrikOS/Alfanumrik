/**
 * Learner-model facade — explainMastery: PURE evidence-based explanation.
 *
 * Design E3: "Facade explainMastery = evidence-based explanation (P-params +
 * reason codes)". T1/PR1: describe EVIDENCE, never judge identity — every
 * reason code names what the data shows ('few_attempts',
 * 'retention_fading'), never what the student is. This module imports
 * nothing from policy; neutrality is by construction (codes are a closed
 * enum, facts are numbers/timestamps only, no free-text about the student).
 *
 * Pure: no I/O, no Date.now() — callers pass `nowIso` for the review-window
 * facts (defaults provided for convenience, injectable for determinism).
 */

import type { MasteryExplanation, MasteryReasonCode, MasteryState } from './types';

/**
 * Below this many attempts the evidence is considered thin
 * ('few_attempts'). Presentation heuristic — NOT a mastery threshold (those
 * live in ./thresholds); it only shapes the explanation, never the number.
 */
export const FEW_ATTEMPTS_MAX = 5;
/** Accuracy >= 0.8 reads as high-accuracy evidence. */
export const HIGH_ACCURACY_MIN = 0.8;
/** Accuracy <= 0.5 reads as low-accuracy evidence. */
export const LOW_ACCURACY_MAX = 0.5;
/** current_retention below this reads as fading. */
export const RETENTION_FADING_BELOW = 0.5;
/** streak_current at/above this reads as a recent correct streak. */
export const STREAK_MIN = 3;
/** consecutive_wrong at/above this reads as recent consecutive errors. */
export const CONSECUTIVE_WRONG_MIN = 2;

/**
 * Explain one topic's mastery state as evidence facts + neutral reason codes.
 *
 * @param state  a MasteryState row (from getMasteryState)
 * @param nowIso "now" for review-due comparison (ISO string; injectable so
 *               the function stays deterministic in tests)
 */
export function explainMastery(
  state: MasteryState,
  nowIso: string = new Date().toISOString(),
): MasteryExplanation {
  const codes: MasteryReasonCode[] = [];

  const attempts = state.attempts ?? 0;
  const correct = state.correctAttempts ?? 0;
  const accuracy = attempts > 0 ? correct / attempts : null;
  const hinted = typeof state.hintsUsed === 'number' ? state.hintsUsed : null;
  const independent =
    hinted !== null ? Math.max(0, attempts - hinted) : attempts > 0 ? attempts : null;

  // ── Evidence quantity ──
  if (attempts === 0) {
    codes.push('no_attempts_yet');
  } else if (attempts < FEW_ATTEMPTS_MAX) {
    codes.push('few_attempts');
  }

  // ── Evidence accuracy ──
  if (accuracy !== null) {
    if (accuracy >= HIGH_ACCURACY_MIN) codes.push('high_accuracy_evidence');
    else if (accuracy <= LOW_ACCURACY_MAX) codes.push('low_accuracy_evidence');
    else codes.push('mixed_accuracy_evidence');
  }

  // ── Independent vs hinted (P8 evidence-quality signal, where tracked) ──
  if (hinted !== null && attempts > 0) {
    if (hinted > attempts / 2) codes.push('hinted_evidence_dominant');
    else codes.push('independent_evidence_dominant');
  }

  // ── Retention ──
  if (
    typeof state.currentRetention === 'number' &&
    state.currentRetention < RETENTION_FADING_BELOW
  ) {
    codes.push('retention_fading');
  }

  // ── Review schedule ──
  if (state.nextReviewAt) {
    // ISO-8601 UTC strings compare lexicographically.
    if (state.nextReviewAt <= nowIso) codes.push('review_overdue');
    else codes.push('review_upcoming');
  }

  // ── Recent run ──
  if (typeof state.streakCurrent === 'number' && state.streakCurrent >= STREAK_MIN) {
    codes.push('recent_correct_streak');
  }
  if (
    typeof state.consecutiveWrong === 'number' &&
    state.consecutiveWrong >= CONSECUTIVE_WRONG_MIN
  ) {
    codes.push('recent_consecutive_errors');
  }

  return {
    reasonCodes: codes,
    facts: {
      attempts,
      correctAttempts: correct,
      accuracy,
      independentAttempts: independent,
      hintedAttempts: hinted,
      retention: typeof state.currentRetention === 'number' ? state.currentRetention : null,
      retentionHalfLifeHours:
        typeof state.retentionHalfLife === 'number' ? state.retentionHalfLife : null,
      nextReviewAt: state.nextReviewAt ?? null,
      lastAttemptedAt: state.lastAttemptedAt ?? null,
    },
  };
}
