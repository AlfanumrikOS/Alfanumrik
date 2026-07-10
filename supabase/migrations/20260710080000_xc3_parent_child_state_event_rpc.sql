-- XC-3: scoped authenticated publisher for parent child-data state events.
-- This preserves the bus flag gate and state_events idempotency while removing
-- route-level service-role usage from parent export and erasure request/cancel.

CREATE OR REPLACE FUNCTION public.parent_publish_child_state_event(
  p_kind text,
  p_student_id uuid,
  p_event_id uuid,
  p_occurred_at timestamptz,
  p_actor_auth_user_id uuid,
  p_tenant_id uuid,
  p_idempotency_key text,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_guardian_id uuid;
  v_school_id uuid;
  v_bus_enabled boolean := false;
  v_inserted boolean := false;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('published', false, 'reason', 'unauthorized');
  END IF;

  IF p_actor_auth_user_id IS DISTINCT FROM auth.uid() THEN
    RETURN jsonb_build_object('published', false, 'reason', 'actor_mismatch');
  END IF;

  IF p_kind NOT IN (
    'parent.child_data_exported',
    'parent.child_erasure_requested',
    'parent.child_erasure_cancelled'
  ) THEN
    RETURN jsonb_build_object('published', false, 'reason', 'invalid_kind');
  END IF;

  SELECT g.id, s.school_id
    INTO v_guardian_id, v_school_id
    FROM public.guardians g
    JOIN public.guardian_student_links gsl
      ON gsl.guardian_id = g.id
     AND gsl.student_id = p_student_id
     AND gsl.status IN ('approved', 'active')
    JOIN public.students s
      ON s.id = p_student_id
   WHERE g.auth_user_id = auth.uid()
   LIMIT 1;

  IF v_guardian_id IS NULL THEN
    RETURN jsonb_build_object('published', false, 'reason', 'not_linked');
  END IF;

  IF p_tenant_id IS DISTINCT FROM v_school_id THEN
    RETURN jsonb_build_object('published', false, 'reason', 'tenant_mismatch');
  END IF;

  SELECT COALESCE(ff.is_enabled, false)
    INTO v_bus_enabled
    FROM public.feature_flags ff
   WHERE ff.flag_name = 'ff_event_bus_v1'
   LIMIT 1;

  IF NOT COALESCE(v_bus_enabled, false) THEN
    RETURN jsonb_build_object('published', false, 'reason', 'flag_off');
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
    p_event_id,
    p_kind,
    p_actor_auth_user_id,
    p_tenant_id,
    p_idempotency_key,
    p_occurred_at,
    COALESCE(p_payload, '{}'::jsonb)
  )
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING true INTO v_inserted;

  IF COALESCE(v_inserted, false) THEN
    RETURN jsonb_build_object('published', true);
  END IF;

  RETURN jsonb_build_object('published', true, 'reason', 'duplicate');
END;
$$;

REVOKE ALL ON FUNCTION public.parent_publish_child_state_event(text, uuid, uuid, timestamptz, uuid, uuid, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.parent_publish_child_state_event(text, uuid, uuid, timestamptz, uuid, uuid, text, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.parent_publish_child_state_event(text, uuid, uuid, timestamptz, uuid, uuid, text, jsonb) TO authenticated;

COMMENT ON FUNCTION public.parent_publish_child_state_event(text, uuid, uuid, timestamptz, uuid, uuid, text, jsonb) IS
  'XC-3 scoped parent child-data state-event publisher. Validates auth.uid() guardian ownership, event kind, tenant binding, and ff_event_bus_v1 before inserting into state_events.';
