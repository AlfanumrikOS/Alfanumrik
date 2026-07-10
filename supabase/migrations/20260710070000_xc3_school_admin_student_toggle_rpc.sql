-- XC-3: move school-admin roster active/inactive toggles behind an
-- authenticated helper. POST student creation still needs Auth Admin, so the
-- route remains a partial service-role migration.

CREATE OR REPLACE FUNCTION public.school_admin_toggle_student_active(
  p_student_id uuid,
  p_is_active boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_school_id uuid;
  v_existing record;
  v_active_count integer := 0;
  v_seats_purchased integer;
  v_updated record;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'status', 401, 'error', 'Authentication required');
  END IF;

  SELECT sa.school_id
    INTO v_school_id
  FROM public.school_admins sa
  JOIN public.schools sc
    ON sc.id = sa.school_id
   AND sc.is_active = true
  WHERE sa.auth_user_id = auth.uid()
    AND sa.is_active = true
  LIMIT 1;

  IF v_school_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'status', 403, 'error', 'Not an active school administrator');
  END IF;

  SELECT s.id, s.is_active
    INTO v_existing
  FROM public.students s
  WHERE s.id = p_student_id
    AND s.school_id = v_school_id
  FOR UPDATE;

  IF v_existing.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'status', 404, 'error', 'Student not found');
  END IF;

  IF p_is_active = true AND COALESCE(v_existing.is_active, false) <> true THEN
    SELECT COUNT(*)
      INTO v_active_count
    FROM public.students s
    WHERE s.school_id = v_school_id
      AND s.is_active = true;

    SELECT ss.seats_purchased
      INTO v_seats_purchased
    FROM public.school_subscriptions ss
    WHERE ss.school_id = v_school_id
    ORDER BY
      CASE WHEN ss.status IN ('active', 'trial') THEN 0 ELSE 1 END,
      ss.created_at DESC NULLS LAST
    LIMIT 1;

    IF v_seats_purchased IS NOT NULL AND v_active_count + 1 > v_seats_purchased THEN
      RETURN jsonb_build_object(
        'success', false,
        'status', 422,
        'code', 'seat_cap_violation',
        'error', format(
          'Cannot activate this student. Your school has used %s of %s seats. Upgrade your subscription to add more.',
          v_active_count,
          v_seats_purchased
        ),
        'seats_used', v_active_count,
        'seats_purchased', v_seats_purchased
      );
    END IF;
  END IF;

  UPDATE public.students
     SET is_active = p_is_active
   WHERE id = p_student_id
     AND school_id = v_school_id
   RETURNING id, name, email, grade, is_active
    INTO v_updated;

  RETURN jsonb_build_object(
    'success', true,
    'was_active', COALESCE(v_existing.is_active, false),
    'data', jsonb_build_object(
      'id', v_updated.id,
      'name', v_updated.name,
      'email', v_updated.email,
      'grade', v_updated.grade,
      'is_active', v_updated.is_active
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.school_admin_toggle_student_active(uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.school_admin_toggle_student_active(uuid, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.school_admin_toggle_student_active(uuid, boolean) TO authenticated;

COMMENT ON FUNCTION public.school_admin_toggle_student_active(uuid, boolean)
  IS 'XC-3 scoped school-admin student active toggle. Resolves active school_admins membership from auth.uid(), enforces same-school ownership, and applies legacy activation seat-cap checks before updating students.is_active.';
