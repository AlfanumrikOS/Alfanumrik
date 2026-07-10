-- XC-3: extend school-admin student-create preflight to validate optional
-- class_id under the caller's auth.uid() school-admin membership before Auth
-- Admin user creation. This prevents orphan auth users on cross-tenant class
-- attempts while keeping the route off service-role class reads.

CREATE OR REPLACE FUNCTION public.school_admin_student_create_preflight(
  p_email text,
  p_attempted_count integer DEFAULT 1,
  p_class_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_school_id uuid;
  v_class_school_id uuid;
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

  IF p_class_id IS NOT NULL THEN
    SELECT c.school_id
      INTO v_class_school_id
    FROM public.classes c
    WHERE c.id = p_class_id
    LIMIT 1;

    IF v_class_school_id IS DISTINCT FROM v_school_id THEN
      RETURN jsonb_build_object(
        'success', false,
        'status', 403,
        'error', 'class_id does not belong to your school'
      );
    END IF;
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

REVOKE ALL ON FUNCTION public.school_admin_student_create_preflight(text, integer, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.school_admin_student_create_preflight(text, integer, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.school_admin_student_create_preflight(text, integer, uuid) TO authenticated;

COMMENT ON FUNCTION public.school_admin_student_create_preflight(text, integer, uuid) IS
  'XC-3 scoped school-admin student create preflight. Resolves caller school from auth.uid(), checks email/legacy seat status, and validates optional class_id before Auth Admin user creation.';
