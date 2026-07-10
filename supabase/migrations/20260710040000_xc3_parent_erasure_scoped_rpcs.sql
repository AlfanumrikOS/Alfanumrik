-- XC-3 RCA-01: scoped authenticated helpers for parent erasure request/cancel.
-- The Next route keeps the app-layer permission gate plus audit/event/email side
-- effects; these functions move the DPDP-sensitive guardian ownership checks and
-- data_erasure_requests mutations out of route-level service-role table access.

CREATE OR REPLACE FUNCTION public.parent_request_child_erasure(
  p_student_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_guardian record;
  v_student record;
  v_existing record;
  v_inserted record;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'status', 401, 'error', 'Unauthorized');
  END IF;

  SELECT g.id, g.email
    INTO v_guardian
    FROM public.guardians g
   WHERE g.auth_user_id = auth.uid()
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'status', 403, 'error', 'Guardian account not found');
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.guardian_student_links gsl
     WHERE gsl.guardian_id = v_guardian.id
       AND gsl.student_id = p_student_id
       AND gsl.status IN ('approved', 'active')
  ) THEN
    RETURN jsonb_build_object('success', false, 'status', 403, 'error', 'Child not linked to your account');
  END IF;

  SELECT s.id, s.school_id, s.name
    INTO v_student
    FROM public.students s
   WHERE s.id = p_student_id
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'status', 404, 'error', 'Child not found');
  END IF;

  SELECT der.id, der.purge_at
    INTO v_existing
    FROM public.data_erasure_requests der
   WHERE der.guardian_id = v_guardian.id
     AND der.student_id = p_student_id
     AND der.status = 'pending'
   ORDER BY der.requested_at DESC
   LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'success', true,
      'data', jsonb_build_object(
        'requestId', v_existing.id,
        'purgeAt', v_existing.purge_at,
        'guardianId', v_guardian.id,
        'guardianEmail', v_guardian.email,
        'schoolId', v_student.school_id,
        'studentName', v_student.name,
        'alreadyPending', true,
        'created', false
      )
    );
  END IF;

  INSERT INTO public.data_erasure_requests (
    guardian_id,
    student_id,
    school_id,
    status,
    reason,
    requested_at,
    purge_at
  )
  VALUES (
    v_guardian.id,
    p_student_id,
    v_student.school_id,
    'pending',
    NULLIF(left(coalesce(p_reason, ''), 2000), ''),
    now(),
    now() + interval '7 days'
  )
  RETURNING id, purge_at INTO v_inserted;

  RETURN jsonb_build_object(
    'success', true,
    'data', jsonb_build_object(
      'requestId', v_inserted.id,
      'purgeAt', v_inserted.purge_at,
      'guardianId', v_guardian.id,
      'guardianEmail', v_guardian.email,
      'schoolId', v_student.school_id,
      'studentName', v_student.name,
      'alreadyPending', false,
      'created', true
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.parent_cancel_child_erasure(p_student_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_guardian record;
  v_row record;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'status', 401, 'error', 'Unauthorized');
  END IF;

  SELECT g.id
    INTO v_guardian
    FROM public.guardians g
   WHERE g.auth_user_id = auth.uid()
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'status', 403, 'error', 'Guardian account not found');
  END IF;

  SELECT der.id, der.status, der.requested_at, der.purge_at, der.school_id
    INTO v_row
    FROM public.data_erasure_requests der
   WHERE der.guardian_id = v_guardian.id
     AND der.student_id = p_student_id
     AND der.status IN ('pending', 'purging', 'completed', 'failed')
   ORDER BY der.requested_at DESC
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'status', 404, 'error', 'No erasure request found');
  END IF;

  IF v_row.status IN ('completed', 'failed', 'purging') THEN
    RETURN jsonb_build_object(
      'success', false,
      'status', 410,
      'error',
      CASE
        WHEN v_row.status IN ('completed', 'purging') THEN 'Erasure has already started and can no longer be cancelled'
        ELSE 'Request is already in terminal state: ' || v_row.status
      END,
      'data', jsonb_build_object('status', v_row.status)
    );
  END IF;

  IF v_row.purge_at <= now() THEN
    RETURN jsonb_build_object(
      'success', false,
      'status', 410,
      'error', 'Grace window has elapsed; erasure is in progress'
    );
  END IF;

  UPDATE public.data_erasure_requests
     SET status = 'cancelled',
         processed_at = now()
   WHERE id = v_row.id
     AND status = 'pending';

  RETURN jsonb_build_object(
    'success', true,
    'data', jsonb_build_object(
      'requestId', v_row.id,
      'guardianId', v_guardian.id,
      'schoolId', v_row.school_id,
      'requestedAt', v_row.requested_at,
      'status', 'cancelled'
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.parent_request_child_erasure(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.parent_request_child_erasure(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.parent_request_child_erasure(uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION public.parent_cancel_child_erasure(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.parent_cancel_child_erasure(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.parent_cancel_child_erasure(uuid) TO authenticated;

COMMENT ON FUNCTION public.parent_request_child_erasure(uuid, text) IS
  'XC-3 scoped authenticated helper for guardian-owned child erasure requests.';
COMMENT ON FUNCTION public.parent_cancel_child_erasure(uuid) IS
  'XC-3 scoped authenticated helper for cancelling guardian-owned child erasure requests during the grace window.';
