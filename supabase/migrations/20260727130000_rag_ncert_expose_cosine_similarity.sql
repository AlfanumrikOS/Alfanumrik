-- Migration: 20260727130000_rag_ncert_expose_cosine_similarity.sql
-- Purpose: Shadow confidence instrumentation (Step 1 of 3). Expose the ABSOLUTE
--          cosine similarity that match_rag_chunks_ncert already computes for its
--          relevance floor, so the downstream confidence path can stop using the
--          RRF ordering statistic (`similarity`) as a proxy for relevance.
--
-- ZERO BEHAVIOUR CHANGE. This migration adds exactly one OUTPUT column
-- (`cosine_similarity`, appended LAST so positional consumers are unaffected).
-- It does NOT change:
--   * the input signature (so NO new overload is created — see HAZARD below),
--   * the `similarity` column (still RRF in tier 1, ts_rank in tier 2, 0.3 in tier 3),
--   * any predicate, ORDER BY, LIMIT, tier ordering, or short-circuit,
--   * the NULL-safe quality predicate (c.quality_score IS NULL OR c.quality_score >= p_quality_score_gate),
--   * the cosine floor `1 - (c.embedding <=> query_embedding) >= p_min_similarity`,
--   * any grant posture (re-granted identically below),
--   * any feature flag or threshold.
--
-- ───────────────────────────────────────────────────────────────────────────────
-- HAZARD / DESIGN NOTE (read before touching this file)
-- ───────────────────────────────────────────────────────────────────────────────
-- Production carries TWO overloads of public.match_rag_chunks_ncert:
--   (1) 10-arg BASELINE  : ..., p_min_quality double precision, query_embedding vector
--                          Created by 00000000000000_baseline_from_prod.sql:5773.
--                          Floor-less and now unused, but it MUST NOT be dropped:
--                          20260516040000_revoke_execute_internal_functions.sql:69 and
--                          20260516050000_revoke_execute_from_public_corrective.sql:91
--                          REVOKE EXECUTE on it by exact argument list, and REVOKE has
--                          no IF EXISTS — dropping it breaks every fresh-DB replay.
--   (2) 11-arg LIVE      : ..., p_quality_score_gate double precision DEFAULT 0.4,
--                               p_min_similarity      double precision DEFAULT 0.5,
--                               query_embedding       public.vector
--                          Created by 20260707010000_rca_final_fixes.sql:749,
--                          granted by 20260707020000_rca18_db_function_execute_grants.sql:64.
--                          This is the one retrieve.ts binds to (it sends both
--                          p_quality_score_gate AND p_min_similarity).
-- A THIRD overload would re-open the PostgREST mis-binding defect fixed in PR #1394.
--
-- Postgres cannot change a function's return type with CREATE OR REPLACE, so adding
-- a RETURNS TABLE column requires DROP + CREATE. We DROP and re-CREATE the *exact
-- same 11-arg input signature*, which means the overload count stays at 2 — it is a
-- replacement, not an addition. The DROP + CREATE are inside one transaction, so
-- there is never a window in which callers observe a missing function; concurrent
-- callers block on the pg_proc lock and then see the new definition.
-- The post-flight assertion at the bottom aborts the transaction if the overload
-- count is ever anything other than "<= 2, exactly one of which carries
-- p_min_similarity".
--
-- SECURITY DEFINER justification (required by architect migration rule 4):
-- rag_content_chunks is RLS-protected and holds no student PII — it is licensed
-- NCERT corpus text. Retrieval must succeed for every authenticated learner without
-- granting them direct SELECT on the corpus table, so the RPC runs as definer with
-- `SET search_path TO 'public'` to pin schema resolution. The function performs no
-- writes and takes no student identifier, so it cannot be used to escalate across
-- the P8/P13 student-data boundary. Posture is UNCHANGED from 20260707010000.

BEGIN;

-- ── Pre-flight: fresh-DB guard + observability ────────────────────────────────
DO $pre$
DECLARE
  v_total INTEGER;
BEGIN
  -- to_regclass fresh-DB guard. plpgsql bodies are late-bound so the function is
  -- still creatable without the table, but a missing corpus table means this
  -- migration is running against an unexpected chain state — surface it loudly.
  IF to_regclass('public.rag_content_chunks') IS NULL THEN
    RAISE WARNING
      '20260727130000: public.rag_content_chunks not found; match_rag_chunks_ncert will be created but is not executable until the corpus table exists.';
  END IF;

  SELECT count(*) INTO v_total
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'match_rag_chunks_ncert';

  RAISE NOTICE '20260727130000: match_rag_chunks_ncert overload count BEFORE = %', v_total;
END
$pre$;

-- ── Replace the 11-arg overload in place (same input signature) ───────────────
-- IF EXISTS keeps this idempotent/re-runnable. The argument list is fully
-- qualified and unambiguous, so this can only ever match the 11-arg overload —
-- the 10-arg baseline overload is untouched.
DROP FUNCTION IF EXISTS public.match_rag_chunks_ncert(
  text,
  text,
  text,
  integer,
  integer,
  text,
  text,
  text,
  double precision,
  double precision,
  public.vector
);

CREATE OR REPLACE FUNCTION "public"."match_rag_chunks_ncert"("query_text" "text", "p_subject_code" "text", "p_grade" "text", "match_count" integer DEFAULT 10, "p_chapter_number" integer DEFAULT NULL::integer, "p_chapter_title" "text" DEFAULT NULL::"text", "p_concept" "text" DEFAULT NULL::"text", "p_content_type" "text" DEFAULT NULL::"text", "p_quality_score_gate" double precision DEFAULT 0.4, "p_min_similarity" double precision DEFAULT 0.5, "query_embedding" "public"."vector" DEFAULT NULL::"public"."vector") RETURNS TABLE("id" "uuid", "content" "text", "chapter_title" "text", "topic" "text", "concept" "text", "similarity" double precision, "content_type" "text", "media_url" "text", "media_type" "text", "media_description" "text", "question_text" "text", "answer_text" "text", "question_type" "text", "marks_expected" integer, "bloom_level" "text", "ncert_exercise" "text", "page_number" integer, "chapter_number" integer, "source" "text", "cosine_similarity" double precision)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $fn$
DECLARE
  v_grade        TEXT;
  v_query        tsquery;
  v_count        INTEGER;
  v_words        TEXT[];
  v_k CONSTANT   INTEGER := 60;
  v_fetch_count  INTEGER;
BEGIN
  v_grade := CASE
    WHEN p_grade ~ '^\d+$' THEN p_grade
    WHEN p_grade ILIKE 'grade%' THEN regexp_replace(p_grade, '[^0-9]', '', 'g')
    ELSE p_grade
  END;

  v_query := plainto_tsquery('english', query_text);
  v_fetch_count := GREATEST(match_count * 4, 60);

  IF query_embedding IS NOT NULL THEN
    RETURN QUERY
    WITH vec AS (
      SELECT
        c.id, c.chunk_text, c.chapter_title, c.topic, c.concept,
        c.content_type, c.media_url, c.media_type, c.media_description,
        c.question_text, c.answer_text, c.question_type, c.marks_expected,
        c.bloom_level, c.ncert_exercise, c.page_number, c.chapter_number, c.source,
        -- SHADOW INSTRUMENTATION: the absolute cosine the floor predicate below
        -- already computes. Output only — it does not filter or order anything.
        (1 - (c.embedding <=> query_embedding))::FLOAT AS cos_sim,
        ROW_NUMBER() OVER (ORDER BY c.embedding <=> query_embedding) AS rank_vec
      FROM rag_content_chunks c
      WHERE c.is_active = TRUE
        AND c.embedding IS NOT NULL
        AND c.subject_code = p_subject_code
        AND c.grade_short  = v_grade
        AND c.source       = 'ncert_2025'
        AND (c.quality_score IS NULL OR c.quality_score >= p_quality_score_gate)
        AND (p_chapter_number IS NULL OR c.chapter_number = p_chapter_number)
        AND (p_chapter_title  IS NULL OR c.chapter_title ILIKE '%' || p_chapter_title || '%')
        AND (p_concept        IS NULL OR c.concept = p_concept)
        AND (p_content_type   IS NULL OR c.content_type = p_content_type)
        AND 1 - (c.embedding <=> query_embedding) >= p_min_similarity
      ORDER BY c.embedding <=> query_embedding
      LIMIT v_fetch_count
    ),
    fts AS (
      SELECT
        c.id, c.chunk_text, c.chapter_title, c.topic, c.concept,
        c.content_type, c.media_url, c.media_type, c.media_description,
        c.question_text, c.answer_text, c.question_type, c.marks_expected,
        c.bloom_level, c.ncert_exercise, c.page_number, c.chapter_number, c.source,
        -- FTS-recovered rows are NOT subject to the cosine floor, so their cosine
        -- may legitimately be below p_min_similarity (or NULL when unembedded).
        -- Reported honestly; never used to filter.
        CASE
          WHEN c.embedding IS NOT NULL
          THEN (1 - (c.embedding <=> query_embedding))::FLOAT
        END AS cos_sim,
        ROW_NUMBER() OVER (ORDER BY ts_rank(c.search_vector, v_query) DESC) AS rank_fts
      FROM rag_content_chunks c
      WHERE c.is_active = TRUE
        AND c.subject_code = p_subject_code
        AND c.grade_short  = v_grade
        AND c.source       = 'ncert_2025'
        AND c.search_vector @@ v_query
        AND (c.quality_score IS NULL OR c.quality_score >= p_quality_score_gate)
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
        COALESCE(v.cos_sim, f.cos_sim)                       AS cosine_similarity,
        (
          COALESCE(1.0 / (v_k + v.rank_vec), 0)
          + COALESCE(1.0 / (v_k + f.rank_fts), 0)
        )::FLOAT                                             AS rrf_score
      FROM vec v
      FULL OUTER JOIN fts f ON v.id = f.id
    )
    SELECT
      fused.id, fused.content, fused.chapter_title, fused.topic, fused.concept,
      fused.rrf_score AS similarity,
      fused.content_type, fused.media_url, fused.media_type, fused.media_description,
      fused.question_text, fused.answer_text, fused.question_type, fused.marks_expected,
      fused.bloom_level, fused.ncert_exercise, fused.page_number, fused.chapter_number, fused.source,
      fused.cosine_similarity
    FROM fused
    ORDER BY fused.rrf_score DESC
    LIMIT match_count;

    GET DIAGNOSTICS v_count = ROW_COUNT;
    IF v_count > 0 THEN RETURN; END IF;
  END IF;

  -- Tier 2 (FTS-only). Reached when query_embedding IS NULL, or when tier 1
  -- produced zero rows. cosine_similarity is NULL when there is no query
  -- embedding (the normal case here) or when the chunk is unembedded.
  RETURN QUERY
  SELECT
    c.id, c.chunk_text, c.chapter_title, c.topic, c.concept,
    ts_rank(c.search_vector, v_query)::FLOAT,
    c.content_type, c.media_url, c.media_type, c.media_description,
    c.question_text, c.answer_text, c.question_type, c.marks_expected,
    c.bloom_level, c.ncert_exercise, c.page_number, c.chapter_number, c.source,
    CASE
      WHEN query_embedding IS NOT NULL AND c.embedding IS NOT NULL
      THEN (1 - (c.embedding <=> query_embedding))::FLOAT
    END
  FROM rag_content_chunks c
  WHERE c.is_active = TRUE
    AND c.subject_code = p_subject_code
    AND c.grade_short  = v_grade
    AND c.source       = 'ncert_2025'
    AND c.search_vector @@ v_query
    AND (c.quality_score IS NULL OR c.quality_score >= p_quality_score_gate)
    AND (p_chapter_number IS NULL OR c.chapter_number = p_chapter_number)
    AND (p_chapter_title  IS NULL OR c.chapter_title ILIKE '%' || p_chapter_title || '%')
    AND (p_concept        IS NULL OR c.concept = p_concept)
    AND (p_content_type   IS NULL OR c.content_type = p_content_type)
  ORDER BY ts_rank(c.search_vector, v_query) DESC
  LIMIT match_count;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count > 0 THEN RETURN; END IF;

  -- Tier 3 (LIKE fallback). `similarity` remains the fixed 0.3 sentinel; the
  -- real cosine (when computable) now rides alongside it instead of being lost.
  v_words := string_to_array(lower(query_text), ' ');
  RETURN QUERY
  SELECT
    c.id, c.chunk_text, c.chapter_title, c.topic, c.concept,
    0.3::FLOAT, c.content_type, c.media_url, c.media_type, c.media_description,
    c.question_text, c.answer_text, c.question_type, c.marks_expected,
    c.bloom_level, c.ncert_exercise, c.page_number, c.chapter_number, c.source,
    CASE
      WHEN query_embedding IS NOT NULL AND c.embedding IS NOT NULL
      THEN (1 - (c.embedding <=> query_embedding))::FLOAT
    END
  FROM rag_content_chunks c
  WHERE c.is_active = TRUE
    AND c.subject_code = p_subject_code
    AND c.grade_short  = v_grade
    AND c.source       = 'ncert_2025'
    AND (c.quality_score IS NULL OR c.quality_score >= p_quality_score_gate)
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
$fn$;

COMMENT ON FUNCTION "public"."match_rag_chunks_ncert"(
  "query_text" "text",
  "p_subject_code" "text",
  "p_grade" "text",
  "match_count" integer,
  "p_chapter_number" integer,
  "p_chapter_title" "text",
  "p_concept" "text",
  "p_content_type" "text",
  "p_quality_score_gate" double precision,
  "p_min_similarity" double precision,
  "query_embedding" "public"."vector"
) IS
  'NCERT-pinned RAG retrieval with RRF (k=60) over vector + FTS, plus FTS-only and LIKE fallback tiers. source=ncert_2025, snake_case subject_code, P5 grade_short. '
  '`similarity` is an ORDERING statistic (RRF in tier 1, ts_rank in tier 2, 0.3 sentinel in tier 3) and is NOT a relevance measure. '
  '`cosine_similarity` (added 20260727130000) is the absolute cosine 1 - (embedding <=> query_embedding); NULL when no query embedding was supplied '
  'or the chunk is unembedded. Output only — it filters and orders nothing. '
  'SECURITY DEFINER: rag_content_chunks is RLS-protected licensed corpus text with no student PII; the RPC takes no student identifier and performs no writes, '
  'so definer rights let any authenticated learner retrieve without direct SELECT on the corpus table. search_path is pinned to public. '
  'DO NOT create a third overload of this name — the 10-arg baseline overload must survive for fresh-DB REVOKE replay.';

-- ── Re-grant: DROP discarded the ACL, and CREATE re-grants EXECUTE to PUBLIC by
--    default. Restore the exact posture set by
--    20260707020000_rca18_db_function_execute_grants.sql:64 (authenticated + service_role).
REVOKE EXECUTE ON FUNCTION public.match_rag_chunks_ncert(
  text,
  text,
  text,
  integer,
  integer,
  text,
  text,
  text,
  double precision,
  double precision,
  public.vector
) FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION public.match_rag_chunks_ncert(
  text,
  text,
  text,
  integer,
  integer,
  text,
  text,
  text,
  double precision,
  double precision,
  public.vector
) FROM anon;

GRANT EXECUTE ON FUNCTION public.match_rag_chunks_ncert(
  text,
  text,
  text,
  integer,
  integer,
  text,
  text,
  text,
  double precision,
  double precision,
  public.vector
) TO authenticated, service_role;

-- ── Post-flight assertion: the overload count MUST NOT have grown ─────────────
DO $post$
DECLARE
  v_total   INTEGER;
  v_live    INTEGER;
  v_has_col BOOLEAN;
BEGIN
  SELECT count(*) INTO v_total
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'match_rag_chunks_ncert';

  SELECT count(*) INTO v_live
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'match_rag_chunks_ncert'
     -- Identify the LIVE overload by argument NAME, not by rendered type list:
     -- p_min_similarity exists only on the 11-arg signature.
     AND 'p_min_similarity' = ANY (COALESCE(p.proargnames, ARRAY[]::text[]));

  SELECT bool_or(pg_get_function_result(p.oid) LIKE '%cosine_similarity%') INTO v_has_col
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'match_rag_chunks_ncert';

  IF v_total > 2 THEN
    RAISE EXCEPTION
      '20260727130000 ABORT: match_rag_chunks_ncert has % overloads (max 2). A third overload re-opens the PostgREST mis-binding defect fixed in PR #1394.',
      v_total;
  END IF;

  IF v_live <> 1 THEN
    RAISE EXCEPTION
      '20260727130000 ABORT: expected exactly 1 live (p_quality_score_gate/p_min_similarity) overload, found %.',
      v_live;
  END IF;

  IF v_has_col IS NOT TRUE THEN
    RAISE EXCEPTION
      '20260727130000 ABORT: cosine_similarity is not present in the live overload result type.';
  END IF;

  RAISE NOTICE '20260727130000: match_rag_chunks_ncert overload count AFTER = % (live=%), cosine_similarity exposed.',
    v_total, v_live;
END
$post$;

COMMIT;
