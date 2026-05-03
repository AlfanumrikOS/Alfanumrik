-- Migration: 20260403100000_educational_content_rebuild.sql
-- Purpose: Add Q&A answer fields and board-relevance tagging to question_bank,
--          create chapter_content_sections table for structured chapter learning pages,
--          and add RPCs for chapter content, Q&A, and RAG content retrieval.


-- ============================================================================
-- 1. New columns on question_bank
-- ============================================================================

-- board_relevance: whether question appeared in or matches board exam pattern
DO $$ BEGIN
  ALTER TABLE question_bank ADD COLUMN board_relevance TEXT DEFAULT NULL;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE question_bank ADD COLUMN board_relevance_note TEXT DEFAULT NULL;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- source_type: classification of question origin
DO $$ BEGIN
  ALTER TABLE question_bank ADD COLUMN source_type TEXT DEFAULT 'practice';
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Q&A answer fields for chapter learning pages
DO $$ BEGIN
  ALTER TABLE question_bank ADD COLUMN answer_text TEXT DEFAULT NULL;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE question_bank ADD COLUMN answer_text_hi TEXT DEFAULT NULL;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE question_bank ADD COLUMN answer_methodology TEXT DEFAULT NULL;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE question_bank ADD COLUMN marks_expected INTEGER DEFAULT NULL;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;


-- ============================================================================
-- 1b. CHECK constraints on new columns
-- ============================================================================

DO $$ BEGIN
  ALTER TABLE question_bank
    ADD CONSTRAINT chk_board_relevance
    CHECK (board_relevance IS NULL OR board_relevance IN ('board_appeared', 'board_pattern'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE question_bank
    ADD CONSTRAINT chk_source_type
    CHECK (source_type IN ('ncert_intext', 'ncert_exercise', 'ncert_example', 'cbse_style', 'practice'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE question_bank
    ADD CONSTRAINT chk_answer_methodology
    CHECK (answer_methodology IS NULL OR answer_methodology IN (
      'definition', 'stepwise', 'diagram', 'derivation', 'essay', 'numerical', 'comparison', 'analysis'
    ));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- ============================================================================
-- 1c. Indexes on new question_bank columns
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_qb_board_relevance
  ON question_bank(board_relevance) WHERE board_relevance IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_qb_source_type
  ON question_bank(source_type);

CREATE INDEX IF NOT EXISTS idx_qb_chapter_subject_grade
  ON question_bank(subject, grade, chapter_number);


-- ============================================================================
-- 2. chapter_content_sections — curated structured content for chapter pages
-- ============================================================================

CREATE TABLE IF NOT EXISTS chapter_content_sections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chapter_id UUID NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  grade TEXT NOT NULL,                    -- P5: grades are TEXT "6"-"12"
  subject TEXT NOT NULL,
  chapter_number INTEGER NOT NULL,
  section_type TEXT NOT NULL,
  title TEXT NOT NULL,
  title_hi TEXT,
  content TEXT NOT NULL,
  content_hi TEXT,
  display_order INTEGER NOT NULL DEFAULT 0,
  rag_chunk_ids UUID[] DEFAULT '{}',     -- traceability: which RAG chunks this section was derived from
  source TEXT DEFAULT 'ncert_2025',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- CHECK constraint on section_type
DO $$ BEGIN
  ALTER TABLE chapter_content_sections
    ADD CONSTRAINT chk_ccs_section_type
    CHECK (section_type IN (
      'overview', 'concept', 'definition', 'formula', 'worked_example',
      'key_takeaway', 'common_mistake', 'exam_tip', 'diagram_reference'
    ));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- ============================================================================
-- 2b. RLS on chapter_content_sections
-- ============================================================================

ALTER TABLE chapter_content_sections ENABLE ROW LEVEL SECURITY;

-- Public read for active content (curriculum reference data, not per-student)
CREATE POLICY "ccs_public_read" ON chapter_content_sections
  FOR SELECT USING (is_active = true);

-- Service role full access for admin content management
CREATE POLICY "ccs_service_all" ON chapter_content_sections
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);


-- ============================================================================
-- 2c. Indexes on chapter_content_sections
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_chapter_content_chapter
  ON chapter_content_sections(chapter_id, display_order);

CREATE INDEX IF NOT EXISTS idx_chapter_content_grade_subject
  ON chapter_content_sections(grade, subject, chapter_number) WHERE is_active = true;


-- ============================================================================
-- 2d. Updated_at trigger for chapter_content_sections
-- ============================================================================

CREATE OR REPLACE FUNCTION update_chapter_content_sections_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_chapter_content_sections_updated_at ON chapter_content_sections;
CREATE TRIGGER trg_chapter_content_sections_updated_at
  BEFORE UPDATE ON chapter_content_sections
  FOR EACH ROW EXECUTE FUNCTION update_chapter_content_sections_updated_at();


-- ============================================================================
-- 3. RPC: get_chapter_content
-- ============================================================================
-- SECURITY DEFINER: This function provides public read access to curated
-- chapter content sections. Using DEFINER to bypass RLS and apply filtering
-- within the function body, consistent with other chapter/content RPCs.

CREATE OR REPLACE FUNCTION get_chapter_content(
  p_grade TEXT,
  p_subject TEXT,
  p_chapter_number INTEGER
)
RETURNS TABLE(
  section_id UUID,
  section_type TEXT,
  title TEXT,
  title_hi TEXT,
  content TEXT,
  content_hi TEXT,
  display_order INTEGER
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_normalized_subject TEXT;
  v_grade TEXT;
BEGIN
  -- Normalize subject name from API shorthand to database format
  v_normalized_subject := CASE lower(trim(p_subject))
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

  -- Normalize grade: accept "7", "Grade 7", "grade7" — store/match as plain TEXT ("7")
  -- chapter_content_sections.grade follows P5 format ("6"-"12")
  v_grade := CASE
    WHEN p_grade ~ '^\d+$' THEN p_grade
    WHEN p_grade ILIKE 'grade%' THEN regexp_replace(p_grade, '[^0-9]', '', 'g')
    ELSE p_grade
  END;

  RETURN QUERY
  SELECT
    ccs.id AS section_id,
    ccs.section_type,
    ccs.title,
    ccs.title_hi,
    ccs.content,
    ccs.content_hi,
    ccs.display_order
  FROM chapter_content_sections ccs
  WHERE ccs.is_active = true
    AND ccs.grade = v_grade
    AND ccs.subject = v_normalized_subject
    AND ccs.chapter_number = p_chapter_number
  ORDER BY ccs.display_order ASC;
END;
$$;


-- ============================================================================
-- 4. RPC: get_chapter_qa
-- ============================================================================
-- SECURITY DEFINER: Provides read access to question_bank Q&A data for
-- chapter learning pages. Mediates access with subject/grade/chapter filtering,
-- consistent with existing question_bank RPCs.

CREATE OR REPLACE FUNCTION get_chapter_qa(
  p_grade TEXT,
  p_subject TEXT,
  p_chapter_number INTEGER,
  p_source_type TEXT DEFAULT NULL
)
RETURNS TABLE(
  question_id UUID,
  question_text TEXT,
  question_text_hi TEXT,
  question_type TEXT,
  source_type TEXT,
  answer_text TEXT,
  answer_text_hi TEXT,
  answer_methodology TEXT,
  marks_expected INTEGER,
  board_relevance TEXT,
  board_relevance_note TEXT,
  ncert_exercise TEXT,
  ncert_page INTEGER,
  is_ncert BOOLEAN,
  difficulty INTEGER,
  bloom_level TEXT,
  options JSONB,
  correct_answer_index INTEGER,
  explanation TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_grade TEXT;
BEGIN
  -- Normalize grade to P5 TEXT format ("6"-"12")
  v_grade := CASE
    WHEN p_grade ~ '^\d+$' THEN p_grade
    WHEN p_grade ILIKE 'grade%' THEN regexp_replace(p_grade, '[^0-9]', '', 'g')
    ELSE p_grade
  END;

  RETURN QUERY
  SELECT
    qb.id AS question_id,
    qb.question_text,
    qb.question_hi AS question_text_hi,
    qb.question_type_v2 AS question_type,
    qb.source_type,
    qb.answer_text,
    qb.answer_text_hi,
    qb.answer_methodology,
    qb.marks_expected,
    qb.board_relevance,
    qb.board_relevance_note,
    qb.ncert_exercise,
    qb.ncert_page,
    qb.is_ncert,
    qb.difficulty,
    qb.bloom_level,
    qb.options,
    qb.correct_answer_index,
    qb.explanation
  FROM question_bank qb
  WHERE qb.is_active = true
    AND qb.grade = v_grade
    AND qb.subject = p_subject
    AND qb.chapter_number = p_chapter_number
    AND (p_source_type IS NULL OR qb.source_type = p_source_type)
  ORDER BY
    -- Source type priority: ncert_exercise first, then intext, example, cbse_style, practice
    CASE qb.source_type
      WHEN 'ncert_exercise' THEN 1
      WHEN 'ncert_intext'   THEN 2
      WHEN 'ncert_example'  THEN 3
      WHEN 'cbse_style'     THEN 4
      WHEN 'practice'       THEN 5
      ELSE 6
    END ASC,
    qb.ncert_page ASC NULLS LAST,
    qb.id ASC;
END;
$$;


-- ============================================================================
-- 5. RPC: get_chapter_rag_content
-- ============================================================================
-- SECURITY DEFINER: Provides read access to rag_content_chunks for chapter
-- learning pages. rag_content_chunks has no direct student RLS policies;
-- this function mediates access with subject/grade/chapter filtering,
-- consistent with match_rag_chunks and hybrid_rag_search.

CREATE OR REPLACE FUNCTION get_chapter_rag_content(
  p_grade TEXT,
  p_subject TEXT,
  p_chapter_number INTEGER
)
RETURNS TABLE(
  chunk_id UUID,
  chunk_text TEXT,
  topic TEXT,
  concept TEXT,
  chapter_title TEXT,
  chunk_index INTEGER,
  page_number INTEGER
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_db_subject TEXT;
  v_db_grade TEXT;
BEGIN
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

  -- Normalize grade: rag_content_chunks uses "Grade 7" format
  v_db_grade := CASE
    WHEN p_grade ~ '^\d+$' THEN 'Grade ' || p_grade
    WHEN p_grade ILIKE 'grade%' THEN 'Grade ' || regexp_replace(p_grade, '[^0-9]', '', 'g')
    ELSE p_grade
  END;

  RETURN QUERY
  SELECT
    rc.id AS chunk_id,
    rc.chunk_text,
    rc.topic,
    rc.concept,
    rc.chapter_title,
    rc.chunk_index,
    rc.page_number
  FROM rag_content_chunks rc
  WHERE rc.is_active = true
    AND rc.subject = v_db_subject
    AND rc.grade = v_db_grade
    AND rc.chapter_number = p_chapter_number
  ORDER BY rc.chunk_index ASC NULLS LAST;
END;
$$;


-- ============================================================================
-- End of migration: 20260403100000_educational_content_rebuild.sql
-- Columns added to question_bank: 7 (board_relevance, board_relevance_note,
--   source_type, answer_text, answer_text_hi, answer_methodology, marks_expected)
-- Constraints added: 3 (chk_board_relevance, chk_source_type, chk_answer_methodology)
-- Indexes added: 5 (3 on question_bank, 2 on chapter_content_sections)
-- Tables created: chapter_content_sections (with RLS + 2 policies + trigger)
-- RPCs created: get_chapter_content, get_chapter_qa, get_chapter_rag_content
-- ============================================================================
