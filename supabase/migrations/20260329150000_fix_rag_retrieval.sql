-- ============================================================
-- FIX RAG RETRIEVAL: Create missing match_rag_chunks RPC
--
-- The foxy-tutor edge function has been calling this RPC since
-- launch, but it never existed. RAG retrieval was silently
-- returning null — Foxy answered every question with ZERO
-- NCERT curriculum context.
-- ============================================================

-- 1. Add text search column for keyword-based retrieval
ALTER TABLE rag_content_chunks ADD COLUMN IF NOT EXISTS search_vector tsvector;

UPDATE rag_content_chunks SET search_vector = to_tsvector('english',
  COALESCE(chunk_text, '') || ' ' || COALESCE(topic, '') || ' ' ||
  COALESCE(concept, '') || ' ' || COALESCE(chapter_title, '')
) WHERE search_vector IS NULL;

CREATE INDEX IF NOT EXISTS idx_rag_chunks_search ON rag_content_chunks USING gin(search_vector);

-- 2. Create the match_rag_chunks RPC
CREATE OR REPLACE FUNCTION match_rag_chunks(
  query_text TEXT,
  p_subject TEXT,
  p_grade TEXT,
  match_count INTEGER DEFAULT 3
)
RETURNS TABLE(
  id UUID,
  content TEXT,
  chapter_title TEXT,
  topic TEXT,
  concept TEXT,
  similarity FLOAT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE
  v_query tsquery;
  v_db_subject TEXT;
  v_db_grade TEXT;
BEGIN
  -- Map client subject codes to DB subject names
  v_db_subject := CASE p_subject
    WHEN 'math' THEN 'Mathematics'
    WHEN 'science' THEN 'Science'
    WHEN 'physics' THEN 'Physics'
    WHEN 'chemistry' THEN 'Chemistry'
    WHEN 'biology' THEN 'Biology'
    WHEN 'english' THEN 'English'
    WHEN 'hindi' THEN 'Hindi'
    WHEN 'social_studies' THEN 'Social Studies'
    WHEN 'computer_science' THEN 'Computer Science'
    WHEN 'coding' THEN 'Computer Science'
    WHEN 'economics' THEN 'Economics'
    WHEN 'accountancy' THEN 'Accountancy'
    WHEN 'political_science' THEN 'Political Science'
    WHEN 'history_sr' THEN 'History'
    WHEN 'geography' THEN 'Geography'
    ELSE initcap(replace(p_subject, '_', ' '))
  END;

  -- Normalize grade format
  v_db_grade := CASE
    WHEN p_grade ~ '^\d+$' THEN 'Grade ' || p_grade
    WHEN p_grade ILIKE 'grade%' THEN 'Grade ' || regexp_replace(p_grade, '[^0-9]', '', 'g')
    ELSE p_grade
  END;

  v_query := plainto_tsquery('english', query_text);

  RETURN QUERY
  SELECT
    c.id,
    c.chunk_text as content,
    c.chapter_title,
    c.topic,
    c.concept,
    ts_rank(c.search_vector, v_query)::FLOAT as similarity
  FROM rag_content_chunks c
  WHERE c.is_active = true
    AND c.subject = v_db_subject
    AND c.grade = v_db_grade
    AND c.search_vector @@ v_query
  ORDER BY ts_rank(c.search_vector, v_query) DESC
  LIMIT match_count;
END;
$$;
