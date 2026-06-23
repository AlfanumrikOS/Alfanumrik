-- Migration: 20260623000200_quiz_responses_error_type_column.sql
-- Purpose: PART C (mastery-integrity, CEO-approved) — close the error_type capture gap.
--
--   The learner-state consumer chain already works:
--     update_learner_state_post_quiz(p_error_type) increments
--       error_count_conceptual / error_count_procedural / error_count_careless
--       via a CASE on the value (20260623000100, lines ~189-196), and
--     compute_post_quiz_action fires 'remediate' when error_count_conceptual >= 3.
--
--   The GAP this migration opens the door to closing:
--     - quiz_responses has NO error_type column, so the classification can never
--       be persisted for forensic / analytics replay; and
--     - submit_quiz_results_v2 passes the always-NULL raw (r->>'error_type') into
--       the consumer, so error_count_* never moves on a normal quiz submit.
--
--   This migration is the SCHEMA half: it adds the column + a CHECK constraint so
--   only the three canonical buckets (or NULL) are ever stored. The companion
--   migration 20260623000300 (later timestamp, runs after) re-emits
--   submit_quiz_results_v2 to SERVER-CLASSIFY the value deterministically and
--   feed the COMPUTED (never the client-supplied) value into the consumer.
--
-- Canonical-mastery contract intact: this column is descriptive metadata on a
--   GRADED response row only. error_count_* still moves ONLY through the graded
--   submit path's call to update_learner_state_post_quiz — never a self-report.
--
-- RLS: UNCHANGED. quiz_responses keeps its existing policies; adding a nullable
--   column with a CHECK constraint touches neither the row-visibility surface nor
--   the policy set. No new table, no policy edit.
--
-- Idempotent:
--   * ADD COLUMN IF NOT EXISTS guards the column.
--   * The CHECK constraint is added inside a DO block that first probes
--     pg_constraint, so re-running is a no-op (ADD CONSTRAINT has no IF NOT EXISTS).
--
-- P5: no grade columns touched (grades remain TEXT elsewhere).
-- Owner: architect. Added: 2026-06-23. Reviewers: assessment, ai-engineer, testing, quality.

BEGIN;

-- 1. The column. Nullable: correct answers and unclassifiable rows stay NULL.
ALTER TABLE public.quiz_responses
  ADD COLUMN IF NOT EXISTS error_type TEXT;

-- 2. CHECK constraint: only the three canonical buckets OR NULL.
--    Mirrors the CASE vocabulary in update_learner_state_post_quiz exactly so a
--    value that passes this CHECK is guaranteed to be consumable by the BKT writer.
--    ADD CONSTRAINT has no IF NOT EXISTS, so guard with a pg_constraint probe.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'quiz_responses_error_type_check'
      AND conrelid = 'public.quiz_responses'::regclass
  ) THEN
    ALTER TABLE public.quiz_responses
      ADD CONSTRAINT quiz_responses_error_type_check
      CHECK (error_type IS NULL OR error_type IN ('conceptual', 'procedural', 'careless'));
  END IF;
END $$;

COMMENT ON COLUMN public.quiz_responses.error_type IS
  'PART C (20260623000200): server-classified error bucket for a WRONG response — '
  'one of (conceptual, procedural, careless) or NULL (correct answers + '
  'unclassifiable rows). Written by submit_quiz_results_v2 (20260623000300) from a '
  'DETERMINISTIC server-side heuristic; never the client-supplied value. The same '
  'computed value is fed to update_learner_state_post_quiz so concept_mastery.'
  'error_count_* moves only on graded wrong answers (canonical-mastery contract).';

INSERT INTO public.admin_audit_log (admin_id, action, entity_type, entity_id, details, created_at)
VALUES (
  NULL,
  'mastery_integrity.quiz_responses_error_type_column_added',
  'system',
  NULL,
  jsonb_build_object(
    'migrated_at', now(),
    'reason', 'PART C: add server-classified error_type column + CHECK so the existing learner-state error_count_* consumer chain can be fed a real value',
    'allowed_values', jsonb_build_array('conceptual', 'procedural', 'careless', null),
    'companion_rpc_migration', '20260623000300',
    'table', 'quiz_responses'
  ),
  now()
);

COMMIT;
