-- Migration: 20260805100100_quiz_responses_hint_level.sql
-- Purpose: Foxy North-Star Phase 0 item F8 (server contract, step 1) — add
--   the hint_level column to quiz_responses so hint usage per question can be
--   persisted by the submit RPC (wired in the companion migration
--   20260805100200_submit_quiz_v2_persist_hint_level.sql).
--
-- Contract (fixed by orchestrator):
--   hint_level smallint NULL, CHECK (hint_level >= 0 AND hint_level <= 3).
--   0 = answered with no hint; NULL = client did not report (legacy payloads,
--   v1 path, mobile). No backfill.
--
-- RLS: quiz_responses row policies are row-scoped (student_id / session
--   ownership), not column-scoped — the new column is automatically covered
--   by the existing policies. No RLS change needed or made.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + duplicate_object-guarded constraint.

ALTER TABLE public.quiz_responses
  ADD COLUMN IF NOT EXISTS hint_level smallint;

DO $$
BEGIN
  ALTER TABLE public.quiz_responses
    ADD CONSTRAINT quiz_responses_hint_level_check
    CHECK (hint_level >= 0 AND hint_level <= 3);
    -- NULL rows pass a CHECK automatically (unknown ≠ false), so the
    -- nullable no-backfill contract holds without an IS NULL clause.
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

COMMENT ON COLUMN public.quiz_responses.hint_level IS
  'Foxy North-Star F8 (2026-08-05): highest hint tier the student used on '
  'this question (0 = none, 1-3 = progressive hints). NULL = not reported '
  '(legacy clients / v1 path). Written by submit_quiz_results_v2 from the '
  'optional "hint_level" key on each responses[] element.';
