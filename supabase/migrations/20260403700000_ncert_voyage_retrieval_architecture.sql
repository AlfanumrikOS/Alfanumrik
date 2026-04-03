-- Migration: 20260403700000_ncert_voyage_retrieval_architecture.sql
-- Purpose: Establish clean NCERT Voyage+Supabase retrieval architecture.
--   Voyage handles embedding generation and optional reranking only.
--   Supabase is the canonical source of truth for all content and metadata.
--   Adds: syllabus_version/source/concept_id/diagram_id columns to rag_content_chunks,
--   ncert_diagram_registry, retrieval_traces, study_payload_cache, quiz_rag_links tables,
--   match_rag_chunks_v2 RPC (8-filter), and get_diagram_record RPC.


-- ============================================================================
-- 1. Add new columns to rag_content_chunks
-- ============================================================================

-- syllabus_version: which CBSE syllabus year this chunk belongs to
DO $$ BEGIN
  ALTER TABLE rag_content_chunks ADD COLUMN syllabus_version TEXT NOT NULL DEFAULT '2025-26';
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE rag_content_chunks
    ADD CONSTRAINT chk_rag_syllabus_version
    CHECK (syllabus_version IN ('2024-25', '2025-26'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- source: canonical data source marker
DO $$ BEGIN
  ALTER TABLE rag_content_chunks ADD COLUMN source TEXT NOT NULL DEFAULT 'NCERT';
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE rag_content_chunks
    ADD CONSTRAINT chk_rag_source
    CHECK (source IN ('NCERT', 'exemplar', 'cbse_sample'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- concept_id: soft FK to chapter_concepts (SET NULL on delete so chunk survives)
DO $$ BEGIN
  ALTER TABLE rag_content_chunks
    ADD COLUMN concept_id UUID REFERENCES chapter_concepts(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- diagram_id: added after ncert_diagram_registry is created (section 2b below)


-- ============================================================================
-- 2. Backfill source column for existing chunks
-- ============================================================================

UPDATE rag_content_chunks SET source = 'NCERT' WHERE source IS NULL OR source = '';


-- ============================================================================
-- 3. Create ncert_diagram_registry
-- ============================================================================
-- Canonical diagram records. Diagrams are served from here, never from Voyage.
-- RAG chunks reference diagrams via diagram_id FK added after this table.
-- Grade follows P5: "6"-"12" (no "Grade" prefix); grade normalization happens
-- at the RPC boundary when looking up rag_content_chunks (which uses "Grade N").

CREATE TABLE IF NOT EXISTS ncert_diagram_registry (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  grade            TEXT        NOT NULL,           -- P5: "6"-"12"
  subject          TEXT        NOT NULL,
  chapter_number   INTEGER     NOT NULL,
  diagram_key      TEXT        NOT NULL,           -- stable unique key: "g7_science_ch1_fig1_1"
  title            TEXT        NOT NULL,
  title_hi         TEXT,
  description      TEXT,
  file_url         TEXT        NOT NULL,           -- Supabase Storage public URL
  page_number      INTEGER,
  related_concepts TEXT[]      NOT NULL DEFAULT '{}',
  syllabus_version TEXT        NOT NULL DEFAULT '2025-26',
  source           TEXT        NOT NULL DEFAULT 'NCERT',
  is_active        BOOLEAN     NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (grade, subject, chapter_number, diagram_key)
);

-- RLS
ALTER TABLE ncert_diagram_registry ENABLE ROW LEVEL SECURITY;

-- Public read for active diagrams (curriculum reference data)
DO $$ BEGIN
  CREATE POLICY "ndr_public_read" ON ncert_diagram_registry
    FOR SELECT USING (is_active = true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Service role full access for admin content management
DO $$ BEGIN
  CREATE POLICY "ndr_service_all" ON ncert_diagram_registry
    FOR ALL TO service_role
    USING (true)
    WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_ndr_chapter
  ON ncert_diagram_registry(grade, subject, chapter_number) WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_ndr_diagram_key
  ON ncert_diagram_registry(diagram_key);

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_ncert_diagram_registry_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ndr_updated_at ON ncert_diagram_registry;
CREATE TRIGGER trg_ndr_updated_at
  BEFORE UPDATE ON ncert_diagram_registry
  FOR EACH ROW EXECUTE FUNCTION update_ncert_diagram_registry_updated_at();


-- ============================================================================
-- 4. Add diagram_id FK to rag_content_chunks (after registry table exists)
-- ============================================================================

DO $$ BEGIN
  ALTER TABLE rag_content_chunks
    ADD COLUMN diagram_id UUID REFERENCES ncert_diagram_registry(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;


-- ============================================================================
-- 5. Composite index on rag_content_chunks for all 8 metadata filters
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_rag_chunks_8_filters
  ON rag_content_chunks(subject, grade, chapter_number, content_type, syllabus_version, is_active);


-- ============================================================================
-- 6. Create retrieval_traces
-- ============================================================================
-- Async audit log. Every retrieval call logs here for quality analysis.
-- user_id is SET NULL on delete to retain analytics after account deletion.

CREATE TABLE IF NOT EXISTS retrieval_traces (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  session_id       UUID,                           -- optional quiz/chat session
  caller           TEXT        NOT NULL,           -- 'foxy-tutor'|'ncert-solver'|'quiz-generator'|'chapter-page'
  grade            TEXT        NOT NULL,
  subject          TEXT        NOT NULL,
  chapter_number   INTEGER,
  concept          TEXT,
  content_type     TEXT,
  syllabus_version TEXT,
  query_text       TEXT        NOT NULL,
  embedding_model  TEXT        NOT NULL DEFAULT 'voyage/voyage-3',
  reranked         BOOLEAN     NOT NULL DEFAULT false,
  chunk_ids        UUID[]      NOT NULL DEFAULT '{}',
  match_count      INTEGER     NOT NULL DEFAULT 5,
  latency_ms       INTEGER,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE retrieval_traces ENABLE ROW LEVEL SECURITY;

-- Users read their own traces
DO $$ BEGIN
  CREATE POLICY "rt_user_select" ON retrieval_traces
    FOR SELECT USING (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Service role full access for analytics and admin review
DO $$ BEGIN
  CREATE POLICY "rt_service_all" ON retrieval_traces
    FOR ALL TO service_role
    USING (true)
    WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Index for analytics queries
CREATE INDEX IF NOT EXISTS idx_rt_caller_grade_subject
  ON retrieval_traces(caller, grade, subject, created_at);

CREATE INDEX IF NOT EXISTS idx_rt_user_created
  ON retrieval_traces(user_id, created_at);


-- ============================================================================
-- 7. Create study_payload_cache
-- ============================================================================
-- Per-student chapter cache to avoid re-running RAG on every page load.
-- Cascades on user delete (student data, not reference data).

CREATE TABLE IF NOT EXISTS study_payload_cache (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  grade            TEXT        NOT NULL,           -- P5: "6"-"12"
  subject          TEXT        NOT NULL,
  chapter_number   INTEGER     NOT NULL,
  payload          JSONB       NOT NULL,
  chunk_ids        UUID[]      NOT NULL DEFAULT '{}',
  syllabus_version TEXT        NOT NULL DEFAULT '2025-26',
  expires_at       TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '24 hours'),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, grade, subject, chapter_number)
);

-- RLS
ALTER TABLE study_payload_cache ENABLE ROW LEVEL SECURITY;

-- Users access only their own cache
DO $$ BEGIN
  CREATE POLICY "spc_user_select" ON study_payload_cache
    FOR SELECT USING (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "spc_user_insert" ON study_payload_cache
    FOR INSERT WITH CHECK (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "spc_user_update" ON study_payload_cache
    FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "spc_user_delete" ON study_payload_cache
    FOR DELETE USING (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Service role full access for cache management and expiry sweeps
DO $$ BEGIN
  CREATE POLICY "spc_service_all" ON study_payload_cache
    FOR ALL TO service_role
    USING (true)
    WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_spc_lookup
  ON study_payload_cache(user_id, grade, subject, chapter_number);

-- Index for expiry sweeps (daily-cron purges expired cache entries).
-- Plain index (no partial predicate) because PostgreSQL evaluates partial index
-- WHERE clauses at creation time, not at query time. A static NOW() predicate
-- would become stale and miss newly-expired rows in future expiry sweep queries.
CREATE INDEX IF NOT EXISTS idx_spc_expires
  ON study_payload_cache(expires_at);


-- ============================================================================
-- 8. Create quiz_rag_links
-- ============================================================================
-- Links quiz sessions to RAG chunks used for question generation.
-- Internal audit table — no direct student RLS needed; service role only.

CREATE TABLE IF NOT EXISTS quiz_rag_links (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_session_id  TEXT        NOT NULL,           -- matches quiz session identifier
  chunk_id         UUID        NOT NULL REFERENCES rag_content_chunks(id) ON DELETE CASCADE,
  question_id      UUID        REFERENCES question_bank(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE quiz_rag_links ENABLE ROW LEVEL SECURITY;

-- Service role full access (internal audit; not exposed to students directly)
DO $$ BEGIN
  CREATE POLICY "qrl_service_all" ON quiz_rag_links
    FOR ALL TO service_role
    USING (true)
    WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_qrl_session
  ON quiz_rag_links(quiz_session_id);

CREATE INDEX IF NOT EXISTS idx_qrl_chunk
  ON quiz_rag_links(chunk_id);


-- ============================================================================
-- 9. Create match_rag_chunks_v2 RPC
-- ============================================================================
-- Replaces match_rag_chunks for all new callers. Supports all 8 metadata filters.
-- match_rag_chunks is kept unchanged for backward compatibility.
--
-- SECURITY DEFINER: required because rag_content_chunks RLS is not configured
-- for direct student access. This function mediates access with subject/grade/source
-- filtering, consistent with match_rag_chunks and get_chapter_rag_content.
-- SET search_path = 'public' prevents search-path injection attacks.

CREATE OR REPLACE FUNCTION match_rag_chunks_v2(
  query_text          TEXT,
  p_subject           TEXT,
  p_grade             TEXT,
  match_count         INTEGER DEFAULT 10,
  p_chapter_number    INTEGER DEFAULT NULL,
  p_chapter           TEXT    DEFAULT NULL,
  p_concept           TEXT    DEFAULT NULL,
  p_content_type      TEXT    DEFAULT NULL,
  p_source            TEXT    DEFAULT 'NCERT',
  p_syllabus_version  TEXT    DEFAULT NULL,
  query_embedding     vector(1024) DEFAULT NULL
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
      AND (p_chapter_number  IS NULL OR c.chapter_number  = p_chapter_number)
      AND (p_chapter         IS NULL OR c.chapter_title ILIKE '%' || p_chapter || '%')
      AND (p_concept         IS NULL OR c.concept        = p_concept)
      AND (p_content_type    IS NULL OR c.content_type   = p_content_type)
      AND (p_syllabus_version IS NULL OR c.syllabus_version = p_syllabus_version)
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
    LIMIT match_count;
  END IF;
END;
$$;


-- ============================================================================
-- 10. Create get_diagram_record RPC
-- ============================================================================
-- Fetch canonical diagram record by diagram_id OR diagram_key.
-- Exactly one of p_diagram_id or p_diagram_key must be non-NULL.
-- Only returns is_active = true records.
--
-- SECURITY DEFINER: consistent with other NCERT content RPCs. ncert_diagram_registry
-- is public-read via RLS, but DEFINER ensures deterministic behavior regardless of
-- caller role and isolates the lookup from future RLS changes.
-- SET search_path = 'public' prevents search-path injection attacks.

CREATE OR REPLACE FUNCTION get_diagram_record(
  p_diagram_id  UUID DEFAULT NULL,
  p_diagram_key TEXT DEFAULT NULL
)
RETURNS TABLE(
  id               UUID,
  grade            TEXT,
  subject          TEXT,
  chapter_number   INTEGER,
  diagram_key      TEXT,
  title            TEXT,
  title_hi         TEXT,
  description      TEXT,
  file_url         TEXT,
  page_number      INTEGER,
  related_concepts TEXT[],
  syllabus_version TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  RETURN QUERY
  SELECT
    r.id,
    r.grade,
    r.subject,
    r.chapter_number,
    r.diagram_key,
    r.title,
    r.title_hi,
    r.description,
    r.file_url,
    r.page_number,
    r.related_concepts,
    r.syllabus_version
  FROM ncert_diagram_registry r
  WHERE r.is_active = true
    AND (
      (p_diagram_id  IS NOT NULL AND r.id          = p_diagram_id)
      OR
      (p_diagram_key IS NOT NULL AND r.diagram_key = p_diagram_key)
    )
  LIMIT 1;
END;
$$;


-- ============================================================================
-- End of migration: 20260403700000_ncert_voyage_retrieval_architecture.sql
--
-- Columns added to rag_content_chunks: 4
--   syllabus_version, source, concept_id, diagram_id
-- Constraints added to rag_content_chunks: 2
--   chk_rag_syllabus_version, chk_rag_source
-- Indexes added to rag_content_chunks: 1
--   idx_rag_chunks_8_filters
-- Tables created (with RLS + policies): 4
--   ncert_diagram_registry, retrieval_traces, study_payload_cache, quiz_rag_links
-- RPCs created: 2
--   match_rag_chunks_v2, get_diagram_record
-- Data backfilled: rag_content_chunks.source = 'NCERT' for existing rows
-- ============================================================================
