-- Migration: 20260504100700_fix_distinct_chapter_tuples_ambiguity.sql
-- Purpose: Fix "column reference subject_code is ambiguous" runtime error in
--          distinct_chapter_tuples_from_chunks() and
--          distinct_chapter_tuples_from_bank().
--
-- Bug
-- ---
-- The production baseline (`00000000000000_baseline_from_prod.sql`) defined both
-- helpers with `LANGUAGE plpgsql` and `RETURNS TABLE(... "subject_code" "text" ...)`.
-- Inside the body, the inner SELECT references a source column also named
-- `subject_code` (from `rag_content_chunks`) and uses it in the WHERE clause.
-- plpgsql treats the OUT column declared in `RETURNS TABLE(...)` as a variable
-- in scope, so any unqualified `subject_code` in the body becomes ambiguous
-- between the OUT column and the source column. PostgreSQL raises:
--
--   ERROR: column reference "subject_code" is ambiguous
--
-- This surfaced via the staging integration tests for PR #516 as
-- "chunk tuple fetch failed: column reference subject_code is ambiguous".
--
-- The original migration `_legacy/timestamped/20260418100700_backfill_helper_rpcs.sql`
-- used `LANGUAGE sql`, which has no such ambiguity (no in-scope OUT-column
-- variables). The pg_dump that produced the baseline appears to have rewritten
-- the simple SQL functions as plpgsql wrappers, introducing the bug.
--
-- Fix
-- ---
-- DROP both functions and re-create them with `LANGUAGE sql STABLE`, matching the
-- original legacy version byte-for-byte in body and signature.
--
-- Why LANGUAGE sql is safer here than plpgsql
-- -------------------------------------------
-- * `LANGUAGE sql` functions are a single SELECT — no PL/pgSQL variable scope,
--   so OUT column names cannot collide with source column names.
-- * The planner can inline a `LANGUAGE sql STABLE` function into the calling
--   query, which is faster than the plpgsql wrapper.
-- * Neither function needs control flow, exception handling, or variables —
--   plpgsql buys nothing here and only adds the ambiguity footgun.
--
-- Reversibility
-- -------------
-- Safe. These helpers are stateless (no data captured) and the previous
-- plpgsql version was bug-prone (raised at runtime on every call). DROP-and-
-- CREATE preserves the exact return signature, so generated TS types in
-- `src/types/database.types.ts` remain valid without regeneration.
-- Idempotent via DROP IF EXISTS + CREATE OR REPLACE.

DROP FUNCTION IF EXISTS public.distinct_chapter_tuples_from_chunks();
DROP FUNCTION IF EXISTS public.distinct_chapter_tuples_from_bank();

CREATE OR REPLACE FUNCTION public.distinct_chapter_tuples_from_chunks()
RETURNS TABLE (grade text, subject_code text, chapter_number int,
               chapter_title text, subject_display text)
LANGUAGE sql STABLE AS $$
  SELECT DISTINCT
    grade_short AS grade,
    subject_code,
    chapter_number,
    NULL::text AS chapter_title,                  -- not always present in chunks
    subject_code AS subject_display
  FROM rag_content_chunks
  WHERE grade_short IS NOT NULL
    AND subject_code IS NOT NULL
    AND chapter_number IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION public.distinct_chapter_tuples_from_bank()
RETURNS TABLE (grade text, subject_code text, chapter_number int,
               chapter_title text, subject_display text)
LANGUAGE sql STABLE AS $$
  SELECT DISTINCT
    grade,
    subject AS subject_code,
    chapter_number,
    NULL::text AS chapter_title,
    subject AS subject_display
  FROM question_bank
  WHERE grade IS NOT NULL
    AND subject IS NOT NULL
    AND chapter_number IS NOT NULL;
$$;

COMMENT ON FUNCTION public.distinct_chapter_tuples_from_chunks() IS
  'Backfill helper: distinct chapter tuples from rag_content_chunks. '
  'Used by scripts/backfill-cbse-syllabus.ts to populate cbse_syllabus. '
  'LANGUAGE sql to avoid plpgsql OUT-column / source-column ambiguity '
  '(fixed in 20260504100700).';

COMMENT ON FUNCTION public.distinct_chapter_tuples_from_bank() IS
  'Backfill helper: distinct chapter tuples from question_bank. '
  'Used by scripts/backfill-cbse-syllabus.ts to populate cbse_syllabus. '
  'LANGUAGE sql to avoid plpgsql OUT-column / source-column ambiguity '
  '(fixed in 20260504100700).';
