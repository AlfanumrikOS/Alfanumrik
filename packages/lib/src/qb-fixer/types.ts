/**
 * Types for the QB fix-failed-questions agent.
 *
 * Spec: docs/superpowers/specs/2026-05-10-qb-qa-fix-failed-questions-design.md
 */

export interface FailedQuestion {
  id: string;
  question_text: string;
  options: string[];
  claimed_correct_index: number;
  explanation: string;
  grade: string;
  subject: string;
  chapter_number: number | null;
  chapter_title: string | null;
  /** Latest verifier verdict from grounded_ai_traces; null if no trace exists. */
  last_verifier_reason: string | null;
  /** What the verifier thought the correct index was; null if it didn't say. */
  last_verifier_correct_index: number | null;
}

// NOTE: 'full_regen' is reused as a bookkeeping label for the "reverified
// unchanged, nothing regenerated" outcome of the retry-on-chapter_not_ready
// path (see fix-failed-questions/system-prompt.ts and
// fix-failed-questions/tools/commit-fix.ts), since
// question_bank_fix_history.fix_strategy's CHECK constraint (supabase/
// migrations/20260510064952_qb_fixer.sql) has no dedicated value for it — a
// real fix (a new enum value via an additive migration) is a tracked
// follow-up, not done here.
export type FixStrategy = 'index_correction' | 'explanation_only' | 'full_regen';

export interface RegenCandidate {
  question: string;
  options: [string, string, string, string];
  correct_answer_index: 0 | 1 | 2 | 3;
  explanation: string;
}

export type FixOutcome = 'verified' | 'still_failed' | 'marked_unfixable' | 'budget_exceeded' | 'error';

export interface SweepResult {
  claimed: number;
  verified: number;
  marked_unfixable: number;
  still_failed: number;
  budget_exceeded: number;
  errors: number;
  duration_ms: number;
}
