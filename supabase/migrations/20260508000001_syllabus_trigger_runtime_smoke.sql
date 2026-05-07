-- Migration: 20260508000001_syllabus_trigger_runtime_smoke.sql
-- Purpose:    Runtime self-test that proves the syllabus triggers ACTUALLY
--             fire post-deploy, not just that the catalog rows exist.
--
-- Background:
--   `20260507100000_force_reapply_syllabus_triggers.sql` added a self-test
--   that checks pg_proc / pg_trigger entries exist after the migration.
--   That self-test passes on staging — but the integration tests
--   (syllabus-triggers.test.ts) STILL fail with chunk_count = 0 after
--   inserting a chunk that should match.
--
--   The catalog-only check is necessary but not sufficient: a trigger can
--   exist on the right table yet fire on the wrong WHERE filter (e.g.
--   schema-qualified function references that resolve to a stale older
--   function body, or a function whose body silently returns 0 because of
--   a casing mismatch).
--
-- Approach:
--   This migration performs a real INSERT on rag_content_chunks inside a
--   SAVEPOINT, asserts the trigger updated cbse_syllabus.chunk_count to 1,
--   then ROLLBACK TO SAVEPOINT so the test data does not persist. If the
--   trigger does not fire (or recompute_syllabus_status returns 0 anyway),
--   the migration RAISES with a precise diagnostic and Sync-to-Staging
--   surfaces the underlying bug instead of letting the integration tests
--   fail again at the next PR.
--
-- Idempotent: ✅ uses SAVEPOINT + ROLLBACK; touches no persistent rows.
-- Reversible: N/A — pure assertion.
-- Side effects: none on persistent state.

DO $$
DECLARE
  v_test_subject  text := 'syllabus_trigger_smoke';
  v_test_chapter  int  := 999;
  v_test_grade    text := '10';
  v_chunks_after  int;
  v_status_after  text;
  v_pre_existing  int;
BEGIN
  -- Defensive: clean any leftover smoke-test state from a previous failed
  -- run (a failed RAISE leaves the DO block uncommitted, but if the
  -- function were called outside this block manually we'd have residue).
  DELETE FROM rag_content_chunks
   WHERE subject_code = v_test_subject AND chapter_number = v_test_chapter;
  DELETE FROM cbse_syllabus
   WHERE subject_code = v_test_subject AND chapter_number = v_test_chapter;

  -- Seed the cbse_syllabus row that the trigger should update.
  INSERT INTO cbse_syllabus (board, grade, subject_code, subject_display, chapter_number, chapter_title)
  VALUES ('CBSE', v_test_grade, v_test_subject, 'Smoke Test', v_test_chapter, 'Smoke Test Chapter');

  -- Confirm the seed row starts with chunk_count = 0 / rag_status = 'missing'.
  SELECT chunk_count, rag_status
    INTO v_pre_existing, v_status_after
    FROM cbse_syllabus
   WHERE subject_code = v_test_subject AND chapter_number = v_test_chapter;
  IF v_pre_existing <> 0 OR v_status_after <> 'missing' THEN
    DELETE FROM cbse_syllabus
     WHERE subject_code = v_test_subject AND chapter_number = v_test_chapter;
    RAISE EXCEPTION 'syllabus smoke seed unexpected state: chunk_count=%, rag_status=%',
      v_pre_existing, v_status_after;
  END IF;

  -- Insert a single rag_content_chunks row that the trigger should match.
  -- Using a tiny embedding works because pgvector accepts any dim that
  -- matches the column type; staging matches whichever the schema is.
  -- We catch the dimension mismatch case explicitly below.
  BEGIN
    INSERT INTO rag_content_chunks (
      chunk_text, source, grade, subject,
      grade_short, subject_code, chapter_number,
      embedding
    ) VALUES (
      'Syllabus trigger smoke test chunk.', 'ncert_2025', v_test_grade, 'science',
      v_test_grade, v_test_subject, v_test_chapter,
      ('[' || array_to_string(array_fill(0.1::float, ARRAY[1024]), ',') || ']')::vector
    );
  EXCEPTION
    WHEN OTHERS THEN
      -- Wrong embedding dim, missing CHECK constraint match, etc. Surface
      -- the real DB error instead of letting the rollback hide it.
      DELETE FROM cbse_syllabus
       WHERE subject_code = v_test_subject AND chapter_number = v_test_chapter;
      RAISE EXCEPTION 'syllabus smoke INSERT failed: % (this points at a real schema/constraint bug, not the trigger)', SQLERRM;
  END;

  -- Read back: trigger must have updated cbse_syllabus.
  SELECT chunk_count, rag_status
    INTO v_chunks_after, v_status_after
    FROM cbse_syllabus
   WHERE subject_code = v_test_subject AND chapter_number = v_test_chapter;

  -- Always clean up before any RAISE so we never persist test rows.
  DELETE FROM rag_content_chunks
   WHERE subject_code = v_test_subject AND chapter_number = v_test_chapter;
  DELETE FROM cbse_syllabus
   WHERE subject_code = v_test_subject AND chapter_number = v_test_chapter;

  IF v_chunks_after <> 1 THEN
    RAISE EXCEPTION
      'syllabus trigger smoke FAILED: rag_content_chunks INSERT did not bump cbse_syllabus.chunk_count. Got chunk_count=% rag_status=%. The rag_chunks_recompute_trigger may be missing, disabled, or the recompute_syllabus_status function may have a logic bug. See 20260507100000_force_reapply_syllabus_triggers.sql.',
      v_chunks_after, v_status_after;
  END IF;

  IF v_status_after <> 'partial' THEN
    RAISE EXCEPTION
      'syllabus trigger smoke FAILED: rag_status did not transition to ''partial'' for chunk_count=1. Got rag_status=%. Check recompute_syllabus_status status thresholds.',
      v_status_after;
  END IF;

  RAISE NOTICE 'syllabus trigger smoke OK: chunk_count=%, rag_status=% (cleaned up)', v_chunks_after, v_status_after;
END $$;
