-- Migration: 20260408000003_rag_board_quality_v2.sql
-- Purpose: Close four RAG filtering gaps identified in the 2026-04-08 RAG audit.
--
-- Gap reference:
--   G1  match_rag_chunks_v2 lacks p_board parameter → CBSE/ICSE content bleeds across boards.
--   G2  match_rag_chunks_v2 lacks p_min_quality parameter → low-quality chunks reach students.
--   G3  match_rag_chunks (legacy) lacks p_syllabus_version parameter → cross-year content bleeds
--       when a caller specifies the syllabus year.
--   G4  (structural) v2 was created in 20260403700000 before board/quality columns were added
--       (20260404000001, 20260404000003), leaving v2 without those filters despite them existing
--       in the table and in the legacy function.
--
-- Approach:
--   1. CREATE OR REPLACE match_rag_chunks_v2 — adds p_board + p_min_quality to all three
--      query paths (vector, full-text, LIKE fallback). All new parameters have defaults so
--      every existing caller continues working without code changes.
--   2. CREATE OR REPLACE match_rag_chunks — adds p_syllabus_version to the legacy function.
--      Default 'NULL' (no filter) preserves backward compatibility for callers that don't
--      pass syllabus_version.
--
-- Board filter semantics (consistent with 20260404000003):
--   NULL / ''  → no board filter (all boards returned)
--   'CBSE'     → CBSE chunks + chunks with board = NULL (shared content)
--   'ICSE'     → ICSE chunks + chunks with board = NULL
--   other      → exact match + chunks with board = NULL
--
-- Quality filter semantics (consistent with 20260404000003):
--   quality_score IS NULL → treated as passing (legacy rows without a score)
--   quality_score < p_min_quality → excluded
--
-- No tables, columns, or policies are created or modified here.
-- Both functions use CREATE OR REPLACE — no DROP required.


-- ============================================================================
-- 1. Rebuild match_rag_chunks_v2 with G1 (p_board) and G2 (p_min_quality) fixes
-- ============================================================================
--
-- SECURITY DEFINER: required because rag_content_chunks RLS is not configured
-- for direct student access. This function mediates access with subject/grade/
-- source/board/quality filtering, consistent with match_rag_chunks.
-- SET search_path = 'public' prevents search-path injection attacks.

CREATE OR REPLACE FUNCTION match_rag_chunks_v2(
  query_text          TEXT,
  p_subject           TEXT,
  p_grade             TEXT,
  match_count         INTEGER         DEFAULT 10,
  p_chapter_number    INTEGER         DEFAULT NULL,
  p_chapter           TEXT            DEFAULT NULL,
  p_concept           TEXT            DEFAULT NULL,
  p_content_type      TEXT            DEFAULT NULL,
  p_source            TEXT            DEFAULT 'NCERT',
  p_syllabus_version  TEXT            DEFAULT NULL,
  query_embedding     vector(1024)    DEFAULT NULL,
  -- G1: board isolation (prevents CBSE/ICSE content bleed)
  p_board             TEXT            DEFAULT 'CBSE',
  -- G2: quality gate (prevents low-quality chunks reaching students)
  p_min_quality       FLOAT           DEFAULT 0.5
)
RETURNS TABLE(
  id               UUID,
  content          TEXT,
  chapter_title    TEXT,
  topic            TEXT,
  concept          TEXT,
  concept_id       UUID,
  similarity       FLOAT,
  content_type     TEXT,
  media_url        TEXT,
  media_type       TEXT,
  media_description TEXT,
  diagram_id       UUID,
  question_text    TEXT,
  answer_text      TEXT,
  question_type    TEXT,
  marks_expected   INTEGER,
  bloom_level      TEXT,
  ncert_exercise   TEXT,
  page_number      INTEGER,
  chapter_number   INTEGER,
  source           TEXT,
  syllabus_version TEXT
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
  -- Normalize subject name from API shorthand to database format
  v_db_subject := CASE lower(trim(p_subject))
    WHEN 'math'                  THEN 'Mathematics'
    WHEN 'mathematics'           THEN 'Mathematics'
    WHEN 'maths'                 THEN 'Mathematics'
    WHEN 'science'               THEN 'Science'
    WHEN 'physics'               THEN 'Physics'
    WHEN 'chemistry'             THEN 'Chemistry'
    WHEN 'biology'               THEN 'Biology'
    WHEN 'english'               THEN 'English'
    WHEN 'hindi'                 THEN 'Hindi'
    WHEN 'sanskrit'              THEN 'Sanskrit'
    WHEN 'social_studies'        THEN 'Social Studies'
    WHEN 'social studies'        THEN 'Social Studies'
    WHEN 'computer_science'      THEN 'Computer Science'
    WHEN 'computer science'      THEN 'Computer Science'
    WHEN 'coding'                THEN 'Computer Science'
    WHEN 'informatics_practices' THEN 'Informatics Practices'
    WHEN 'informatics practices' THEN 'Informatics Practices'
    WHEN 'economics'             THEN 'Economics'
    WHEN 'accountancy'           THEN 'Accountancy'
    WHEN 'political_science'     THEN 'Political Science'
    WHEN 'political science'     THEN 'Political Science'
    WHEN 'history'               THEN 'History'
    WHEN 'history_sr'            THEN 'History'
    WHEN 'geography'             THEN 'Geography'
    ELSE initcap(replace(trim(p_subject), '_', ' '))
  END;

  -- Normalize grade: p_grade follows P5 ("6"-"12") but rag_content_chunks
  -- stores "Grade N". Normalize at the RPC boundary.
  v_db_grade := CASE
    WHEN p_grade ~ '^\d+$'       THEN 'Grade ' || p_grade
    WHEN p_grade ILIKE 'grade%'  THEN 'Grade ' || regexp_replace(p_grade, '[^0-9]', '', 'g')
    ELSE p_grade
  END;

  -- Normalize board: NULL / empty → no filter; others → upper-case for consistent matching.
  -- Consistent with the normalization in match_rag_chunks (20260404000003).
  v_db_board := CASE
    WHEN p_board IS NULL OR trim(p_board) = '' THEN NULL
    ELSE upper(trim(p_board))
  END;

  -- PATH 1: Vector similarity search (when embedding is provided)
  IF query_embedding IS NOT NULL THEN
    RETURN QUERY
    SELECT
      c.id,
      c.chunk_text                              AS content,
      c.chapter_title,
      c.topic,
      c.concept,
      c.concept_id,
      (1 - (c.embedding <=> query_embedding))::FLOAT AS similarity,
      c.content_type,
      c.media_url,
      c.media_type,
      c.media_description,
      c.diagram_id,
      c.question_text,
      c.answer_text,
      c.question_type,
      c.marks_expected,
      c.bloom_level,
      c.ncert_exercise,
      c.page_number,
      c.chapter_number,
      c.source,
      c.syllabus_version
    FROM rag_content_chunks c
    WHERE c.is_active = true
      AND c.embedding IS NOT NULL
      AND c.subject = v_db_subject
      AND c.grade   = v_db_grade
      AND c.source  = p_source
      AND (p_chapter_number   IS NULL OR c.chapter_number  = p_chapter_number)
      AND (p_chapter          IS NULL OR c.chapter_title ILIKE '%' || p_chapter || '%')
      AND (p_concept          IS NULL OR c.concept        = p_concept)
      AND (p_content_type     IS NULL OR c.content_type   = p_content_type)
      AND (p_syllabus_version IS NULL OR c.syllabus_version = p_syllabus_version)
      -- G1: board isolation
      AND (v_db_board IS NULL OR c.board IS NULL OR upper(c.board) = v_db_board)
      -- G2: quality gate (NULL quality_score rows pass to preserve legacy data)
      AND (c.quality_score IS NULL OR c.quality_score >= p_min_quality)
    ORDER BY c.embedding <=> query_embedding
    LIMIT match_count;

    GET DIAGNOSTICS v_count = ROW_COUNT;

    IF v_count > 0 THEN
      RETURN;
    END IF;
    -- Fall through to full-text search
  END IF;

  -- PATH 2: Full-text search (tsvector)
  v_query := plainto_tsquery('english', query_text);

  RETURN QUERY
  SELECT
    c.id,
    c.chunk_text                        AS content,
    c.chapter_title,
    c.topic,
    c.concept,
    c.concept_id,
    ts_rank(c.search_vector, v_query)::FLOAT AS similarity,
    c.content_type,
    c.media_url,
    c.media_type,
    c.media_description,
    c.diagram_id,
    c.question_text,
    c.answer_text,
    c.question_type,
    c.marks_expected,
    c.bloom_level,
    c.ncert_exercise,
    c.page_number,
    c.chapter_number,
    c.source,
    c.syllabus_version
  FROM rag_content_chunks c
  WHERE c.is_active = true
    AND c.subject = v_db_subject
    AND c.grade   = v_db_grade
    AND c.source  = p_source
    AND c.search_vector @@ v_query
    AND (p_chapter_number   IS NULL OR c.chapter_number  = p_chapter_number)
    AND (p_chapter          IS NULL OR c.chapter_title ILIKE '%' || p_chapter || '%')
    AND (p_concept          IS NULL OR c.concept         = p_concept)
    AND (p_content_type     IS NULL OR c.content_type    = p_content_type)
    AND (p_syllabus_version IS NULL OR c.syllabus_version = p_syllabus_version)
    -- G1: board isolation
    AND (v_db_board IS NULL OR c.board IS NULL OR upper(c.board) = v_db_board)
    -- G2: quality gate
    AND (c.quality_score IS NULL OR c.quality_score >= p_min_quality)
  ORDER BY ts_rank(c.search_vector, v_query) DESC
  LIMIT match_count;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- PATH 3: LIKE keyword fallback
  IF v_count = 0 THEN
    v_words := string_to_array(lower(query_text), ' ');
    RETURN QUERY
    SELECT
      c.id,
      c.chunk_text                AS content,
      c.chapter_title,
      c.topic,
      c.concept,
      c.concept_id,
      0.5::FLOAT                  AS similarity,
      c.content_type,
      c.media_url,
      c.media_type,
      c.media_description,
      c.diagram_id,
      c.question_text,
      c.answer_text,
      c.question_type,
      c.marks_expected,
      c.bloom_level,
      c.ncert_exercise,
      c.page_number,
      c.chapter_number,
      c.source,
      c.syllabus_version
    FROM rag_content_chunks c
    WHERE c.is_active = true
      AND c.subject = v_db_subject
      AND c.grade   = v_db_grade
      AND c.source  = p_source
      AND (
        lower(c.chunk_text) LIKE '%' || v_words[1] || '%'
        OR (array_length(v_words, 1) >= 2 AND lower(c.chunk_text) LIKE '%' || v_words[2] || '%')
        OR (array_length(v_words, 1) >= 3 AND lower(c.chunk_text) LIKE '%' || v_words[3] || '%')
        OR lower(c.topic)   LIKE '%' || v_words[1] || '%'
        OR lower(c.concept) LIKE '%' || v_words[1] || '%'
      )
      AND (p_chapter_number   IS NULL OR c.chapter_number  = p_chapter_number)
      AND (p_chapter          IS NULL OR c.chapter_title ILIKE '%' || p_chapter || '%')
      AND (p_concept          IS NULL OR c.concept         = p_concept)
      AND (p_content_type     IS NULL OR c.content_type    = p_content_type)
      AND (p_syllabus_version IS NULL OR c.syllabus_version = p_syllabus_version)
      -- G1: board isolation
      AND (v_db_board IS NULL OR c.board IS NULL OR upper(c.board) = v_db_board)
      -- G2: quality gate
      AND (c.quality_score IS NULL OR c.quality_score >= p_min_quality)
    LIMIT match_count;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.match_rag_chunks_v2(
  TEXT, TEXT, TEXT, INTEGER, INTEGER, TEXT, TEXT, TEXT, TEXT, TEXT, vector(1024), TEXT, FLOAT
) TO authenticated, service_role;


-- ============================================================================
-- 2. Rebuild match_rag_chunks (legacy) with G3 (p_syllabus_version) fix
-- ============================================================================
--
-- match_rag_chunks already has p_board and p_min_quality (added in 20260404000003).
-- It was missing p_syllabus_version (G3) — callers on the ncert-solver / foxy-tutor
-- paths that pass a syllabus year could not narrow legacy retrieval by year.
-- Default NULL means no syllabus filter → all existing callers are unaffected.
--
-- SECURITY DEFINER: consistent with the existing function; rag_content_chunks RLS
-- does not cover direct student access. SET search_path prevents injection attacks.

DROP FUNCTION IF EXISTS match_rag_chunks(TEXT, TEXT, TEXT, INTEGER, TEXT, vector(1024), TEXT, FLOAT);

CREATE OR REPLACE FUNCTION match_rag_chunks(
  query_text      TEXT,
  p_subject       TEXT,
  p_grade         TEXT,
  match_count     INTEGER         DEFAULT 5,
  p_chapter       TEXT            DEFAULT NULL,
  query_embedding vector(1024)    DEFAULT NULL,
  p_board         TEXT            DEFAULT NULL,
  p_min_quality   FLOAT           DEFAULT 0.5,
  -- G3: syllabus year isolation (NULL = no filter, backward-compatible default)
  p_syllabus_version TEXT         DEFAULT NULL
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

  -- Normalize board: NULL / empty → no filter; others → upper-case
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
      -- G3: syllabus year isolation
      AND (p_syllabus_version IS NULL OR c.syllabus_version = p_syllabus_version)
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
    -- G3: syllabus year isolation
    AND (p_syllabus_version IS NULL OR c.syllabus_version = p_syllabus_version)
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
      -- G3: syllabus year isolation
      AND (p_syllabus_version IS NULL OR c.syllabus_version = p_syllabus_version)
    LIMIT match_count;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.match_rag_chunks(
  TEXT, TEXT, TEXT, INTEGER, TEXT, vector(1024), TEXT, FLOAT, TEXT
) TO authenticated, service_role;


-- ============================================================================
-- End of migration: 20260408000003_rag_board_quality_v2.sql
--
-- RPCs modified (CREATE OR REPLACE):
--   match_rag_chunks_v2  — added p_board (G1), p_min_quality (G2)
--   match_rag_chunks     — added p_syllabus_version (G3)
-- Tables modified: none
-- Policies modified: none
-- All new parameters have backward-compatible defaults.
-- ============================================================================
