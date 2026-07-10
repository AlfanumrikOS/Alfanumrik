-- XC-3 parent consent drain: move DPDP consent mutations/list reads out of
-- the route-level service-role client and behind auth.uid()-anchored helpers.

CREATE OR REPLACE FUNCTION public.parent_record_consent(
  p_student_id uuid,
  p_consent_version text,
  p_scopes jsonb,
  p_locale text DEFAULT 'en',
  p_ip_address text DEFAULT NULL,
  p_user_agent text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auth_user_id uuid := auth.uid();
  v_guardian_id uuid;
  v_consent_id uuid;
  v_allowed_scopes text[] := ARRAY[
    'curriculum_access',
    'performance_data_sharing_with_teacher',
    'marketing_emails'
  ];
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

  IF p_consent_version IS NULL OR btrim(p_consent_version) = '' THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'invalid_input', 'error', 'consentVersion is required');
  END IF;

  IF p_locale NOT IN ('en', 'hi') THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'invalid_input', 'error', 'Invalid locale');
  END IF;

  IF COALESCE((p_scopes ->> 'curriculum_access')::boolean, false) IS DISTINCT FROM true THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'invalid_input', 'error', 'curriculum_access scope is required to proceed');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_object_keys(COALESCE(p_scopes, '{}'::jsonb)) AS scope_key
    WHERE NOT (scope_key = ANY(v_allowed_scopes))
  ) THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'invalid_input', 'error', 'Unknown consent scope');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.guardian_student_links gsl
    WHERE gsl.guardian_id = v_guardian_id
      AND gsl.student_id = p_student_id
      AND gsl.status IN ('active', 'approved')
    LIMIT 1
  ) THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'not_linked', 'error', 'Not linked to that student');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.parental_consent pc
    WHERE pc.guardian_id = v_guardian_id
      AND pc.student_id = p_student_id
      AND pc.revoked_at IS NULL
    LIMIT 1
  ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'conflict',
      'error', 'Active consent already exists for this guardian/student pair'
    );
  END IF;

  INSERT INTO public.parental_consent (
    guardian_id,
    student_id,
    consent_version,
    consent_payload,
    ip_address,
    user_agent
  )
  VALUES (
    v_guardian_id,
    p_student_id,
    btrim(p_consent_version),
    jsonb_build_object('scopes', COALESCE(p_scopes, '{}'::jsonb), 'locale', COALESCE(p_locale, 'en')),
    NULLIF(p_ip_address, '')::inet,
    p_user_agent
  )
  RETURNING id INTO v_consent_id;

  INSERT INTO public.state_events (
    event_id,
    kind,
    actor_auth_user_id,
    tenant_id,
    idempotency_key,
    occurred_at,
    payload
  )
  VALUES (
    gen_random_uuid(),
    'parent.consent_granted',
    v_auth_user_id,
    NULL,
    'consent_granted:' || v_consent_id::text,
    now(),
    jsonb_build_object(
      'consentId', v_consent_id,
      'guardianId', v_guardian_id,
      'studentId', p_student_id,
      'consentVersion', btrim(p_consent_version),
      'scopes', COALESCE(p_scopes, '{}'::jsonb),
      'locale', COALESCE(p_locale, 'en')
    )
  )
  ON CONFLICT (idempotency_key) DO NOTHING;

  INSERT INTO public.audit_logs (
    auth_user_id,
    action,
    resource_type,
    resource_id,
    details,
    ip_address,
    user_agent,
    status
  )
  VALUES (
    v_auth_user_id,
    'parent.consent.granted',
    'parental_consent',
    v_consent_id::text,
    jsonb_build_object(
      'actor_role', 'guardian',
      'student_id', p_student_id,
      'guardian_id', v_guardian_id,
      'consent_version', btrim(p_consent_version),
      'scopes', COALESCE(p_scopes, '{}'::jsonb)
    ),
    NULLIF(p_ip_address, '')::inet,
    p_user_agent,
    'success'
  );

  RETURN jsonb_build_object(
    'success', true,
    'consent_id', v_consent_id,
    'consent_version', btrim(p_consent_version)
  );
EXCEPTION
  WHEN invalid_text_representation THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'invalid_input', 'error', 'Invalid IP address');
  WHEN unique_violation THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'conflict',
      'error', 'Active consent already exists for this guardian/student pair'
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.parent_revoke_consent(
  p_student_id uuid,
  p_ip_address text DEFAULT NULL,
  p_user_agent text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auth_user_id uuid := auth.uid();
  v_guardian_id uuid;
  v_consent_id uuid;
  v_consent_version text;
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

  IF NOT EXISTS (
    SELECT 1
    FROM public.guardian_student_links gsl
    WHERE gsl.guardian_id = v_guardian_id
      AND gsl.student_id = p_student_id
      AND gsl.status IN ('active', 'approved')
    LIMIT 1
  ) THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'not_linked', 'error', 'Not linked to that student');
  END IF;

  UPDATE public.parental_consent pc
     SET revoked_at = now()
   WHERE pc.guardian_id = v_guardian_id
     AND pc.student_id = p_student_id
     AND pc.revoked_at IS NULL
  RETURNING pc.id, pc.consent_version INTO v_consent_id, v_consent_version;

  IF v_consent_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'not_found', 'error', 'No active consent to revoke');
  END IF;

  INSERT INTO public.state_events (
    event_id,
    kind,
    actor_auth_user_id,
    tenant_id,
    idempotency_key,
    occurred_at,
    payload
  )
  VALUES (
    gen_random_uuid(),
    'parent.consent_revoked',
    v_auth_user_id,
    NULL,
    'consent_revoked:' || v_consent_id::text,
    now(),
    jsonb_build_object(
      'consentId', v_consent_id,
      'guardianId', v_guardian_id,
      'studentId', p_student_id,
      'consentVersion', v_consent_version
    )
  )
  ON CONFLICT (idempotency_key) DO NOTHING;

  INSERT INTO public.audit_logs (
    auth_user_id,
    action,
    resource_type,
    resource_id,
    details,
    ip_address,
    user_agent,
    status
  )
  VALUES (
    v_auth_user_id,
    'parent.consent.revoked',
    'parental_consent',
    v_consent_id::text,
    jsonb_build_object(
      'actor_role', 'guardian',
      'student_id', p_student_id,
      'guardian_id', v_guardian_id,
      'consent_version', v_consent_version
    ),
    NULLIF(p_ip_address, '')::inet,
    p_user_agent,
    'success'
  );

  RETURN jsonb_build_object(
    'success', true,
    'consent_id', v_consent_id,
    'consent_version', v_consent_version
  );
EXCEPTION
  WHEN invalid_text_representation THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'invalid_input', 'error', 'Invalid IP address');
END;
$$;

CREATE OR REPLACE FUNCTION public.parent_list_active_consents()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auth_user_id uuid := auth.uid();
  v_guardian_id uuid;
  v_items jsonb;
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

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', pc.id,
        'guardianId', pc.guardian_id,
        'studentId', pc.student_id,
        'consentVersion', pc.consent_version,
        'grantedAt', pc.granted_at,
        'revokedAt', pc.revoked_at,
        'payload', COALESCE(pc.consent_payload, jsonb_build_object('scopes', '{}'::jsonb, 'locale', 'en'))
      )
      ORDER BY pc.granted_at DESC
    ),
    '[]'::jsonb
  )
    INTO v_items
  FROM public.parental_consent pc
  WHERE pc.guardian_id = v_guardian_id
    AND pc.revoked_at IS NULL;

  RETURN jsonb_build_object('success', true, 'items', v_items);
END;
$$;

REVOKE ALL ON FUNCTION public.parent_record_consent(uuid, text, jsonb, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.parent_record_consent(uuid, text, jsonb, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.parent_record_consent(uuid, text, jsonb, text, text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.parent_revoke_consent(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.parent_revoke_consent(uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.parent_revoke_consent(uuid, text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.parent_list_active_consents() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.parent_list_active_consents() FROM anon;
GRANT EXECUTE ON FUNCTION public.parent_list_active_consents() TO authenticated;

COMMENT ON FUNCTION public.parent_record_consent(uuid, text, jsonb, text, text, text)
  IS 'XC-3 scoped parent consent grant helper. Resolves guardian via auth.uid(), enforces active guardian_student_links ownership, inserts parental_consent, state_events, and audit_logs rows.';

COMMENT ON FUNCTION public.parent_revoke_consent(uuid, text, text)
  IS 'XC-3 scoped parent consent revoke helper. Resolves guardian via auth.uid(), enforces active guardian_student_links ownership, soft-revokes consent, and writes state/audit rows.';

COMMENT ON FUNCTION public.parent_list_active_consents()
  IS 'XC-3 scoped parent consent list helper. Resolves guardian via auth.uid() and returns active consent rows for that guardian only.';
