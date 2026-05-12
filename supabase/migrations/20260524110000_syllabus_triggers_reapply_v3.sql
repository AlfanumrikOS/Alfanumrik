-- Migration: 20260524110000_syllabus_triggers_reapply_v3.sql
-- Purpose:    Third attempt at reconciling staging's syllabus-trigger
--             drift. Smoke-tests with the EXACT fixture row shape the
--             integration test uses, so if this migration succeeds on
--             staging, the integration test should also succeed.
--
-- Background:
--   PR #560 (20260507100000_force_reapply_syllabus_triggers.sql) was
--   the first reapply attempt. It re-created the function + triggers +
--   CHECK constraints and self-tested catalog presence. The catalog
--   self-test passed but the integration test
--   src/__tests__/migrations/syllabus-triggers.test.ts kept failing.
--
--   20260508000001_syllabus_trigger_runtime_smoke.sql followed up with
--   a runtime smoke test using a separate fixture
--   (subject_code='syllabus_trigger_smoke'). It also identified and
--   fixed the legacy sync_rag_chunk_normalized_fields trigger that
--   was overwriting caller-supplied subject_code. The smoke test
--   passes — yet the integration test (run by the live-DB CI job
--   against staging) continues to fail with
--   `Cannot read properties of null (reading 'chunk_count')`, which
--   means `.single()` returns no row.
--
--   This migration runs the SAME smoke-test but with the EXACT shape
--   the integration test uses: board='CBSE', grade='10',
--   subject_code='science_trigger_test', chapter_number=777. If THAT
--   smoke passes, but the integration test still fails on next CI,
--   the bug is in the test runner's environment (service_role key,
--   RLS, network) — not the DB schema. That narrows the
--   investigation significantly.
--
-- Idempotent: ✅ DROP CASCADE + CREATE, deletes its own smoke rows.
-- Side effects on data: none. Smoke rows deleted in all paths.

-- ── 1. Aggressive teardown + rebuild (identical to 20260508000001) ────
DROP TRIGGER IF EXISTS rag_chunks_recompute_trigger ON public.rag_content_chunks CASCADE;
DROP TRIGGER IF EXISTS question_bank_recompute_trigger ON public.question_bank CASCADE;
DROP FUNCTION IF EXISTS public.trg_rag_chunks_recompute() CASCADE;
DROP FUNCTION IF EXISTS public.trg_question_bank_recompute() CASCADE;
DROP FUNCTION IF EXISTS public.recompute_syllabus_status(text, text, integer) CASCADE;

CREATE FUNCTION public.recompute_syllabus_status(
  p_grade text,
  p_subject_code text,
  p_chapter_number integer
) RETURNS void
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_chunks int;
  v_questions int;
  v_status text;
BEGIN
  SELECT count(*) INTO v_chunks
    FROM public.rag_content_chunks
    WHERE grade_short = p_grade
      AND subject_code = p_subject_code
      AND chapter_number = p_chapter_number
      AND is_active = true;

  SELECT count(*) INTO v_questions
    FROM public.question_bank
    WHERE grade = p_grade
      AND subject = p_subject_code
      AND chapter_number = p_chapter_number
      AND verified_against_ncert = true
      AND deleted_at IS NULL;

  v_status := CASE
    WHEN v_chunks = 0 THEN 'missing'
    WHEN v_chunks < 50 OR v_questions < 40 THEN 'partial'
    ELSE 'ready'
  END;

  UPDATE public.cbse_syllabus
  SET chunk_count = v_chunks,
      verified_question_count = v_questions,
      rag_status = v_status,
      last_verified_at = now(),
      updated_at = now()
  WHERE grade = p_grade
    AND subject_code = p_subject_code
    AND chapter_number = p_chapter_number;
END $$;

CREATE FUNCTION public.trg_rag_chunks_recompute() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.recompute_syllabus_status(OLD.grade_short, OLD.subject_code, OLD.chapter_number);
    RETURN OLD;
  ELSE
    PERFORM public.recompute_syllabus_status(NEW.grade_short, NEW.subject_code, NEW.chapter_number);
    IF TG_OP = 'UPDATE' AND (
      OLD.grade_short IS DISTINCT FROM NEW.grade_short OR
      OLD.subject_code IS DISTINCT FROM NEW.subject_code OR
      OLD.chapter_number IS DISTINCT FROM NEW.chapter_number
    ) THEN
      PERFORM public.recompute_syllabus_status(OLD.grade_short, OLD.subject_code, OLD.chapter_number);
    END IF;
    RETURN NEW;
  END IF;
END $$;

CREATE FUNCTION public.trg_question_bank_recompute() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND
     OLD.verified_against_ncert IS NOT DISTINCT FROM NEW.verified_against_ncert AND
     OLD.deleted_at IS NOT DISTINCT FROM NEW.deleted_at THEN
    RETURN NEW;
  END IF;
  PERFORM public.recompute_syllabus_status(NEW.grade, NEW.subject, NEW.chapter_number);
  RETURN NEW;
END $$;

CREATE TRIGGER rag_chunks_recompute_trigger
  AFTER INSERT OR DELETE OR UPDATE ON public.rag_content_chunks
  FOR EACH ROW EXECUTE FUNCTION public.trg_rag_chunks_recompute();
ALTER TABLE public.rag_content_chunks ENABLE TRIGGER rag_chunks_recompute_trigger;

CREATE TRIGGER question_bank_recompute_trigger
  AFTER INSERT OR UPDATE ON public.question_bank
  FOR EACH ROW EXECUTE FUNCTION public.trg_question_bank_recompute();
ALTER TABLE public.question_bank ENABLE TRIGGER question_bank_recompute_trigger;

-- ── 2. Trigger inventory NOTICE (post-rebuild diagnostic) ──────────────
DO $$
DECLARE
  v_trig record;
  v_lines text := '';
BEGIN
  FOR v_trig IN
    SELECT tgname,
           CASE tgenabled
             WHEN 'O' THEN 'enabled'
             WHEN 'D' THEN 'DISABLED'
             WHEN 'R' THEN 'replica-only'
             WHEN 'A' THEN 'always'
             ELSE 'unknown' END AS state
      FROM pg_trigger
     WHERE tgrelid = 'public.rag_content_chunks'::regclass
       AND NOT tgisinternal
     ORDER BY tgname
  LOOP
    v_lines := v_lines || E'\n  - ' || v_trig.tgname || ' [' || v_trig.state || ']';
  END LOOP;
  RAISE NOTICE 'rag_content_chunks triggers (v3 rebuild):%', v_lines;
END $$;

-- ── 3. Smoke test — EXACT integration-test fixture shape ──────────────
-- Matches src/__tests__/migrations/syllabus-triggers.test.ts:
--   board='CBSE', grade='10', subject_code='science_trigger_test',
--   chapter_number=777
-- If this passes on staging but the integration test still fails, the
-- bug is in the test runner's environment, NOT the schema.
DO $$
DECLARE
  v_subject     text := 'science_trigger_test';
  v_chapter     int  := 777;
  v_grade       text := '10';
  v_test_row_count        int;
  v_chunks_after_trig     int;
  v_status_after_trig     text;
  v_inserted_id           uuid;
BEGIN
  -- Defensive cleanup (handles a crashed prior run).
  DELETE FROM public.rag_content_chunks
   WHERE subject_code = v_subject AND chapter_number = v_chapter;
  DELETE FROM public.cbse_syllabus
   WHERE subject_code = v_subject AND chapter_number = v_chapter;

  -- Seed cbse_syllabus with the EXACT fixture the integration test uses.
  INSERT INTO public.cbse_syllabus (
    board, grade, subject_code, subject_display, chapter_number, chapter_title
  ) VALUES (
    'CBSE', v_grade, v_subject, 'Science', v_chapter, 'Trigger Test'
  );

  -- Verify the seed is queryable by the EXACT match shape the test uses.
  -- If THIS fails on staging the test's .match() will too.
  SELECT count(*) INTO v_test_row_count
    FROM public.cbse_syllabus
   WHERE board = 'CBSE'
     AND grade = v_grade
     AND subject_code = v_subject
     AND subject_display = 'Science'
     AND chapter_number = v_chapter
     AND chapter_title = 'Trigger Test';
  IF v_test_row_count <> 1 THEN
    DELETE FROM public.cbse_syllabus
     WHERE subject_code = v_subject AND chapter_number = v_chapter;
    RAISE EXCEPTION
      'syllabus v3 smoke: cbse_syllabus INSERT not findable by the integration test''s match shape. Probable BEFORE trigger mutation on cbse_syllabus. Inspect cbse_syllabus triggers via the prior NOTICE.';
  END IF;

  -- Insert chunk.
  INSERT INTO public.rag_content_chunks (
    chunk_text, source, grade, subject,
    grade_short, subject_code, chapter_number,
    embedding
  ) VALUES (
    'Integration-shape smoke test chunk.', 'ncert_2025', v_grade, 'science',
    v_grade, v_subject, v_chapter,
    ('[' || array_to_string(array_fill(0.1::float, ARRAY[1024]), ',') || ']')::vector
  )
  RETURNING id INTO v_inserted_id;

  IF v_inserted_id IS NULL THEN
    DELETE FROM public.cbse_syllabus
     WHERE subject_code = v_subject AND chapter_number = v_chapter;
    RAISE EXCEPTION
      'syllabus v3 smoke: chunk INSERT returned no id. A BEFORE trigger on rag_content_chunks is suppressing rows. See trigger inventory NOTICE above.';
  END IF;

  -- Read trigger effect.
  SELECT chunk_count, rag_status INTO v_chunks_after_trig, v_status_after_trig
    FROM public.cbse_syllabus
   WHERE subject_code = v_subject AND chapter_number = v_chapter;

  -- Cleanup before any RAISE so a failed smoke doesn't pollute the DB.
  DELETE FROM public.rag_content_chunks
   WHERE subject_code = v_subject AND chapter_number = v_chapter;
  DELETE FROM public.cbse_syllabus
   WHERE subject_code = v_subject AND chapter_number = v_chapter;

  IF v_chunks_after_trig IS NULL OR v_chunks_after_trig < 1 THEN
    RAISE EXCEPTION
      'syllabus v3 smoke: trigger did not bump chunk_count (got %). This is the same failure mode as the integration test. The migration cannot proceed — staging is genuinely broken.',
      v_chunks_after_trig;
  END IF;

  IF v_status_after_trig <> 'partial' THEN
    RAISE EXCEPTION
      'syllabus v3 smoke: rag_status did not transition to ''partial'' (got %).',
      v_status_after_trig;
  END IF;

  RAISE NOTICE 'syllabus v3 smoke OK using the EXACT integration-test fixture: chunk_count=%, rag_status=%. The integration test SHOULD pass after this migration syncs to staging.',
    v_chunks_after_trig, v_status_after_trig;
END $$;
