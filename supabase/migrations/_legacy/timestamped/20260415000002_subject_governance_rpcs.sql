-- supabase/migrations/20260415000002_subject_governance_rpcs.sql
BEGIN;

CREATE OR REPLACE FUNCTION get_available_subjects(p_student_id UUID)
RETURNS TABLE (
  code TEXT, name TEXT, name_hi TEXT, icon TEXT, color TEXT,
  subject_kind TEXT, is_core BOOLEAN, is_locked BOOLEAN
)
LANGUAGE SQL SECURITY DEFINER STABLE AS $$
  WITH s AS (SELECT grade, stream FROM students WHERE id = p_student_id),
       p AS (
         SELECT plan_code FROM student_subscriptions
          WHERE student_id = p_student_id
            AND status IN ('active','trialing','grace')
          ORDER BY current_period_end DESC NULLS LAST LIMIT 1
       ),
       effective_plan AS (
         SELECT COALESCE((SELECT plan_code FROM p), 'free') AS plan_code
       ),
       grade_valid AS (
         SELECT gsm.subject_code, gsm.is_core FROM grade_subject_map gsm, s
          WHERE gsm.grade = s.grade
            AND (gsm.stream IS NULL OR gsm.stream = s.stream OR s.stream IS NULL)
       ),
       plan_valid AS (
         SELECT psa.subject_code FROM plan_subject_access psa, effective_plan ep
          WHERE psa.plan_code = ep.plan_code
       )
  SELECT sub.code, sub.name, COALESCE(sub.name_hi, sub.name), sub.icon, sub.color,
         sub.subject_kind, gv.is_core,
         (gv.subject_code NOT IN (SELECT subject_code FROM plan_valid)) AS is_locked
    FROM subjects sub
    JOIN grade_valid gv ON gv.subject_code = sub.code
   WHERE sub.is_active;
$$;

REVOKE ALL ON FUNCTION get_available_subjects(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_available_subjects(UUID) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION set_student_subjects(
  p_student_id UUID, p_subjects TEXT[], p_preferred TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_allowed TEXT[];
  v_invalid TEXT[];
  v_max INT;
  v_count INT;
BEGIN
  -- authz: caller must own the student row
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_student_id THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  IF p_subjects IS NULL OR array_length(p_subjects, 1) IS NULL THEN
    p_subjects := ARRAY[]::TEXT[];
  END IF;

  SELECT ARRAY_AGG(code) INTO v_allowed
    FROM get_available_subjects(p_student_id) WHERE NOT is_locked;

  v_invalid := ARRAY(SELECT UNNEST(p_subjects) EXCEPT SELECT UNNEST(COALESCE(v_allowed, ARRAY[]::TEXT[])));
  IF array_length(v_invalid, 1) > 0 THEN
    RAISE EXCEPTION 'subject_not_allowed'
      USING DETAIL = jsonb_build_object('invalid', v_invalid, 'allowed', v_allowed)::text;
  END IF;

  SELECT max_subjects INTO v_max
    FROM subscription_plans sp
    JOIN student_subscriptions ss ON ss.plan_id = sp.id
   WHERE ss.student_id = p_student_id
     AND ss.status IN ('active','trialing','grace')
   ORDER BY ss.current_period_end DESC NULLS LAST LIMIT 1;

  v_count := COALESCE(array_length(p_subjects, 1), 0);
  IF v_max IS NOT NULL AND v_count > v_max THEN
    RAISE EXCEPTION 'max_subjects_exceeded'
      USING DETAIL = jsonb_build_object('limit', v_max, 'requested', v_count)::text;
  END IF;

  DELETE FROM student_subject_enrollment WHERE student_id = p_student_id;
  IF v_count > 0 THEN
    INSERT INTO student_subject_enrollment (student_id, subject_code, source)
      SELECT p_student_id, UNNEST(p_subjects), 'student';
  END IF;

  UPDATE students
     SET selected_subjects = p_subjects,
         preferred_subject = COALESCE(
           CASE WHEN p_preferred = ANY(p_subjects) THEN p_preferred ELSE NULL END,
           p_subjects[1],
           preferred_subject
         )
   WHERE id = p_student_id;

  RETURN jsonb_build_object('ok', true, 'subjects', p_subjects);
END;
$$;

REVOKE ALL ON FUNCTION set_student_subjects(UUID, TEXT[], TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION set_student_subjects(UUID, TEXT[], TEXT) TO authenticated, service_role;

COMMIT;