/**
 * Learner-model facade — the CME next-action priority ladder (pure).
 *
 * MOVED VERBATIM (2026-08-05, Foxy North-Star Phase 2 workstream A) from
 * `apps/host/src/app/api/foxy/_lib/cognitive-context.ts` (which re-points to
 * this module). Pure logic only — no I/O. Mirrors the retired cme-engine's
 * documented 5-priority order (supabase/functions/cme-engine/index.ts
 * selectNextAction):
 *   (1) prerequisite / knowledge gap      → 'remediate'
 *   (2) forgetting risk (overdue review)  → 'revise'
 *   (3) repeated conceptual errors (>=3)  → 're_teach'
 *   (4) next unmastered concept           → 'practice' / 'challenge'
 *   (5) nothing actionable                → null (exam-prep / cold-start
 *       rails handle the no-signal case; see nullNextActionReason)
 *
 * The three ladder cutoffs are re-exported from ./thresholds — the single
 * constants source (design decision: "thresholds=facade"). Ladder ordering is
 * pinned by `packages/lib/src/__tests__/learner-model/next-action.test.ts`
 * and (via the apps/host re-export) `adaptive-differential.test.ts`
 * (REG-231..234).
 *
 * `getNextAction` is an alias of `deriveNextAction` — the facade name the
 * design (E3/L3) uses; both are the same function.
 */

import {
  MASTERY_CHALLENGE_CEILING,
  MASTERY_PRACTICE_THRESHOLD,
  RETEACH_CONCEPTUAL_ERROR_MIN,
} from './thresholds';

export interface NextActionInputs {
  /** Unresolved knowledge gaps (loadCognitiveContext shape). */
  knowledgeGaps: Array<{ target: string; prerequisite: string; gapType: string }>;
  /** Overdue reviews (next_review_at <= now); mastery is the 0-100 integer. */
  revisionDue: Array<{ title: string; lastReviewed: string; mastery: number }>;
  /** 30d cme_error_log counts by error_type. */
  recentErrors: Array<{ errorType: string; count: number }>;
  /** Subject-filtered concept_mastery rows: title + raw mastery_probability (0-1). */
  masteryTopics: Array<{ title: string; masteryProbability: number }>;
  /**
   * OPTIONAL (additive, 2026-08-05): the student's academic goal. Used ONLY
   * to annotate the tier-5 null-case reason string (see
   * `nullNextActionReason`) — it does NOT reorder or gate any ladder rung,
   * and `deriveNextAction`'s return value is byte-identical with or without
   * it (tier 5 still returns null).
   */
  academicGoal?: { code: string } | null;
}

// Mirrors cme-engine selectNextAction cutoffs: >=3 conceptual errors triggers
// re-teach; mastery_mean < 0.6 → practice; < 0.85 → challenge; >= 0.85 mastered.
// Values live in ./thresholds (single source). RETEACH_CONCEPTUAL_ERROR_MIN is
// exported from ./thresholds directly (barrel re-exports it); the two mastery
// cutoffs are re-declared here under their historical ladder names so existing
// consumers keep importing them unchanged.
export const NEXT_CONCEPT_PRACTICE_THRESHOLD = MASTERY_PRACTICE_THRESHOLD;
export const NEXT_CONCEPT_MASTERED_THRESHOLD = MASTERY_CHALLENGE_CEILING;

export function deriveNextAction(
  input: NextActionInputs,
): { actionType: string; conceptName: string; reason: string } | null {
  // (1) Prerequisite / knowledge gap — remediate the prerequisite when named,
  // else the gap's target concept.
  const gap = input.knowledgeGaps.find(
    (g) => ((g.prerequisite || g.target) ?? '').trim().length > 0,
  );
  if (gap) {
    return {
      actionType: 'remediate',
      conceptName: (gap.prerequisite || gap.target).trim(),
      reason: 'Prerequisite gap needs remediation before advancing',
    };
  }

  // (2) Forgetting risk — overdue review, weakest mastery first; tie-break on
  // oldest next_review_at (ISO strings compare lexicographically).
  const overdue = [...input.revisionDue]
    .filter((r) => r.title.trim().length > 0)
    .sort((a, b) => a.mastery - b.mastery || a.lastReviewed.localeCompare(b.lastReviewed))[0];
  if (overdue) {
    return {
      actionType: 'revise',
      conceptName: overdue.title,
      reason: 'Previously learned concept fading — revision needed',
    };
  }

  // Unmastered concepts, lowest mastery first (defensive sort — callers pass
  // rows already ordered ascending by mastery_probability).
  const unmastered = input.masteryTopics
    .filter(
      (t) => t.title.trim().length > 0 && t.masteryProbability < NEXT_CONCEPT_MASTERED_THRESHOLD,
    )
    .sort((a, b) => a.masteryProbability - b.masteryProbability);

  // (3) Repeated conceptual errors → re-teach the weakest known concept.
  const conceptual = input.recentErrors.find((e) => e.errorType === 'conceptual');
  if (conceptual && conceptual.count >= RETEACH_CONCEPTUAL_ERROR_MIN && unmastered.length > 0) {
    return {
      actionType: 're_teach',
      conceptName: unmastered[0].title,
      reason: 'Repeated conceptual errors — needs a different explanation approach',
    };
  }

  // (4) Next unmastered concept — lowest mastery_probability below threshold.
  if (unmastered.length > 0) {
    const next = unmastered[0];
    return next.masteryProbability < NEXT_CONCEPT_PRACTICE_THRESHOLD
      ? {
          actionType: 'practice',
          conceptName: next.title,
          reason: 'Partially learned — needs more practice',
        }
      : {
          actionType: 'challenge',
          conceptName: next.title,
          reason: 'Approaching mastery — increasing difficulty',
        };
  }

  // (5) No actionable signal → null (exam-prep / cold-start rails apply).
  return null;
}

/**
 * Facade name for the same ladder (design E3/L3: "expose via facade
 * getNextAction"). Identical function — NOT a wrapper.
 */
export const getNextAction = deriveNextAction;

/**
 * Tier-5 null-case annotation. `deriveNextAction` returns bare null when no
 * ladder rung fires (behavior-pinned); surfaces that want to EXPLAIN that
 * null (Foxy prompt "RECOMMENDED ACTION" block, the Close stage, teacher
 * insights) call this with the same optional `academicGoal` the inputs carry.
 * Evidence-language only — describes the signal state, never the student.
 */
export function nullNextActionReason(
  academicGoal?: { code: string } | null,
): string {
  return academicGoal?.code
    ? `No actionable signal — defaulting to the '${academicGoal.code}' goal rails (exam-prep / cold-start)`
    : 'No actionable signal — exam-prep / cold-start rails apply';
}
