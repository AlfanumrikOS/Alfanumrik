-- Migration: 20260403000001_fix_rag_vector_search.sql
-- Purpose: Replace text-only match_rag_chunks with hybrid vector+full-text search,
--          add hybrid_rag_search RRF function, and add metadata composite index.

-- ============================================================
-- 0. Ensure pgvector extension is available
-- ============================================================
CREATE EXTENSION IF NOT EXISTS vector;

-- ============================================================
-- 1. Ensure embedding column exists on rag_content_chunks
-- ============================================================
DO $$ BEGIN
  ALTER TABLE rag_content_chunks ADD COLUMN IF NOT EXISTS embedding vector(1024);
EXCEPTION WHEN undefined_table THEN
  RAISE NOTICE 'rag_content_chunks does not exist, skipping';
END $$;

-- ============================================================
-- 2. Drop both overloaded versions of match_rag_chunks
--    (one with p_chapter INTEGER, one with p_chapter TEXT)
-- ============================================================
DROP FUNCTION IF EXISTS match_rag_chunks(TEXT, TEXT, TEXT, INTEGER, INTEGER);
DROP FUNCTION IF EXISTS match_rag_chunks(TEXT, TEXT, TEXT, INTEGER, TEXT);
DROP FUNCTION IF EXISTS match_rag_chunks(TEXT, TEXT, TEXT, INTEGER);

-- ============================================================
-- 3. Create unified match_rag_chunks with hybrid search
-- ============================================================
-- SECURITY DEFINER: required because rag_content_chunks RLS is not configured for
-- direct student access; this function mediates access with subject/grade filtering.
-- Edge Functions call this via service role, but the function signature must remain
-- stable for the existing foxy-tutor and ncert-solver callers. The new query_embedding
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
  similarity FLOAT
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

  -- Normalize grade: "7" → "Grade 7", "grade7" → "Grade 7", "Grade 7" → "Grade 7"
  v_db_grade := CASE
    WHEN p_grade ~ '^\d+$' THEN 'Grade ' || p_grade
    WHEN p_grade ILIKE 'grade%' THEN 'Grade ' || regexp_replace(p_grade, '[^0-9]', '', 'g')
    ELSE p_grade
  END;

  -- ── PATH 1: Vector similarity search (when embedding is provided) ──
  IF query_embedding IS NOT NULL THEN
    RETURN QUERY
    SELECT
      c.id,
      c.chunk_text,
      c.chapter_title,
      c.topic,
      c.concept,
      (1 - (c.embedding <=> query_embedding))::FLOAT AS similarity
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

  -- ── PATH 2: Full-text search (tsvector) ──
  v_query := plainto_tsquery('english', query_text);

  RETURN QUERY
  SELECT
    c.id,
    c.chunk_text,
    c.chapter_title,
    c.topic,
    c.concept,
    ts_rank(c.search_vector, v_query)::FLOAT AS similarity
  FROM rag_content_chunks c
  WHERE c.is_active = true
    AND c.subject = v_db_subject
    AND c.grade = v_db_grade
    AND c.search_vector @@ v_query
    AND (p_chapter IS NULL OR c.chapter_title ILIKE '%' || p_chapter || '%')
  ORDER BY ts_rank(c.search_vector, v_query) DESC
  LIMIT match_count;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- ── PATH 3: LIKE keyword fallback ──
  IF v_count = 0 THEN
    v_words := string_to_array(lower(query_text), ' ');
    RETURN QUERY
    SELECT
      c.id,
      c.chunk_text,
      c.chapter_title,
      c.topic,
      c.concept,
      0.5::FLOAT AS similarity
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

-- ============================================================
-- 4. Create hybrid_rag_search with Reciprocal Rank Fusion (RRF)
-- ============================================================
-- SECURITY DEFINER: same justification as match_rag_chunks — mediates access
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
  similarity FLOAT
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
    combined.rrf_score AS similarity
  FROM combined
  ORDER BY combined.rrf_score DESC
  LIMIT match_count;
END;
$$;

-- ============================================================
-- 5. Composite index for metadata filtering (subject + grade + active)
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_rag_chunks_subject_grade
  ON rag_content_chunks(subject, grade) WHERE is_active = true;

-- ============================================================
-- 6. Ensure IVFFlat index exists for vector search
--    50 lists for ~9000 rows is appropriate (sqrt(9000) ≈ 95, but
--    IVFFlat works well with lists = rows/100 to sqrt(rows))
-- ============================================================
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE indexname = 'idx_rag_chunks_embedding'
  ) THEN
    CREATE INDEX idx_rag_chunks_embedding
      ON rag_content_chunks USING ivfflat (embedding vector_cosine_ops)
      WITH (lists = 50);
  END IF;
EXCEPTION WHEN undefined_column THEN
  RAISE NOTICE 'embedding column not found, skipping IVFFlat index';
END $$;
