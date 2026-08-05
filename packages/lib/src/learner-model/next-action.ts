/**
 * Learner-model facade — the CME next-action priority ladder (pure).
 *
 * MOVED VERBATIM (2026-08-05, Foxy North-Star Phase 2 workstream A) from
 * `apps/host/src/app/api/foxy/_lib/cognitive-context.ts` (which re-points to
 * this module). Pure logic only — no I/O. Mirrors the retired cme-engine's
 * documented 5-priority order.
 *
 * ─── L3 LADDER COMPLETION (Foxy North-Star Phase 4, 2026-08-05) ───────────
 * The ladder now supports TWO shapes, selected by the `newLadder` input:
 *
 *   NEW LADDER (newLadder === true, gated at the caller by
 *   `ff_foxy_decide_ladder_v1`, seeded by migration 20260811000000):
 *     (1) safetyHold.active                       → 'safety_hold'
 *     (2) openAssignments (earliest due, non-null → 'assigned_work'
 *         NULLS LAST — subject/grade filtering
 *         is applied by the CALLER before this
 *         function; this rung fires on any row
 *         present in the array)
 *     (3) forgetting risk (overdue review)        → 'revise'
 *     (4) prerequisite / knowledge gap            → 'remediate'
 *     (5) repeated conceptual errors (>=3)        → 're_teach'
 *     (6) next unmastered concept                 → 'practice' / 'challenge'
 *     (7) nothing actionable                      → null
 *
 *   LEGACY LADDER (newLadder undefined/false — flag OFF; DEFAULT for
 *   backwards compatibility; byte-identical to the pre-Phase-4 shape;
 *   existing next-action.test.ts + adaptive-differential REG-231..234 pin
 *   this behavior):
 *     (1) prerequisite gap  (2) overdue  (3) >=3 conceptual  (4) unmastered
 *     (5) null
 *
 * Tiers 3 and 4 (revise/remediate) SWAP between the two modes — legacy runs
 * gap-before-overdue, new runs overdue-before-gap (the design's forgetting-
 * risk-first policy). Callers who OMIT `newLadder` (or pass false) receive
 * the LEGACY ladder — the safe backwards-compatible default; passing
 * `newLadder: true` enables the new 7-tier shape.
 *
 * The three ladder cutoffs are re-exported from ./thresholds — the single
 * constants source (design decision: "thresholds=facade"). Ladder ordering is
 * pinned by two tests:
 *   - `next-action.test.ts` (existing legacy-behavior pin — additive
 *      safetyHold/openAssignments fields are ignored when newLadder is off)
 *   - `next-action-order.test.ts` (the NEW 7-tier strict-order pin — an input
 *      where ALL 7 tiers fire, then peel one per assertion; plus a legacy-
 *      mode assertion pinning gap-before-overdue as the compat path).
 *
 * `getNextAction` is an alias of `deriveNextAction` — the facade name the
 * design (E3/L3) uses; both are the same function.
 */

import {
  MASTERY_CHALLENGE_CEILING,
  MASTERY_PRACTICE_THRESHOLD,
  RETEACH_CONCEPTUAL_ERROR_MIN,
} from './thresholds';

/**
 * L3 additive: a safeguarding hold that must PREEMPT every teaching action.
 * Populated by the caller when a safeguarding escalation is open on the
 * student's account or a pending review is queued. When `active === true`
 * this fires the tier-1 `safety_hold` rung of the NEW ladder — no other
 * signal is consulted. Ignored when `newLadder` is off (legacy mode).
 */
export interface SafetyHoldInput {
  active: boolean;
  reason: 'safeguarding_escalation_open' | 'safeguarding_review_pending';
}

/**
 * L3 additive: an OPEN assignment relevant to this student. Subject and
 * grade filtering happens UPSTREAM at the query layer (P5: `grade` is a
 * string). Any row present here is eligible to fire the tier-2
 * `assigned_work` rung; ties break by earliest `dueDate` (NULLS LAST,
 * ISO-string lexicographic sort). Ignored when `newLadder` is off.
 */
export interface OpenAssignmentInput {
  assignmentId: string;
  title: string;
  subjectCode: string | null;
  /** P5: grade is a STRING ("6".."12") or null. NEVER an integer. */
  grade: string | null;
  /** ISO-8601 due date; null → treated as latest-sortable (NULLS LAST). */
  dueDate: string | null;
  chapter: string | null;
}

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
  /**
   * L3 (Phase 4, 2026-08-05): safeguarding hold. Fires ladder tier 1
   * `safety_hold` in NEW ladder when `active === true`. Ignored in legacy.
   * OPTIONAL — omitted or null means "no hold".
   */
  safetyHold?: SafetyHoldInput | null;
  /**
   * L3 (Phase 4, 2026-08-05): open assignments (already subject-filtered
   * at the query layer). Fires ladder tier 2 `assigned_work` in NEW ladder.
   * Ignored in legacy mode. OPTIONAL — undefined or [] means "no work".
   */
  openAssignments?: OpenAssignmentInput[];
  /**
   * L3 (Phase 4, 2026-08-05): opt-in switch selecting the 7-tier ladder.
   * DEFAULT (undefined/false) = legacy 5-tier ladder (byte-identical to the
   * pre-Phase-4 shape). Callers gate this on `ff_foxy_decide_ladder_v1`.
   */
  newLadder?: boolean;
}

// Mirrors cme-engine selectNextAction cutoffs: >=3 conceptual errors triggers
// re-teach; mastery_mean < 0.6 → practice; < 0.85 → challenge; >= 0.85 mastered.
// Values live in ./thresholds (single source). RETEACH_CONCEPTUAL_ERROR_MIN is
// exported from ./thresholds directly (barrel re-exports it); the two mastery
// cutoffs are re-declared here under their historical ladder names so existing
// consumers keep importing them unchanged.
export const NEXT_CONCEPT_PRACTICE_THRESHOLD = MASTERY_PRACTICE_THRESHOLD;
export const NEXT_CONCEPT_MASTERED_THRESHOLD = MASTERY_CHALLENGE_CEILING;

/** Union of possible actionType return values from `deriveNextAction`. */
export type NextActionType =
  | 'safety_hold'
  | 'assigned_work'
  | 'remediate'
  | 'revise'
  | 're_teach'
  | 'practice'
  | 'challenge';

export interface NextActionResult {
  actionType: NextActionType;
  conceptName: string;
  reason: string;
}

/** Tie-break comparator: earliest dueDate first, NULLS LAST. Pure. */
function compareAssignmentsByDueDateNullsLast(
  a: OpenAssignmentInput,
  b: OpenAssignmentInput,
): number {
  const ad = a.dueDate;
  const bd = b.dueDate;
  if (ad === null && bd === null) return 0;
  if (ad === null) return 1; // NULLS LAST
  if (bd === null) return -1;
  return ad.localeCompare(bd); // ISO-8601 sorts lexicographically
}

export function deriveNextAction(
  input: NextActionInputs,
): NextActionResult | null {
  const useNewLadder = input.newLadder === true;

  // ─── NEW LADDER (Phase 4, ff_foxy_decide_ladder_v1 ON) ─────────────────
  if (useNewLadder) {
    // (1) Safety hold — preempts every teaching signal.
    if (input.safetyHold && input.safetyHold.active) {
      return {
        actionType: 'safety_hold',
        conceptName: '',
        reason:
          input.safetyHold.reason === 'safeguarding_escalation_open'
            ? 'Safeguarding escalation open — teaching paused pending review'
            : 'Safeguarding review pending — teaching paused pending review',
      };
    }

    // (2) Assigned work — earliest due date first (NULLS LAST). Subject/
    // grade filtering is applied UPSTREAM at the query, not here.
    const assignments = input.openAssignments ?? [];
    if (assignments.length > 0) {
      const next = [...assignments].sort(compareAssignmentsByDueDateNullsLast)[0];
      return {
        actionType: 'assigned_work',
        conceptName: next.title,
        reason: 'Open assignment is due — prioritising assigned work',
      };
    }

    // (3) Forgetting risk — overdue review, weakest mastery first; tie-
    // break on oldest next_review_at (ISO strings compare lexicographically).
    // SWAPPED with tier 4 vs. legacy — new-ladder policy is
    // forgetting-risk-first.
    const overdueNew = [...input.revisionDue]
      .filter((r) => r.title.trim().length > 0)
      .sort((a, b) => a.mastery - b.mastery || a.lastReviewed.localeCompare(b.lastReviewed))[0];
    if (overdueNew) {
      return {
        actionType: 'revise',
        conceptName: overdueNew.title,
        reason: 'Previously learned concept fading — revision needed',
      };
    }

    // (4) Prerequisite / knowledge gap — remediate the prerequisite when
    // named, else the gap's target concept. SWAPPED with tier 3 vs. legacy.
    const gapNew = input.knowledgeGaps.find(
      (g) => ((g.prerequisite || g.target) ?? '').trim().length > 0,
    );
    if (gapNew) {
      return {
        actionType: 'remediate',
        conceptName: (gapNew.prerequisite || gapNew.target).trim(),
        reason: 'Prerequisite gap needs remediation before advancing',
      };
    }

    // (5-7) fall through to the shared re_teach / practice / challenge / null
    // tail below — semantics unchanged from legacy.
    return deriveNextActionTail(input);
  }

  // ─── LEGACY LADDER (default — flag OFF, byte-identical) ────────────────
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

  // (3) re_teach → (4) practice/challenge → (5) null — shared tail.
  return deriveNextActionTail(input);
}

/**
 * Shared TAIL of the ladder — the re_teach / practice / challenge / null
 * tiers. Semantics IDENTICAL across legacy and new-ladder modes; extracted
 * only so the new-ladder path can reuse them after its tier-3/tier-4 swap.
 * Not exported.
 */
function deriveNextActionTail(input: NextActionInputs): NextActionResult | null {
  // Unmastered concepts, lowest mastery first (defensive sort — callers pass
  // rows already ordered ascending by mastery_probability).
  const unmastered = input.masteryTopics
    .filter(
      (t) => t.title.trim().length > 0 && t.masteryProbability < NEXT_CONCEPT_MASTERED_THRESHOLD,
    )
    .sort((a, b) => a.masteryProbability - b.masteryProbability);

  // Repeated conceptual errors → re-teach the weakest known concept.
  const conceptual = input.recentErrors.find((e) => e.errorType === 'conceptual');
  if (conceptual && conceptual.count >= RETEACH_CONCEPTUAL_ERROR_MIN && unmastered.length > 0) {
    return {
      actionType: 're_teach',
      conceptName: unmastered[0].title,
      reason: 'Repeated conceptual errors — needs a different explanation approach',
    };
  }

  // Next unmastered concept — lowest mastery_probability below threshold.
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

  // Nothing actionable → null (exam-prep / cold-start rails apply).
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
