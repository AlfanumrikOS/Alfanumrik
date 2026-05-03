-- Migration: 20260418100700_backfill_helper_rpcs.sql
-- Purpose: Helper RPCs for cbse_syllabus backfill — surface distinct (grade,
-- subject_code, chapter_number) tuples from rag_content_chunks and question_bank.

CREATE OR REPLACE FUNCTION distinct_chapter_tuples_from_chunks()
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

CREATE OR REPLACE FUNCTION distinct_chapter_tuples_from_bank()
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

COMMENT ON FUNCTION distinct_chapter_tuples_from_chunks() IS
  'Backfill helper: distinct chapter tuples from rag_content_chunks. '
  'Used by scripts/backfill-cbse-syllabus.ts to populate cbse_syllabus.';

COMMENT ON FUNCTION distinct_chapter_tuples_from_bank() IS
  'Backfill helper: distinct chapter tuples from question_bank. '
  'Used by scripts/backfill-cbse-syllabus.ts to populate cbse_syllabus.';