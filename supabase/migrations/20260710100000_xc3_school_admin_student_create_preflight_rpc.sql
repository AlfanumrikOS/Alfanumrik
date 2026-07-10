-- XC-3: move school-admin student-create email dedupe and legacy seat preflight
-- behind the caller's RLS/auth context instead of route-level service-role reads.

CREATE OR REPLACE FUNCTION public.school_admin_student_create_preflight(
  p_email text,
  p_attempted_count integer DEFAULT 1
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_school_id uuid;
  v_normalized_email text := lower(trim(coalesce(p_email, '')));
  v_attempted_count integer := greatest(coalesce(p_attempted_count, 1), 0);
  v_email_exists boolean := false;
  v_seats_used integer := 0;
  v_seats_purchased integer := null;
  v_seat_cap_violation boolean := false;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'status', 401,
      'error', 'Unauthorized'
    );
  END IF;

  SELECT sa.school_id
    INTO v_school_id
  FROM public.school_admins sa
  WHERE sa.auth_user_id = auth.uid()
  LIMIT 1;

  IF v_school_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'status', 403,
      'error', 'School admin account not found'
    );
  END IF;

  IF v_normalized_email <> '' THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.students s
      WHERE lower(s.email) = v_normalized_email
    )
      INTO v_email_exists;
  END IF;

  SELECT count(*)::integer
    INTO v_seats_used
  FROM public.students s
  WHERE s.school_id = v_school_id
    AND s.is_active = true;

  SELECT ss.seats_purchased
    INTO v_seats_purchased
  FROM public.school_subscriptions ss
  WHERE ss.school_id = v_school_id
  LIMIT 1;

  v_seat_cap_violation :=
    v_seats_purchased IS NOT NULL
    AND v_seats_used + v_attempted_count > v_seats_purchased;

  RETURN jsonb_build_object(
    'success', true,
    'data', jsonb_build_object(
      'emailExists', v_email_exists,
      'seatsUsed', v_seats_used,
      'seatsPurchased', v_seats_purchased,
      'seatCapViolation', v_seat_cap_violation
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.school_admin_student_create_preflight(text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.school_admin_student_create_preflight(text, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.school_admin_student_create_preflight(text, integer) TO authenticated;
