-- =====================================================================
-- Fix: match_rag_chunks references the dropped `syllabus_version` column
-- =====================================================================
--
-- BUG (verified live): public.match_rag_chunks(...) errored on EVERY vector
-- call because its vector branch carried the predicate
--
--     AND (p_syllabus_version IS NULL OR c.syllabus_version = p_syllabus_version)
--
-- but rag_content_chunks NO LONGER HAS a `syllabus_version` column (it was
-- dropped in an earlier schema change). Postgres resolves the column reference
-- at first execution, so every vector-mode call raised
-- `column c.syllabus_version does not exist` and silently fell through /
-- ungrounded the following surfaces:
--   - NCERT photo-solver (scan-solve / ncert-solver via _shared/retrieval.ts
--     legacy fallback)
--   - concept-engine semantic search (src/app/api/concept-engine/route.ts)
-- Foxy chat is UNAFFECTED — it uses match_rag_chunks_ncert, a different RPC.
--
-- FIX: remove the offending predicate line from the vector branch ONLY.
-- The predicate was already a no-op (the column is gone, and callers default
-- p_syllabus_version to a value that the table can no longer satisfy), so
-- dropping it restores grounding with ZERO behavioral change for any row.
--
-- The `p_syllabus_version` PARAMETER is intentionally KEPT in the signature:
-- callers (supabase/functions/_shared/retrieval.ts) pass it positionally /
-- by name, so removing the parameter would break those call sites
-- (PGRST202 / argument-mismatch). The parameter is simply ignored now.
--
-- This definition is byte-identical to the live prod definition obtained via
--   SELECT pg_get_functiondef(oid) FROM pg_proc
--   WHERE pronamespace='public'::regnamespace AND proname='match_rag_chunks';
-- EXCEPT for the single removed predicate line described above.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.match_rag_chunks(query_text text, p_subject text, p_grade text, match_count integer DEFAULT 5, p_chapter text DEFAULT NULL::text, query_embedding vector DEFAULT NULL::vector, p_board text DEFAULT NULL::text, p_min_quality double precision DEFAULT 0.5, p_syllabus_version text DEFAULT NULL::text)
 RETURNS TABLE(id uuid, content text, chapter_title text, topic text, concept text, similarity double precision, media_url text, page_number integer, media_description text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_db_subject TEXT;
  v_subjects   TEXT[];
  v_db_grade   TEXT;
  v_db_board   TEXT;
  v_query      tsquery;
  v_count      INTEGER;
  v_words      TEXT[];
  v_grade_num  INTEGER;
BEGIN
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
    WHEN 'socialstudies'          THEN 'Social Studies'
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
    WHEN 'business_studies'       THEN 'Business Studies'
    WHEN 'business studies'       THEN 'Business Studies'
    ELSE initcap(replace(trim(p_subject), '_', ' '))
  END;

  v_db_grade := CASE
    WHEN p_grade ~ '^\d+$'       THEN 'Grade ' || p_grade
    WHEN p_grade ILIKE 'grade%'  THEN 'Grade ' || regexp_replace(p_grade, '[^0-9]', '', 'g')
    ELSE p_grade
  END;

  v_grade_num := regexp_replace(v_db_grade, '[^0-9]', '', 'g')::INTEGER;

  IF v_grade_num >= 11 AND v_db_subject = 'Science' THEN
    v_subjects := ARRAY['Physics', 'Chemistry', 'Biology'];
  ELSIF v_grade_num >= 11 AND v_db_subject = 'Social Studies' THEN
    v_subjects := ARRAY['History', 'Geography', 'Political Science', 'Economics'];
  ELSE
    v_subjects := ARRAY[v_db_subject];
  END IF;

  v_db_board := CASE
    WHEN p_board IS NULL OR trim(p_board) = '' THEN NULL
    ELSE upper(trim(p_board))
  END;

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
      c.page_number,
      c.media_description
    FROM rag_content_chunks c
    WHERE c.is_active = true
      AND c.embedding IS NOT NULL
      AND c.subject = ANY(v_subjects)
      AND c.grade   = v_db_grade
      AND (v_db_board IS NULL OR c.board IS NULL OR upper(c.board) = v_db_board)
      AND (c.quality_score IS NULL OR c.quality_score >= p_min_quality
      AND (p_chapter IS NULL OR c.chapter_title ILIKE '%' || p_chapter || '%')
    ORDER BY c.embedding <=> query_embedding
    LIMIT match_count;

    GET DIAGNOSTICS v_count = ROW_COUNT;
    IF v_count > 0 THEN RETURN; END IF;
  END IF;

  v_words := regexp_split_to_array(
    regexp_replace(lower(trim(query_text)), '[^\w\s]', '', 'g'),
    '\s+'
  );
  v_words := array(SELECT w FROM unnest(v_words) AS w WHERE length(w) > 2);

  IF array_length(v_words, 1) IS NOT NULL THEN
    v_query := array_to_string(v_words, ' & ')::tsquery;

    RETURN QUERY
    SELECT
      c.id,
      c.chunk_text,
      c.chapter_title,
      c.topic,
      c.concept,
      ts_rank(c.search_vector, v_query)::FLOAT AS similarity,
      c.media_url,
      c.page_number,
      c.media_description
    FROM rag_content_chunks c
    WHERE c.is_active = true
      AND c.subject = ANY(v_subjects)
      AND c.grade   = v_db_grade
      AND (v_db_board IS NULL OR c.board IS NULL OR upper(c.board) = v_db_board)
      AND (c.quality_score IS NULL OR c.quality_score >= p_min_quality
      AND (p_chapter IS NULL OR c.chapter_title ILIKE '%' || p_chapter || '%')
      AND c.search_vector @@ v_query
    ORDER BY ts_rank(c.search_vector, v_query) DESC
    LIMIT match_count;
  END IF;
END;
$function$;
