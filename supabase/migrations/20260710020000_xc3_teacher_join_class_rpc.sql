-- XC-3 RCA-01: replace /api/teacher/join-class route service-role writes with
-- a scoped authenticated RPC. The route still performs the app-layer RBAC gate;
-- this function binds the write to auth.uid() and the active class code inside
-- the database, avoiding a broad route-level service-role client.

CREATE OR REPLACE FUNCTION public.teacher_join_class_by_code(p_class_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_teacher record;
  v_class record;
  v_already_joined boolean := false;
  v_inserted_count integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'status', 401,
      'error', 'Unauthorized'
    );
  END IF;

  SELECT t.id, t.school_id
    INTO v_teacher
    FROM public.teachers t
   WHERE t.auth_user_id = auth.uid()
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'status', 403,
      'error', 'Teacher account not found'
    );
  END IF;

  SELECT c.id, c.school_id
    INTO v_class
    FROM public.classes c
   WHERE c.class_code = p_class_code
     AND c.is_active = true
     AND c.deleted_at IS NULL
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'status', 404,
      'error', 'No active class found for this code'
    );
  END IF;

  SELECT EXISTS (
    SELECT 1
      FROM public.class_teachers ct
     WHERE ct.class_id = v_class.id
       AND ct.teacher_id = v_teacher.id
  )
    INTO v_already_joined;

  IF NOT v_already_joined THEN
    INSERT INTO public.class_teachers (class_id, teacher_id, role, is_active)
    VALUES (v_class.id, v_teacher.id, 'teacher', true)
    ON CONFLICT (class_id, teacher_id) DO NOTHING;

    GET DIAGNOSTICS v_inserted_count = ROW_COUNT;
    -- If no row was inserted, a concurrent request won the unique-key race.
    v_already_joined := v_inserted_count = 0;
  END IF;

  IF v_teacher.school_id IS NULL AND v_class.school_id IS NOT NULL THEN
    UPDATE public.teachers
       SET school_id = v_class.school_id,
           updated_at = now()
     WHERE id = v_teacher.id
       AND school_id IS NULL;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'data', jsonb_build_object(
      'classId', v_class.id,
      'teacherId', v_teacher.id,
      'schoolId', v_class.school_id,
      'alreadyJoined', v_already_joined
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.teacher_join_class_by_code(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.teacher_join_class_by_code(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.teacher_join_class_by_code(text) TO authenticated;

COMMENT ON FUNCTION public.teacher_join_class_by_code(text) IS
  'XC-3 scoped authenticated teacher join-class helper: joins current auth.uid() teacher to an active class by code without route service-role access.';
