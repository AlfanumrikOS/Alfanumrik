/**
 * Alfanumrik — Goal-Adaptive Learning Layers / Phase 2 (Layer 4)
 * Goal-aware Mastery DISPLAY thresholds (read-only helpers)
 *
 * Owner: assessment
 * Founder constraint: pure NEW module. ZERO mutation of existing behavior.
 *
 * SCOPE — IMPORTANT: this module changes the DISPLAY threshold ONLY.
 * It does NOT change BKT/IRT internal computations, slip/learn rates, or
 * any algorithm constant inside `cognitive-engine.ts`. The legacy display
 * threshold (0.8 mastery → "Mastered" badge, 0.4 → "developing") is preserved
 * verbatim for callers that pass `goal === null/undefined` OR for callers
 * that opt out of goal-aware behavior (default in `getMasteryDisplayBadge`).
 *
 * Pure data + types. ZERO IO, ZERO React, ZERO side effects, ZERO PII handling.
 *
 * Effect is wired in by the caller behind the `ff_goal_aware_selection`
 * feature flag — when the flag is OFF, no caller invokes these helpers and
 * existing scorecard/progress UI displays byte-identical values to today.
 *
 * Invariants:
 *  - getDisplayMasteryThreshold returns a value in (0, 1]
 *  - getReadinessTargetPct returns an integer in [0, 100]
 *  - Unknown / null goal → legacy defaults (0.8 / 80) so callers that
 *    accidentally pass an unrecognized goal cannot regress display behavior
 *  - classifyMasteryForDisplay never throws on numeric input (clamps via the
 *    threshold comparison; NaN inputs degrade to 'building')
 */

import { resolveGoalProfile, type GoalCode } from './goal-profile';

// ─── Constants ────────────────────────────────────────────────────────────

/** Legacy display threshold preserved for null / unknown goals. */
const LEGACY_DISPLAY_THRESHOLD = 0.8;

/** Legacy readiness target preserved for null / unknown goals. */
const LEGACY_READINESS_PCT = 80;

/** Per-goal "ready" milestone (% to show in scorecard).
 *  Authored — must match the goal persona constitution. */
const READINESS_TARGET_PCT_BY_GOAL: Record<GoalCode, number> = {
  improve_basics: 60,
  pass_comfortably: 70,
  school_topper: 80,
  board_topper: 85,
  competitive_exam: 85,
  olympiad: 90,
};

// ─── Public API ───────────────────────────────────────────────────────────

/**
 * The probability above which the UI displays a "Mastered" badge for a concept.
 * Reads `goal.masteryThreshold` from `GOAL_PROFILES`.
 *
 * Returns 0.8 (legacy default) for unknown / null / undefined goals so the
 * UI never regresses when a flag-gated caller forgets to pass a goal.
 */
export function getDisplayMasteryThreshold(
  goal: GoalCode | null | undefined,
): number {
  const profile = resolveGoalProfile(goal ?? undefined);
  if (!profile) return LEGACY_DISPLAY_THRESHOLD;
  return profile.masteryThreshold;
}

/**
 * The "ready" milestone for a given goal, expressed as a percent 0-100.
 *
 * Used by the scorecard to surface a concrete target percentage in the
 * goal-aware sentence (e.g. "You're at 65% readiness for board_topper —
 * target is 85%."). Returns 80 for unknown / null goals (matches legacy).
 */
export function getReadinessTargetPct(
  goal: GoalCode | null | undefined,
): number {
  if (!goal) return LEGACY_READINESS_PCT;
  const value = READINESS_TARGET_PCT_BY_GOAL[goal];
  return typeof value === 'number' ? value : LEGACY_READINESS_PCT;
}

/**
 * Classify a mastery probability into one of three display states.
 *
 *  - 'mastered'   if mastery >= threshold
 *  - 'developing' if mastery >= 0.5 * threshold
 *  - 'building'   otherwise (or when mastery is NaN)
 *
 * Pure function. Used by UI badge components to render the right colour /
 * label / icon. Algorithm internals (BKT/IRT/SM-2) keep their own thresholds.
 */
export function classifyMasteryForDisplay(
  mastery: number,
  goal: GoalCode | null | undefined,
): 'mastered' | 'developing' | 'building' {
  const threshold = getDisplayMasteryThreshold(goal);
  // NaN-safe: any NaN comparison returns false, so it falls through to 'building'.
  if (mastery >= threshold) return 'mastered';
  if (mastery >= threshold * 0.5) return 'developing';
  return 'building';
}
