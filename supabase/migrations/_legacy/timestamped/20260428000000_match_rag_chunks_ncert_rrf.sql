-- supabase/migrations/20260428000000_match_rag_chunks_ncert_rrf.sql
-- Phase 1.2: replace the sequential vector → FTS → LIKE fall-through inside
-- match_rag_chunks_ncert with Reciprocal Rank Fusion (RRF) so vector and
-- full-text rankings combine on every query instead of "vector wins, FTS
-- ignored." RRF is the standard hybrid-fusion technique used in
-- hybrid_rag_search (migration 20260403000001) — we apply the same pattern
-- to the NCERT-pinned RPC the grounded-answer pipeline depends on.
--
-- Why this matters
--   - Vector-only retrieval misses keyword-anchored questions ("define
--     refraction") because Voyage embeddings reward semantic neighbors,
--     not exact-term hits.
--   - FTS-only retrieval misses paraphrased queries.
--   - RRF (k=60) gives a chunk credit when it ranks high in EITHER list
--     and big credit when it ranks high in BOTH, without requiring a
--     calibrated weight per subject/grade.
--
-- Behavior preservation
--   - Function signature is unchanged — every caller (foxy /api/foxy,
--     grounded-answer Edge, ncert-retriever) keeps working without code
--     changes.
--   - Output column shape is unchanged.
--   - When `query_embedding` is NULL we skip the vector candidate set and
--     fall back to FTS-only (same as the V1 RPC's path 2).
--   - The LIKE keyword fallback (path 3) is preserved as a last-resort
--     branch when both the vector and FTS candidate sets are empty (e.g.
--     a brand-new chapter with not enough text indexed yet).
--   - source = 'ncert_2025' pin and quality_score floor are kept on every
--     branch — defense-in-depth against future ingestion bugs leaking
--     non-NCERT chunks.
--   - Scope filters (subject_code, grade_short, chapter_number,
--     chapter_title, concept, content_type) are applied identically in
--     both candidate sets so the RRF combiner cannot resurrect an
--     out-of-scope chunk.
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
  v_grade        TEXT;
  v_query        tsquery;
  v_count        INTEGER;
  v_words        TEXT[];
  v_k CONSTANT   INTEGER := 60;        -- RRF constant per Cormack et al. 2009.
  v_fetch_count  INTEGER;
BEGIN
  -- Normalize grade input to P5 ("6"-"12") to match grade_short column.
  v_grade := CASE
    WHEN p_grade ~ '^\d+$' THEN p_grade
    WHEN p_grade ILIKE 'grade%' THEN regexp_replace(p_grade, '[^0-9]', '', 'g')
    ELSE p_grade
  END;

  v_query := plainto_tsquery('english', query_text);

  -- Fetch 4× the requested count from each candidate set so RRF has a
  -- meaningful overlap to fuse over. With match_count=30 (the new default
  -- when reranking is on), we pull up to 120 candidates per side; planner
  -- handles this fine on the existing IVFFlat + GIN indexes.
  v_fetch_count := GREATEST(match_count * 4, 60);

  -- ── PATH 1: hybrid (RRF) when an embedding is available ───────────────
  IF query_embedding IS NOT NULL THEN
    RETURN QUERY
    WITH vec AS (
      SELECT
        c.id,
        c.chunk_text,
        c.chapter_title,
        c.topic,
        c.concept,
        c.content_type,
        c.media_url,
        c.media_type,
        c.media_description,
        c.question_text,
        c.answer_text,
        c.question_type,
        c.marks_expected,
        c.bloom_level,
        c.ncert_exercise,
        c.page_number,
        c.chapter_number,
        c.source,
        ROW_NUMBER() OVER (ORDER BY c.embedding <=> query_embedding) AS rank_vec
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
      LIMIT v_fetch_count
    ),
    fts AS (
      SELECT
        c.id,
        c.chunk_text,
        c.chapter_title,
        c.topic,
        c.concept,
        c.content_type,
        c.media_url,
        c.media_type,
        c.media_description,
        c.question_text,
        c.answer_text,
        c.question_type,
        c.marks_expected,
        c.bloom_level,
        c.ncert_exercise,
        c.page_number,
        c.chapter_number,
        c.source,
        ROW_NUMBER() OVER (ORDER BY ts_rank(c.search_vector, v_query) DESC) AS rank_fts
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
      LIMIT v_fetch_count
    ),
    fused AS (
      SELECT
        COALESCE(v.id, f.id)                                 AS id,
        COALESCE(v.chunk_text, f.chunk_text)                 AS content,
        COALESCE(v.chapter_title, f.chapter_title)           AS chapter_title,
        COALESCE(v.topic, f.topic)                           AS topic,
        COALESCE(v.concept, f.concept)                       AS concept,
        COALESCE(v.content_type, f.content_type)             AS content_type,
        COALESCE(v.media_url, f.media_url)                   AS media_url,
        COALESCE(v.media_type, f.media_type)                 AS media_type,
        COALESCE(v.media_description, f.media_description)   AS media_description,
        COALESCE(v.question_text, f.question_text)           AS question_text,
        COALESCE(v.answer_text, f.answer_text)               AS answer_text,
        COALESCE(v.question_type, f.question_type)           AS question_type,
        COALESCE(v.marks_expected, f.marks_expected)         AS marks_expected,
        COALESCE(v.bloom_level, f.bloom_level)               AS bloom_level,
        COALESCE(v.ncert_exercise, f.ncert_exercise)         AS ncert_exercise,
        COALESCE(v.page_number, f.page_number)               AS page_number,
        COALESCE(v.chapter_number, f.chapter_number)         AS chapter_number,
        COALESCE(v.source, f.source)                         AS source,
        (
          COALESCE(1.0 / (v_k + v.rank_vec), 0)
          + COALESCE(1.0 / (v_k + f.rank_fts), 0)
        )::FLOAT                                             AS rrf_score
      FROM vec v
      FULL OUTER JOIN fts f ON v.id = f.id
    )
    SELECT
      fused.id,
      fused.content,
      fused.chapter_title,
      fused.topic,
      fused.concept,
      fused.rrf_score AS similarity,
      fused.content_type,
      fused.media_url,
      fused.media_type,
      fused.media_description,
      fused.question_text,
      fused.answer_text,
      fused.question_type,
      fused.marks_expected,
      fused.bloom_level,
      fused.ncert_exercise,
      fused.page_number,
      fused.chapter_number,
      fused.source
    FROM fused
    ORDER BY fused.rrf_score DESC
    LIMIT match_count;

    GET DIAGNOSTICS v_count = ROW_COUNT;
    IF v_count > 0 THEN RETURN; END IF;
  END IF;

  -- ── PATH 2: FTS-only (no embedding available, or hybrid returned 0) ──
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

  -- ── PATH 3: LIKE keyword fallback (last resort, scope still pinned) ──
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
  'NCERT-pinned RAG retrieval with RRF (k=60) over vector + FTS, plus LIKE fallback. source=ncert_2025, snake_case subject_code, P5 grade_short.';

INSERT INTO admin_audit_log (admin_id, action, entity_type, entity_id, details, created_at)
VALUES (NULL, 'rag.ncert_wrapper.rrf_upgrade', 'system', NULL,
        jsonb_build_object('created_at', now(), 'note', 'match_rag_chunks_ncert now uses RRF (k=60) hybrid fusion'),
        now())
ON CONFLICT DO NOTHING;

COMMIT;
