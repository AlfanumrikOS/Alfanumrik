-- Tighten or document rls_policy_always_true advisor WARNs (11 policies).
--
-- Background: Each of the 11 policies below is `FOR INSERT ... WITH CHECK (true)`,
-- which the Supabase advisor flags because such policies provide no real
-- row-level filtering on writes. We audited each policy's write paths in code
-- and either tightened the policy to a meaningful CHECK or recorded the
-- intent in a COMMENT so future audits can see this was deliberate.
--
-- Audit results (2026-05-09):
--   public.ai_response_reports."Students can create reports"  : TIGHTENED
--      → role authenticated, student_id must match caller's student row.
--   public.audit_logs.audit_logs_insert                       : DOCUMENTED INTENTIONAL
--      → write-only audit table; already restricted to authenticated role.
--   public.rag_content_audit.rag_audit_write                  : DOCUMENTED INTENTIONAL
--      → write-only audit table; only ingestion pipeline writes.
--   public.rag_content_chunks.rag_chunks_write                : TIGHTENED
--      → restricted to service_role (only edge fns + admin scripts ingest).
--   public.rag_content_documents.rag_docs_write               : TIGHTENED
--      → restricted to service_role.
--   public.rag_content_sources.rag_sources_write              : TIGHTENED
--      → restricted to service_role.
--   public.rag_query_logs.rag_query_write                     : DOCUMENTED INTENTIONAL
--      → write-only retrieval metrics fed by app + edge fns.
--   public.rag_retrieval_logs.rag_retrieval_write             : DOCUMENTED INTENTIONAL
--      → write-only retrieval metrics fed by app + edge fns.
--   public.student_moments.moments_insert                     : DOCUMENTED INTENTIONAL
--      → inserted only by SECURITY DEFINER triggers/functions; no app code path.
--   public.support_tickets."Anyone can create tickets"        : TIGHTENED
--      → restricted to authenticated role; companion policy
--        support_tickets_self_insert already enforces ownership for the
--        authenticated path. Guest/unauthenticated tickets continue to
--        succeed through /api/support/ticket which uses the service role.
--   public.waitlist.waitlist_public_insert                    : DOCUMENTED INTENTIONAL
--      → public anonymous landing-page signup, by design; SELECT is denied
--        by waitlist_no_public_read.
--
-- Reference:
--   https://supabase.com/docs/guides/database/database-linter?lint=0017_rls_policy_always_true

-- Per-policy actions follow.

-- =====================================================================
-- 1. ai_response_reports — TIGHTEN
-- =====================================================================
-- Was: FOR INSERT TO public WITH CHECK (true)
-- Now: FOR INSERT TO authenticated WITH CHECK (student_id belongs to caller)
-- Code path: src/app/api/student/foxy-interaction/route.ts uses supabaseAdmin
-- (service-role bypasses RLS), so this tightening does not break production.

DROP POLICY IF EXISTS "Students can create reports" ON public.ai_response_reports;

CREATE POLICY "Students can create reports" ON public.ai_response_reports
  FOR INSERT TO authenticated
  WITH CHECK (
    student_id IN (
      SELECT s.id FROM public.students s WHERE s.auth_user_id = auth.uid()
    )
  );

COMMENT ON POLICY "Students can create reports" ON public.ai_response_reports
  IS 'Tightened 2026-05-09 (advisor 0017_rls_policy_always_true): authenticated students may report only their own AI responses. Server route uses service_role and bypasses this anyway.';

-- =====================================================================
-- 2. audit_logs — DOCUMENT INTENTIONAL
-- =====================================================================
-- Already restricted to the authenticated role. The WITH CHECK (true) is
-- intentional: any authenticated request may append to its own audit trail;
-- the audit_logs_select policy ensures users can only read their own entries.

COMMENT ON POLICY "audit_logs_insert" ON public.audit_logs
  IS 'Intentional: write-only audit append for authenticated callers. Audited 2026-05-09 — ack rls_policy_always_true.';

-- =====================================================================
-- 3. rag_content_audit — DOCUMENT INTENTIONAL
-- =====================================================================
-- Write-only audit log fed by the RAG ingestion pipeline. SELECT is open
-- by rag_audit_read but writes happen only from edge functions / scripts
-- running with service_role.

COMMENT ON POLICY "rag_audit_write" ON public.rag_content_audit
  IS 'Intentional: write-only RAG audit append. All writers use service_role. Audited 2026-05-09 — ack rls_policy_always_true.';

-- =====================================================================
-- 4. rag_content_chunks — TIGHTEN
-- =====================================================================
-- All writers (edge fns embed-*, generate-*, extract-*; scripts/ncert-ingestion;
-- supabaseAdmin in tests) use service_role. Restricting the policy to that
-- role does not break any production path and removes the public anon vector.

DROP POLICY IF EXISTS "rag_chunks_write" ON public.rag_content_chunks;

CREATE POLICY "rag_chunks_write" ON public.rag_content_chunks
  FOR INSERT TO service_role
  WITH CHECK (true);

COMMENT ON POLICY "rag_chunks_write" ON public.rag_content_chunks
  IS 'Tightened 2026-05-09 (advisor 0017_rls_policy_always_true): RAG chunks may only be inserted by the ingestion pipeline (service_role).';

-- =====================================================================
-- 5. rag_content_documents — TIGHTEN
-- =====================================================================

DROP POLICY IF EXISTS "rag_docs_write" ON public.rag_content_documents;

CREATE POLICY "rag_docs_write" ON public.rag_content_documents
  FOR INSERT TO service_role
  WITH CHECK (true);

COMMENT ON POLICY "rag_docs_write" ON public.rag_content_documents
  IS 'Tightened 2026-05-09 (advisor 0017_rls_policy_always_true): RAG documents may only be inserted by the ingestion pipeline (service_role).';

-- =====================================================================
-- 6. rag_content_sources — TIGHTEN
-- =====================================================================

DROP POLICY IF EXISTS "rag_sources_write" ON public.rag_content_sources;

CREATE POLICY "rag_sources_write" ON public.rag_content_sources
  FOR INSERT TO service_role
  WITH CHECK (true);

COMMENT ON POLICY "rag_sources_write" ON public.rag_content_sources
  IS 'Tightened 2026-05-09 (advisor 0017_rls_policy_always_true): RAG sources may only be inserted by the ingestion pipeline (service_role).';

-- =====================================================================
-- 7. rag_query_logs — DOCUMENT INTENTIONAL
-- =====================================================================
-- Write-only retrieval metrics. The SELECT side is open by rag_query_read
-- for telemetry consumers; writes are append-only and contain no user PII
-- beyond a query string. Tightening to service_role would block client-side
-- foxy/quiz logging paths that are intentionally permissive.

COMMENT ON POLICY "rag_query_write" ON public.rag_query_logs
  IS 'Intentional: write-only retrieval-metrics append. Audited 2026-05-09 — ack rls_policy_always_true.';

-- =====================================================================
-- 8. rag_retrieval_logs — DOCUMENT INTENTIONAL
-- =====================================================================

COMMENT ON POLICY "rag_retrieval_write" ON public.rag_retrieval_logs
  IS 'Intentional: write-only retrieval-metrics append. Audited 2026-05-09 — ack rls_policy_always_true.';

-- =====================================================================
-- 9. student_moments — DOCUMENT INTENTIONAL
-- =====================================================================
-- No application code writes to student_moments directly. Inserts happen
-- inside SECURITY DEFINER trigger functions (e.g. on quiz/lesson completion).
-- The permissive INSERT policy is required so those triggers can write
-- moments for any student; SELECT is restricted to the owning student via
-- moments_own.

COMMENT ON POLICY "moments_insert" ON public.student_moments
  IS 'Intentional: only SECURITY DEFINER trigger functions insert moments. Audited 2026-05-09 — ack rls_policy_always_true.';

-- =====================================================================
-- 10. support_tickets."Anyone can create tickets" — TIGHTEN
-- =====================================================================
-- Both POST routes (/api/support/ticket and /api/support/tickets) use
-- supabaseAdmin (service_role bypasses RLS), so neither is affected by
-- this policy. The companion policy `support_tickets_self_insert` already
-- enforces ownership for any direct authenticated client. Restrict the
-- broad policy to authenticated and rely on the self-insert policy for
-- its actual CHECK; the broad policy is now strictly redundant for the
-- authenticated case but kept (rather than dropped) to preserve any
-- behaviour migrations downstream may depend on.

DROP POLICY IF EXISTS "Anyone can create tickets" ON public.support_tickets;

CREATE POLICY "Anyone can create tickets" ON public.support_tickets
  FOR INSERT TO authenticated
  WITH CHECK (
    student_id IS NULL
    OR student_id IN (
      SELECT s.id FROM public.students s WHERE s.auth_user_id = auth.uid()
    )
  );

COMMENT ON POLICY "Anyone can create tickets" ON public.support_tickets
  IS 'Tightened 2026-05-09 (advisor 0017_rls_policy_always_true): authenticated callers may create tickets for themselves or with no student_id (e.g. teacher/parent roles). Anon ticket submissions still work via /api/support/ticket which uses service_role. Companion policy support_tickets_self_insert provides the strict ownership check.';

-- =====================================================================
-- 11. waitlist — DOCUMENT INTENTIONAL
-- =====================================================================
-- Anonymous landing-page signup. SELECT is denied by waitlist_no_public_read,
-- so users can submit but cannot enumerate. The permissive INSERT is
-- deliberately public.

COMMENT ON POLICY "waitlist_public_insert" ON public.waitlist
  IS 'Intentional: public anonymous waitlist signup. SELECT is denied by waitlist_no_public_read. Audited 2026-05-09 — ack rls_policy_always_true.';
