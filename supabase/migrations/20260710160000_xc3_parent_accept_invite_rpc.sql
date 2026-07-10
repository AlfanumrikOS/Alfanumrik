-- XC-3 parent accept-invite drain: remove route-level service-role reads/writes
-- from /api/parent/accept-invite and bind invite redemption to auth.uid().

CREATE OR REPLACE FUNCTION public.parent_accept_invite_code(
  p_invite_code text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code text;
  v_guardian_id uuid;
  v_student_id uuid;
  v_student_name text;
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'unauthorized',
      'error', 'Unauthorized'
    );
  END IF;

  v_code := upper(trim(COALESCE(p_invite_code, '')));
  IF v_code = '' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'invalid_or_expired',
      'error', 'Invalid or expired invite code'
    );
  END IF;

  SELECT g.id
    INTO v_guardian_id
  FROM public.guardians AS g
  WHERE g.auth_user_id = auth.uid()
  LIMIT 1;

  IF v_guardian_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'no_guardian',
      'error', 'Guardian profile not found. Please complete registration first.'
    );
  END IF;

  v_result := public.link_guardian_via_invite_code(auth.uid(), v_code);

  IF COALESCE((v_result->>'success')::boolean, false) IS NOT TRUE THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'invalid_or_expired',
      'error', COALESCE(v_result->>'error', 'Invalid or expired invite code')
    );
  END IF;

  SELECT s.id, s.name
    INTO v_student_id, v_student_name
  FROM public.students AS s
  WHERE (s.invite_code = v_code OR s.link_code = v_code)
    AND s.is_active = true
  LIMIT 1;

  IF v_student_id IS NOT NULL THEN
    UPDATE public.guardian_student_links AS gsl
       SET status = 'approved',
           updated_at = now()
     WHERE gsl.student_id = v_student_id
       AND gsl.guardian_id IS NULL
       AND gsl.status = 'pending';
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'link_id', v_result->>'link_id',
    'status', COALESCE(v_result->>'status', 'approved'),
    'student_name', v_student_name
  );
END;
$$;

REVOKE ALL ON FUNCTION public.parent_accept_invite_code(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.parent_accept_invite_code(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.parent_accept_invite_code(text) TO authenticated;

COMMENT ON FUNCTION public.parent_accept_invite_code(text)
  IS 'XC-3 scoped parent invite acceptance. Uses auth.uid() to redeem a child invite and retire the pending placeholder row.';
