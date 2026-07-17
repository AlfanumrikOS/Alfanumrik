-- Migration: 20260716090100_ncert_solver_solutions.sql
-- Purpose: Durable L3 solution store for ncert-solver (response-cache v2,
--          CEO-approved decisions 1-3, 2026-07-16). Copies the REG-39
--          remediation-cache pattern (wrong_answer_remediations, _legacy/
--          timestamped/20260428000100): content keyed on the QUESTION, never
--          the student — two students asking the same normalized question at
--          the same content/generation context receive the same stored
--          GroundedResponse, which is the desired behavior.
--
-- Cache-key contract (ai-engineer pipeline must match exactly):
--   * question_hash    — sha256 hex of the NORMALIZED query text. Normalization
--                        must NOT strip operator punctuation (REG-237: the
--                        retired public.response_cache collapsed "5+3"/"5-3";
--                        that bug class is a rejection condition here).
--   * gen_ctx_hash     — sha256 hex of the generation context (model id,
--                        prompt/template version, pipeline params). Any prompt
--                        or model change produces a new hash => a clean miss.
--   * content_version  — the rag_content_versions.version for (grade,
--                        subject_code) AT WRITE TIME (missing row => 0).
--   * Lookup: match all four unique-key columns, then require
--     stored content_version = current rag_content_versions version;
--     mismatch = miss (stale grounding).
--   * Write: INSERT ... ON CONFLICT (grade, subject_code, question_hash,
--     gen_ctx_hash) DO UPDATE SET response/content_version/model/tokens_used/
--     created_at — the newer solve supersedes the stale row in place.
--   * NO TTL by design: invalidation is entirely content_version + gen_ctx
--     keying. Do not add a TTL sweep against this table.
--
-- Privacy contract (P13): `response` holds the GroundedResponse payload ONLY.
-- NO student_id, NO auth uid, NO PII of any kind — by contract AND by schema
-- (there is no student-referencing column to leak through). Writers that
-- attempt to persist per-student state here must be rejected in review.
--
-- P5: grade is TEXT '6'..'12' (CHECK enforced). Never integer.
--
-- ─── RLS posture: service-role-only (deliberate, TIGHTER than REG-39) ─────────
-- wrong_answer_remediations allowed authenticated SELECT because clients read
-- it directly. Here the ONLY reader/writer is the server-side ncert-solver
-- pipeline (service key), so no authenticated/anon policy exists — default
-- deny for every non-service principal. The standard four-pattern RLS matrix
-- (student-own / parent-linked / teacher-assigned / service) intentionally
-- collapses to the service pattern alone: there is no student_id to scope by.
-- This omission is the design, not an oversight.
--
-- Additive only. Idempotent: CREATE TABLE/INDEX IF NOT EXISTS, DROP POLICY IF
-- EXISTS before CREATE POLICY, REVOKE/GRANT are inherently re-runnable. No
-- DROP of any existing object. Distinct from the DEPRECATED public.
-- response_cache (see 20260713130100) — that table stays untouched and dies
-- on its own audit-cycle schedule.
--
-- Owner: architect (schema/RLS) + ai-engineer (pipeline read/write, in
--        parallel, against these exact column names). Added: 2026-07-16.

BEGIN;

-- ─── 1. Table ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.ncert_solver_solutions (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  grade           TEXT        NOT NULL CHECK (grade IN ('6','7','8','9','10','11','12')),  -- P5
  subject_code    TEXT        NOT NULL,
  chapter_number  INTEGER     CHECK (chapter_number IS NULL OR chapter_number >= 1),
  question_hash   TEXT        NOT NULL,  -- sha256 hex of normalized query (REG-237-safe normalization)
  gen_ctx_hash    TEXT        NOT NULL,  -- sha256 hex of generation context (model + prompt version + params)
  response        JSONB       NOT NULL,  -- GroundedResponse payload; NO student_id / PII by contract (P13)
  content_version INTEGER     NOT NULL CHECK (content_version >= 0),  -- rag_content_versions.version at write time
  model           TEXT,
  tokens_used     INTEGER     CHECK (tokens_used IS NULL OR tokens_used >= 0),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (grade, subject_code, question_hash, gen_ctx_hash)
);

-- ─── 2. Indexes ───────────────────────────────────────────────────────────────
-- Point lookups ride the UNIQUE constraint's backing index. The two below
-- serve ops-side work only:

-- Stale-version audit/purge scans ("how many rows ground on version < N?").
CREATE INDEX IF NOT EXISTS idx_ncert_solver_solutions_content_version
  ON public.ncert_solver_solutions (grade, subject_code, content_version);

-- Recency-window ops queries (hit-rate/date-range forensics).
CREATE INDEX IF NOT EXISTS idx_ncert_solver_solutions_created
  ON public.ncert_solver_solutions (created_at);

-- ─── 3. Row Level Security (same migration as the table — P8) ────────────────

ALTER TABLE public.ncert_solver_solutions ENABLE ROW LEVEL SECURITY;

-- Service role: full access. The ONLY policy on this table — anon and
-- authenticated have no policy and therefore no row access (default deny).
DROP POLICY IF EXISTS ncert_solver_solutions_service_all
  ON public.ncert_solver_solutions;
CREATE POLICY ncert_solver_solutions_service_all
  ON public.ncert_solver_solutions
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ─── 4. Grants (defense in depth under the RLS layer) ─────────────────────────
REVOKE ALL ON public.ncert_solver_solutions FROM PUBLIC;
REVOKE ALL ON public.ncert_solver_solutions FROM anon;
REVOKE ALL ON public.ncert_solver_solutions FROM authenticated;

GRANT ALL ON public.ncert_solver_solutions TO service_role;

COMMENT ON TABLE public.ncert_solver_solutions IS
  'Response-cache v2 durable L3 solution store for ncert-solver (REG-39 remediation-cache pattern, service-role-only). Keyed UNIQUE (grade, subject_code, question_hash, gen_ctx_hash); reader must also match content_version against rag_content_versions (mismatch = miss). NO TTL — invalidated by content_version/gen_ctx keying. response = GroundedResponse payload only, no student_id/PII by contract (P13). Serving gated by ff_response_cache_serve_ncert_v1; the store tier itself gated by ff_ncert_solver_solution_store_v1. Grades are strings ''6''..''12'' (P5).';

COMMIT;

-- ─── Verify (manual check after applying) ─────────────────────────────────────
-- SELECT polname, cmd FROM pg_policies
--  WHERE tablename = 'ncert_solver_solutions' ORDER BY polname;
--   Expected: ncert_solver_solutions_service_all (ALL) — and nothing else.
