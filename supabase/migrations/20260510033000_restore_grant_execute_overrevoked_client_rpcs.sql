-- Restore EXECUTE for client-callable RPCs that PRs #678/#679/#681 over-revoked.
-- Triaged from: grep of supabase.rpc(...) call sites in src/components, src/app, src/lib
-- against pg_proc.has_function_privilege('authenticated', oid, 'EXECUTE').
--
-- Each function below is SECURITY DEFINER with its own internal authz check
-- (callers' student_id / school_id / role is validated inside the function),
-- so granting EXECUTE to authenticated does not expose data the caller shouldn't see.
-- The REVOKE waves were correct in principle (lock down by default) but caught
-- legitimate client surfaces — restoring those specifically.
--
-- Symptom: dashboard shows "Could not load daily progress" because
-- get_daily_xp_by_category denies authenticated; many other student-facing
-- features silently broken too (settings, NCERT picker, school admin, super
-- admin reconciliation, etc.).
--
-- Applied to prod via Supabase MCP on 2026-05-10 03:30 UTC. This file is the
-- corresponding canonical-repo entry so the deploy chain re-running it is a
-- no-op (GRANT is idempotent).

GRANT EXECUTE ON FUNCTION public.get_daily_xp_by_category(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_chapter_concepts(text, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_chapter_progress(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_chapter_qa_from_rag(text, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_ncert_chapter_stats(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_student_subjects(uuid, text[], text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_account_deletion(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_account_deletion(uuid, text, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.validate_academic_scope(uuid, text, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_subject_violations(text, text, text, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.next_contract_number(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_payment(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.atomic_school_plan_change(uuid, text, integer, text) TO authenticated;

-- Audit marker so future debuggers know what happened
INSERT INTO public.admin_audit_log (admin_id, action, entity_type, entity_id, details, created_at)
VALUES (
  NULL,
  'rpc.execute_grants_restored',
  'system',
  NULL,
  jsonb_build_object(
    'reason', 'Over-revoke regression from PRs #678/#679/#681 broke student dashboard + multiple admin surfaces',
    'restored_functions', jsonb_build_array(
      'get_daily_xp_by_category', 'get_chapter_concepts', 'get_chapter_progress',
      'get_chapter_qa_from_rag', 'get_ncert_chapter_stats', 'set_student_subjects',
      'cancel_account_deletion', 'request_account_deletion', 'validate_academic_scope',
      'get_subject_violations', 'next_contract_number', 'reconcile_payment',
      'atomic_school_plan_change'
    ),
    'audit_method', 'grep src/**/*.{ts,tsx} for supabase.rpc(...) call sites + intersect with pg_proc deny list',
    'symptom', 'XPDailyStatus.tsx error: "Could not load daily progress"',
    'reported_by', 'Pradeep Sharma',
    'reported_at', '2026-05-10'
  ),
  now()
)
ON CONFLICT DO NOTHING;
