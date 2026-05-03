-- Migration: 20260403400000_rag_three_categories.sql
-- Purpose: Make RAG the single source of truth with three content categories
--          (content, diagram, qa). Add content_type column, Q&A metadata columns,
--          update match_rag_chunks and get_chapter_rag_content RPCs to support
--          content_type filtering, and create get_chapter_qa_from_rag RPC.


-- ============================================================================
-- 1. Add content_type column to rag_content_chunks
-- ============================================================================

DO $$ BEGIN
  ALTER TABLE rag_content_chunks ADD COLUMN IF NOT EXISTS content_type TEXT NOT NULL DEFAULT 'content';
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE rag_content_chunks ADD CONSTRAINT chk_rag_content_type
    CHECK (content_type IN ('content', 'diagram', 'qa'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- ============================================================================
-- 2. Backfill existing data
-- ============================================================================

-- Tag existing diagram chunks
UPDATE rag_content_chunks SET content_type = 'diagram'
  WHERE media_type = 'diagram' AND content_type = 'content';

-- Tag existing text chunks (already default 'content', but be explicit)
UPDATE rag_content_chunks SET content_type = 'content'
  WHERE media_type IS NULL AND content_type = 'content';


-- ============================================================================
-- 3. Add index for content_type filtering
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_rag_chunks_content_type
  ON rag_content_chunks(content_type, subject, grade) WHERE is_active = true;


-- ============================================================================
-- 4. Add Q&A-specific metadata columns
-- ============================================================================

DO $$ BEGIN
  ALTER TABLE rag_content_chunks ADD COLUMN IF NOT EXISTS question_text TEXT DEFAULT NULL;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE rag_content_chunks ADD COLUMN IF NOT EXISTS answer_text TEXT DEFAULT NULL;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE rag_content_chunks ADD COLUMN IF NOT EXISTS question_type TEXT DEFAULT NULL;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE rag_content_chunks ADD COLUMN IF NOT EXISTS ncert_exercise TEXT DEFAULT NULL;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE rag_content_chunks ADD COLUMN IF NOT EXISTS marks_expected INTEGER DEFAULT NULL;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE rag_content_chunks ADD COLUMN IF NOT EXISTS bloom_level TEXT DEFAULT NULL;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE rag_content_chunks ADD CONSTRAINT chk_rag_question_type
    CHECK (question_type IS NULL OR question_type IN (
      'mcq', 'short_answer', 'long_answer', 'numerical',
      'intext', 'exercise', 'example', 'hots'
    ));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- ============================================================================
-- 5. Drop and recreate match_rag_chunks with content_type filter
-- ============================================================================
-- Must drop existing overloads because the return type is changing
-- (adding content_type to RETURNS TABLE).

DROP FUNCTION IF EXISTS match_rag_chunks(TEXT, TEXT, TEXT, INTEGER, TEXT, vector);
DROP FUNCTION IF EXISTS match_rag_chunks(TEXT, TEXT, TEXT, INTEGER, TEXT);
DROP FUNCTION IF EXISTS match_rag_chunks(TEXT, TEXT, TEXT, INTEGER);

-- SECURITY DEFINER: required because rag_content_chunks RLS is not configured for
-- direct student access; this function mediates access with subject/grade filtering.
-- Edge Functions call this via service role, but the function signature must remain
-- stable for the existing foxy-tutor and ncert-solver callers. The query_embedding
-- parameter defaults to NULL so existing callers are unaffected. The new
-- p_content_type parameter defaults to NULL for backward compatibility.
CREATE OR REPLACE FUNCTION match_rag_chunks(
  query_text TEXT,
  p_subject TEXT,
  p_grade TEXT,
  match_count INTEGER DEFAULT 5,
  p_chapter TEXT DEFAULT NULL,
  query_embedding vector(1024) DEFAULT NULL,
  p_content_type TEXT DEFAULT NULL
)
RETURNS TABLE(
  id UUID,
  content TEXT,
  chapter_title TEXT,
  topic TEXT,
  concept TEXT,
  similarity FLOAT,
  media_url TEXT,
  content_type TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_db_subject TEXT;
  v_db_grade TEXT;
  v_query tsquery;
  v_count INTEGER;
  v_words TEXT[];
BEGIN
  -- Normalize subject name from API shorthand to database format
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

  -- Normalize grade: "7" -> "Grade 7", "grade7" -> "Grade 7", "Grade 7" -> "Grade 7"
  v_db_grade := CASE
    WHEN p_grade ~ '^\d+$' THEN 'Grade ' || p_grade
    WHEN p_grade ILIKE 'grade%' THEN 'Grade ' || regexp_replace(p_grade, '[^0-9]', '', 'g')
    ELSE p_grade
  END;

  -- PATH 1: Vector similarity search (when embedding is provided)
  IF query_embedding IS NOT NULL THEN
    RETURN QUERY
    SELECT
      c.id,
      c.chunk_text,
      c.chapter_title,
      c.topic,
      c.concept,
      (1 - (c.embedding <=> query_embedding))::FLOAT AS similarity,
      c.media_url,
      c.content_type
    FROM rag_content_chunks c
    WHERE c.is_active = true
      AND c.embedding IS NOT NULL
      AND c.subject = v_db_subject
      AND c.grade = v_db_grade
      AND (p_chapter IS NULL OR c.chapter_title ILIKE '%' || p_chapter || '%')
      AND (p_content_type IS NULL OR c.content_type = p_content_type)
    ORDER BY c.embedding <=> query_embedding
    LIMIT match_count;

    GET DIAGNOSTICS v_count = ROW_COUNT;

    -- If vector search returned results, we are done
    IF v_count > 0 THEN
      RETURN;
    END IF;
    -- Otherwise fall through to full-text search
  END IF;

  -- PATH 2: Full-text search (tsvector)
  v_query := plainto_tsquery('english', query_text);

  RETURN QUERY
  SELECT
    c.id,
    c.chunk_text,
    c.chapter_title,
    c.topic,
    c.concept,
    ts_rank(c.search_vector, v_query)::FLOAT AS similarity,
    c.media_url,
    c.content_type
  FROM rag_content_chunks c
  WHERE c.is_active = true
    AND c.subject = v_db_subject
    AND c.grade = v_db_grade
    AND c.search_vector @@ v_query
    AND (p_chapter IS NULL OR c.chapter_title ILIKE '%' || p_chapter || '%')
    AND (p_content_type IS NULL OR c.content_type = p_content_type)
  ORDER BY ts_rank(c.search_vector, v_query) DESC
  LIMIT match_count;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- PATH 3: LIKE keyword fallback
  IF v_count = 0 THEN
    v_words := string_to_array(lower(query_text), ' ');
    RETURN QUERY
    SELECT
      c.id,
      c.chunk_text,
      c.chapter_title,
      c.topic,
      c.concept,
      0.5::FLOAT AS similarity,
      c.media_url,
      c.content_type
    FROM rag_content_chunks c
    WHERE c.is_active = true
      AND c.subject = v_db_subject
      AND c.grade = v_db_grade
      AND (
        lower(c.chunk_text) LIKE '%' || v_words[1] || '%'
        OR (array_length(v_words, 1) >= 2 AND lower(c.chunk_text) LIKE '%' || v_words[2] || '%')
        OR (array_length(v_words, 1) >= 3 AND lower(c.chunk_text) LIKE '%' || v_words[3] || '%')
        OR lower(c.topic) LIKE '%' || v_words[1] || '%'
        OR lower(c.concept) LIKE '%' || v_words[1] || '%'
      )
      AND (p_chapter IS NULL OR c.chapter_title ILIKE '%' || p_chapter || '%')
      AND (p_content_type IS NULL OR c.content_type = p_content_type)
    LIMIT match_count;
  END IF;
END;
$$;


-- ============================================================================
-- 6. Update get_chapter_rag_content with content_type filter
-- ============================================================================
-- SECURITY DEFINER: required because rag_content_chunks RLS is not configured
-- for direct student access; this function mediates access with subject/grade
-- filtering. Consistent with the original definition in
-- 20260403100000_educational_content_rebuild.sql and updated in
-- 20260403300000_embed_diagrams_in_rag.sql.

CREATE OR REPLACE FUNCTION get_chapter_rag_content(
  p_grade TEXT,
  p_subject TEXT,
  p_chapter_number INTEGER,
  p_content_type TEXT DEFAULT NULL
)
RETURNS TABLE(
  chunk_id UUID,
  chunk_text TEXT,
  topic TEXT,
  concept TEXT,
  chapter_title TEXT,
  chunk_index INTEGER,
  page_number INTEGER,
  media_url TEXT,
  media_type TEXT,
  media_description TEXT,
  content_type TEXT
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
    rc.page_number,
    rc.media_url,
    rc.media_type,
    rc.media_description,
    rc.content_type
  FROM rag_content_chunks rc
  WHERE rc.is_active = true
    AND rc.subject = v_db_subject
    AND rc.grade = v_db_grade
    AND rc.chapter_number = p_chapter_number
    AND (p_content_type IS NULL OR rc.content_type = p_content_type)
  ORDER BY rc.chunk_index ASC NULLS LAST;
END;
$$;


-- ============================================================================
-- 7. Create get_chapter_qa_from_rag RPC for Q&A retrieval
-- ============================================================================
-- SECURITY DEFINER: required because rag_content_chunks RLS is not configured
-- for direct student access; this function mediates access with subject/grade
-- filtering, consistent with match_rag_chunks and get_chapter_rag_content.

CREATE OR REPLACE FUNCTION get_chapter_qa_from_rag(
  p_grade TEXT,
  p_subject TEXT,
  p_chapter_number INTEGER
)
RETURNS TABLE(
  chunk_id UUID,
  question_text TEXT,
  answer_text TEXT,
  question_type TEXT,
  ncert_exercise TEXT,
  marks_expected INTEGER,
  bloom_level TEXT,
  chunk_text TEXT,
  topic TEXT,
  concept TEXT,
  chapter_title TEXT,
  media_url TEXT,
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
    rc.question_text,
    rc.answer_text,
    rc.question_type,
    rc.ncert_exercise,
    rc.marks_expected,
    rc.bloom_level,
    rc.chunk_text,
    rc.topic,
    rc.concept,
    rc.chapter_title,
    rc.media_url,
    rc.page_number
  FROM rag_content_chunks rc
  WHERE rc.is_active = true
    AND rc.content_type = 'qa'
    AND rc.subject = v_db_subject
    AND rc.grade = v_db_grade
    AND rc.chapter_number = p_chapter_number
  ORDER BY rc.chunk_index ASC NULLS LAST;
END;
$$;


-- ============================================================================
-- End of migration: 20260403400000_rag_three_categories.sql
-- Columns added to rag_content_chunks: 7 (content_type, question_text,
--   answer_text, question_type, ncert_exercise, marks_expected, bloom_level)
-- Constraints added: 2 (chk_rag_content_type, chk_rag_question_type)
-- Indexes added: 1 (idx_rag_chunks_content_type)
-- RPCs updated: match_rag_chunks, get_chapter_rag_content
-- RPCs created: get_chapter_qa_from_rag
-- ============================================================================
