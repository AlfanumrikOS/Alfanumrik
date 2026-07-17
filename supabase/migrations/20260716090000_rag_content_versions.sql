-- Migration: 20260716090000_rag_content_versions.sql
-- Purpose: Per (grade, subject_code) monotonic content-version counter for the
--          response-cache v2 design (CEO-approved decisions 1-3, 2026-07-16).
--
-- NCERT ingestion writers bump `version` whenever grounding content for a
-- grade+subject changes (chunk re-ingestion, embedding refresh, QA re-extract).
-- The grounded-answer pipeline folds the current version into every cache key
-- (L1/L2 Redis and the durable L3 ncert_solver_solutions store), so a content
-- bump implicitly invalidates all cached answers grounded on stale content —
-- no TTL race, no sweep job.
--
-- Contract for readers/writers (ai-engineer pipeline must match exactly):
--   * Read:  SELECT version FROM rag_content_versions
--            WHERE grade = $1 AND subject_code = $2;  -- missing row => version 0
--   * Bump:  INSERT INTO rag_content_versions (grade, subject_code, version)
--            VALUES ($1, $2, 1)
--            ON CONFLICT (grade, subject_code)
--            DO UPDATE SET version = rag_content_versions.version + 1;
--            (updated_at is maintained by trigger.)
--   * `version` is MONOTONIC — never decremented, never reset.
--
-- P5: grade is TEXT '6'..'12' (CHECK enforced). Never integer.
--
-- ─── RLS posture: service-role-only (deliberate) ─────────────────────────────
-- This is pure cache-plumbing infrastructure: no student data, no PII, and no
-- client surface reads it. The only readers/writers are server-side (ingestion
-- scripts + the grounded-answer pipeline via supabase-admin / Edge Function
-- service key). The standard four-pattern RLS matrix (student-own / parent-
-- linked / teacher-assigned / service) intentionally collapses to the service
-- pattern alone: there is no student_id to scope by. No authenticated or anon
-- policy exists — default-deny for every non-service principal. This omission
-- is the design, not an oversight (mirrors the service-only posture of
-- payment_webhook_events).
--
-- Additive only. Idempotent: CREATE TABLE IF NOT EXISTS, DROP POLICY IF EXISTS
-- before CREATE POLICY, CREATE OR REPLACE FUNCTION, DROP TRIGGER IF EXISTS,
-- REVOKE/GRANT are inherently re-runnable. No DROP of any existing object.
--
-- Owner: architect. Added: 2026-07-16.

BEGIN;

-- ─── 1. Table ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.rag_content_versions (
  grade        TEXT        NOT NULL CHECK (grade IN ('6','7','8','9','10','11','12')),  -- P5
  subject_code TEXT        NOT NULL,
  version      INTEGER     NOT NULL DEFAULT 0 CHECK (version >= 0),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (grade, subject_code)
);

-- ─── 2. updated_at trigger ────────────────────────────────────────────────────
-- Version bumps go through ON CONFLICT DO UPDATE; the trigger guarantees
-- updated_at freshness regardless of the writer's SET list.

CREATE OR REPLACE FUNCTION public.update_rag_content_versions_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_rag_content_versions_updated_at
  ON public.rag_content_versions;
CREATE TRIGGER trg_rag_content_versions_updated_at
  BEFORE UPDATE ON public.rag_content_versions
  FOR EACH ROW EXECUTE FUNCTION public.update_rag_content_versions_updated_at();

-- ─── 3. Row Level Security (same migration as the table — P8) ────────────────

ALTER TABLE public.rag_content_versions ENABLE ROW LEVEL SECURITY;

-- Service role: full access. The ONLY policy on this table — anon and
-- authenticated have no policy and therefore no row access (default deny).
DROP POLICY IF EXISTS rag_content_versions_service_all
  ON public.rag_content_versions;
CREATE POLICY rag_content_versions_service_all
  ON public.rag_content_versions
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ─── 4. Grants (defense in depth under the RLS layer) ─────────────────────────
REVOKE ALL ON public.rag_content_versions FROM PUBLIC;
REVOKE ALL ON public.rag_content_versions FROM anon;
REVOKE ALL ON public.rag_content_versions FROM authenticated;

GRANT ALL ON public.rag_content_versions TO service_role;

COMMENT ON TABLE public.rag_content_versions IS
  'Response-cache v2: per (grade, subject_code) monotonic content-version counter. NCERT ingestion writers bump version on content change; the grounded-answer pipeline folds it into cache keys (L1/L2 Redis + L3 ncert_solver_solutions) to invalidate stale grounding. Missing row reads as version 0. Service-role-only (no PII, no client surface). Grades are strings ''6''..''12'' (P5).';

COMMIT;

-- ─── Verify (manual check after applying) ─────────────────────────────────────
-- SELECT polname, cmd FROM pg_policies
--  WHERE tablename = 'rag_content_versions' ORDER BY polname;
--   Expected: rag_content_versions_service_all (ALL) — and nothing else.
