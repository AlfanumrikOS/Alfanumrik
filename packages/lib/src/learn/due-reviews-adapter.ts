/**
 * Pedagogy v2 — Wave 1B
 * `get_due_reviews` RPC rows → DueSm2Card[] adapter.
 *
 * The orchestrator's `daily-rhythm-orchestrator.ts` (shipped in Wave 1A)
 * takes `DueSm2Card[]` as input — that interface is the contract this
 * adapter fulfills. We do NOT modify the orchestrator. We adapt RPC output
 * shape into it.
 *
 * The RPC `get_due_reviews(p_student_id, p_subject_code, p_limit)` is
 * defined in `supabase/migrations/00000000000000_baseline_from_prod.sql`
 * (line 4615). It returns rows already filtered to due-for-review topics,
 * one row per topic. We map topic_id → questionId via a separate lookup
 * (one active question per topic), order by mastery_probability ascending
 * so the most-forgotten reviews come first, and tag ahead-of-grade
 * concepts via a set the route builds from a curriculum-vs-student-grade
 * comparison.
 *
 * Pure function. ZERO IO, ZERO React, ZERO PII handling.
 *
 * Spec: docs/superpowers/specs/2026-05-08-pedagogy-v2-three-speed-rhythm-design.md
 * Plan: docs/superpowers/plans/2026-05-09-pedagogy-v2-wave-1b-rhythm-data-and-surface.md
 */

import type { DueSm2Card } from './daily-rhythm-orchestrator';

/**
 * Shape of a row returned by the `get_due_reviews` RPC. Only the columns
 * this adapter consumes are typed — the RPC also returns `title`,
 * `title_hi`, but we don't use them at the adapter layer.
 */
export interface DueReviewRow {
  topic_id: string;
  mastery_probability: number | null;
  last_attempted_at: string | null;
  review_interval_days: number;
}

export interface DueReviewsAdapterInput {
  rows: DueReviewRow[];
  /** Map topic_id → an active question_id for that topic. Built by the route. */
  conceptToQuestion: Map<string, string>;
  /** Set of topic_ids whose curriculum grade exceeds the student's grade. */
  aheadOfGradeConceptIds: Set<string>;
}

/**
 * Translate due-review RPC rows into DueSm2Card objects ordered by urgency.
 *
 * Ordering: ascending by mastery_probability (least mastered first). Null
 * mastery_probability is treated as 1.0 — these are surfaces of the SRS
 * cron's least-confidence picks, so a null is "we have no signal yet" and
 * should sort behind known-low-mastery items.
 *
 * Filtering: rows without a question mapping are dropped silently. The
 * route is responsible for building a complete-as-possible mapping; if it
 * gives us partial coverage, we don't fail — we emit fewer cards.
 */
export function dueReviewsToCards(input: DueReviewsAdapterInput): DueSm2Card[] {
  return input.rows
    .filter((r) => input.conceptToQuestion.has(r.topic_id))
    .slice() // copy before sort to avoid mutating input
    .sort((a, b) => {
      const am = a.mastery_probability ?? 1;
      const bm = b.mastery_probability ?? 1;
      return am - bm;
    })
    .map((r) => ({
      questionId: input.conceptToQuestion.get(r.topic_id)!,
      topicId: r.topic_id,
      isAheadOfGrade: input.aheadOfGradeConceptIds.has(r.topic_id),
    }));
}
