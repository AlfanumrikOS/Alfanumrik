-- P0-1 wave 2 (2026-09-02 launch audit, same-day follow-up). While
-- correcting the PUBLIC-grant gap in 20260902150108, a full live scan of
-- every SECURITY DEFINER function still carrying a PUBLIC EXECUTE grant
-- found 58 functions, not just the 13 already being corrected. This
-- migration closes the subset of those 58 individually verified (grep
-- across apps/host/src, packages/lib/src, packages/ui/src, mobile/lib,
-- supabase/functions) to have ZERO callers anywhere in this codebase:
--
--   compute_post_quiz_action, foxy_policy_decide, get_class_activity_report,
--   get_school_dashboard_stats, get_school_usage_analytics,
--   match_rag_chunks_v3, security_rebuild_tenant_ai_usage_from_audit,
--   snapshot_adaptive_intervention_metrics_daily, start_mock_test_attempt,
--   verify_activity_reporting
--
-- 9 of these 10 additionally carry EXPLICIT named grants to anon AND
-- authenticated (not just the PUBLIC default) — so this REVOKEs all three
-- (PUBLIC, anon, authenticated) rather than PUBLIC alone. No overloads
-- exist for any of these 10 (verified live), so the unqualified
-- `public.<name>` form is unambiguous.
--
-- Some of these read or write per-student/per-school data with no
-- ownership check in the body (get_class_activity_report takes p_class_id;
-- get_school_dashboard_stats and get_school_usage_analytics take
-- p_school_id), so leaving them PUBLIC-reachable was a live information-
-- disclosure risk, not just a hygiene issue.
--
-- REMAINING SCOPE (deliberately deferred, see this session's own report):
-- the other ~48 of the 58 flagged functions DO have real application
-- callers (mostly via the browser/RLS-respecting client in
-- packages/lib/src/supabase.ts) and need PUBLIC removed while
-- authenticated access is preserved — a swap-not-a-revoke, which requires
-- reading each function's body to confirm its internal ownership check is
-- adequate before removing the anon-reachable PUBLIC path (the same class
-- of verification this migration and its predecessor already went
-- through). That batch is tracked as a follow-up, not rushed into this
-- migration.

REVOKE EXECUTE ON FUNCTION public.compute_post_quiz_action                    FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.foxy_policy_decide                          FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_class_activity_report                   FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_school_dashboard_stats                  FROM PUBLIC, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_school_usage_analytics                  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.match_rag_chunks_v3                         FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.security_rebuild_tenant_ai_usage_from_audit FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.snapshot_adaptive_intervention_metrics_daily FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.start_mock_test_attempt                     FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.verify_activity_reporting                   FROM PUBLIC, anon, authenticated;
