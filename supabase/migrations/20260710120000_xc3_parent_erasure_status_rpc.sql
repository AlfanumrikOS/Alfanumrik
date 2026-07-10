-- XC-3 RCA-01: scoped authenticated helper for parent erasure status reads.
-- Moves the DPDP-sensitive guardian/link/status lookup out of route-level
-- service-role access while preserving the existing response contract.

CREATE OR REPLACE FUNCTION public.parent_child_erasure_status(p_student_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_guardian record;
  v_request record;
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

  IF NOT EXISTS (
    SELECT 1
      FROM public.guardian_student_links gsl
     WHERE gsl.guardian_id = v_guardian.id
       AND gsl.student_id = p_student_id
       AND gsl.status IN ('approved', 'active')
  ) THEN
    RETURN jsonb_build_object('success', false, 'status', 403, 'error', 'Child not linked to your account');
  END IF;

  SELECT
      der.id,
      der.status,
      der.requested_at,
      der.purge_at,
      der.processed_at,
      der.reason,
      der.error_message
    INTO v_request
    FROM public.data_erasure_requests der
   WHERE der.guardian_id = v_guardian.id
     AND der.student_id = p_student_id
   ORDER BY der.requested_at DESC
   LIMIT 1;

  RETURN jsonb_build_object(
    'success', true,
    'data', jsonb_build_object(
      'request',
      CASE
        WHEN v_request.id IS NULL THEN NULL
        ELSE jsonb_build_object(
          'id', v_request.id,
          'status', v_request.status,
          'requested_at', v_request.requested_at,
          'purge_at', v_request.purge_at,
          'processed_at', v_request.processed_at,
          'reason', v_request.reason,
          'error_message', v_request.error_message
        )
      END
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.parent_child_erasure_status(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.parent_child_erasure_status(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.parent_child_erasure_status(uuid) TO authenticated;

COMMENT ON FUNCTION public.parent_child_erasure_status(uuid) IS
  'XC-3 scoped authenticated helper for guardian-owned child erasure status reads.';
