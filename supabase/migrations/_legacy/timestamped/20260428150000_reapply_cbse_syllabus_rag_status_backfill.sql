-- Migration: 20260428150000_reapply_cbse_syllabus_rag_status_backfill.sql
-- Purpose: Re-apply the cbse_syllabus.rag_status backfill loop.
--
-- Re-apply only — `20260428140000` shipped but Supabase CLI skipped applying
-- it due to `schema_migrations` reconciliation drift. This file has a fresh
-- timestamp so the CLI re-runs the recompute loop. Idempotent: safe to run
-- repeatedly. No schema changes.
--
-- Part B (cbse_syllabus_rag_ready RPC) and Part C (cbse_syllabus_rag_diagnostic
-- view) from 20260428140000 are already applied in production and are NOT
-- duplicated here.
--
-- Touches: cbse_syllabus (UPDATE only, via existing recompute_syllabus_status
-- function defined in 20260418100500). No schema changes. Per-row error
-- handling so a single bad row does not abort the batch. Function-not-found
-- is caught (fresh installs without 20260418100500 applied).

BEGIN;

-- ---------------------------------------------------------------------------
-- Part A: One-shot backfill (re-apply)
-- ---------------------------------------------------------------------------
-- Iterates every distinct (grade, subject_code, chapter_number) row in
-- cbse_syllabus and calls recompute_syllabus_status() to refresh chunk_count,
-- verified_question_count, and rag_status.
DO $$
DECLARE
  r RECORD;
  v_count INT := 0;
BEGIN
  FOR r IN
    SELECT DISTINCT grade, subject_code, chapter_number
    FROM cbse_syllabus
  LOOP
    BEGIN
      PERFORM recompute_syllabus_status(r.grade, r.subject_code, r.chapter_number);
      v_count := v_count + 1;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'recompute failed for grade=% subject=% chapter=%: %',
        r.grade, r.subject_code, r.chapter_number, SQLERRM;
    END;
  END LOOP;
  RAISE NOTICE 'recompute_syllabus_status backfilled % rows', v_count;
EXCEPTION WHEN undefined_function THEN
  RAISE NOTICE 'recompute_syllabus_status fn not defined yet — skipping backfill';
END $$;

COMMIT;
