-- XC-3: scoped helper for the post-auth school-admin student attach step.
-- The route still needs Auth Admin to create the Supabase auth user, but the
-- trigger-created public.students row and optional class roster attachment are
-- now bound to auth.uid() school-admin membership in the database.

CREATE OR REPLACE FUNCTION public.school_admin_attach_created_student(
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
  v_school_id uuid;
  v_student_id uuid;
  v_class_school_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'status', 401, 'error', 'Unauthorized');
  END IF;

  SELECT sa.school_id
    INTO v_school_id
    FROM public.school_admins sa
   WHERE sa.auth_user_id = auth.uid()
   LIMIT 1;

  IF v_school_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'status', 403, 'error', 'School admin account not found');
  END IF;

  IF p_class_id IS NOT NULL THEN
    SELECT c.school_id
      INTO v_class_school_id
      FROM public.classes c
     WHERE c.id = p_class_id
     LIMIT 1;

    IF v_class_school_id IS DISTINCT FROM v_school_id THEN
      RETURN jsonb_build_object('success', false, 'status', 403, 'error', 'class_id does not belong to your school');
    END IF;
  END IF;

  UPDATE public.students
     SET school_id = v_school_id,
         phone = CASE
           WHEN NULLIF(p_phone, '') IS NULL THEN phone
           ELSE left(p_phone, 64)
         END
   WHERE auth_user_id = p_student_auth_user_id
     AND (school_id IS NULL OR school_id = v_school_id)
  RETURNING id INTO v_student_id;

  IF v_student_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'status', 404, 'error', 'Student row not found');
  END IF;

  IF p_class_id IS NOT NULL THEN
    INSERT INTO public.class_students (class_id, student_id)
    VALUES (p_class_id, v_student_id)
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'data', jsonb_build_object('studentId', v_student_id)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.school_admin_attach_created_student(uuid, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.school_admin_attach_created_student(uuid, text, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.school_admin_attach_created_student(uuid, text, uuid) TO authenticated;

COMMENT ON FUNCTION public.school_admin_attach_created_student(uuid, text, uuid) IS
  'XC-3 scoped post-auth student attach helper. Resolves caller school from auth.uid(), attaches the trigger-created student row, and optionally inserts a same-school class roster row.';
