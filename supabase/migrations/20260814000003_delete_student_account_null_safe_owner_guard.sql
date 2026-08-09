-- Migration: 20260814000003_delete_student_account_null_safe_owner_guard.sql
-- Audit remediation (2026-08-09, backend+DB doctor) — closes a CRITICAL
-- unauthenticated data-destruction path on public.delete_student_account(uuid).
--
--   FINDING (Critical): delete_student_account is SECURITY DEFINER and, per the
--     live ACL {=X/postgres,postgres=X/postgres,authenticated=X/postgres,
--     service_role=X/postgres}, carries the baseline default PUBLIC EXECUTE
--     grant — so anon (via PUBLIC) can invoke it over PostgREST /rest/v1/rpc.
--     The prior in-body guard was:
--         IF v_auth_uid IS NULL OR v_auth_uid != auth.uid() THEN ... Unauthorized
--     which FAILS OPEN for an unauthenticated caller: for a real target student
--     v_auth_uid is non-null, auth.uid() is NULL, so `v_auth_uid != NULL`
--     evaluates to SQL NULL, `FALSE OR NULL` is NULL, and PL/pgSQL does NOT
--     execute the THEN branch on a NULL condition — control falls through to
--     the 21 child-table DELETEs and the students soft-delete. An anonymous
--     caller who knows/enumerates a student_id UUID could wipe that student's
--     learning data and deactivate the account.
--
--   PRIOR PARTIAL ATTEMPT: 20260515000002 issued
--     `REVOKE EXECUTE ... FROM anon` — a silent no-op, because the grant lives
--     on PUBLIC (the exact class documented in the #676/#678 revoke-from-PUBLIC
--     saga). The named-role REVOKE removes nothing when PUBLIC holds the grant.
--
-- FIX (two independent controls — defense in depth):
--   1. Grant surface: REVOKE ALL FROM PUBLIC, anon (the form that actually
--      removes the inherited grant) and re-assert authenticated + service_role
--      EXECUTE explicitly, so fresh environments (CI live-DB, staging, DR) land
--      in the hardened posture without relying on the default PUBLIC grant.
--   2. In-body guard: rewritten to the house ownership pattern already used by
--      20260813000007 / submit_quiz_results_v2:
--        IF auth.uid() IS NOT NULL AND (v_auth_uid IS NULL OR v_auth_uid <> auth.uid())
--      The `auth.uid() IS NOT NULL AND` prefix keeps the deliberate service-role
--      escape hatch (a service-role caller carries no JWT, auth.uid() IS NULL);
--      the `<>` comparison is NULL-safe for the authenticated cross-user case.
--
-- CALLERS (verified 2026-08-09): the ONLY caller is the authenticated browser
--   client — apps/host/src/app/(student)/profile/page.tsx:570 deletes the
--   signed-in student's own account. The service-role account-deletion path
--   (supabase/functions/account-purge) performs its own direct table DELETEs and
--   does NOT call this RPC. So revoking anon/PUBLIC EXECUTE is purely additive
--   for legitimate traffic and the guard is unchanged for the owner.
--
-- CONTRACT: unchanged — same signature delete_student_account(p_student_id uuid),
--   same jsonb return shape {success, error}. No frontend change required.
--
-- IDEMPOTENT: CREATE OR REPLACE + REVOKE/GRANT are replay-safe. No schema/RLS
--   change, no DROP of tables/columns, no data deletion by this migration.

BEGIN;

CREATE OR REPLACE FUNCTION public.delete_student_account(p_student_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_auth_uid uuid;
BEGIN
  SELECT auth_user_id INTO v_auth_uid FROM students WHERE id = p_student_id;
  -- SECURITY FIX (2026-08-09): NULL-safe ownership guard (house pattern from
  -- 20260813000007). The previous guard `v_auth_uid IS NULL OR v_auth_uid !=
  -- auth.uid()` failed OPEN for an anonymous caller (auth.uid() NULL makes the
  -- inequality SQL NULL, and PL/pgSQL skips the THEN branch on NULL). This form
  -- denies any authenticated non-owner; anon is additionally closed by the
  -- REVOKE below; service-role callers (auth.uid() IS NULL) keep their escape.
  IF auth.uid() IS NOT NULL AND (v_auth_uid IS NULL OR v_auth_uid <> auth.uid()) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
  END IF;
  DELETE FROM question_responses WHERE student_id = p_student_id;
  DELETE FROM cognitive_session_metrics WHERE student_id = p_student_id;
  DELETE FROM bloom_progression WHERE student_id = p_student_id;
  DELETE FROM learning_velocity WHERE student_id = p_student_id;
  DELETE FROM knowledge_gaps WHERE student_id = p_student_id;
  DELETE FROM quiz_responses WHERE student_id = p_student_id;
  DELETE FROM quiz_sessions WHERE student_id = p_student_id;
  DELETE FROM study_plan_tasks WHERE student_id = p_student_id;
  DELETE FROM study_plans WHERE student_id = p_student_id;
  DELETE FROM spaced_repetition_cards WHERE student_id = p_student_id;
  DELETE FROM concept_mastery WHERE student_id = p_student_id;
  DELETE FROM topic_mastery WHERE student_id = p_student_id;
  DELETE FROM student_learning_profiles WHERE student_id = p_student_id;
  DELETE FROM daily_activity WHERE student_id = p_student_id;
  DELETE FROM chat_sessions WHERE student_id = p_student_id;
  DELETE FROM notifications WHERE recipient_id = p_student_id;
  DELETE FROM competition_participants WHERE student_id = p_student_id;
  DELETE FROM student_simulation_progress WHERE student_id = p_student_id;
  DELETE FROM class_students WHERE student_id = p_student_id;
  DELETE FROM guardian_student_links WHERE student_id = p_student_id;
  UPDATE students SET deleted_at = now(), is_active = false, account_status = 'deleted' WHERE id = p_student_id;
  RETURN jsonb_build_object('success', true);
END;
$function$;

REVOKE ALL   ON FUNCTION public.delete_student_account(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.delete_student_account(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.delete_student_account(uuid) IS
  'Authenticated student self-service account deletion (hard-deletes child rows, '
  'soft-deletes the students row). service_role + authenticated EXECUTE only after '
  '20260814000003; PUBLIC/anon revoked (the 20260515000002 named-role revoke was a '
  'no-op against the PUBLIC grant). NULL-safe ownership guard: an authenticated '
  'caller may only delete their own account.';

COMMIT;
