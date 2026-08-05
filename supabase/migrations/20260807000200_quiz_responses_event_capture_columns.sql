-- Migration: 20260807000200_quiz_responses_event_capture_columns.sql
-- Purpose: Foxy North-Star Phase 2 (spec §1.3) — event-capture columns on
--   quiz_responses so submit_quiz_results_v2 (rewired in 20260807000500) can
--   persist, per response:
--     * question_version — quiz_session_shuffles.options_version_at_serve for
--       the served snapshot (server-held; zero client trust)
--     * content_hash     — quiz_session_shuffles.integrity_hash (SHA256 of the
--       served options snapshot; server-held)
--     * answer_method    — how the student answered: mcq | typed | voice | scan
--       (server-whitelisted; unknown values coerced to 'mcq')
--     * confidence       — optional self-reported confidence 1..5
--     * misconception_id — FK to question_misconceptions when a wrong answer's
--       ORIGINAL-space distractor index matches a curated misconception mapping
--
-- ALL columns are NULLABLE with no backfill — additive-safe for mobile/legacy
-- clients and the v1 path (P5/mobile contract: old APKs simply leave them NULL).
--
-- RLS: quiz_responses policies are row-scoped (student_id / session
--   ownership), not column-scoped — new columns automatically covered. No RLS
--   change needed or made.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + duplicate_object-guarded constraints
--   + CREATE INDEX IF NOT EXISTS. No DROP.
-- Owner: architect. Added: 2026-08-05. Reviewers: assessment, backend, testing.

ALTER TABLE public.quiz_responses
  ADD COLUMN IF NOT EXISTS question_version integer,
  ADD COLUMN IF NOT EXISTS content_hash     text,
  ADD COLUMN IF NOT EXISTS answer_method    text,
  ADD COLUMN IF NOT EXISTS confidence       smallint,
  ADD COLUMN IF NOT EXISTS misconception_id uuid;

-- CHECKs: NULL rows pass a CHECK automatically (unknown ≠ false), so the
-- nullable no-backfill contract holds; the IS NULL arm is kept explicit to
-- pin the contract in the constraint text itself.
DO $$
BEGIN
  ALTER TABLE public.quiz_responses
    ADD CONSTRAINT quiz_responses_answer_method_check
    CHECK (answer_method IS NULL
           OR answer_method IN ('mcq', 'typed', 'voice', 'scan'));
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.quiz_responses
    ADD CONSTRAINT quiz_responses_confidence_check
    CHECK (confidence IS NULL OR confidence BETWEEN 1 AND 5);
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

-- FK: a deleted curated mapping must never orphan-block or cascade-delete a
-- student's response row — SET NULL preserves the response (P4-adjacent).
DO $$
BEGIN
  ALTER TABLE public.quiz_responses
    ADD CONSTRAINT quiz_responses_misconception_id_fkey
    FOREIGN KEY (misconception_id)
    REFERENCES public.question_misconceptions(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

-- Partial index: the misconception analytics/remediation lane only ever scans
-- rows WITH a mapped misconception; the vast majority of rows stay NULL.
CREATE INDEX IF NOT EXISTS idx_quiz_responses_misconception
  ON public.quiz_responses (misconception_id)
  WHERE misconception_id IS NOT NULL;

COMMENT ON COLUMN public.quiz_responses.question_version IS
  'options_version_at_serve copied from the quiz_session_shuffles row for this '
  'session+question at submit time (server-held snapshot version; never client '
  'supplied). NULL = pre-Phase-2 row / v1 path.';
COMMENT ON COLUMN public.quiz_responses.content_hash IS
  'integrity_hash copied from the quiz_session_shuffles row (SHA256 of served '
  'options snapshot || correct index; server-held). NULL = pre-Phase-2 row.';
COMMENT ON COLUMN public.quiz_responses.answer_method IS
  'How the answer was captured: mcq | typed | voice | scan. Server-whitelisted '
  'in submit_quiz_results_v2 (unknown -> mcq). NULL = legacy client / v1 path.';
COMMENT ON COLUMN public.quiz_responses.confidence IS
  'Optional student self-reported confidence 1..5 (regex-guarded server-side; '
  'invalid -> NULL). Telemetry only — feeds no scoring/XP/anti-cheat decision.';
COMMENT ON COLUMN public.quiz_responses.misconception_id IS
  'question_misconceptions.id matched on wrong answers by (question_id, '
  'ORIGINAL-space distractor index). NULL when correct, unmapped, or legacy.';
