-- Migration: 20260507100000_force_reapply_syllabus_triggers.sql
-- Purpose:    Force re-application of the syllabus triggers + rag_content_chunks
--             constraints that should already exist per the baseline (and per
--             the older catchup migration `20260504100800`) but are reportedly
--             missing on the staging Supabase project.
--
-- Background:
--   `CI — Alfanumrik / Integration Tests (live DB)` has been failing on every
--   PR for weeks against staging with three identical assertions:
--     - syllabus-triggers.test.ts: chunk_count = 0 (trigger didn't bump)
--     - syllabus-triggers.test.ts: rag_status = 'missing' (expected 'partial')
--     - rag-chunks-constraints.test.ts: insert with grade_short='13' SUCCEEDS
--
--   The objects DO exist on prod (the baseline `00000000000000_baseline_from_prod`
--   creates them as inline CONSTRAINT clauses on rag_content_chunks). They DO
--   NOT exist on staging because staging was provisioned from a Supabase
--   snapshot that recorded the baseline migration version in
--   `supabase_migrations.schema_migrations` *without* having the underlying
--   objects in place.
--
--   The earlier fix `20260504100800_staging_baseline_catchup.sql` should have
--   handled this — but it appears the staging project's `schema_migrations`
--   also recorded that version (likely from the same snapshot or a partial
--   prior apply), so `supabase db push --linked` on the Sync-to-Staging
--   workflow skips it. Result: silent drift, indefinitely red CI.
--
-- Approach:
--   New version number → guaranteed to be unrecorded → guaranteed to apply
--   on staging when the next push lands. All operations are idempotent
--   (CREATE OR REPLACE for functions/triggers, DO blocks for constraints with
--   IF NOT EXISTS-equivalent guards) so re-running on prod where everything
--   exists is a strict no-op.
--
--   Then a final DO block ASSERTS each object exists with RAISE EXCEPTION on
--   failure. If the migration claims success but staging is still missing the
--   objects somehow (Supabase CLI bug, RLS oddity, …), the next CI run will
--   fail at THIS migration step with a clear diagnostic instead of silently
--   leaving CI red.
--
-- Idempotent: ✅ no-op on prod where everything exists.
-- Reversible: ✅ each object can be DROP'd via standard DDL.
-- Side effects on data: none. Trigger reattachment does not touch existing rows.

-- ── 1. recompute_syllabus_status function ──────────────────────────────
-- Recalculates cbse_syllabus.{chunk_count, verified_question_count,
-- rag_status, last_verified_at, updated_at} for a (grade, subject_code,
-- chapter_number) triple.

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

-- ── 2. Trigger function: rag_content_chunks → recompute ────────────────
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

-- ── 3. Trigger function: question_bank → recompute ─────────────────────
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

-- ── 4. Triggers — drop-then-create. Postgres lacks CREATE TRIGGER IF NOT
--    EXISTS, and CREATE OR REPLACE TRIGGER is Postgres 14+; we use the
--    DROP IF EXISTS + CREATE pattern which works on every supported
--    version and is safe to re-run.
-- ────────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS rag_chunks_recompute_trigger ON public.rag_content_chunks;
CREATE TRIGGER rag_chunks_recompute_trigger
  AFTER INSERT OR DELETE OR UPDATE ON public.rag_content_chunks
  FOR EACH ROW EXECUTE FUNCTION public.trg_rag_chunks_recompute();

DROP TRIGGER IF EXISTS question_bank_recompute_trigger ON public.question_bank;
CREATE TRIGGER question_bank_recompute_trigger
  AFTER INSERT OR UPDATE ON public.question_bank
  FOR EACH ROW EXECUTE FUNCTION public.trg_question_bank_recompute();

-- ── 5. CHECK constraints — drop-then-add. ─────────────────────────────
-- ALTER TABLE ... ADD CONSTRAINT has no IF NOT EXISTS; ALTER TABLE ...
-- DROP CONSTRAINT IF EXISTS does. Drop+add gives clean, deterministic
-- behaviour on both staging (missing) and prod (existing) without leaning
-- on EXCEPTION-swallow patterns that masked the silent drift in the
-- previous catchup migration.
--
-- IMPORTANT: drop+add briefly removes the constraint inside the
-- migration transaction. Postgres re-validates the constraint when added
-- back, scanning every row. On a small table (~13,990 rows in prod per
-- recent counts) this completes in well under a second. If you ever ship
-- this pattern against a 100M+ row table, switch to NOT VALID + later
-- VALIDATE CONSTRAINT.

ALTER TABLE public.rag_content_chunks
  DROP CONSTRAINT IF EXISTS rag_chunks_valid_grade;
ALTER TABLE public.rag_content_chunks
  ADD CONSTRAINT rag_chunks_valid_grade
  CHECK (grade_short = ANY (ARRAY['6','7','8','9','10','11','12']));

ALTER TABLE public.rag_content_chunks
  DROP CONSTRAINT IF EXISTS rag_chunks_source_ncert_only;
ALTER TABLE public.rag_content_chunks
  ADD CONSTRAINT rag_chunks_source_ncert_only
  CHECK (source = 'ncert_2025');

-- ── 6. Self-test: assert every object exists post-migration. ──────────
-- If this RAISES, the migration fails loudly and Sync-to-Staging surfaces
-- the problem instead of silently logging "applied" while the underlying
-- objects are still missing — which is exactly what happened with the
-- 20260504100800 catchup.
DO $$
DECLARE
  v_recompute_fn  int;
  v_chunks_trig   int;
  v_qbank_trig    int;
  v_grade_check   int;
  v_source_check  int;
BEGIN
  SELECT count(*) INTO v_recompute_fn
    FROM pg_proc WHERE proname = 'recompute_syllabus_status';
  SELECT count(*) INTO v_chunks_trig
    FROM pg_trigger WHERE tgname = 'rag_chunks_recompute_trigger' AND NOT tgisinternal;
  SELECT count(*) INTO v_qbank_trig
    FROM pg_trigger WHERE tgname = 'question_bank_recompute_trigger' AND NOT tgisinternal;
  SELECT count(*) INTO v_grade_check
    FROM pg_constraint WHERE conname = 'rag_chunks_valid_grade';
  SELECT count(*) INTO v_source_check
    FROM pg_constraint WHERE conname = 'rag_chunks_source_ncert_only';

  IF v_recompute_fn = 0 THEN
    RAISE EXCEPTION 'Self-test failed: recompute_syllabus_status function missing post-migration.';
  END IF;
  IF v_chunks_trig = 0 THEN
    RAISE EXCEPTION 'Self-test failed: rag_chunks_recompute_trigger missing post-migration.';
  END IF;
  IF v_qbank_trig = 0 THEN
    RAISE EXCEPTION 'Self-test failed: question_bank_recompute_trigger missing post-migration.';
  END IF;
  IF v_grade_check = 0 THEN
    RAISE EXCEPTION 'Self-test failed: rag_chunks_valid_grade CHECK constraint missing post-migration.';
  END IF;
  IF v_source_check = 0 THEN
    RAISE EXCEPTION 'Self-test failed: rag_chunks_source_ncert_only CHECK constraint missing post-migration.';
  END IF;

  RAISE NOTICE 'syllabus-triggers reapply: all 5 expected objects present.';
END $$;
