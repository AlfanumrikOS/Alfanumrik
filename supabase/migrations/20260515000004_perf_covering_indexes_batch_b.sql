-- Migration: perf_covering_indexes_batch_b
-- Date: 2026-05-15
-- Purpose: Second half of the unindexed-FK covering-index sweep (lint:
--          unindexed_foreign_keys). Batch B — school/content/enrollment
--          tables (15 of 30). Pairs with 20260515000003 (batch A).

CREATE INDEX IF NOT EXISTS idx_question_misconceptions_remediation_concept_id
  ON public.question_misconceptions (remediation_concept_id);

CREATE INDEX IF NOT EXISTS idx_school_admins_invited_by
  ON public.school_admins (invited_by);
CREATE INDEX IF NOT EXISTS idx_school_admins_school_id
  ON public.school_admins (school_id);

CREATE INDEX IF NOT EXISTS idx_school_alert_rules_school_id
  ON public.school_alert_rules (school_id);

CREATE INDEX IF NOT EXISTS idx_school_announcements_created_by
  ON public.school_announcements (created_by);

CREATE INDEX IF NOT EXISTS idx_school_api_keys_created_by
  ON public.school_api_keys (created_by);

CREATE INDEX IF NOT EXISTS idx_school_exams_created_by
  ON public.school_exams (created_by);

CREATE INDEX IF NOT EXISTS idx_school_invite_codes_class_id
  ON public.school_invite_codes (class_id);
CREATE INDEX IF NOT EXISTS idx_school_invite_codes_created_by
  ON public.school_invite_codes (created_by);
CREATE INDEX IF NOT EXISTS idx_school_invite_codes_school_id
  ON public.school_invite_codes (school_id);

CREATE INDEX IF NOT EXISTS idx_school_questions_created_by
  ON public.school_questions (created_by);

CREATE INDEX IF NOT EXISTS idx_plan_subject_access_subject_code
  ON public.plan_subject_access (subject_code);

CREATE INDEX IF NOT EXISTS idx_student_ncert_attempts_exercise_id
  ON public.student_ncert_attempts (exercise_id);

CREATE INDEX IF NOT EXISTS idx_student_subject_enrollment_subject_code
  ON public.student_subject_enrollment (subject_code);

CREATE INDEX IF NOT EXISTS idx_students_preferred_subject
  ON public.students (preferred_subject);
