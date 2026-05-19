-- Migration: 20260520000003_add_question_bank_chapter_title.sql
-- Purpose: Close latent schema drift — add chapter_title column to public.question_bank.
--
-- Context (discovered 2026-05-19):
--   The column public.question_bank.chapter_title is referenced by THREE production code paths
--   but is NOT present in the baseline CREATE TABLE block (baseline lines 2123-2230 list only
--   chapter_number integer and chapter_id uuid). No subsequent migration adds it.
--     1. RPC get_board_year_questions (baseline line 4225) SELECTs q.chapter_title.
--     2. Edge Function bulk-question-gen/index.ts:1291 INSERTs chapter_title.
--     3. Seed migration 20260520000006_seed_jee_neet_olympiad_papers.sql references chapter_title
--        in 5 INSERTs — would FAIL on any fresh supabase db push without this fix.
--
-- Idempotency:
--   ADD COLUMN IF NOT EXISTS is a no-op when the column already exists. If live production has
--   chapter_title via an out-of-band hot-fix not captured in version control, this migration is
--   a no-op there; on fresh DBs (CI live-DB tests, new staging, DR) it adds the missing column.
--
-- Ordering:
--   Placed at timestamp 20260520000003 — BEFORE 20260520000004 (PR-1) and BEFORE 20260520000006
--   (seed). Supabase applies migrations in lexicographic order, so chapter_title must exist
--   before the seed migration writes to it.
--
-- Safety:
--   Additive only — new column is nullable, zero risk to existing rows. No data loss possible.
--
-- Owner: architect (schema)
--
-- Rollback (requires user approval per CLAUDE.md — no DROP without approval):
--   ALTER TABLE public.question_bank DROP COLUMN IF EXISTS chapter_title;
--   DROP INDEX IF EXISTS public.idx_question_bank_chapter_title;

BEGIN;

-- 1. Add the column (idempotent)
ALTER TABLE public.question_bank
  ADD COLUMN IF NOT EXISTS chapter_title text;

-- 2. Partial index — keeps get_board_year_questions RPC scans cheap when populated
CREATE INDEX IF NOT EXISTS idx_question_bank_chapter_title
  ON public.question_bank (chapter_title)
  WHERE chapter_title IS NOT NULL;

-- 3. Backfill from chapters master (best-effort, guarded if chapters table absent)
DO $backfill$
DECLARE
  v_filled bigint;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'chapters'
  ) THEN
    UPDATE public.question_bank qb
    SET chapter_title = ch.title
    FROM public.chapters ch
    WHERE qb.chapter_title IS NULL
      AND qb.chapter_number IS NOT NULL
      AND qb.subject IS NOT NULL
      AND qb.grade IS NOT NULL
      AND ch.subject_code = qb.subject
      AND ch.grade = qb.grade
      AND ch.chapter_number = qb.chapter_number
      AND ch.title IS NOT NULL
      AND ch.title !~ '^Chapter [0-9]+$';

    SELECT COUNT(*) INTO v_filled
    FROM public.question_bank
    WHERE chapter_title IS NOT NULL;

    RAISE NOTICE 'Backfilled chapter_title from chapters master: % rows now have chapter_title', v_filled;
  ELSE
    RAISE NOTICE 'chapters table not found — skipping backfill (column will populate via writes only)';
  END IF;
END
$backfill$;

-- 4. Column comment
COMMENT ON COLUMN public.question_bank.chapter_title IS
  'Human-readable chapter title (Title Case). Closes schema drift discovered 2026-05-19: referenced by get_board_year_questions RPC, bulk-question-gen Edge Function, and JEE/NEET seed migration 20260520000006. Backfilled from chapters master table where available.';

-- 5. Verification block
DO $verify$
DECLARE
  v_column_exists boolean;
  v_index_exists boolean;
  v_total bigint;
  v_filled bigint;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'question_bank'
      AND column_name = 'chapter_title'
  ) INTO v_column_exists;

  SELECT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'question_bank'
      AND indexname = 'idx_question_bank_chapter_title'
  ) INTO v_index_exists;

  SELECT COUNT(*) INTO v_total FROM public.question_bank;
  SELECT COUNT(*) INTO v_filled FROM public.question_bank WHERE chapter_title IS NOT NULL;

  IF NOT v_column_exists THEN
    RAISE WARNING 'VERIFICATION FAILED: question_bank.chapter_title column missing after ALTER';
  ELSIF NOT v_index_exists THEN
    RAISE WARNING 'VERIFICATION WARNING: idx_question_bank_chapter_title index missing';
  ELSE
    RAISE NOTICE 'Verification OK — chapter_title column present, index present. Rows: %/% have chapter_title populated.', v_filled, v_total;
  END IF;
END
$verify$;

COMMIT;
