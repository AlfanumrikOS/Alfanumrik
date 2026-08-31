-- Fixes a live bug in the parent portal's "Remove Link" flow
-- (apps/host/src/app/parent/children/page.tsx, handleUnlinkConfirm):
-- the client called `supabase.from('guardian_student_links').update(...)`
-- directly with the browser (RLS-scoped) client. guardian_student_links has
-- no RLS UPDATE policy granting a guardian write access to their own link
-- rows (the only authenticated-role policies are STUDENT-owned, scoped to
-- `student_id = auth.uid()`). A Postgres UPDATE that matches zero rows is
-- NOT an error -- PostgREST returns 200 with an empty result -- so the UI
-- reported "unlinked" success while the link silently stayed active.
--
-- Fix follows the same shape as the existing parent_revoke_consent RPC
-- (20260710180000_xc3_parent_consent_rpcs.sql): a SECURITY DEFINER helper
-- that resolves the guardian via auth.uid(), re-verifies ownership
-- server-side (so it's safe to grant EXECUTE to authenticated broadly),
-- and returns an explicit success/error_code the caller can act on instead
-- of trusting a silent no-op.

CREATE OR REPLACE FUNCTION public.parent_revoke_guardian_link(
  p_student_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auth_user_id uuid := auth.uid();
  v_guardian_id uuid;
  v_link_id uuid;
BEGIN
  IF v_auth_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'unauthorized', 'error', 'Unauthorized');
  END IF;

  SELECT g.id
    INTO v_guardian_id
  FROM public.guardians g
  WHERE g.auth_user_id = v_auth_user_id
  LIMIT 1;

  IF v_guardian_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'no_guardian', 'error', 'Guardian account not found');
  END IF;

  UPDATE public.guardian_student_links gsl
     SET status = 'revoked',
         is_verified = false,
         revoked_at = now(),
         revoked_by = v_auth_user_id,
         updated_at = now()
   WHERE gsl.guardian_id = v_guardian_id
     AND gsl.student_id = p_student_id
     AND gsl.status IN ('active', 'approved', 'pending')
  RETURNING gsl.id INTO v_link_id;

  IF v_link_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'not_linked', 'error', 'Not linked to that student, or already unlinked');
  END IF;

  INSERT INTO public.audit_logs (
    auth_user_id,
    action,
    resource_type,
    resource_id,
    details,
    status
  )
  VALUES (
    v_auth_user_id,
    'parent.guardian_link_revoked',
    'guardian_student_links',
    v_link_id::text,
    jsonb_build_object(
      'actor_role', 'guardian',
      'student_id', p_student_id,
      'guardian_id', v_guardian_id
    ),
    'success'
  );

  RETURN jsonb_build_object('success', true, 'link_id', v_link_id);
END;
$$;

REVOKE ALL ON FUNCTION public.parent_revoke_guardian_link(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.parent_revoke_guardian_link(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.parent_revoke_guardian_link(uuid) TO authenticated;

COMMENT ON FUNCTION public.parent_revoke_guardian_link(uuid)
  IS 'Parent-portal "Remove Link" helper. Resolves guardian via auth.uid(), re-verifies ownership server-side, revokes the guardian_student_links row, and audit-logs the action. Returns an explicit success/error_code instead of the silent-no-op the prior direct-table-update path had.';

-- Self-verifying post-condition.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'parent_revoke_guardian_link'
  ) THEN
    RAISE EXCEPTION 'parent_revoke_guardian_link was not created';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.parent_revoke_guardian_link(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated cannot execute parent_revoke_guardian_link';
  END IF;
  IF has_function_privilege('anon', 'public.parent_revoke_guardian_link(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon must not be able to execute parent_revoke_guardian_link';
  END IF;
END
$$;
