-- XC-3 parent link-code OTP drain: move challenge/audit/link mutations out of
-- route-level service-role code and bind them to auth.uid().

CREATE OR REPLACE FUNCTION public.parent_link_code_otp_audit(
  p_event text,
  p_ip_address text,
  p_user_agent text,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.auth_audit_log (
    auth_user_id,
    event_type,
    ip_address,
    user_agent,
    metadata
  )
  VALUES (
    auth.uid(),
    p_event,
    p_ip_address,
    p_user_agent,
    COALESCE(p_metadata, '{}'::jsonb)
  );
EXCEPTION WHEN OTHERS THEN
  NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.parent_request_link_code_otp(
  p_link_code text,
  p_challenge_id uuid,
  p_otp_hash text,
  p_expires_at timestamptz,
  p_ip_address text DEFAULT NULL,
  p_user_agent text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code text;
  v_student_id uuid;
  v_student_name text;
  v_recent_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'unauthorized', 'error', 'Unauthorized');
  END IF;

  v_code := upper(trim(COALESCE(p_link_code, '')));
  IF v_code = '' THEN
    PERFORM public.parent_link_code_otp_audit(
      'link_code_otp_request_no_match',
      p_ip_address,
      p_user_agent,
      jsonb_build_object('link_code_prefix', '')
    );
    RETURN jsonb_build_object('success', true, 'should_send_email', false, 'outcome', 'no_match');
  END IF;

  SELECT s.id, s.name
    INTO v_student_id, v_student_name
  FROM public.students AS s
  WHERE (s.invite_code = v_code OR s.link_code = v_code)
    AND s.is_active = true
  LIMIT 1;

  IF v_student_id IS NULL THEN
    PERFORM public.parent_link_code_otp_audit(
      'link_code_otp_request_no_match',
      p_ip_address,
      p_user_agent,
      jsonb_build_object('link_code_prefix', left(v_code, 2))
    );
    RETURN jsonb_build_object('success', true, 'should_send_email', false, 'outcome', 'no_match');
  END IF;

  SELECT c.id
    INTO v_recent_id
  FROM public.link_code_otp_challenges AS c
  WHERE c.link_code = v_code
    AND c.auth_user_id = auth.uid()
    AND c.created_at >= now() - interval '60 seconds'
  ORDER BY c.created_at DESC
  LIMIT 1;

  IF v_recent_id IS NOT NULL THEN
    PERFORM public.parent_link_code_otp_audit(
      'link_code_otp_request_cooldown_skip',
      p_ip_address,
      p_user_agent,
      jsonb_build_object('challenge_id', v_recent_id)
    );
    RETURN jsonb_build_object(
      'success', true,
      'should_send_email', false,
      'outcome', 'cooldown',
      'challenge_id', v_recent_id,
      'student_name', v_student_name
    );
  END IF;

  INSERT INTO public.link_code_otp_challenges (
    id,
    link_code,
    auth_user_id,
    student_id,
    otp_hash,
    expires_at,
    attempt_count
  )
  VALUES (
    p_challenge_id,
    v_code,
    auth.uid(),
    v_student_id,
    p_otp_hash,
    p_expires_at,
    0
  );

  PERFORM public.parent_link_code_otp_audit(
    'link_code_otp_request_success',
    p_ip_address,
    p_user_agent,
    jsonb_build_object('challenge_id', p_challenge_id, 'student_id', v_student_id)
  );

  RETURN jsonb_build_object(
    'success', true,
    'should_send_email', true,
    'outcome', 'created',
    'challenge_id', p_challenge_id,
    'student_id', v_student_id,
    'student_name', v_student_name
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.parent_redeem_link_code_otp(
  p_link_code text,
  p_otp text,
  p_ip_address text DEFAULT NULL,
  p_user_agent text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code text;
  v_challenge record;
  v_expected_hash text;
  v_new_count integer;
  v_remaining integer;
  v_locked_until timestamptz;
  v_retry_after integer;
  v_guardian_id uuid;
  v_link_result jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'unauthorized', 'error', 'Unauthorized');
  END IF;

  v_code := upper(trim(COALESCE(p_link_code, '')));

  SELECT c.*
    INTO v_challenge
  FROM public.link_code_otp_challenges AS c
  WHERE c.link_code = v_code
    AND c.auth_user_id = auth.uid()
  ORDER BY c.created_at DESC
  LIMIT 1;

  IF v_challenge.id IS NULL THEN
    PERFORM public.parent_link_code_otp_audit(
      'link_code_otp_redeem_no_challenge',
      p_ip_address,
      p_user_agent,
      '{}'::jsonb
    );
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'no_challenge',
      'error', 'No active OTP. Request a new code.'
    );
  END IF;

  IF v_challenge.locked_until IS NOT NULL AND v_challenge.locked_until > now() THEN
    v_retry_after := greatest(1, ceil(extract(epoch from (v_challenge.locked_until - now())))::integer);
    PERFORM public.parent_link_code_otp_audit(
      'link_code_otp_redeem_locked',
      p_ip_address,
      p_user_agent,
      jsonb_build_object('challenge_id', v_challenge.id, 'locked_until', v_challenge.locked_until)
    );
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'locked',
      'error', 'Too many incorrect attempts. Try again later.',
      'locked_until', v_challenge.locked_until,
      'retry_after_seconds', v_retry_after
    );
  END IF;

  IF v_challenge.expires_at <= now() THEN
    PERFORM public.parent_link_code_otp_audit(
      'link_code_otp_redeem_expired',
      p_ip_address,
      p_user_agent,
      jsonb_build_object('challenge_id', v_challenge.id, 'expires_at', v_challenge.expires_at)
    );
    DELETE FROM public.link_code_otp_challenges WHERE id = v_challenge.id;
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'expired',
      'error', 'OTP has expired. Request a new code.'
    );
  END IF;

  v_expected_hash := encode(
    extensions.digest(COALESCE(p_otp, '') || '|' || v_challenge.id::text, 'sha256'),
    'hex'
  );

  IF v_expected_hash IS DISTINCT FROM v_challenge.otp_hash THEN
    v_new_count := COALESCE(v_challenge.attempt_count, 0) + 1;
    v_remaining := greatest(0, 5 - v_new_count);

    IF v_new_count >= 5 THEN
      v_locked_until := now() + interval '1 hour';
      UPDATE public.link_code_otp_challenges
         SET attempt_count = v_new_count,
             locked_until = v_locked_until
       WHERE id = v_challenge.id;

      v_retry_after := greatest(1, ceil(extract(epoch from (v_locked_until - now())))::integer);
      PERFORM public.parent_link_code_otp_audit(
        'link_code_otp_redeem_locked_now',
        p_ip_address,
        p_user_agent,
        jsonb_build_object(
          'challenge_id', v_challenge.id,
          'attempt_count', v_new_count,
          'remaining_attempts', v_remaining
        )
      );

      RETURN jsonb_build_object(
        'success', false,
        'error_code', 'locked',
        'error', 'Too many incorrect attempts. Try again later.',
        'locked_until', v_locked_until,
        'retry_after_seconds', v_retry_after
      );
    END IF;

    UPDATE public.link_code_otp_challenges
       SET attempt_count = v_new_count
     WHERE id = v_challenge.id;

    PERFORM public.parent_link_code_otp_audit(
      'link_code_otp_redeem_wrong',
      p_ip_address,
      p_user_agent,
      jsonb_build_object(
        'challenge_id', v_challenge.id,
        'attempt_count', v_new_count,
        'remaining_attempts', v_remaining
      )
    );

    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'wrong_otp',
      'error', 'Incorrect code.',
      'remaining_attempts', v_remaining
    );
  END IF;

  SELECT g.id
    INTO v_guardian_id
  FROM public.guardians AS g
  WHERE g.auth_user_id = auth.uid()
  LIMIT 1;

  IF v_guardian_id IS NULL THEN
    PERFORM public.parent_link_code_otp_audit(
      'link_code_otp_redeem_no_guardian_profile',
      p_ip_address,
      p_user_agent,
      jsonb_build_object('challenge_id', v_challenge.id)
    );
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'no_guardian',
      'error', 'No guardian profile. Complete signup first.'
    );
  END IF;

  v_link_result := public.link_guardian_to_student_via_code(v_guardian_id, v_code);

  IF v_link_result ? 'error' THEN
    PERFORM public.parent_link_code_otp_audit(
      'link_code_otp_redeem_rpc_rejected',
      p_ip_address,
      p_user_agent,
      jsonb_build_object('challenge_id', v_challenge.id, 'reason', v_link_result->>'error')
    );
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'domain_rejected',
      'error', v_link_result->>'error'
    );
  END IF;

  DELETE FROM public.link_code_otp_challenges WHERE id = v_challenge.id;

  PERFORM public.parent_link_code_otp_audit(
    'link_code_otp_redeem_success',
    p_ip_address,
    p_user_agent,
    jsonb_build_object('challenge_id', v_challenge.id, 'student_id', v_challenge.student_id)
  );

  RETURN jsonb_build_object(
    'success', true,
    'linked', true,
    'student_name', v_link_result->>'student_name',
    'student_grade', v_link_result->>'student_grade'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.parent_link_code_otp_audit(text, text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.parent_link_code_otp_audit(text, text, text, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.parent_link_code_otp_audit(text, text, text, jsonb) FROM authenticated;

REVOKE ALL ON FUNCTION public.parent_request_link_code_otp(text, uuid, text, timestamptz, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.parent_request_link_code_otp(text, uuid, text, timestamptz, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.parent_request_link_code_otp(text, uuid, text, timestamptz, text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.parent_redeem_link_code_otp(text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.parent_redeem_link_code_otp(text, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.parent_redeem_link_code_otp(text, text, text, text) TO authenticated;

COMMENT ON FUNCTION public.parent_request_link_code_otp(text, uuid, text, timestamptz, text, text)
  IS 'XC-3 scoped parent link-code OTP request helper. Resolves student/cooldown and inserts challenge under auth.uid().';

COMMENT ON FUNCTION public.parent_redeem_link_code_otp(text, text, text, text)
  IS 'XC-3 scoped parent link-code OTP redeem helper. Verifies OTP hash, locks attempts, links guardian, and burns challenge under auth.uid().';
