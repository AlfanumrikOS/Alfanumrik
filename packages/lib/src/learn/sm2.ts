/**
 * Alfanumrik — CANONICAL TypeScript SM-2 (Foxy North-Star Phase 3, E4/F10).
 *
 * THE single TS implementation of the SM-2 spaced-repetition step. Moved
 * VERBATIM (math, constants, clamps untouched) from
 * `apps/host/src/app/api/learner/review/grade/helpers.ts`, which is now a
 * thin re-export of this module. Do NOT copy this algorithm anywhere else —
 * extend/import this module instead.
 *
 * Pinned twin: the SQL SM-2 in `supabase/migrations/` (the
 * `update_learner_state_post_quiz` chain and the concept_mastery review RPCs
 * in the baseline). Per plan §4.3 / F10 the SQL RPC is the source of the
 * frozen parameter values and this file is the marked TS mirror:
 *   - ease factor bounds: 1.3 … 3.0
 *   - interval cap: 365 days
 *   - streak cap: 100
 *   - quality domain: {0, 3, 4, 5} (forgot / hard / good / easy)
 * Changing ANY of these requires assessment sign-off AND a matching SQL
 * migration in the same change (they must never diverge).
 *
 * Analyzer note (scripts/foxy-alignment/analyze.mjs, check 6 "SM-2 update"):
 * this file is the [canonical] allowlist entry for the /applySm2/ signature;
 * `.../review/grade/helpers.ts` and `route.ts` remain allowlisted only as
 * re-export/caller. Any new file matching the signature fails the analyzer.
 */

const EASE_FLOOR = 1.3;
const EASE_CEIL = 3.0;
const INTERVAL_CAP_DAYS = 365;
const STREAK_CAP = 100;

export interface Sm2Input {
  easeFactor: number;
  intervalDays: number;
  streak: number;
  quality: 0 | 3 | 4 | 5;
}

export interface Sm2Output {
  easeFactor: number;
  intervalDays: number;
  streak: number;
}

export function applySm2(input: Sm2Input): Sm2Output {
  let newEase = input.easeFactor + (0.1 - (5 - input.quality) * (0.08 + (5 - input.quality) * 0.02));
  if (newEase < EASE_FLOOR) newEase = EASE_FLOOR;
  if (newEase > EASE_CEIL) newEase = EASE_CEIL;

  let newInterval = input.intervalDays;
  let newStreak = input.streak;

  if (input.quality < 3) {
    newInterval = 1;
    newStreak = 0;
  } else {
    if (input.streak === 0) newInterval = 1;
    else if (input.streak === 1) newInterval = 6;
    else newInterval = Math.round(input.intervalDays * newEase);
    newStreak = input.streak + 1;
  }

  if (newInterval > INTERVAL_CAP_DAYS) newInterval = INTERVAL_CAP_DAYS;
  if (newStreak > STREAK_CAP) newStreak = STREAK_CAP;

  return { easeFactor: newEase, intervalDays: newInterval, streak: newStreak };
}

/**
 * Initial SM-2 parameters for a brand-new card, matching the DB column
 * defaults on `spaced_repetition_cards` (ease_factor 2.5, interval_days 1,
 * streak 0) and on `concept_mastery` (ease_factor 2.5, sm2_interval 1).
 * Single place new-card params come from — never inline these numbers.
 */
export function initialCardParams(): Sm2Output {
  return { easeFactor: 2.5, intervalDays: 1, streak: 0 };
}
