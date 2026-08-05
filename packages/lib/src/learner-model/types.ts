/**
 * Learner-model facade — shared types.
 *
 * The facade (design E3) is the ONE read surface over the canonical learner
 * model (`concept_mastery` + the `update_learner_state_post_quiz` writer).
 * It never writes (E6). Types here are the wire-agnostic shapes the facade
 * functions return; readers project them onto their own wire contracts.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { DueReviewRow as AdapterDueReviewRow } from '@alfanumrik/lib/learn/due-reviews-adapter';

/**
 * Minimal structural seam for the injected Supabase client (house pattern —
 * same as `RhythmQueueClient` in build-rhythm-queue.ts and the pulse-server
 * convention of authorizing UPSTREAM): only `from` + `rpc` are used, so both
 * the RLS-scoped server client and the service-role admin client satisfy it.
 * The CALLER chooses which client to inject — the facade never bypasses RLS
 * on its own (P8).
 */
export type LearnerModelClient = Pick<SupabaseClient, 'from' | 'rpc'>;

/**
 * One (student, topic) row of the canonical mastery store, camelCased.
 * `masteryProbability` is the canonical numeric posterior (null only for
 * legacy rows the backfill missed); `masteryLevel` is the derived categorical
 * band string the SQL writes ('beginner' | 'developing' | 'proficient' |
 * 'mastered' | 'not_started').
 */
export interface MasteryState {
  topicId: string;
  /** curriculum_topics.title via the FK join; null when the join is empty. */
  title: string | null;
  /** curriculum_topics.subject_id via the FK join; null when unknown. */
  subjectId: string | null;
  masteryProbability: number | null;
  masteryLevel: string | null;
  attempts: number;
  correctAttempts: number;
  hintsUsed: number | null;
  easeFactor: number | null;
  reviewIntervalDays: number | null;
  nextReviewAt: string | null;
  lastAttemptedAt: string | null;
  retentionHalfLife: number | null;
  currentRetention: number | null;
  streakCurrent: number | null;
  consecutiveWrong: number | null;
  consecutiveCorrect: number | null;
  updatedAt: string | null;
}

/**
 * A due-review row as returned by the facade's `getDueReviews`: the
 * `get_due_reviews` RPC's 6 columns PLUS the F7 additive SM-2 merge fields
 * (`ease_factor` / `next_review_at`, batch-fetched from concept_mastery)
 * PLUS the display fields (`title`, `title_hi`, best-effort subject) that
 * the dive routes consume.
 *
 * Extends the due-reviews-adapter row (snake_case, by design) so facade rows
 * feed `dueReviewsToCards` directly with no re-mapping.
 */
export interface DueReviewRow extends AdapterDueReviewRow {
  title: string | null;
  title_hi: string | null;
  /** Best-effort subject code if the RPC surfaces one (not in the frozen 6-col contract). */
  subject_code: string | null;
  subject: string | null;
}

/** The next-action ladder's non-null recommendation shape. */
export interface NextAction {
  actionType: string;
  conceptName: string;
  reason: string;
}

export type { NextActionInputs } from './next-action';

/**
 * Evidence-language reason codes for `explainMastery` (T1: describe
 * evidence, never judge identity — codes name what the DATA shows, never
 * what the student "is").
 */
export type MasteryReasonCode =
  | 'no_attempts_yet'
  | 'few_attempts'
  | 'high_accuracy_evidence'
  | 'mixed_accuracy_evidence'
  | 'low_accuracy_evidence'
  | 'hinted_evidence_dominant'
  | 'independent_evidence_dominant'
  | 'retention_fading'
  | 'review_overdue'
  | 'review_upcoming'
  | 'recent_correct_streak'
  | 'recent_consecutive_errors';

/**
 * Pure, PII-free explanation of a MasteryState: WHY the number is what it is,
 * stated as evidence facts. No identity labels, no diagnoses (PR1/PR2/T1).
 */
export interface MasteryExplanation {
  reasonCodes: MasteryReasonCode[];
  facts: {
    attempts: number;
    correctAttempts: number;
    /** correctAttempts / attempts, or null when attempts = 0. */
    accuracy: number | null;
    /** attempts - hintsUsed (floored at 0), or null when hints are untracked. */
    independentAttempts: number | null;
    /** hints_used counter, or null when untracked. */
    hintedAttempts: number | null;
    /** current_retention (0-1) at last practice, or null. */
    retention: number | null;
    retentionHalfLifeHours: number | null;
    nextReviewAt: string | null;
    lastAttemptedAt: string | null;
  };
}
