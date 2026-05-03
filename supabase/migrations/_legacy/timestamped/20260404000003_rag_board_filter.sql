-- Migration: 20260404000003_rag_board_filter.sql
--
-- Adds board column to rag_content_chunks and updates match_rag_chunks
-- to filter by board (CBSE / ICSE / etc.) and quality_score.
--
-- Problems fixed:
--   #7  — No board isolation in RAG retrieval: CBSE and ICSE content is
--          returned interchangeably; ICSE students get CBSE-specific content.
--   #5  — Quality gate: chunks with quality_score < 0.5 are excluded from
--          retrieval so low-quality/malformed content doesn't reach students.
--
-- Board filter logic (p_board):
--   NULL or ''       → no board filter (returns content for all boards)
--   'CBSE'           → CBSE-specific chunks + chunks with no board set
--   'ICSE'           → ICSE-specific chunks + chunks with no board set
--   (other values)   → exact match + chunks with no board set
--
-- New parameters added to match_rag_chunks (all optional, backwards-compatible):
--   p_board        TEXT    DEFAULT NULL   — board filter (NULL = no filter)
--   p_min_quality  FLOAT   DEFAULT 0.5   — minimum quality_score threshold

-- ── 1. Add board column (safe: IF NOT EXISTS) ────────────────────────────────
DO $$ BEGIN
  ALTER TABLE rag_content_chunks
    ADD COLUMN IF NOT EXISTS board TEXT DEFAULT 'CBSE';
EXCEPTION WHEN undefined_table THEN
  RAISE NOTICE 'rag_content_chunks does not exist — skipping board column';
END $$;

-- Index for board + subject + grade composite filter
CREATE INDEX IF NOT EXISTS idx_rag_chunks_board_subject_grade
  ON rag_content_chunks(board, subject, grade)
  WHERE is_active = true;

-- ── 2. Drop old overloaded signatures ────────────────────────────────────────
DROP FUNCTION IF EXISTS match_rag_chunks(TEXT, TEXT, TEXT, INTEGER);
DROP FUNCTION IF EXISTS match_rag_chunks(TEXT, TEXT, TEXT, INTEGER, INTEGER);
DROP FUNCTION IF EXISTS match_rag_chunks(TEXT, TEXT, TEXT, INTEGER, TEXT);
DROP FUNCTION IF EXISTS match_rag_chunks(TEXT, TEXT, TEXT, INTEGER, TEXT, vector);

-- ── 3. Updated match_rag_chunks ───────────────────────────────────────────────
-- Adds p_board and p_min_quality parameters.
-- All new parameters have safe defaults so existing callers are unaffected.
CREATE OR REPLACE FUNCTION match_rag_chunks(
  query_text    TEXT,
  p_subject     TEXT,
  p_grade       TEXT,
  match_count   INTEGER          DEFAULT 5,
  p_chapter     TEXT             DEFAULT NULL,
  query_embedding vector(1024)   DEFAULT NULL,
  p_board       TEXT             DEFAULT NULL,
  p_min_quality FLOAT            DEFAULT 0.5
)
RETURNS TABLE(
  id            UUID,
  content       TEXT,
  chapter_title TEXT,
  topic         TEXT,
  concept       TEXT,
  similarity    FLOAT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_db_subject TEXT;
  v_db_grade   TEXT;
  v_db_board   TEXT;
  v_query      tsquery;
  v_count      INTEGER;
  v_words      TEXT[];
BEGIN
  -- Normalize subject
  v_db_subject := CASE lower(trim(p_subject))
    WHEN 'math'                   THEN 'Mathematics'
    WHEN 'mathematics'            THEN 'Mathematics'
    WHEN 'maths'                  THEN 'Mathematics'
    WHEN 'science'                THEN 'Science'
    WHEN 'physics'                THEN 'Physics'
    WHEN 'chemistry'              THEN 'Chemistry'
    WHEN 'biology'                THEN 'Biology'
    WHEN 'english'                THEN 'English'
    WHEN 'hindi'                  THEN 'Hindi'
    WHEN 'sanskrit'               THEN 'Sanskrit'
    WHEN 'social_studies'         THEN 'Social Studies'
    WHEN 'social studies'         THEN 'Social Studies'
    WHEN 'computer_science'       THEN 'Computer Science'
    WHEN 'computer science'       THEN 'Computer Science'
    WHEN 'coding'                 THEN 'Computer Science'
    WHEN 'informatics_practices'  THEN 'Informatics Practices'
    WHEN 'informatics practices'  THEN 'Informatics Practices'
    WHEN 'economics'              THEN 'Economics'
    WHEN 'accountancy'            THEN 'Accountancy'
    WHEN 'political_science'      THEN 'Political Science'
    WHEN 'political science'      THEN 'Political Science'
    WHEN 'history'                THEN 'History'
    WHEN 'history_sr'             THEN 'History'
    WHEN 'geography'              THEN 'Geography'
    ELSE initcap(replace(trim(p_subject), '_', ' '))
  END;

  -- Normalize grade: "7" → "Grade 7", "grade7" → "Grade 7", "Grade 7" → "Grade 7"
  v_db_grade := CASE
    WHEN p_grade ~ '^\d+$'       THEN 'Grade ' || p_grade
    WHEN p_grade ILIKE 'grade%'  THEN 'Grade ' || regexp_replace(p_grade, '[^0-9]', '', 'g')
    ELSE p_grade
  END;

  -- Normalize board: NULL / empty → no filter; others → upper-case for consistent matching
  v_db_board := CASE
    WHEN p_board IS NULL OR trim(p_board) = '' THEN NULL
    ELSE upper(trim(p_board))
  END;

  -- ── PATH 1: Vector similarity search (when embedding provided) ──────────────
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
      AND c.grade   = v_db_grade
      AND (v_db_board IS NULL OR c.board IS NULL OR upper(c.board) = v_db_board)
      AND (c.quality_score IS NULL OR c.quality_score >= p_min_quality)
      AND (p_chapter IS NULL OR c.chapter_title ILIKE '%' || p_chapter || '%')
    ORDER BY c.embedding <=> query_embedding
    LIMIT match_count;

    GET DIAGNOSTICS v_count = ROW_COUNT;
    IF v_count > 0 THEN RETURN; END IF;
    -- Fall through to full-text if vector search returned nothing
  END IF;

  -- ── PATH 2: Full-text search (tsvector) ──────────────────────────────────────
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
    AND c.grade   = v_db_grade
    AND c.search_vector @@ v_query
    AND (v_db_board IS NULL OR c.board IS NULL OR upper(c.board) = v_db_board)
    AND (c.quality_score IS NULL OR c.quality_score >= p_min_quality)
    AND (p_chapter IS NULL OR c.chapter_title ILIKE '%' || p_chapter || '%')
  ORDER BY ts_rank(c.search_vector, v_query) DESC
  LIMIT match_count;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- ── PATH 3: LIKE keyword fallback (when full-text finds nothing) ──────────────
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
      AND c.grade   = v_db_grade
      AND (v_db_board IS NULL OR c.board IS NULL OR upper(c.board) = v_db_board)
      AND (c.quality_score IS NULL OR c.quality_score >= p_min_quality)
      AND (
            lower(c.chunk_text) LIKE '%' || v_words[1] || '%'
        OR (array_length(v_words, 1) >= 2 AND lower(c.chunk_text) LIKE '%' || v_words[2] || '%')
        OR (array_length(v_words, 1) >= 3 AND lower(c.chunk_text) LIKE '%' || v_words[3] || '%')
        OR  lower(c.topic)      LIKE '%' || v_words[1] || '%'
        OR  lower(c.concept)    LIKE '%' || v_words[1] || '%'
      )
      AND (p_chapter IS NULL OR c.chapter_title ILIKE '%' || p_chapter || '%')
    LIMIT match_count;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.match_rag_chunks(TEXT, TEXT, TEXT, INTEGER, TEXT, vector, TEXT, FLOAT)
  TO authenticated, service_role;
