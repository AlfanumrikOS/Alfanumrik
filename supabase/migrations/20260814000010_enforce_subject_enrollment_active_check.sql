-- Migration: 20260814000010_enforce_subject_enrollment_active_check.sql
-- Phase 3 / M5 — Server-authoritative allowed-subject policy: write gate.
--
-- Purpose
--   Close the hole that makes the restriction advisory instead of authoritative.
--
--   subjects.is_active gates READS only. get_available_subjects() and
--   get_available_subjects_v2() both end with `WHERE sub.is_active`, but
--   enforce_subject_enrollment() — the BEFORE INSERT OR UPDATE trigger on
--   student_subject_enrollment — checks only grade_subject_map and
--   plan_subject_access and never joins subjects at all. Consequently a
--   direct INSERT of a deactivated subject SUCCEEDS today: the subject
--   vanishes from the picker while remaining fully writable by any client
--   that posts a subject_code straight at the table. M1/M2 alone are a UI
--   filter, not a policy. This migration makes the catalogue authoritative
--   at the write boundary.
--
-- Change
--   One added check, placed immediately BEFORE the existing grade check, so
--   the pre-existing error precedence is preserved: a student with no grade
--   still fails with 'student_missing_grade' exactly as before, and the new
--   'subject_not_active' outranks only 'subject_not_valid_for_grade' and
--   'subject_not_in_plan'. Nothing else in the function body changes.
--
-- Pure function replace — the trigger trg_enforce_subject_enrollment
-- (BEFORE INSERT OR UPDATE ON student_subject_enrollment FOR EACH ROW) already
-- exists from the baseline and is NOT recreated here.
--
-- SECURITY INVOKER (the function is not and must not be SECURITY DEFINER —
-- it is a validation trigger, it reads only rows the writer can already see).
-- `SET search_path = public, pg_catalog` is restated because CREATE OR REPLACE
-- FUNCTION discards the function's SET clauses; migration 20260516010000 had
-- applied that search_path via ALTER FUNCTION and omitting it here would
-- silently revert that hardening.
--
-- Idempotency: CREATE OR REPLACE FUNCTION with a fixed signature — re-running
-- installs byte-identical source and leaves ownership and grants intact.
-- No DDL on any table, no data change.

BEGIN;

CREATE OR REPLACE FUNCTION public.enforce_subject_enrollment()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_grade TEXT; v_stream TEXT; v_plan TEXT; v_ok BOOLEAN;
BEGIN
  SELECT grade, stream INTO v_grade, v_stream FROM students WHERE id = NEW.student_id;
  IF v_grade IS NULL THEN
    RAISE EXCEPTION 'student_missing_grade' USING ERRCODE = 'check_violation';
  END IF;

  -- Phase 3 M5: the subject must be in the ACTIVE catalogue.
  -- Without this, a deactivated subject stays writable even though it is
  -- invisible in get_available_subjects(). Deliberately placed before the
  -- grade check so the restriction, not the curriculum map, is the reported
  -- cause when a client posts a removed subject.
  SELECT EXISTS(
    SELECT 1 FROM subjects sub
     WHERE sub.code = NEW.subject_code
       AND sub.is_active
  ) INTO v_ok;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'subject_not_active'
      USING DETAIL = jsonb_build_object('subject', NEW.subject_code)::text,
            ERRCODE = 'check_violation';
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

COMMENT ON FUNCTION public.enforce_subject_enrollment() IS
  'BEFORE INSERT OR UPDATE trigger on student_subject_enrollment. Gates, in '
  'order: student has a grade, subject is in the ACTIVE catalogue (Phase 3 M5), '
  'subject is valid for grade/stream, subject is in the plan. All failures '
  'raise ERRCODE check_violation.';

COMMIT;
