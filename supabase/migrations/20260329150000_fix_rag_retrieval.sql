-- ============================================================
-- FIX RAG RETRIEVAL: Create match_rag_chunks RPC + content ingestion
-- ============================================================

-- 1. Add text search column
ALTER TABLE rag_content_chunks ADD COLUMN IF NOT EXISTS search_vector tsvector;

UPDATE rag_content_chunks SET search_vector = to_tsvector('english',
  COALESCE(chunk_text, '') || ' ' || COALESCE(topic, '') || ' ' ||
  COALESCE(concept, '') || ' ' || COALESCE(chapter_title, '')
) WHERE search_vector IS NULL;

CREATE INDEX IF NOT EXISTS idx_rag_chunks_search ON rag_content_chunks USING gin(search_vector);

-- 2. Create match_rag_chunks with ILIKE fallback
CREATE OR REPLACE FUNCTION match_rag_chunks(
  query_text TEXT,
  p_subject TEXT,
  p_grade TEXT,
  match_count INTEGER DEFAULT 3
)
RETURNS TABLE(
  id UUID, content TEXT, chapter_title TEXT, topic TEXT, concept TEXT, similarity FLOAT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE
  v_db_subject TEXT;
  v_db_grade TEXT;
  v_query tsquery;
  v_count INTEGER;
  v_words TEXT[];
BEGIN
  v_db_subject := CASE p_subject
    WHEN 'math' THEN 'Mathematics' WHEN 'science' THEN 'Science'
    WHEN 'physics' THEN 'Physics' WHEN 'chemistry' THEN 'Chemistry'
    WHEN 'biology' THEN 'Biology' WHEN 'english' THEN 'English'
    WHEN 'hindi' THEN 'Hindi' WHEN 'social_studies' THEN 'Social Studies'
    WHEN 'computer_science' THEN 'Computer Science'
    WHEN 'coding' THEN 'Computer Science'
    WHEN 'economics' THEN 'Economics' WHEN 'accountancy' THEN 'Accountancy'
    WHEN 'political_science' THEN 'Political Science'
    WHEN 'history_sr' THEN 'History' WHEN 'geography' THEN 'Geography'
    ELSE initcap(replace(p_subject, '_', ' '))
  END;
  v_db_grade := CASE
    WHEN p_grade ~ '^\d+$' THEN 'Grade ' || p_grade
    WHEN p_grade ILIKE 'grade%' THEN 'Grade ' || regexp_replace(p_grade, '[^0-9]', '', 'g')
    ELSE p_grade
  END;
  v_query := plainto_tsquery('english', query_text);

  RETURN QUERY
  SELECT c.id, c.chunk_text, c.chapter_title, c.topic, c.concept,
    ts_rank(c.search_vector, v_query)::FLOAT
  FROM rag_content_chunks c
  WHERE c.is_active = true AND c.subject = v_db_subject AND c.grade = v_db_grade
    AND c.search_vector @@ v_query
  ORDER BY ts_rank(c.search_vector, v_query) DESC
  LIMIT match_count;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  IF v_count = 0 THEN
    v_words := string_to_array(lower(query_text), ' ');
    RETURN QUERY
    SELECT c.id, c.chunk_text, c.chapter_title, c.topic, c.concept, 0.5::FLOAT
    FROM rag_content_chunks c
    WHERE c.is_active = true AND c.subject = v_db_subject AND c.grade = v_db_grade
      AND (
        lower(c.chunk_text) LIKE '%' || v_words[1] || '%'
        OR lower(c.chunk_text) LIKE '%' || v_words[2] || '%'
        OR lower(c.chunk_text) LIKE '%' || v_words[3] || '%'
        OR lower(c.topic) LIKE '%' || v_words[1] || '%'
        OR lower(c.concept) LIKE '%' || v_words[1] || '%'
      )
    LIMIT match_count;
  END IF;
END;
$$;
