-- 20260702160000_p3w3_17_concept_mastery_review_date_index.sql
--
-- Phase 3 Wave 3 #17 (MED perf, F7): concept_mastery has TWO sibling
-- "next review" columns that are NOT duplicates of each other -- they back
-- two genuinely different query paths, and only one of the two paths was
-- missing its composite index.
--
--   next_review_at   timestamptz  -- filtered by the get_due_reviews() RPC
--                                     (public.get_due_reviews, baseline
--                                     migration ~L4615), which is called by
--                                     /api/rhythm/today and /api/dive/start.
--                                     This path IS already covered by the
--                                     existing composite index
--                                     idx_concept_mastery_review
--                                     (student_id, next_review_at) -- no gap
--                                     here, nothing to change.
--
--   next_review_date date         -- filtered directly (no RPC) by
--                                     /api/dashboard/reviews-due
--                                     (src/app/api/dashboard/reviews-due/route.ts)
--                                     and /api/revision/overview
--                                     (src/app/api/revision/overview/route.ts).
--                                     Both routes run the EXACT same shape:
--                                       WHERE student_id = $1
--                                         AND mastery_probability < 0.95
--                                         AND next_review_date >= $academicYearStart
--                                         AND next_review_date <= $today (or today+7)
--                                       ORDER BY next_review_date ASC
--                                     The only existing indexes touching this
--                                     column are idx_concept_mastery_student
--                                     (student_id alone) and
--                                     idx_concept_mastery_review_date
--                                     (next_review_date alone) -- neither is a
--                                     composite that can serve the
--                                     student_id + date-range + order-by shape
--                                     in one index scan. THIS is the real F7
--                                     gap.
--
-- Correction to the audit recommendation's shorthand: the task brief names
-- get_due_reviews as the affected caller, but get_due_reviews filters on
-- next_review_at, which was never the gap -- it already has a matching
-- composite index. The actual gap is on next_review_date, hit by the two
-- direct-query routes above (not by get_due_reviews, rhythm/today, or
-- dive/start, which are unaffected by this migration).
--
-- Fix: add a composite index on (student_id, next_review_date), partial on
-- the exact mastery_probability < 0.95 predicate both callers use verbatim
-- -- this keeps the index scoped to genuinely-due rows only (mastered rows
-- at >= 0.95 are excluded from both callers' WHERE clause anyway) rather
-- than the audit's looser "< 1" example predicate.
--
-- Additive only: the existing idx_concept_mastery_review (student_id,
-- next_review_at) and idx_concept_mastery_review_date (next_review_date
-- alone) are left untouched. idx_concept_mastery_review_date is a plain
-- (non-partial, non-composite) index used generically; grepping the repo
-- turned up no other caller that specifically needs a bare next_review_date
-- index over this new composite, but since it's cheap to keep and dropping
-- it is out of scope for a MED-risk additive perf fix, it is left in place.
--
-- Not using CREATE INDEX CONCURRENTLY: Supabase's `db push` wraps each
-- migration file in a transaction, and CONCURRENTLY cannot run inside one
-- (same rationale as 20260527000008_perf_index_audit_phase_d6.sql).
-- concept_mastery is a per-student, per-topic mastery table (bounded by
-- curriculum size, at most a few hundred rows per student) -- not remotely
-- at a row count where an in-migration lock is user-visible.

BEGIN;

CREATE INDEX IF NOT EXISTS idx_concept_mastery_student_review_date_due
  ON public.concept_mastery (student_id, next_review_date)
  WHERE mastery_probability < 0.95;

COMMENT ON INDEX public.idx_concept_mastery_student_review_date_due IS
  'Phase 3 Wave 3 #17 (F7): composite covering /api/dashboard/reviews-due '
  'and /api/revision/overview, both of which filter '
  'student_id + next_review_date range + mastery_probability < 0.95 and '
  'ORDER BY next_review_date. Distinct from idx_concept_mastery_review '
  '(student_id, next_review_at), which already covers the get_due_reviews() '
  'RPC path used by /api/rhythm/today and /api/dive/start -- that path was '
  'never the gap. Additive: does not replace or drop any existing index.';

COMMIT;
