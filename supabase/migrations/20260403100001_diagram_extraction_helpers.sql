-- Migration: 20260403100001_diagram_extraction_helpers.sql
-- Purpose: Add two helper RPCs for diagram/figure extraction from RAG content
--          and media retrieval for chapter learning pages.
--   1. find_diagram_references — scans rag_content_chunks for figure/diagram mentions
--   2. get_chapter_media — returns content_media records for a specific chapter


-- ============================================================================
-- 1. RPC: find_diagram_references
-- ============================================================================
-- SECURITY DEFINER: rag_content_chunks has no direct student RLS policies.
-- This function mediates access with grade/subject filtering and only exposes
-- chunk metadata + diagram reference text, consistent with match_rag_chunks
-- and get_chapter_rag_content which also use SECURITY DEFINER for the same table.

CREATE OR REPLACE FUNCTION find_diagram_references(
  p_grade TEXT DEFAULT NULL,
  p_subject TEXT DEFAULT NULL
)
RETURNS TABLE(
  chunk_id UUID,
  grade TEXT,
  subject TEXT,
  chapter_title TEXT,
  chapter_number INTEGER,
  page_number INTEGER,
  chunk_text TEXT,
  diagram_refs TEXT[]
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_db_grade TEXT;
  v_db_subject TEXT;
BEGIN
  -- Normalize grade to rag_content_chunks format ("Grade 7")
  IF p_grade IS NOT NULL THEN
    v_db_grade := CASE
      WHEN p_grade ~ '^\d+$' THEN 'Grade ' || p_grade
      WHEN p_grade ILIKE 'grade%' THEN 'Grade ' || regexp_replace(p_grade, '[^0-9]', '', 'g')
      ELSE p_grade
    END;
  END IF;

  -- Normalize subject name (same mapping as match_rag_chunks)
  IF p_subject IS NOT NULL THEN
    v_db_subject := CASE lower(trim(p_subject))
      WHEN 'math' THEN 'Mathematics'
      WHEN 'mathematics' THEN 'Mathematics'
      WHEN 'maths' THEN 'Mathematics'
      WHEN 'science' THEN 'Science'
      WHEN 'physics' THEN 'Physics'
      WHEN 'chemistry' THEN 'Chemistry'
      WHEN 'biology' THEN 'Biology'
      WHEN 'english' THEN 'English'
      WHEN 'hindi' THEN 'Hindi'
      WHEN 'sanskrit' THEN 'Sanskrit'
      WHEN 'social_studies' THEN 'Social Studies'
      WHEN 'social studies' THEN 'Social Studies'
      WHEN 'computer_science' THEN 'Computer Science'
      WHEN 'computer science' THEN 'Computer Science'
      WHEN 'coding' THEN 'Computer Science'
      WHEN 'informatics_practices' THEN 'Informatics Practices'
      WHEN 'informatics practices' THEN 'Informatics Practices'
      WHEN 'economics' THEN 'Economics'
      WHEN 'accountancy' THEN 'Accountancy'
      WHEN 'political_science' THEN 'Political Science'
      WHEN 'political science' THEN 'Political Science'
      WHEN 'history' THEN 'History'
      WHEN 'history_sr' THEN 'History'
      WHEN 'geography' THEN 'Geography'
      ELSE initcap(replace(trim(p_subject), '_', ' '))
    END;
  END IF;

  RETURN QUERY
  SELECT
    rc.id AS chunk_id,
    rc.grade,
    rc.subject,
    rc.chapter_title,
    rc.chapter_number,
    rc.page_number,
    rc.chunk_text,
    ARRAY(
      SELECT DISTINCT m[1]
      FROM regexp_matches(rc.chunk_text, '(?:Figure|Fig\.|Diagram|Activity|Table|Chart|Map|Illustration)\s*[\d]+[\.\d]*', 'gi') AS m
    ) AS diagram_refs
  FROM rag_content_chunks rc
  WHERE rc.is_active = true
    AND (v_db_grade IS NULL OR rc.grade = v_db_grade)
    AND (v_db_subject IS NULL OR rc.subject = v_db_subject)
    AND rc.chunk_text ~* '(?:Figure|Fig\.|Diagram|Activity|Table|Chart|Map|Illustration)\s*[\d]+[\.\d]*'
  ORDER BY rc.grade, rc.subject, rc.chapter_number, rc.chunk_index;
END;
$$;


-- ============================================================================
-- 2. RPC: get_chapter_media
-- ============================================================================
-- SECURITY DEFINER: content_media is curriculum reference data with a public-read
-- RLS policy for active rows, but using DEFINER for consistency with other
-- chapter content RPCs and to ensure stable access regardless of future RLS changes.

CREATE OR REPLACE FUNCTION get_chapter_media(
  p_grade TEXT,
  p_subject TEXT,
  p_chapter_number INTEGER
)
RETURNS TABLE(
  media_id UUID,
  caption TEXT,
  alt_text TEXT,
  media_type TEXT,
  storage_url TEXT,
  page_number INTEGER,
  source_book TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_db_grade TEXT;
  v_db_subject TEXT;
BEGIN
  -- Normalize grade to content_media format ("Grade 7")
  v_db_grade := CASE
    WHEN p_grade ~ '^\d+$' THEN 'Grade ' || p_grade
    WHEN p_grade ILIKE 'grade%' THEN 'Grade ' || regexp_replace(p_grade, '[^0-9]', '', 'g')
    ELSE p_grade
  END;

  -- Normalize subject name (same mapping as match_rag_chunks)
  v_db_subject := CASE lower(trim(p_subject))
    WHEN 'math' THEN 'Mathematics'
    WHEN 'mathematics' THEN 'Mathematics'
    WHEN 'maths' THEN 'Mathematics'
    WHEN 'science' THEN 'Science'
    WHEN 'physics' THEN 'Physics'
    WHEN 'chemistry' THEN 'Chemistry'
    WHEN 'biology' THEN 'Biology'
    WHEN 'english' THEN 'English'
    WHEN 'hindi' THEN 'Hindi'
    WHEN 'sanskrit' THEN 'Sanskrit'
    WHEN 'social_studies' THEN 'Social Studies'
    WHEN 'social studies' THEN 'Social Studies'
    WHEN 'computer_science' THEN 'Computer Science'
    WHEN 'computer science' THEN 'Computer Science'
    WHEN 'coding' THEN 'Computer Science'
    WHEN 'informatics_practices' THEN 'Informatics Practices'
    WHEN 'informatics practices' THEN 'Informatics Practices'
    WHEN 'economics' THEN 'Economics'
    WHEN 'accountancy' THEN 'Accountancy'
    WHEN 'political_science' THEN 'Political Science'
    WHEN 'political science' THEN 'Political Science'
    WHEN 'history' THEN 'History'
    WHEN 'history_sr' THEN 'History'
    WHEN 'geography' THEN 'Geography'
    ELSE initcap(replace(trim(p_subject), '_', ' '))
  END;

  RETURN QUERY
  SELECT
    cm.id AS media_id,
    cm.caption,
    cm.alt_text,
    cm.media_type,
    cm.storage_url,
    cm.page_number,
    cm.source_book
  FROM content_media cm
  WHERE cm.is_active = true
    AND cm.grade = v_db_grade
    AND cm.subject = v_db_subject
    AND cm.chapter_number = p_chapter_number
  ORDER BY cm.page_number ASC NULLS LAST;
END;
$$;


-- ============================================================================
-- End of migration: 20260403100001_diagram_extraction_helpers.sql
-- RPCs created:
--   1. find_diagram_references(p_grade, p_subject) — scans RAG chunks for diagram refs
--   2. get_chapter_media(p_grade, p_subject, p_chapter_number) — returns chapter media
-- No tables created or altered. No DROP statements.
-- ============================================================================
