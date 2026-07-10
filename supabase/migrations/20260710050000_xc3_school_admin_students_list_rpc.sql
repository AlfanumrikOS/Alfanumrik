-- XC-3: move school-admin roster GET reads behind an authenticated helper.
-- The route still needs service-role for Auth-user creation in POST, so this
-- migration is a partial service-role reduction, not an allowlist ratchet.

CREATE OR REPLACE FUNCTION public.school_admin_list_students(
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
  v_school_id uuid;
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

  IF v_grade IS NOT NULL AND v_grade NOT IN ('6', '7', '8', '9', '10', '11', '12') THEN
    RETURN jsonb_build_object('success', false, 'status', 400, 'error', 'Invalid grade filter');
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

  v_offset := (v_page - 1) * v_limit;

  SELECT COUNT(*)
    INTO v_total
  FROM public.students s
  WHERE s.school_id = v_school_id
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
      )
      ORDER BY page_rows.created_at DESC
    ),
    '[]'::jsonb
  )
    INTO v_rows
  FROM (
    SELECT
      s.id,
      s.name,
      s.email,
      s.grade,
      s.is_active,
      s.xp_total,
      s.last_active,
      s.subscription_plan,
      s.created_at
    FROM public.students s
    WHERE s.school_id = v_school_id
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

REVOKE ALL ON FUNCTION public.school_admin_list_students(integer, integer, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.school_admin_list_students(integer, integer, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.school_admin_list_students(integer, integer, text, text) TO authenticated;

COMMENT ON FUNCTION public.school_admin_list_students(integer, integer, text, text)
  IS 'XC-3 scoped school-admin roster list helper. Resolves school from auth.uid() and active school_admins membership; no route-supplied school_id is trusted.';
