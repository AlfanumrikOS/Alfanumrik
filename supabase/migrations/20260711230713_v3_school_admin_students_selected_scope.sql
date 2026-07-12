-- One Experience V3: make every school-admin student roster helper honor the
-- server-authorized school selected by a multi-school administrator.
--
-- The new overloads require p_school_id and independently verify that it is an
-- active membership of auth.uid(). This migration is intentionally additive:
-- every legacy signature and grant remains byte-for-byte owned by its original
-- migration so the currently deployed application remains rollback-compatible.
-- Legacy wrapper hardening is a later migration, after all callers use the
-- explicit selected-school overloads and the deployment has been observed.

BEGIN;

-- Internal defense-in-depth permission resolver for the SECURITY DEFINER
-- overloads below. It is never callable by API roles. Deployments that have
-- the tenant-scoped get_user_permissions(uuid, uuid) overload use it; baseline
-- deployments with only the baseline one-argument resolver use its global
-- permission set plus the selected school_admins.role matrix. Resolver errors
-- and unknown permission codes deny access.
CREATE OR REPLACE FUNCTION public.school_admin_has_selected_permission(
  p_school_id uuid,
  p_permission_code text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_permissions jsonb;
BEGIN
  IF auth.uid() IS NULL OR p_school_id IS NULL OR NULLIF(BTRIM(p_permission_code), '') IS NULL THEN
    RETURN false;
  END IF;

  IF to_regprocedure('public.get_user_permissions(uuid,uuid)') IS NOT NULL THEN
    BEGIN
      EXECUTE 'SELECT public.get_user_permissions($1, $2)'
        INTO v_permissions
        USING auth.uid(), p_school_id;
    EXCEPTION WHEN OTHERS THEN
      RETURN false;
    END;
  ELSIF to_regprocedure('public.get_user_permissions(uuid)') IS NOT NULL THEN
    BEGIN
      EXECUTE 'SELECT public.get_user_permissions($1)'
        INTO v_permissions
        USING auth.uid();
    EXCEPTION WHEN OTHERS THEN
      RETURN false;
    END;
  ELSE
    RETURN false;
  END IF;

  IF NOT (COALESCE(v_permissions->'permissions', '[]'::jsonb) ? p_permission_code) THEN
    RETURN false;
  END IF;

  -- Every supported school-admin role is allowed to manage students in the
  -- approved matrix. Unknown/legacy roles fail closed. Keeping this explicit
  -- is essential on baseline schemas where user_roles cannot be school-scoped.
  IF p_permission_code = 'institution.manage_students' THEN
    RETURN EXISTS (
      SELECT 1
      FROM public.school_admins sa
      JOIN public.schools sc ON sc.id = sa.school_id AND sc.is_active = true
      WHERE sa.auth_user_id = auth.uid()
        AND sa.school_id = p_school_id
        AND sa.is_active = true
        AND sa.role IN ('principal', 'vice_principal', 'academic_coordinator', 'institution_admin')
    );
  END IF;

  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.school_admin_has_selected_permission(uuid, text) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.school_admin_list_students(
  p_school_id uuid,
  p_page integer DEFAULT 1,
  p_limit integer DEFAULT 20,
  p_grade text DEFAULT NULL,
  p_search text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_page integer := GREATEST(1, COALESCE(p_page, 1));
  v_limit integer := LEAST(100, GREATEST(1, COALESCE(p_limit, 20)));
  v_offset integer;
  v_grade text := NULLIF(BTRIM(COALESCE(p_grade, '')), '');
  v_search text := NULLIF(BTRIM(COALESCE(p_search, '')), '');
  v_total integer := 0;
  v_rows jsonb := '[]'::jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'status', 401, 'error', 'Authentication required');
  END IF;

  IF p_school_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.school_admins sa
    JOIN public.schools sc ON sc.id = sa.school_id AND sc.is_active = true
    WHERE sa.auth_user_id = auth.uid()
      AND sa.school_id = p_school_id
      AND sa.is_active = true
  ) THEN
    RETURN jsonb_build_object('success', false, 'status', 403, 'error', 'Not an active administrator of the selected school');
  END IF;

  IF NOT public.school_admin_has_selected_permission(p_school_id, 'institution.manage_students') THEN
    RETURN jsonb_build_object('success', false, 'status', 403, 'error', 'Missing permission for the selected school');
  END IF;

  IF v_grade IS NOT NULL AND v_grade NOT IN ('6', '7', '8', '9', '10', '11', '12') THEN
    RETURN jsonb_build_object('success', false, 'status', 400, 'error', 'Invalid grade filter');
  END IF;

  v_offset := (v_page - 1) * v_limit;

  SELECT COUNT(*)
  INTO v_total
  FROM public.students s
  WHERE s.school_id = p_school_id
    AND (v_grade IS NULL OR s.grade = v_grade)
    AND (v_search IS NULL OR s.name ILIKE '%' || v_search || '%');

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', page_rows.id,
        'name', page_rows.name,
        'email', page_rows.email,
        'grade', page_rows.grade,
        'is_active', page_rows.is_active,
        'xp_total', page_rows.xp_total,
        'last_active', page_rows.last_active,
        'subscription_plan', page_rows.subscription_plan,
        'created_at', page_rows.created_at
      ) ORDER BY page_rows.created_at DESC
    ),
    '[]'::jsonb
  )
  INTO v_rows
  FROM (
    SELECT s.id, s.name, s.email, s.grade, s.is_active, s.xp_total,
           s.last_active, s.subscription_plan, s.created_at
    FROM public.students s
    WHERE s.school_id = p_school_id
      AND (v_grade IS NULL OR s.grade = v_grade)
      AND (v_search IS NULL OR s.name ILIKE '%' || v_search || '%')
    ORDER BY s.created_at DESC
    LIMIT v_limit
    OFFSET v_offset
  ) page_rows;

  RETURN jsonb_build_object(
    'success', true,
    'data', v_rows,
    'pagination', jsonb_build_object(
      'page', v_page,
      'limit', v_limit,
      'total', v_total,
      'totalPages', CEIL(v_total::numeric / v_limit)::integer
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.school_admin_toggle_student_active(
  p_school_id uuid,
  p_student_id uuid,
  p_is_active boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing record;
  v_active_count integer := 0;
  v_seats_purchased integer;
  v_updated record;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'status', 401, 'error', 'Authentication required');
  END IF;

  IF p_school_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.school_admins sa
    JOIN public.schools sc ON sc.id = sa.school_id AND sc.is_active = true
    WHERE sa.auth_user_id = auth.uid()
      AND sa.school_id = p_school_id
      AND sa.is_active = true
  ) THEN
    RETURN jsonb_build_object('success', false, 'status', 403, 'error', 'Not an active administrator of the selected school');
  END IF;

  IF NOT public.school_admin_has_selected_permission(p_school_id, 'institution.manage_students') THEN
    RETURN jsonb_build_object('success', false, 'status', 403, 'error', 'Missing permission for the selected school');
  END IF;

  -- Join the established per-school seat lock before taking a student row lock.
  -- Every seat-mutating path must use advisory lock -> row/count/update ordering
  -- so concurrent activation and enrollment cannot over-allocate or deadlock.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('school_seat:' || p_school_id::text, 0)
  );

  SELECT s.id, s.is_active
  INTO v_existing
  FROM public.students s
  WHERE s.id = p_student_id AND s.school_id = p_school_id
  FOR UPDATE;

  IF v_existing.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'status', 404, 'error', 'Student not found');
  END IF;

  IF p_is_active = true AND COALESCE(v_existing.is_active, false) <> true THEN
    SELECT COUNT(*) INTO v_active_count
    FROM public.students s
    WHERE s.school_id = p_school_id AND s.is_active = true;

    SELECT ss.seats_purchased INTO v_seats_purchased
    FROM public.school_subscriptions ss
    WHERE ss.school_id = p_school_id
    ORDER BY CASE WHEN ss.status IN ('active', 'trial') THEN 0 ELSE 1 END,
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
  WHERE id = p_student_id AND school_id = p_school_id
  RETURNING id, name, email, grade, is_active INTO v_updated;

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

CREATE OR REPLACE FUNCTION public.school_admin_attach_created_student(
  p_school_id uuid,
  p_student_auth_user_id uuid,
  p_phone text DEFAULT NULL,
  p_class_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_student_id uuid;
  v_class_school_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'status', 401, 'error', 'Unauthorized');
  END IF;

  IF p_school_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.school_admins sa
    JOIN public.schools sc ON sc.id = sa.school_id AND sc.is_active = true
    WHERE sa.auth_user_id = auth.uid()
      AND sa.school_id = p_school_id
      AND sa.is_active = true
  ) THEN
    RETURN jsonb_build_object('success', false, 'status', 403, 'error', 'Not an active administrator of the selected school');
  END IF;

  IF NOT public.school_admin_has_selected_permission(p_school_id, 'institution.manage_students') THEN
    RETURN jsonb_build_object('success', false, 'status', 403, 'error', 'Missing permission for the selected school');
  END IF;

  IF p_class_id IS NOT NULL THEN
    SELECT c.school_id INTO v_class_school_id
    FROM public.classes c
    WHERE c.id = p_class_id
    LIMIT 1;

    IF v_class_school_id IS DISTINCT FROM p_school_id THEN
      RETURN jsonb_build_object('success', false, 'status', 403, 'error', 'class_id does not belong to the selected school');
    END IF;
  END IF;

  UPDATE public.students
  SET school_id = p_school_id,
      phone = CASE WHEN NULLIF(p_phone, '') IS NULL THEN phone ELSE left(p_phone, 64) END
  WHERE auth_user_id = p_student_auth_user_id
    AND (school_id IS NULL OR school_id = p_school_id)
  RETURNING id INTO v_student_id;

  IF v_student_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'status', 404, 'error', 'Student row not found');
  END IF;

  IF p_class_id IS NOT NULL THEN
    INSERT INTO public.class_students (class_id, student_id)
    VALUES (p_class_id, v_student_id)
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN jsonb_build_object('success', true, 'data', jsonb_build_object('studentId', v_student_id));
END;
$$;

CREATE OR REPLACE FUNCTION public.school_admin_student_create_preflight(
  p_school_id uuid,
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
  v_class_school_id uuid;
  v_normalized_email text := lower(trim(coalesce(p_email, '')));
  v_attempted_count integer := greatest(coalesce(p_attempted_count, 1), 0);
  v_email_exists boolean := false;
  v_seats_used integer := 0;
  v_seats_purchased integer := null;
  v_seat_cap_violation boolean := false;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'status', 401, 'error', 'Unauthorized');
  END IF;

  IF p_school_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.school_admins sa
    JOIN public.schools sc ON sc.id = sa.school_id AND sc.is_active = true
    WHERE sa.auth_user_id = auth.uid()
      AND sa.school_id = p_school_id
      AND sa.is_active = true
  ) THEN
    RETURN jsonb_build_object('success', false, 'status', 403, 'error', 'Not an active administrator of the selected school');
  END IF;

  IF NOT public.school_admin_has_selected_permission(p_school_id, 'institution.manage_students') THEN
    RETURN jsonb_build_object('success', false, 'status', 403, 'error', 'Missing permission for the selected school');
  END IF;

  IF p_class_id IS NOT NULL THEN
    SELECT c.school_id INTO v_class_school_id
    FROM public.classes c
    WHERE c.id = p_class_id
    LIMIT 1;

    IF v_class_school_id IS DISTINCT FROM p_school_id THEN
      RETURN jsonb_build_object('success', false, 'status', 403, 'error', 'class_id does not belong to the selected school');
    END IF;
  END IF;

  IF v_normalized_email <> '' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.students s WHERE lower(s.email) = v_normalized_email
    ) INTO v_email_exists;
  END IF;

  SELECT count(*)::integer INTO v_seats_used
  FROM public.students s
  WHERE s.school_id = p_school_id AND s.is_active = true;

  SELECT ss.seats_purchased INTO v_seats_purchased
  FROM public.school_subscriptions ss
  WHERE ss.school_id = p_school_id
  ORDER BY CASE WHEN ss.status IN ('active', 'trial') THEN 0 ELSE 1 END,
           ss.created_at DESC NULLS LAST
  LIMIT 1;

  v_seat_cap_violation := v_seats_purchased IS NOT NULL
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

REVOKE ALL ON FUNCTION public.school_admin_list_students(uuid, integer, integer, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.school_admin_list_students(uuid, integer, integer, text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.school_admin_toggle_student_active(uuid, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.school_admin_toggle_student_active(uuid, uuid, boolean) TO authenticated;
REVOKE ALL ON FUNCTION public.school_admin_attach_created_student(uuid, uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.school_admin_attach_created_student(uuid, uuid, text, uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.school_admin_student_create_preflight(uuid, text, integer, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.school_admin_student_create_preflight(uuid, text, integer, uuid) TO authenticated;

COMMENT ON FUNCTION public.school_admin_list_students(uuid, integer, integer, text, text)
  IS 'Lists students only for the active school-admin membership explicitly selected by p_school_id.';
COMMENT ON FUNCTION public.school_admin_toggle_student_active(uuid, uuid, boolean)
  IS 'Toggles a student only within the active school-admin membership explicitly selected by p_school_id.';
COMMENT ON FUNCTION public.school_admin_attach_created_student(uuid, uuid, text, uuid)
  IS 'Attaches a newly-created student only to the active school-admin membership explicitly selected by p_school_id.';
COMMENT ON FUNCTION public.school_admin_student_create_preflight(uuid, text, integer, uuid)
  IS 'Runs student-create and class preflight only for the active school-admin membership explicitly selected by p_school_id.';

COMMIT;
