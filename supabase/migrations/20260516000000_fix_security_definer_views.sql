-- ─── Fix security_definer_view advisor ERRORs (7 views) ──────────────
--
-- Background:
--
-- Postgres views created without `security_invoker = on` enforce permissions
-- of the view OWNER (definer semantics) rather than the querying user. This
-- is the historical default and causes Supabase's database linter to flag
-- ERROR-level findings (lint code 0010_security_definer_view), because such
-- views can leak rows past RLS when called by a less-privileged user.
--
-- Setting `security_invoker = on` delegates permission checks to the caller,
-- making the view behave like a regular SELECT against the underlying tables
-- — RLS on the base tables is enforced as the calling role.
--
-- Reference:
--   https://supabase.com/docs/guides/database/database-linter?lint=0010_security_definer_view
--
-- Risk assessment (per-view code-scan, 2026-05-09):
--
--   All 7 views are queried server-side using the service-role client
--   (`supabaseAdmin` / `SUPABASE_SERVICE_ROLE_KEY`), which bypasses RLS
--   regardless of definer/invoker semantics. No client-side / anon-key
--   reads of these views were found in src/. So switching to invoker mode
--   is functionally equivalent for current callers — but tightens the
--   security posture against any future direct-from-client access.
--
--   • misconception_candidates           — src/app/api/super-admin/misconceptions  (admin, service-role) — LOW
--   • cbse_syllabus_rag_diagnostic       — no live route refs (test only)                                — LOW
--   • v_ops_timeline                     — src/app/api/super-admin/observability/* (admin, service-role) — LOW
--   • rag_chapter_coverage               — no live route refs                                            — LOW
--   • v_class_lab_leaderboard            — src/app/api/teacher/lab-leaderboard    (service-role)         — LOW
--   • ingestion_gaps                     — scripts/pre-rollout-checklist.ts only (ops tool)              — LOW
--   • super_admin_subject_readiness      — no live route refs                                            — LOW
--
-- Existence verified against production project shktyoxqhundlvkiwguu via
-- pg_views on 2026-05-09 — all 7 views present.
--
-- Idempotency: ALTER VIEW ... SET (...) is idempotent by construction
-- (Postgres just overwrites the reloptions entry); re-running this
-- migration is safe.

ALTER VIEW public.misconception_candidates SET (security_invoker = on);
ALTER VIEW public.cbse_syllabus_rag_diagnostic SET (security_invoker = on);
ALTER VIEW public.v_ops_timeline SET (security_invoker = on);
ALTER VIEW public.rag_chapter_coverage SET (security_invoker = on);
ALTER VIEW public.v_class_lab_leaderboard SET (security_invoker = on);
ALTER VIEW public.ingestion_gaps SET (security_invoker = on);
ALTER VIEW public.super_admin_subject_readiness SET (security_invoker = on);
