-- Migration: 20260809000700_foxy_quality_scores_question_depth.sql
-- Purpose: Foxy North-Star Phase 3 — additive question_depth_score column on
--   foxy_quality_scores: a fifth (optional) LLM-judge rubric dimension
--   scoring the DEPTH of the student-facing questions Foxy asked in the
--   scored turn (surface recall vs probing/socratic). NULLABLE by design:
--   historical rows predate the dimension, and the judge only emits it for
--   rubric versions that include it — the existing 4-dimension composite is
--   untouched.
--
-- Range CHECK mirrors the table's sibling rubric columns (0..100, migration
-- 20260508240000); NULL passes the CHECK automatically (nullable contract).
--
-- RLS: foxy_quality_scores policies (super-admin read / service-role write,
--   20260508240000) are row-scoped — the additive column is automatically
--   covered. No RLS change.
-- Idempotent: ADD COLUMN IF NOT EXISTS + duplicate_object-guarded CHECK.
--   Additive only, no DROP, no backfill.
-- Owner: architect. Reviewers (P14): ai-engineer (judge rubric emitter),
--   ops (quality dashboard), testing. Added: 2026-08-05.

ALTER TABLE public.foxy_quality_scores
  ADD COLUMN IF NOT EXISTS question_depth_score numeric;

DO $question_depth_check$
BEGIN
  ALTER TABLE public.foxy_quality_scores
    ADD CONSTRAINT foxy_quality_scores_question_depth_range
    CHECK (question_depth_score >= 0 AND question_depth_score <= 100);
    -- NULL rows pass a CHECK automatically (unknown ≠ false).
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $question_depth_check$;

COMMENT ON COLUMN public.foxy_quality_scores.question_depth_score IS
  'Phase 3 (20260809000700): optional fifth rubric dimension — depth of the '
  'questions Foxy asked in the scored turn (0 = pure surface recall, 100 = '
  'probing/socratic). NULL = not scored (historical rows / rubric versions '
  'without this dimension). Does not participate in the 4-dimension '
  'overall_score blend from 20260508240000.';
