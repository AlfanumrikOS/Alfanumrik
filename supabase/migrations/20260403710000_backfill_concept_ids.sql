-- Migration: 20260403710000_backfill_concept_ids.sql
-- Purpose: Best-effort backfill of rag_content_chunks.concept_id by matching
--          rag_content_chunks.concept (free text) to chapter_concepts.title
--          on normalized grade + normalized subject + chapter_number.
--
-- Grade normalization:  rag stores "Grade 7"  → strip non-digits → "7"  (P5)
-- Subject normalization: rag stores "Mathematics" → chapter_concepts uses "math"
--
-- This is idempotent: only rows with concept_id IS NULL are touched.
-- NULLs that remain after the update are acceptable — concept text in rag
-- may not exactly match chapter_concepts.title.


-- ============================================================================
-- Backfill rag_content_chunks.concept_id
-- ============================================================================

DO $$
DECLARE
  v_updated INTEGER;
BEGIN
  UPDATE rag_content_chunks rcc
  SET concept_id = cc.id
  FROM chapter_concepts cc
  WHERE rcc.concept_id IS NULL                        -- idempotent: only unset rows
    AND rcc.concept IS NOT NULL
    AND rcc.concept <> ''
    AND rcc.concept = cc.title                        -- exact text match
    AND rcc.chapter_number = cc.chapter_number
    AND regexp_replace(rcc.grade, '[^0-9]', '', 'g') = cc.grade
    AND CASE rcc.subject
          WHEN 'Mathematics'           THEN 'math'
          WHEN 'Science'               THEN 'science'
          WHEN 'Physics'               THEN 'physics'
          WHEN 'Chemistry'             THEN 'chemistry'
          WHEN 'Biology'               THEN 'biology'
          WHEN 'English'               THEN 'english'
          WHEN 'Hindi'                 THEN 'hindi'
          WHEN 'Sanskrit'              THEN 'sanskrit'
          WHEN 'Social Studies'        THEN 'social_studies'
          WHEN 'Computer Science'      THEN 'computer_science'
          WHEN 'Informatics Practices' THEN 'informatics_practices'
          WHEN 'Economics'             THEN 'economics'
          WHEN 'Accountancy'           THEN 'accountancy'
          WHEN 'Political Science'     THEN 'political_science'
          WHEN 'History'               THEN 'history'
          WHEN 'Geography'             THEN 'geography'
          ELSE lower(replace(rcc.subject, ' ', '_'))
        END = cc.subject;

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  RAISE NOTICE '[20260403710000] backfill_concept_ids: % rag_content_chunks rows updated with concept_id', v_updated;
END;
$$;


-- ============================================================================
-- End of migration: 20260403710000_backfill_concept_ids.sql
--
-- Tables modified: rag_content_chunks (concept_id column, already existed)
-- Rows affected: variable — best-effort match on concept text + grade + subject + chapter_number
-- RLS: no change (tables and policies already exist)
-- New tables: none
-- New RPCs: none
-- Idempotent: yes (WHERE concept_id IS NULL guard)
-- ============================================================================
