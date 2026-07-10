-- XC-3 parent approve-link drain: move student link review out of route-level
-- service-role code and anchor ownership to the authenticated database subject.

CREATE OR REPLACE FUNCTION public.student_review_guardian_link(
  p_link_id uuid,
  p_action text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_student_id uuid;
  v_status text;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'unauthorized',
      'error', 'Unauthorized'
    );
  END IF;

  IF p_action NOT IN ('approved', 'rejected') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'invalid_action',
      'error', 'Action must be approved or rejected'
    );
  END IF;

  SELECT s.id
    INTO v_student_id
  FROM public.students AS s
  WHERE s.auth_user_id = auth.uid()
  LIMIT 1;

  IF v_student_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'no_student',
      'error', 'Student profile not found'
    );
  END IF;

  UPDATE public.guardian_student_links AS gsl
     SET status = p_action,
         is_verified = (p_action = 'approved'),
         approved_by = CASE WHEN p_action = 'approved' THEN auth.uid() ELSE NULL END,
         approved_at = CASE WHEN p_action = 'approved' THEN now() ELSE NULL END,
         rejected_reason = CASE
           WHEN p_action = 'rejected' THEN COALESCE(gsl.rejected_reason, 'Declined by student')
           ELSE NULL
         END,
         updated_at = now()
   WHERE gsl.id = p_link_id
     AND gsl.student_id = v_student_id
     AND gsl.status = 'pending'
  RETURNING gsl.status INTO v_status;

  IF v_status IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'not_found',
      'error', 'No pending request found'
    );
  END IF;

  INSERT INTO public.admin_audit_log (action, entity_type, entity_id, details)
  VALUES (
    'guardian_link_' || p_action,
    'guardian_student_link',
    p_link_id::text,
    jsonb_build_object('reviewed_by_auth_user_id', auth.uid(), 'action', p_action)
  );

  RETURN jsonb_build_object('success', true, 'status', v_status);
END;
$$;

REVOKE ALL ON FUNCTION public.student_review_guardian_link(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.student_review_guardian_link(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.student_review_guardian_link(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.student_review_guardian_link(uuid, text)
  IS 'XC-3 scoped student guardian-link review. Resolves student ownership from auth.uid() before mutating pending guardian_student_links.';
