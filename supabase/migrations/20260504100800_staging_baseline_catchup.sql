-- Migration: 20260504100800_staging_baseline_catchup.sql
-- Purpose:    Idempotent backfill of schema objects that should exist per
--             the baseline (00000000000000_baseline_from_prod.sql) but may
--             be missing on environments where the legacy migration chain
--             wasn't fully replayed (staging Supabase project, preview
--             branches built from older parents, DR projects).
--
-- Background:
--   Integration tests on PRs (which run against STAGING_SUPABASE_*) failed
--   for weeks with errors like:
--     - chunk_count assertion: trigger trg_rag_chunks_recompute missing
--     - rag_status 'missing' vs 'partial': same trigger missing
--     - rejects invalid grade_short: CHECK rag_chunks_valid_grade missing
--   despite the same schema living on production. Diagnosis: staging was
--   provisioned from a snapshot that predates these objects, and the
--   legacy migrations adding them were never replayed against it.
--
-- Approach:
--   All objects use CREATE OR REPLACE (functions, triggers) or
--   conditional DO blocks (constraints) so the migration is a NO-OP on
--   production where everything already exists, but creates the missing
--   pieces on staging without affecting any data.
--
-- Idempotent: ✅ Re-running this migration is safe.
-- Reversible: ✅ Each object can be dropped via standard DDL; the
--             migration adds capabilities without modifying data.

-- ───────────────────────────────────────────────────────────────────────
-- 1. recompute_syllabus_status function
--    Recalculates cbse_syllabus.chunk_count + verified_question_count +
--    rag_status for a (grade, subject_code, chapter_number) triple.
-- ───────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.recompute_syllabus_status(
  p_grade text,
  p_subject_code text,
  p_chapter_number integer
) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_chunks int;
  v_questions int;
  v_status text;
BEGIN
  SELECT count(*) INTO v_chunks
    FROM rag_content_chunks
    WHERE grade_short = p_grade
      AND subject_code = p_subject_code
      AND chapter_number = p_chapter_number
      AND is_active = true;

  SELECT count(*) INTO v_questions
    FROM question_bank
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

  UPDATE cbse_syllabus
  SET chunk_count = v_chunks,
      verified_question_count = v_questions,
      rag_status = v_status,
      last_verified_at = now(),
      updated_at = now()
  WHERE grade = p_grade
    AND subject_code = p_subject_code
    AND chapter_number = p_chapter_number;
END $$;

-- ───────────────────────────────────────────────────────────────────────
-- 2. trg_rag_chunks_recompute — trigger function for rag_content_chunks
-- ───────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.trg_rag_chunks_recompute() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM recompute_syllabus_status(OLD.grade_short, OLD.subject_code, OLD.chapter_number);
    RETURN OLD;
  ELSE
    PERFORM recompute_syllabus_status(NEW.grade_short, NEW.subject_code, NEW.chapter_number);
    IF TG_OP = 'UPDATE' AND (
      OLD.grade_short IS DISTINCT FROM NEW.grade_short OR
      OLD.subject_code IS DISTINCT FROM NEW.subject_code OR
      OLD.chapter_number IS DISTINCT FROM NEW.chapter_number
    ) THEN
      PERFORM recompute_syllabus_status(OLD.grade_short, OLD.subject_code, OLD.chapter_number);
    END IF;
    RETURN NEW;
  END IF;
END $$;

-- ───────────────────────────────────────────────────────────────────────
-- 3. trg_question_bank_recompute — trigger function for question_bank
-- ───────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.trg_question_bank_recompute() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND
     OLD.verified_against_ncert IS NOT DISTINCT FROM NEW.verified_against_ncert AND
     OLD.deleted_at IS NOT DISTINCT FROM NEW.deleted_at THEN
    RETURN NEW;
  END IF;
  PERFORM recompute_syllabus_status(NEW.grade, NEW.subject, NEW.chapter_number);
  RETURN NEW;
END $$;

-- ───────────────────────────────────────────────────────────────────────
-- 4. Triggers — bound to their tables. CREATE OR REPLACE TRIGGER is
--    idempotent (Postgres 14+).
-- ───────────────────────────────────────────────────────────────────────

CREATE OR REPLACE TRIGGER rag_chunks_recompute_trigger
  AFTER INSERT OR DELETE OR UPDATE ON public.rag_content_chunks
  FOR EACH ROW EXECUTE FUNCTION public.trg_rag_chunks_recompute();

CREATE OR REPLACE TRIGGER question_bank_recompute_trigger
  AFTER INSERT OR UPDATE ON public.question_bank
  FOR EACH ROW EXECUTE FUNCTION public.trg_question_bank_recompute();

-- ───────────────────────────────────────────────────────────────────────
-- 5. CHECK constraint: rag_chunks_valid_grade
--    Restricts grade_short to '6'..'12' per CBSE scope (P5 invariant).
--    Postgres < 17 does not have ADD CONSTRAINT IF NOT EXISTS, so wrap
--    in DO block with exception handler.
-- ───────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  ALTER TABLE public.rag_content_chunks
    ADD CONSTRAINT rag_chunks_valid_grade
    CHECK (grade_short = ANY (ARRAY['6','7','8','9','10','11','12']));
EXCEPTION
  WHEN duplicate_object THEN
    NULL; -- constraint already present, no-op
  WHEN duplicate_table THEN
    NULL; -- some Postgres versions report this code instead
END $$;

-- ───────────────────────────────────────────────────────────────────────
-- 6. CHECK constraint: rag_chunks_source_ncert_only
--    Restricts source to 'ncert_2025' to enforce P12 (only NCERT-grounded
--    content reaches Foxy retrievals). Same DO-block pattern.
-- ───────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  ALTER TABLE public.rag_content_chunks
    ADD CONSTRAINT rag_chunks_source_ncert_only
    CHECK (source = 'ncert_2025');
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
END $$;

-- End of migration: 20260504100800_staging_baseline_catchup.sql
