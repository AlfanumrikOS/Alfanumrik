-- Migration: 20260403300000_embed_diagrams_in_rag.sql
-- Purpose: Make diagrams first-class content in the RAG retrieval pipeline by
--          adding media columns to rag_content_chunks and chapter_concepts,
--          and updating match_rag_chunks, hybrid_rag_search,
--          get_chapter_rag_content, and get_chapter_concepts RPCs to return them.


-- ============================================================================
-- 1. Add media columns to rag_content_chunks
-- ============================================================================
-- media_type: 'diagram', 'table', 'chart', 'photo', or NULL (text-only chunk)

ALTER TABLE rag_content_chunks ADD COLUMN IF NOT EXISTS media_url TEXT DEFAULT NULL;
ALTER TABLE rag_content_chunks ADD COLUMN IF NOT EXISTS media_type TEXT DEFAULT NULL;
ALTER TABLE rag_content_chunks ADD COLUMN IF NOT EXISTS media_description TEXT DEFAULT NULL;

DO $$ BEGIN
  ALTER TABLE rag_content_chunks
    ADD CONSTRAINT chk_rag_media_type
    CHECK (media_type IS NULL OR media_type IN ('diagram', 'table', 'chart', 'photo'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- ============================================================================
-- 2. Add diagram_url column to chapter_concepts
-- ============================================================================

ALTER TABLE chapter_concepts ADD COLUMN IF NOT EXISTS diagram_url TEXT DEFAULT NULL;


-- ============================================================================
-- 3. Index for finding chunks that have media
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_rag_chunks_media_type
  ON rag_content_chunks(media_type) WHERE media_type IS NOT NULL;


-- ============================================================================
-- 4. Update get_chapter_rag_content RPC to return media columns
-- ============================================================================
-- SECURITY DEFINER: required because rag_content_chunks RLS is not configured
-- for direct student access; this function mediates access with subject/grade
-- filtering. Consistent with the original definition in
-- 20260403100000_educational_content_rebuild.sql.

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
  page_number INTEGER,
  media_url TEXT,
  media_type TEXT,
  media_description TEXT
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
    rc.media_description
  FROM rag_content_chunks rc
  WHERE rc.is_active = true
    AND rc.subject = v_db_subject
    AND rc.grade = v_db_grade
    AND rc.chapter_number = p_chapter_number
  ORDER BY rc.chunk_index ASC NULLS LAST;
END;
$$;


-- ============================================================================
-- 5. Drop and recreate match_rag_chunks with media_url in return table
-- ============================================================================
-- Must drop existing overloads first because the return type is changing.

DROP FUNCTION IF EXISTS match_rag_chunks(TEXT, TEXT, TEXT, INTEGER, TEXT, vector);
DROP FUNCTION IF EXISTS match_rag_chunks(TEXT, TEXT, TEXT, INTEGER, TEXT);
DROP FUNCTION IF EXISTS match_rag_chunks(TEXT, TEXT, TEXT, INTEGER, INTEGER);
DROP FUNCTION IF EXISTS match_rag_chunks(TEXT, TEXT, TEXT, INTEGER);

-- SECURITY DEFINER: required because rag_content_chunks RLS is not configured for
-- direct student access; this function mediates access with subject/grade filtering.
-- Edge Functions call this via service role, but the function signature must remain
-- stable for the existing foxy-tutor and ncert-solver callers. The query_embedding
-- parameter defaults to NULL so existing callers are unaffected.
CREATE OR REPLACE FUNCTION match_rag_chunks(
  query_text TEXT,
  p_subject TEXT,
  p_grade TEXT,
  match_count INTEGER DEFAULT 5,
  p_chapter TEXT DEFAULT NULL,
  query_embedding vector(1024) DEFAULT NULL
)
RETURNS TABLE(
  id UUID,
  content TEXT,
  chapter_title TEXT,
  topic TEXT,
  concept TEXT,
  similarity FLOAT,
  media_url TEXT
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
      c.media_url
    FROM rag_content_chunks c
    WHERE c.is_active = true
      AND c.embedding IS NOT NULL
      AND c.subject = v_db_subject
      AND c.grade = v_db_grade
      AND (p_chapter IS NULL OR c.chapter_title ILIKE '%' || p_chapter || '%')
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
    c.media_url
  FROM rag_content_chunks c
  WHERE c.is_active = true
    AND c.subject = v_db_subject
    AND c.grade = v_db_grade
    AND c.search_vector @@ v_query
    AND (p_chapter IS NULL OR c.chapter_title ILIKE '%' || p_chapter || '%')
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
      c.media_url
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
    LIMIT match_count;
  END IF;
END;
$$;


-- ============================================================================
-- 6. Drop and recreate hybrid_rag_search with media_url in return table
-- ============================================================================
-- Must drop because return type is changing.

DROP FUNCTION IF EXISTS hybrid_rag_search(TEXT, vector, TEXT, TEXT, TEXT, INTEGER, FLOAT, FLOAT);

-- SECURITY DEFINER: same justification as match_rag_chunks -- mediates access
-- to rag_content_chunks which has no direct student RLS policies.
CREATE OR REPLACE FUNCTION hybrid_rag_search(
  query_text TEXT,
  query_embedding vector(1024),
  p_subject TEXT,
  p_grade TEXT,
  p_chapter TEXT DEFAULT NULL,
  match_count INTEGER DEFAULT 5,
  vector_weight FLOAT DEFAULT 0.7,
  text_weight FLOAT DEFAULT 0.3
)
RETURNS TABLE(
  id UUID,
  content TEXT,
  chapter_title TEXT,
  topic TEXT,
  concept TEXT,
  similarity FLOAT,
  media_url TEXT
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
  v_k CONSTANT INTEGER := 60;  -- RRF constant
  v_fetch_count INTEGER;
BEGIN
  -- Normalize subject
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

  -- Normalize grade
  v_db_grade := CASE
    WHEN p_grade ~ '^\d+$' THEN 'Grade ' || p_grade
    WHEN p_grade ILIKE 'grade%' THEN 'Grade ' || regexp_replace(p_grade, '[^0-9]', '', 'g')
    ELSE p_grade
  END;

  v_query := plainto_tsquery('english', query_text);
  -- Fetch more candidates than needed to allow RRF to re-rank
  v_fetch_count := match_count * 4;

  RETURN QUERY
  WITH
  -- Vector search candidates with rank
  vec AS (
    SELECT
      c.id,
      c.chunk_text,
      c.chapter_title,
      c.topic,
      c.concept,
      c.media_url,
      ROW_NUMBER() OVER (ORDER BY c.embedding <=> query_embedding) AS rank_vec
    FROM rag_content_chunks c
    WHERE c.is_active = true
      AND c.embedding IS NOT NULL
      AND c.subject = v_db_subject
      AND c.grade = v_db_grade
      AND (p_chapter IS NULL OR c.chapter_title ILIKE '%' || p_chapter || '%')
    ORDER BY c.embedding <=> query_embedding
    LIMIT v_fetch_count
  ),
  -- Full-text search candidates with rank
  fts AS (
    SELECT
      c.id,
      c.chunk_text,
      c.chapter_title,
      c.topic,
      c.concept,
      c.media_url,
      ROW_NUMBER() OVER (ORDER BY ts_rank(c.search_vector, v_query) DESC) AS rank_fts
    FROM rag_content_chunks c
    WHERE c.is_active = true
      AND c.subject = v_db_subject
      AND c.grade = v_db_grade
      AND c.search_vector @@ v_query
      AND (p_chapter IS NULL OR c.chapter_title ILIKE '%' || p_chapter || '%')
    ORDER BY ts_rank(c.search_vector, v_query) DESC
    LIMIT v_fetch_count
  ),
  -- Combine via FULL OUTER JOIN and compute RRF score
  combined AS (
    SELECT
      COALESCE(v.id, f.id) AS id,
      COALESCE(v.chunk_text, f.chunk_text) AS chunk_text,
      COALESCE(v.chapter_title, f.chapter_title) AS chapter_title,
      COALESCE(v.topic, f.topic) AS topic,
      COALESCE(v.concept, f.concept) AS concept,
      COALESCE(v.media_url, f.media_url) AS media_url,
      (
        vector_weight * COALESCE(1.0 / (v_k + v.rank_vec), 0) +
        text_weight   * COALESCE(1.0 / (v_k + f.rank_fts), 0)
      )::FLOAT AS rrf_score
    FROM vec v
    FULL OUTER JOIN fts f ON v.id = f.id
  )
  SELECT
    combined.id,
    combined.chunk_text,
    combined.chapter_title,
    combined.topic,
    combined.concept,
    combined.rrf_score AS similarity,
    combined.media_url
  FROM combined
  ORDER BY combined.rrf_score DESC
  LIMIT match_count;
END;
$$;


-- ============================================================================
-- 7. Update get_chapter_concepts RPC to return diagram_url
-- ============================================================================
-- SECURITY DEFINER: This function provides public read access to curated
-- chapter concept data. Using DEFINER to bypass RLS and apply filtering
-- within the function body, consistent with get_chapter_content and other
-- chapter/content RPCs in the codebase.

CREATE OR REPLACE FUNCTION get_chapter_concepts(
  p_grade TEXT,
  p_subject TEXT,
  p_chapter_number INTEGER
)
RETURNS TABLE(
  concept_id UUID,
  concept_number INTEGER,
  title TEXT,
  title_hi TEXT,
  learning_objective TEXT,
  learning_objective_hi TEXT,
  explanation TEXT,
  explanation_hi TEXT,
  key_formula TEXT,
  example_title TEXT,
  example_content TEXT,
  example_content_hi TEXT,
  common_mistakes JSONB,
  exam_tips JSONB,
  diagram_refs JSONB,
  diagram_description TEXT,
  diagram_url TEXT,
  practice_question TEXT,
  practice_options JSONB,
  practice_correct_index INTEGER,
  practice_explanation TEXT,
  difficulty INTEGER,
  bloom_level TEXT,
  estimated_minutes INTEGER
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_grade TEXT;
BEGIN
  -- Normalize grade: accept "7", "Grade 7", "grade7" -> "7" (P5 format)
  v_grade := CASE
    WHEN p_grade ~ '^\d+$' THEN p_grade
    WHEN p_grade ILIKE 'grade%' THEN regexp_replace(p_grade, '[^0-9]', '', 'g')
    ELSE p_grade
  END;

  RETURN QUERY
  SELECT
    cc.id AS concept_id,
    cc.concept_number,
    cc.title,
    cc.title_hi,
    cc.learning_objective,
    cc.learning_objective_hi,
    cc.explanation,
    cc.explanation_hi,
    cc.key_formula,
    cc.example_title,
    cc.example_content,
    cc.example_content_hi,
    cc.common_mistakes,
    cc.exam_tips,
    cc.diagram_refs,
    cc.diagram_description,
    cc.diagram_url,
    cc.practice_question,
    cc.practice_options,
    cc.practice_correct_index,
    cc.practice_explanation,
    cc.difficulty,
    cc.bloom_level,
    cc.estimated_minutes
  FROM chapter_concepts cc
  WHERE cc.is_active = true
    AND cc.grade = v_grade
    AND cc.subject = p_subject
    AND cc.chapter_number = p_chapter_number
  ORDER BY cc.concept_number ASC;
END;
$$;


-- ============================================================================
-- 8. Make ncert-books bucket public for serving diagram images
-- ============================================================================
-- Idempotent: UPDATE is a no-op if already public or bucket doesn't exist.

UPDATE storage.buckets SET public = true WHERE id = 'ncert-books';


-- ============================================================================
-- End of migration: 20260403300000_embed_diagrams_in_rag.sql
-- Columns added to rag_content_chunks: 3 (media_url, media_type, media_description)
-- Columns added to chapter_concepts: 1 (diagram_url)
-- Constraints added: 1 (chk_rag_media_type)
-- Indexes added: 1 (idx_rag_chunks_media_type)
-- RPCs updated: get_chapter_rag_content, match_rag_chunks, hybrid_rag_search,
--               get_chapter_concepts
-- Storage: ncert-books bucket set to public
-- ============================================================================
