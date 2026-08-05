/**
 * Learner-model READ FACADE (Foxy North-Star Phase 2 workstream A, design E3).
 *
 * The ONE read surface over the canonical learner model: `concept_mastery`
 * written solely by `update_learner_state_post_quiz` (SQL RPC 20260623000100)
 * inside the atomic submit chain. READ-ONLY by contract (E6: the facade —
 * and everything downstream of it, including all AI paths — never writes
 * mastery). Import via `@alfanumrik/lib/learner-model`.
 *
 * Exports:
 *   - getMasteryState(sb, studentId, opts)   — per-topic mastery read
 *   - getDueReviews(sb, studentId, ...)      — get_due_reviews RPC + F7 merge
 *   - deriveNextAction / getNextAction       — pure 5-priority ladder
 *   - explainMastery(state)                  — pure evidence explanation
 *   - bktPosterior / BKT_PARAMS              — SQL BKT mirror (preview only)
 *   - thresholds                             — single mastery/ZPD constant source
 *   - aggregateFormatPreference              — pure D9 implicit-preference rule
 */

export * from './types';
export * from './thresholds';
export * from './bkt-mirror';
export * from './next-action';
export * from './mastery-state';
export * from './due-reviews';
export * from './explain-mastery';
export * from './preference-aggregation';
