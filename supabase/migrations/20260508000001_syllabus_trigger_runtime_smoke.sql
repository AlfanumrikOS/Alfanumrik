-- Migration: 20260508000001_syllabus_trigger_runtime_smoke.sql
-- Purpose:    Aggressively recreate the syllabus triggers + recompute
--             function, then runtime-assert they fire correctly.
--
-- Background:
--   Earlier diagnostic run (2026-05-07 16:49 UTC, run 25509695162) confirmed
--   that on staging the rag_content_chunks AFTER INSERT trigger does NOT
--   bump cbse_syllabus.chunk_count, even though `20260507100000` claimed
--   success and its catalog self-test passed. Catalog presence is necessary
--   but not sufficient — the trigger object exists yet doesn't fire.
--
--   Most likely causes (in order of probability):
--     A) recompute_syllabus_status was created in a non-public schema by
--        an earlier migration and the trigger function's unqualified
--        `PERFORM recompute_syllabus_status(...)` resolves to a stale body
--        that early-returns without doing the UPDATE.
--     B) cbse_syllabus.grade column stores 'Grade 10' (display form) not
--        '10' (short form), so the recompute UPDATE's
--        `WHERE grade = p_grade` never matches.
--     C) The trigger is ALTER TABLE … DISABLE TRIGGERed.
--
-- Approach:
--   1. DROP everything with CASCADE so we know we're starting clean.
--   2. CREATE the function with explicit `public.` qualification on the
--      inner call, and `SET search_path = public, pg_temp` on both the
--      recompute and trigger functions so search_path drift cannot affect
--      resolution.
--   3. CREATE the trigger and explicitly ENABLE it.
--   4. Smoke test: seed a cbse_syllabus row, INSERT a rag_content_chunks
--      row, assert the trigger updated chunk_count to 1 and rag_status to
--      'partial'. Also call recompute_syllabus_status() explicitly as a
--      separate diagnostic so a future failure can distinguish trigger
--      vs function bugs.
--   5. RAISE with a precise diagnostic if the assertion still fails.
--   6. Always clean up smoke test rows.
--
-- Idempotent: ✅ DROP CASCADE + CREATE is safe to re-run.
-- Reversible: N/A — only re-creates objects that should already exist.
-- Side effects on data: none. The smoke test rows are deleted in all paths.

-- ── 1. Aggressive teardown ─────────────────────────────────────────────
-- DROP CASCADE removes any dependent objects we missed. The
-- 20260507100000 migration's CREATE OR REPLACE may have left a stale
-- function body in scope; CASCADE forces a clean rebuild.
DROP TRIGGER IF EXISTS rag_chunks_recompute_trigger ON public.rag_content_chunks CASCADE;
DROP TRIGGER IF EXISTS question_bank_recompute_trigger ON public.question_bank CASCADE;
DROP FUNCTION IF EXISTS public.trg_rag_chunks_recompute() CASCADE;
DROP FUNCTION IF EXISTS public.trg_question_bank_recompute() CASCADE;
DROP FUNCTION IF EXISTS public.recompute_syllabus_status(text, text, integer) CASCADE;

-- ── 2. recompute_syllabus_status (explicit search_path) ─────────────────
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

-- ── 3. Trigger functions (fully-qualified inner call) ───────────────────
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

-- ── 4. Triggers (re-attach + force ENABLE) ──────────────────────────────
CREATE TRIGGER rag_chunks_recompute_trigger
  AFTER INSERT OR DELETE OR UPDATE ON public.rag_content_chunks
  FOR EACH ROW EXECUTE FUNCTION public.trg_rag_chunks_recompute();
ALTER TABLE public.rag_content_chunks ENABLE TRIGGER rag_chunks_recompute_trigger;

CREATE TRIGGER question_bank_recompute_trigger
  AFTER INSERT OR UPDATE ON public.question_bank
  FOR EACH ROW EXECUTE FUNCTION public.trg_question_bank_recompute();
ALTER TABLE public.question_bank ENABLE TRIGGER question_bank_recompute_trigger;

-- ── 5a. Trigger inventory (diagnostic only — surfaces BEFORE triggers
--    that may silently suppress INSERTs by returning NULL). ──────────────
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
             ELSE 'unknown' END AS state,
           pg_get_triggerdef(oid) AS def
      FROM pg_trigger
     WHERE tgrelid = 'public.rag_content_chunks'::regclass
       AND NOT tgisinternal
     ORDER BY tgname
  LOOP
    v_lines := v_lines || E'\n  - ' || v_trig.tgname || ' [' || v_trig.state || ']: ' || v_trig.def;
  END LOOP;
  RAISE NOTICE 'rag_content_chunks triggers (post-recreation):%', v_lines;
END $$;

-- ── 5b. Runtime smoke test with diagnostic separation ───────────────────
DO $$
DECLARE
  v_test_subject     text := 'syllabus_trigger_smoke';
  v_test_chapter     int  := 999;
  v_test_grade       text := '10';
  v_chunks_after_trig int;
  v_status_after_trig text;
  v_chunks_after_rpc  int;
  v_seed_grade        text;
  v_seed_count        int;
  v_inserted_id       uuid;
BEGIN
  -- Defensive cleanup
  DELETE FROM public.rag_content_chunks
   WHERE subject_code = v_test_subject AND chapter_number = v_test_chapter;
  DELETE FROM public.cbse_syllabus
   WHERE subject_code = v_test_subject AND chapter_number = v_test_chapter;

  -- Seed cbse_syllabus
  INSERT INTO public.cbse_syllabus (board, grade, subject_code, subject_display, chapter_number, chapter_title)
  VALUES ('CBSE', v_test_grade, v_test_subject, 'Smoke Test', v_test_chapter, 'Smoke Test Chapter');

  -- Read back the grade as stored — surface 'Grade 10' vs '10' drift.
  SELECT grade INTO v_seed_grade
    FROM public.cbse_syllabus
   WHERE subject_code = v_test_subject AND chapter_number = v_test_chapter;
  IF v_seed_grade <> v_test_grade THEN
    DELETE FROM public.cbse_syllabus
     WHERE subject_code = v_test_subject AND chapter_number = v_test_chapter;
    RAISE EXCEPTION
      'cbse_syllabus.grade stored as % but test inserted %. The recompute UPDATE WHERE grade = p_grade will never match. This is the root cause of the trigger silent-fail. Audit cbse_syllabus.grade format vs rag_content_chunks.grade_short.',
      quote_literal(v_seed_grade), quote_literal(v_test_grade);
  END IF;

  -- Insert chunk (trigger should fire). RETURNING id so we can detect the
  -- "BEFORE trigger returned NULL — silently suppressed INSERT" case
  -- where INSERT raises no error but inserts nothing.
  BEGIN
    INSERT INTO public.rag_content_chunks (
      chunk_text, source, grade, subject,
      grade_short, subject_code, chapter_number,
      embedding
    ) VALUES (
      'Syllabus trigger smoke test chunk.', 'ncert_2025', v_test_grade, 'science',
      v_test_grade, v_test_subject, v_test_chapter,
      ('[' || array_to_string(array_fill(0.1::float, ARRAY[1024]), ',') || ']')::vector
    )
    RETURNING id INTO v_inserted_id;
  EXCEPTION
    WHEN OTHERS THEN
      DELETE FROM public.cbse_syllabus
       WHERE subject_code = v_test_subject AND chapter_number = v_test_chapter;
      RAISE EXCEPTION 'syllabus smoke INSERT failed: % (real schema/constraint bug, not the trigger)', SQLERRM;
  END;

  -- If RETURNING gave NULL the INSERT was silently suppressed, almost
  -- certainly by a BEFORE INSERT trigger that RETURN NULL'd. Surface this
  -- distinct failure mode separately from the trigger/recompute layers.
  IF v_inserted_id IS NULL THEN
    DELETE FROM public.cbse_syllabus
     WHERE subject_code = v_test_subject AND chapter_number = v_test_chapter;
    RAISE EXCEPTION
      'syllabus smoke: INSERT returned no id — a BEFORE trigger on rag_content_chunks suppressed the row by RETURN NULL. See trigger inventory in the prior NOTICE block. The recompute trigger never fires because nothing actually got inserted. This is the root cause of integration-tests/syllabus-triggers.test.ts also showing chunk_count=0.';
  END IF;

  -- Read after trigger
  SELECT chunk_count, rag_status INTO v_chunks_after_trig, v_status_after_trig
    FROM public.cbse_syllabus
   WHERE subject_code = v_test_subject AND chapter_number = v_test_chapter;

  -- Verify chunk row landed
  SELECT count(*) INTO v_seed_count
    FROM public.rag_content_chunks
   WHERE subject_code = v_test_subject AND chapter_number = v_test_chapter;

  -- Diagnostic split: call recompute explicitly to distinguish trigger vs function
  PERFORM public.recompute_syllabus_status(v_test_grade, v_test_subject, v_test_chapter);
  SELECT chunk_count INTO v_chunks_after_rpc
    FROM public.cbse_syllabus
   WHERE subject_code = v_test_subject AND chapter_number = v_test_chapter;

  -- Cleanup before any RAISE
  DELETE FROM public.rag_content_chunks
   WHERE subject_code = v_test_subject AND chapter_number = v_test_chapter;
  DELETE FROM public.cbse_syllabus
   WHERE subject_code = v_test_subject AND chapter_number = v_test_chapter;

  -- Decisive diagnostic
  IF v_seed_count <> 1 THEN
    RAISE EXCEPTION
      'syllabus smoke: rag_content_chunks INSERT did not persist a row (count=%). Constraint or RLS issue.',
      v_seed_count;
  END IF;

  IF v_chunks_after_rpc <> 1 THEN
    RAISE EXCEPTION
      'syllabus smoke: explicit recompute_syllabus_status() ALSO returned chunk_count=%. The recompute function itself is broken — its UPDATE filter does not match cbse_syllabus rows. trigger=%, rpc=%, seed_grade=%.',
      v_chunks_after_rpc, v_chunks_after_trig, v_chunks_after_rpc, v_seed_grade;
  END IF;

  IF v_chunks_after_trig <> 1 THEN
    RAISE EXCEPTION
      'syllabus smoke: trigger did not fire (trig_chunk_count=%) but explicit recompute() works (rpc_chunk_count=%). The recompute function is correct; the AFTER INSERT trigger is the broken object.',
      v_chunks_after_trig, v_chunks_after_rpc;
  END IF;

  IF v_status_after_trig <> 'partial' THEN
    RAISE EXCEPTION
      'syllabus smoke: rag_status did not transition to ''partial'' (got %). Check recompute_syllabus_status status thresholds.',
      v_status_after_trig;
  END IF;

  RAISE NOTICE 'syllabus trigger smoke OK: trig=%, rpc=%, status=% (cleaned up)',
    v_chunks_after_trig, v_chunks_after_rpc, v_status_after_trig;
END $$;
