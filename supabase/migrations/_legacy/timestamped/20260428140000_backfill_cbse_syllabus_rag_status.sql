-- Migration: 20260428140000_backfill_cbse_syllabus_rag_status.sql
-- Purpose: Refresh stale cbse_syllabus.rag_status flags after bulk NCERT chunk
--          ingestion (chunks present but trigger may have missed firing), and
--          add a chat-readiness helper RPC + diagnostic view.
--
-- Background:
--   recompute_syllabus_status() (defined in 20260418100500) is triggered by
--   trg_rag_chunks_recompute on rag_content_chunks INSERT/UPDATE/DELETE. If
--   chunks were ingested via a path that bypassed the trigger (e.g. direct
--   COPY) or before the trigger existed, cbse_syllabus.chunk_count and
--   rag_status remain stale.
--
-- This migration is idempotent: re-running is a no-op (same recompute logic,
-- CREATE OR REPLACE for fn/view).
--
-- Touches: cbse_syllabus (UPDATE only, via existing fn), no schema changes.
-- RLS: cbse_syllabus already has RLS (policies unchanged). New fn + view have
--      explicit GRANTs, no RLS bypass.

BEGIN;

-- ---------------------------------------------------------------------------
-- Part A: One-shot backfill
-- ---------------------------------------------------------------------------
-- Iterates every distinct (grade, subject_code, chapter_number) row in
-- cbse_syllabus and calls recompute_syllabus_status() to refresh chunk_count,
-- verified_question_count, and rag_status. Per-row error handling so a single
-- bad row does not abort the batch. Function-not-found is caught (fresh
-- installs without 20260418100500 applied).
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

-- ---------------------------------------------------------------------------
-- Part B: Helper RPC — chat-readiness probe
-- ---------------------------------------------------------------------------
-- Returns TRUE when chunks alone are sufficient (>= 50 active NCERT chunks),
-- regardless of verified_question_count. Use case: Foxy chat readiness probe
-- — chunks alone are enough for grounded answers; verified questions are only
-- needed for quiz mode.
--
-- Distinct from cbse_syllabus.rag_status:
--   - rag_status = 'ready'           => fully ready (chat + quiz)
--   - cbse_syllabus_rag_ready = true => chat-ready (chunks sufficient)
CREATE OR REPLACE FUNCTION cbse_syllabus_rag_ready(
  p_grade text,
  p_subject_code text,
  p_chapter_number int
) RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $func$
DECLARE
  v_chunks int;
BEGIN
  SELECT count(*) INTO v_chunks
    FROM rag_content_chunks
    WHERE grade_short = p_grade
      AND subject_code = p_subject_code
      AND chapter_number = p_chapter_number
      AND is_active = true;
  RETURN v_chunks >= 50;
END $func$;

REVOKE ALL ON FUNCTION cbse_syllabus_rag_ready(text, text, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cbse_syllabus_rag_ready(text, text, int) TO authenticated;
GRANT EXECUTE ON FUNCTION cbse_syllabus_rag_ready(text, text, int) TO service_role;

COMMENT ON FUNCTION cbse_syllabus_rag_ready(text, text, int) IS
  'Returns TRUE when the chapter has >= 50 active NCERT chunks. Distinct from cbse_syllabus.rag_status which also requires verified questions for full ready state. Use this for Foxy chat readiness checks.';

-- ---------------------------------------------------------------------------
-- Part C: Diagnostic view
-- ---------------------------------------------------------------------------
-- Compares cbse_syllabus.chunk_count vs the actual count in rag_content_chunks.
-- sync_state = 'STALE' indicates the trigger missed an update — fix by calling
-- recompute_syllabus_status() for the affected (grade, subject, chapter) tuple.
CREATE OR REPLACE VIEW cbse_syllabus_rag_diagnostic AS
SELECT
  c.grade,
  c.subject_code,
  c.chapter_number,
  c.chapter_title,
  c.rag_status,
  c.chunk_count,
  c.verified_question_count,
  COALESCE((
    SELECT count(*)
    FROM rag_content_chunks rc
    WHERE rc.grade_short = c.grade
      AND rc.subject_code = c.subject_code
      AND rc.chapter_number = c.chapter_number
      AND rc.is_active = true
  ), 0) AS actual_chunk_count,
  CASE
    WHEN c.chunk_count != (
      SELECT count(*)
      FROM rag_content_chunks rc
      WHERE rc.grade_short = c.grade
        AND rc.subject_code = c.subject_code
        AND rc.chapter_number = c.chapter_number
        AND rc.is_active = true
    ) THEN 'STALE'
    ELSE 'IN_SYNC'
  END AS sync_state
FROM cbse_syllabus c;

GRANT SELECT ON cbse_syllabus_rag_diagnostic TO authenticated;
GRANT SELECT ON cbse_syllabus_rag_diagnostic TO service_role;

COMMENT ON VIEW cbse_syllabus_rag_diagnostic IS
  'Diagnostic view comparing cbse_syllabus.chunk_count vs actual count in rag_content_chunks. sync_state=STALE means the trigger missed an update — call recompute_syllabus_status() to fix.';

COMMIT;
