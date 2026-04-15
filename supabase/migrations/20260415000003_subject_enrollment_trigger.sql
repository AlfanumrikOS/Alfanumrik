-- supabase/migrations/20260415000003_subject_enrollment_trigger.sql
BEGIN;

CREATE OR REPLACE FUNCTION enforce_subject_enrollment() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  v_grade TEXT; v_stream TEXT; v_plan TEXT; v_ok BOOLEAN;
BEGIN
  SELECT grade, stream INTO v_grade, v_stream FROM students WHERE id = NEW.student_id;
  IF v_grade IS NULL THEN
    RAISE EXCEPTION 'student_missing_grade' USING ERRCODE = 'check_violation';
  END IF;

  SELECT ss.plan_code INTO v_plan
    FROM student_subscriptions ss
   WHERE ss.student_id = NEW.student_id
     AND ss.status IN ('active','trialing','grace')
   ORDER BY ss.current_period_end DESC NULLS LAST LIMIT 1;
  v_plan := COALESCE(v_plan, 'free');

  SELECT EXISTS(
    SELECT 1 FROM grade_subject_map gsm
     WHERE gsm.grade = v_grade
       AND gsm.subject_code = NEW.subject_code
       AND (gsm.stream IS NULL OR gsm.stream = v_stream OR v_stream IS NULL)
  ) INTO v_ok;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'subject_not_valid_for_grade'
      USING DETAIL = jsonb_build_object('subject', NEW.subject_code, 'grade', v_grade, 'stream', v_stream)::text,
            ERRCODE = 'check_violation';
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM plan_subject_access psa
     WHERE psa.plan_code = v_plan
       AND psa.subject_code = NEW.subject_code
  ) INTO v_ok;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'subject_not_in_plan'
      USING DETAIL = jsonb_build_object('subject', NEW.subject_code, 'plan', v_plan)::text,
            ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

-- Create the trigger but DISABLE it. Phase E enables it after cleanup.
CREATE TRIGGER trg_enforce_subject_enrollment
  BEFORE INSERT OR UPDATE ON student_subject_enrollment
  FOR EACH ROW EXECUTE FUNCTION enforce_subject_enrollment();
ALTER TABLE student_subject_enrollment DISABLE TRIGGER trg_enforce_subject_enrollment;

COMMIT;