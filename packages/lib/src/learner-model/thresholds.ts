/**
 * Learner-model facade — SINGLE source for mastery-band + ZPD thresholds.
 *
 * ⚠ MIRROR of SQL RPC 20260623000100 (update_learner_state_post_quiz) — keep
 * in lockstep. The categorical band literals below (0.95 / 0.70 / 0.40) are
 * copied from the RPC's band CASE:
 *
 *   v_new_mastery >= 0.95 -> 'mastered'
 *   v_new_mastery >= 0.70 -> 'proficient'
 *   v_new_mastery >= 0.40 -> 'developing'
 *   else                  -> 'beginner'
 *   (attempts = 0         -> 'not_started', defensive)
 *
 * The lockstep is pinned by
 * `packages/lib/src/__tests__/learner-model/thresholds-lockstep.test.ts`
 * (REG-48 pattern: the test reads the migration file text and asserts the SQL
 * literals match these TS constants). If you change a value here without a
 * matching migration — or vice versa — that test fails the build.
 *
 * The 0.60 / 0.85 pair are the live next-action ladder cutoffs (practice vs
 * challenge / mastered) mirrored from the cme-engine documented order and
 * executed today in `deriveNextAction` (moved verbatim into ./next-action.ts)
 * — the same 0.85 is the Vygotsky ZPD sweet-spot ceiling named
 * MASTERY_ZPD_CEILING in cognitive-engine.ts.
 *
 * FOXY_MASTERY_LOW / FOXY_MASTERY_HIGH are the Foxy cognitive-context
 * masteryLevel cuts (avgMastery < 0.4 → 'low', < 0.7 → 'medium', else 'high')
 * previously duplicated between the Foxy route loaders and the
 * grounded-answer prompts (design S1.4: "thresholds 0.4/0.7 duplicated" —
 * this file is the consolidation point).
 *
 * Design: docs/superpowers/specs/2026-08-05-foxy-north-star-alignment-design.md
 * ("One constants source per domain: … thresholds=facade"). Owner: backend
 * (module) + assessment (values — changing any number here is an
 * assessment-approval change).
 */

// ─── Categorical mastery band (SQL RPC 20260623000100 — lockstep) ────────────

/** mastery_probability >= 0.40 → 'developing' (below: 'beginner'). */
export const MASTERY_BAND_DEVELOPING_MIN = 0.4;
/** mastery_probability >= 0.70 → 'proficient'. */
export const MASTERY_BAND_PROFICIENT_MIN = 0.7;
/** mastery_probability >= 0.95 → 'mastered'. */
export const MASTERY_BAND_MASTERED_MIN = 0.95;

/** Categorical band vocabulary — exactly the SQL RPC's CASE outputs. */
export type MasteryBand =
  | 'not_started'
  | 'beginner'
  | 'developing'
  | 'proficient'
  | 'mastered';

/**
 * TS twin of the SQL band CASE. `attempts === 0` → 'not_started' (defensive —
 * the RPC always writes attempts >= 1, branch kept for contract symmetry with
 * the 20260623000000 backfill's band derivation).
 */
export function masteryBandFor(
  masteryProbability: number,
  attempts: number,
): MasteryBand {
  if (attempts === 0) return 'not_started';
  if (masteryProbability >= MASTERY_BAND_MASTERED_MIN) return 'mastered';
  if (masteryProbability >= MASTERY_BAND_PROFICIENT_MIN) return 'proficient';
  if (masteryProbability >= MASTERY_BAND_DEVELOPING_MIN) return 'developing';
  return 'beginner';
}

// ─── Next-action ladder cutoffs (deriveNextAction — cme-engine mirror) ───────

/**
 * Weak-topic / practice cutoff: mastery_probability < 0.60 → 'practice' in
 * the next-action ladder; also the loadCognitiveContext weakTopics cut and
 * the chapter-ladder TOPIC_MASTERED_THRESHOLD.
 */
export const MASTERY_PRACTICE_THRESHOLD = 0.6;

/**
 * "Approaching mastery" ceiling: mastery_probability < 0.85 → still
 * actionable ('challenge' above 0.60); >= 0.85 counts as mastered for the
 * ladder. Same value as cognitive-engine's MASTERY_ZPD_CEILING (Vygotsky
 * 70–85% success-band upper bound).
 */
export const MASTERY_CHALLENGE_CEILING = 0.85;

/** >= 3 conceptual errors in 30d triggers the 're_teach' ladder rung. */
export const RETEACH_CONCEPTUAL_ERROR_MIN = 3;

// ─── Foxy cognitive-context masteryLevel cuts ────────────────────────────────

/** avgMastery < 0.4 → masteryLevel 'low' (Foxy prompt rails). */
export const FOXY_MASTERY_LOW = 0.4;
/** avgMastery < 0.7 → 'medium'; >= 0.7 → 'high'. */
export const FOXY_MASTERY_HIGH = 0.7;

// ─── Foxy weak-areas intent-chip cuts (assessment mandate, 2026-08-05) ───────
//
// Assessment mandate on the Phase 2 topic_mastery_rollup re-point: with a BKT
// prior of 0.1, a topic that is 1-for-1 sits at ~0.43 mastery_probability —
// below the 0.5 weak cut purely from thin evidence. A topic with fewer than
// WEAK_AREA_MIN_ATTEMPTS total attempts is "not enough data yet", NEVER
// "weak", and must be excluded from the weak-areas chip set. The 0.5 cut is
// named here so the Foxy route imports it instead of hardcoding it.

/** mastery_probability < 0.5 → candidate for the "My weak areas" chip. */
export const WEAK_AREA_CHIP_THRESHOLD = 0.5;
/** Rows with total_attempts < 3 are excluded from the weak set (thin evidence). */
export const WEAK_AREA_MIN_ATTEMPTS = 3;

// ─── ZPD constants (cognitive-engine calculateZPD — named here) ──────────────
//
// calculateZPD(currentMastery, recentAccuracy):
//   target = clamp(currentMastery + ZPD_TARGET_PUSH
//                  + (recentAccuracy - ZPD_ACCURACY_ANCHOR) * ZPD_ACCURACY_ADJUSTMENT,
//                  ZPD_TARGET_MIN, ZPD_TARGET_MAX)

/** Push the ZPD target 10% above current mastery. */
export const ZPD_TARGET_PUSH = 0.1;
/** Recent-accuracy anchor: 0.75 = middle of the 70–85% success sweet spot. */
export const ZPD_ACCURACY_ANCHOR = 0.75;
/** Weight of the recent-accuracy adjustment on the ZPD target. */
export const ZPD_ACCURACY_ADJUSTMENT = 0.2;
/** ZPD target difficulty floor. */
export const ZPD_TARGET_MIN = 0.1;
/** ZPD target difficulty cap (executed literal in calculateZPD). */
export const ZPD_TARGET_MAX = 0.95;
/**
 * Vygotsky ZPD sweet-spot ceiling (documented 70–85% success-band upper
 * bound) — same value as MASTERY_CHALLENGE_CEILING by design.
 */
export const ZPD_SWEET_SPOT_CEILING = 0.85;
