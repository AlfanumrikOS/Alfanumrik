-- supabase/migrations/20260415000016_match_rag_chunks_ncert_only.sql
-- Recovery-mode migration #4: NCERT-only RAG retrieval wrapper.
--
-- Applied to production via mcp apply_migration on 2026-04-15. This file
-- exists for CI parity so staging/dev environments and any future restore
-- replay the same DDL.
--
-- Audit findings that motivated this:
--   1. The original `match_rag_chunks_v2` migration (file
--      20260403700000_ncert_voyage_retrieval_architecture.sql on disk) was
--      NEVER applied to production. The `match_rag_chunks_v2` function and
--      its companion tables (ncert_diagram_registry, retrieval_traces,
--      study_payload_cache, quiz_rag_links) all do not exist in prod.
--      Production has been running on `match_rag_chunks` (V1) for months.
--   2. V1 accepts a `p_syllabus_version` parameter but the corresponding
--      column does not exist on `rag_content_chunks`; passing non-NULL
--      would error at runtime. Currently safe only because every caller
--      passes NULL.
--   3. `rag_content_chunks` already has snake_case `subject_code` (100%
--      populated, 22 distinct values matching subjects.code) and P5
--      `grade_short` (100% populated). The Title-Case CASE statement in
--      V1 is therefore unnecessary complexity.
--   4. All 15411 chunks have `source = 'ncert_2025'`. The standing rule
--      "NCERT source is only Voyage embeddings, only fetch updated NCERT
--      curriculum" is enforceable today by hardcoding `source = 'ncert_2025'`
--      in the new wrapper.
--
-- Design choice: instead of resurrecting the never-applied V2 migration
-- (which would require data backfill for syllabus_version and bring in
-- four unused tables), this migration creates a single purpose-built
-- wrapper RPC with the canonical filters baked in. Callers in /api/foxy
-- and /lib/ai/retrieval/ncert-retriever.ts have been updated to use it.
--
-- The legacy `match_rag_chunks` (V1) RPC is left in place for backward
-- compatibility with the `supabase/functions/foxy-tutor` Edge Function,
-- which is being deprecated in favor of `/api/foxy`.
--
-- Idempotent — CREATE OR REPLACE FUNCTION.

BEGIN;

CREATE OR REPLACE FUNCTION match_rag_chunks_ncert(
  query_text          TEXT,
  p_subject_code      TEXT,
  p_grade             TEXT,
  match_count         INTEGER DEFAULT 10,
  p_chapter_number    INTEGER DEFAULT NULL,
  p_chapter_title     TEXT    DEFAULT NULL,
  p_concept           TEXT    DEFAULT NULL,
  p_content_type      TEXT    DEFAULT NULL,
  p_min_quality       FLOAT   DEFAULT 0.4,
  query_embedding     vector(1024) DEFAULT NULL
)
RETURNS TABLE(
  id               UUID,
  content          TEXT,
  chapter_title    TEXT,
  topic            TEXT,
  concept          TEXT,
  similarity       FLOAT,
  content_type     TEXT,
  media_url        TEXT,
  media_type       TEXT,
  media_description TEXT,
  question_text    TEXT,
  answer_text      TEXT,
  question_type    TEXT,
  marks_expected   INTEGER,
  bloom_level      TEXT,
  ncert_exercise   TEXT,
  page_number      INTEGER,
  chapter_number   INTEGER,
  source           TEXT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = 'public'
AS $$
DECLARE
  v_grade  TEXT;
  v_query  tsquery;
  v_count  INTEGER;
  v_words  TEXT[];
BEGIN
  -- Normalize grade input to P5 ("6"-"12") to match grade_short column
  v_grade := CASE
    WHEN p_grade ~ '^\d+$' THEN p_grade
    WHEN p_grade ILIKE 'grade%' THEN regexp_replace(p_grade, '[^0-9]', '', 'g')
    ELSE p_grade
  END;

  -- PATH 1: vector similarity (when an embedding is provided)
  IF query_embedding IS NOT NULL THEN
    RETURN QUERY
    SELECT
      c.id, c.chunk_text AS content, c.chapter_title, c.topic, c.concept,
      (1 - (c.embedding <=> query_embedding))::FLOAT AS similarity,
      c.content_type, c.media_url, c.media_type, c.media_description,
      c.question_text, c.answer_text, c.question_type, c.marks_expected,
      c.bloom_level, c.ncert_exercise, c.page_number, c.chapter_number, c.source
    FROM rag_content_chunks c
    WHERE c.is_active = TRUE
      AND c.embedding IS NOT NULL
      AND c.subject_code = p_subject_code
      AND c.grade_short  = v_grade
      AND c.source       = 'ncert_2025'
      AND (c.quality_score IS NULL OR c.quality_score >= p_min_quality)
      AND (p_chapter_number IS NULL OR c.chapter_number = p_chapter_number)
      AND (p_chapter_title  IS NULL OR c.chapter_title ILIKE '%' || p_chapter_title || '%')
      AND (p_concept        IS NULL OR c.concept = p_concept)
      AND (p_content_type   IS NULL OR c.content_type = p_content_type)
    ORDER BY c.embedding <=> query_embedding
    LIMIT match_count;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    IF v_count > 0 THEN RETURN; END IF;
  END IF;

  -- PATH 2: full-text search
  v_query := plainto_tsquery('english', query_text);
  RETURN QUERY
  SELECT
    c.id, c.chunk_text, c.chapter_title, c.topic, c.concept,
    ts_rank(c.search_vector, v_query)::FLOAT,
    c.content_type, c.media_url, c.media_type, c.media_description,
    c.question_text, c.answer_text, c.question_type, c.marks_expected,
    c.bloom_level, c.ncert_exercise, c.page_number, c.chapter_number, c.source
  FROM rag_content_chunks c
  WHERE c.is_active = TRUE
    AND c.subject_code = p_subject_code
    AND c.grade_short  = v_grade
    AND c.source       = 'ncert_2025'
    AND c.search_vector @@ v_query
    AND (c.quality_score IS NULL OR c.quality_score >= p_min_quality)
    AND (p_chapter_number IS NULL OR c.chapter_number = p_chapter_number)
    AND (p_chapter_title  IS NULL OR c.chapter_title ILIKE '%' || p_chapter_title || '%')
    AND (p_concept        IS NULL OR c.concept = p_concept)
    AND (p_content_type   IS NULL OR c.content_type = p_content_type)
  ORDER BY ts_rank(c.search_vector, v_query) DESC
  LIMIT match_count;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count > 0 THEN RETURN; END IF;

  -- PATH 3: LIKE keyword fallback (last resort, scope still pinned)
  v_words := string_to_array(lower(query_text), ' ');
  RETURN QUERY
  SELECT
    c.id, c.chunk_text, c.chapter_title, c.topic, c.concept,
    0.3::FLOAT, c.content_type, c.media_url, c.media_type, c.media_description,
    c.question_text, c.answer_text, c.question_type, c.marks_expected,
    c.bloom_level, c.ncert_exercise, c.page_number, c.chapter_number, c.source
  FROM rag_content_chunks c
  WHERE c.is_active = TRUE
    AND c.subject_code = p_subject_code
    AND c.grade_short  = v_grade
    AND c.source       = 'ncert_2025'
    AND (c.quality_score IS NULL OR c.quality_score >= p_min_quality)
    AND (p_chapter_number IS NULL OR c.chapter_number = p_chapter_number)
    AND (p_chapter_title  IS NULL OR c.chapter_title ILIKE '%' || p_chapter_title || '%')
    AND (
      lower(c.chunk_text) LIKE '%' || COALESCE(v_words[1],'') || '%'
      OR (array_length(v_words, 1) >= 2 AND lower(c.chunk_text) LIKE '%' || v_words[2] || '%')
      OR lower(COALESCE(c.topic,''))   LIKE '%' || COALESCE(v_words[1],'') || '%'
      OR lower(COALESCE(c.concept,'')) LIKE '%' || COALESCE(v_words[1],'') || '%'
    )
  LIMIT match_count;
END;
$$;

REVOKE ALL ON FUNCTION match_rag_chunks_ncert(TEXT, TEXT, TEXT, INTEGER, INTEGER, TEXT, TEXT, TEXT, FLOAT, vector) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION match_rag_chunks_ncert(TEXT, TEXT, TEXT, INTEGER, INTEGER, TEXT, TEXT, TEXT, FLOAT, vector) TO authenticated, service_role;

COMMENT ON FUNCTION match_rag_chunks_ncert IS
  'NCERT-pinned RAG retrieval. source=ncert_2025, snake_case subject_code, P5 grade_short. Replaces match_rag_chunks for all production callers.';

INSERT INTO admin_audit_log (admin_id, action, entity_type, entity_id, details, created_at)
VALUES (NULL, 'rag.ncert_wrapper.created', 'system', NULL,
        jsonb_build_object('created_at', now(), 'note', 'V2-equivalent RPC pinned to source=ncert_2025'), now())
ON CONFLICT DO NOTHING;

COMMIT;
