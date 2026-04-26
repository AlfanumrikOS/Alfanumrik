-- Migration: 20260427000300_retrieval_traces_apply.sql
-- Purpose: Apply standalone the `retrieval_traces` table from the
--          never-shipped V2 architecture migration (20260403700000).
--
-- Background:
--   The original migration `20260403700000_ncert_voyage_retrieval_architecture.sql`
--   was authored but never applied to production (audit confirmed in
--   `20260415000016_match_rag_chunks_ncert_only.sql` lines 8-13). That migration
--   bundled `retrieval_traces` with three other tables (ncert_diagram_registry,
--   study_payload_cache, quiz_rag_links) and the `match_rag_chunks_v2` RPC,
--   which require data backfill and are not part of current product direction.
--
--   Phase 1 of the Foxy moat plan added retrieval-trace logging in
--   `supabase/functions/_shared/retrieval.ts` (`logTrace`, line 305) which
--   inserts into `retrieval_traces` after rerank. Without this table the
--   insert silently fails (logTrace catches and returns ''), so traces are
--   currently being dropped on the floor.
--
--   This migration ships ONLY `retrieval_traces` with the exact shape used by
--   the existing `logTrace` insert. The other V2 tables and `match_rag_chunks_v2`
--   are out of scope and remain a separate decision.
--
-- Columns mirror the abandoned migration's schema (lines 151-169) so this is
-- forward-compatible if/when the rest of V2 is revisited.
--
-- P13 note: `query_text` is currently stored raw to match the existing
-- `logTrace` insert contract. A follow-up should replace it with a redacted
-- preview + sha256 hash (see grounded-answer/trace.ts pattern). Out of scope
-- for this slim migration.

-- ============================================================================
-- 1. Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS retrieval_traces (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  session_id       UUID,                           -- optional quiz/chat session
  caller           TEXT        NOT NULL,           -- 'foxy-tutor'|'ncert-solver'|'quiz-generator'|'chapter-page'
  grade            TEXT        NOT NULL,           -- P5: string grade
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

-- ============================================================================
-- 2. RLS (P8: every new table gets RLS enabled in the same migration)
-- ============================================================================

ALTER TABLE retrieval_traces ENABLE ROW LEVEL SECURITY;

-- Service role (Edge Functions writing traces; super-admin analytics)
DO $$ BEGIN
  CREATE POLICY "rt_service_all" ON retrieval_traces
    FOR ALL TO service_role
    USING (true)
    WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Users read their own traces (per-student debugging via the app)
DO $$ BEGIN
  CREATE POLICY "rt_user_select" ON retrieval_traces
    FOR SELECT USING (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Super-admin SELECT for analytics dashboards. Matches the RBAC pattern used
-- across other admin-readable tables: check user_roles + roles join.
DO $$ BEGIN
  CREATE POLICY "rt_super_admin_select" ON retrieval_traces
    FOR SELECT USING (
      EXISTS (
        SELECT 1
        FROM user_roles ur
        JOIN roles r ON r.id = ur.role_id
        WHERE ur.auth_user_id = auth.uid()
          AND ur.is_active = true
          AND (ur.expires_at IS NULL OR ur.expires_at > now())
          AND r.name IN ('super_admin', 'admin')
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Note: no INSERT/UPDATE/DELETE policies for non-service callers. Writes are
-- service-role-only (Edge Functions); students/parents/teachers cannot mutate
-- traces. The default-deny RLS posture handles this without explicit policies.

-- ============================================================================
-- 3. Indexes
-- ============================================================================

-- Log scanning by recency (admin dashboards, latency analytics)
CREATE INDEX IF NOT EXISTS idx_retrieval_traces_created_at
  ON retrieval_traces (created_at DESC);

-- Per-student debugging (e.g., "show me Foxy retrievals for student X")
CREATE INDEX IF NOT EXISTS idx_retrieval_traces_user_created
  ON retrieval_traces (user_id, created_at DESC);

-- Caller/grade/subject analytics (matches V2 design)
CREATE INDEX IF NOT EXISTS idx_retrieval_traces_caller_grade_subject
  ON retrieval_traces (caller, grade, subject, created_at DESC);

-- ============================================================================
-- Summary
-- ============================================================================
-- Table created: retrieval_traces (with RLS + 3 policies)
-- Indexes: 3 (created_at DESC, user/created, caller/grade/subject/created)
-- Idempotent: IF NOT EXISTS on table + indexes; DO $$ EXCEPTION blocks on
--             policies. Safe to re-run against environments where the table
--             may have been hand-applied via mcp.
-- ============================================================================
