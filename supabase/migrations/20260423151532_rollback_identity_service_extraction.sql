-- Rollback Migration: 20260423151532_rollback_identity_service_extraction
-- Emergency rollback for identity service schema extraction
-- Use only if critical issues detected post-migration
-- Estimated rollback time: 3-5 minutes

-- ============================================================================
-- PHASE 1: MOVE TABLES BACK TO PUBLIC SCHEMA (REVERSE ORDER)
-- ============================================================================

-- Move tables back in reverse dependency order
ALTER TABLE identity.guardian_student_links SET SCHEMA public;
ALTER TABLE identity.class_students SET SCHEMA public;
ALTER TABLE identity.classes SET SCHEMA public;
ALTER TABLE identity.guardians SET SCHEMA public;
ALTER TABLE identity.teachers SET SCHEMA public;
ALTER TABLE identity.students SET SCHEMA public;
ALTER TABLE identity.user_active_sessions SET SCHEMA public;
ALTER TABLE identity.identity_events SET SCHEMA public;
ALTER TABLE identity.user_roles SET SCHEMA public;
ALTER TABLE identity.schools SET SCHEMA public;

-- ============================================================================
-- PHASE 2: RESTORE FOREIGN KEY REFERENCES TO PUBLIC SCHEMA
-- ============================================================================

-- 2.1 Tables referencing students
ALTER TABLE public.student_learning_profiles DROP CONSTRAINT IF EXISTS student_learning_profiles_student_id_fkey;
ALTER TABLE public.student_learning_profiles ADD CONSTRAINT student_learning_profiles_student_id_fkey
  FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE;

ALTER TABLE public.concept_mastery DROP CONSTRAINT IF EXISTS concept_mastery_student_id_fkey;
ALTER TABLE public.concept_mastery ADD CONSTRAINT concept_mastery_student_id_fkey
  FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE;

ALTER TABLE public.topic_mastery DROP CONSTRAINT IF EXISTS topic_mastery_student_id_fkey;
ALTER TABLE public.topic_mastery ADD CONSTRAINT topic_mastery_student_id_fkey
  FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE;

ALTER TABLE public.chat_sessions DROP CONSTRAINT IF EXISTS chat_sessions_student_id_fkey;
ALTER TABLE public.chat_sessions ADD CONSTRAINT chat_sessions_student_id_fkey
  FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE;

ALTER TABLE public.quiz_sessions DROP CONSTRAINT IF EXISTS quiz_sessions_student_id_fkey;
ALTER TABLE public.quiz_sessions ADD CONSTRAINT quiz_sessions_student_id_fkey
  FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE;

ALTER TABLE public.quiz_responses DROP CONSTRAINT IF EXISTS quiz_responses_student_id_fkey;
ALTER TABLE public.quiz_responses ADD CONSTRAINT quiz_responses_student_id_fkey
  FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE;

ALTER TABLE public.study_plans DROP CONSTRAINT IF EXISTS study_plans_student_id_fkey;
ALTER TABLE public.study_plans ADD CONSTRAINT study_plans_student_id_fkey
  FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE;

ALTER TABLE public.study_plan_tasks DROP CONSTRAINT IF EXISTS study_plan_tasks_student_id_fkey;
ALTER TABLE public.study_plan_tasks ADD CONSTRAINT study_plan_tasks_student_id_fkey
  FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE;

ALTER TABLE public.spaced_repetition_cards DROP CONSTRAINT IF EXISTS spaced_repetition_cards_student_id_fkey;
ALTER TABLE public.spaced_repetition_cards ADD CONSTRAINT spaced_repetition_cards_student_id_fkey
  FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE;

ALTER TABLE public.competition_participants DROP CONSTRAINT IF EXISTS competition_participants_student_id_fkey;
ALTER TABLE public.competition_participants ADD CONSTRAINT competition_participants_student_id_fkey
  FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE;

ALTER TABLE public.daily_activity DROP CONSTRAINT IF EXISTS daily_activity_student_id_fkey;
ALTER TABLE public.daily_activity ADD CONSTRAINT daily_activity_student_id_fkey
  FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE;

ALTER TABLE public.student_simulation_progress DROP CONSTRAINT IF EXISTS student_simulation_progress_student_id_fkey;
ALTER TABLE public.student_simulation_progress ADD CONSTRAINT student_simulation_progress_student_id_fkey
  FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE;

ALTER TABLE public.classroom_poll_responses DROP CONSTRAINT IF EXISTS classroom_poll_responses_student_id_fkey;
ALTER TABLE public.classroom_poll_responses ADD CONSTRAINT classroom_poll_responses_student_id_fkey
  FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE;

-- Additional tables from cascade fixes
ALTER TABLE public.adaptive_interactions DROP CONSTRAINT IF EXISTS adaptive_interactions_student_id_fkey;
ALTER TABLE public.adaptive_interactions ADD CONSTRAINT adaptive_interactions_student_id_fkey
  FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE;

ALTER TABLE public.adaptive_mastery DROP CONSTRAINT IF EXISTS adaptive_mastery_student_id_fkey;
ALTER TABLE public.adaptive_mastery ADD CONSTRAINT adaptive_mastery_student_id_fkey
  FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE;

ALTER TABLE public.at_risk_alerts DROP CONSTRAINT IF EXISTS at_risk_alerts_student_id_fkey;
ALTER TABLE public.at_risk_alerts ADD CONSTRAINT at_risk_alerts_student_id_fkey
  FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE;

ALTER TABLE public.chapter_study_sessions DROP CONSTRAINT IF EXISTS chapter_study_sessions_student_id_fkey;
ALTER TABLE public.chapter_study_sessions ADD CONSTRAINT chapter_study_sessions_student_id_fkey
  FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE;

ALTER TABLE public.interleave_queue DROP CONSTRAINT IF EXISTS interleave_queue_student_id_fkey;
ALTER TABLE public.interleave_queue ADD CONSTRAINT interleave_queue_student_id_fkey
  FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE;

ALTER TABLE public.learning_journey DROP CONSTRAINT IF EXISTS learning_journey_student_id_fkey;
ALTER TABLE public.learning_journey ADD CONSTRAINT learning_journey_student_id_fkey
  FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE;

ALTER TABLE public.narrative_progress DROP CONSTRAINT IF EXISTS narrative_progress_student_id_fkey;
ALTER TABLE public.narrative_progress ADD CONSTRAINT narrative_progress_student_id_fkey
  FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE;

-- 2.2 Tables referencing teachers
ALTER TABLE public.class_teachers DROP CONSTRAINT IF EXISTS class_teachers_teacher_id_fkey;
ALTER TABLE public.class_teachers ADD CONSTRAINT class_teachers_teacher_id_fkey
  FOREIGN KEY (teacher_id) REFERENCES public.teachers(id) ON DELETE CASCADE;

-- 2.3 Tables referencing guardians
ALTER TABLE public.guardian_student_links DROP CONSTRAINT IF EXISTS guardian_student_links_guardian_id_fkey;
ALTER TABLE public.guardian_student_links ADD CONSTRAINT guardian_student_links_guardian_id_fkey
  FOREIGN KEY (guardian_id) REFERENCES public.guardians(id) ON DELETE CASCADE;

-- 2.4 Tables referencing schools
ALTER TABLE public.classes DROP CONSTRAINT IF EXISTS classes_school_id_fkey;
ALTER TABLE public.classes ADD CONSTRAINT classes_school_id_fkey
  FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE CASCADE;

ALTER TABLE public.students DROP CONSTRAINT IF EXISTS students_school_id_fkey;
ALTER TABLE public.students ADD CONSTRAINT students_school_id_fkey
  FOREIGN KEY (school_id) REFERENCES public.schools(id);

ALTER TABLE public.teachers DROP CONSTRAINT IF EXISTS teachers_school_id_fkey;
ALTER TABLE public.teachers ADD CONSTRAINT teachers_school_id_fkey
  FOREIGN KEY (school_id) REFERENCES public.schools(id);

-- 2.5 Tables referencing classes
ALTER TABLE public.class_students DROP CONSTRAINT IF EXISTS class_students_class_id_fkey;
ALTER TABLE public.class_students ADD CONSTRAINT class_students_class_id_fkey
  FOREIGN KEY (class_id) REFERENCES public.classes(id) ON DELETE CASCADE;

ALTER TABLE public.class_teachers DROP CONSTRAINT IF EXISTS class_teachers_class_id_fkey;
ALTER TABLE public.class_teachers ADD CONSTRAINT class_teachers_class_id_fkey
  FOREIGN KEY (class_id) REFERENCES public.classes(id) ON DELETE CASCADE;

-- ============================================================================
-- PHASE 3: DROP IDENTITY SCHEMA
-- ============================================================================

DROP SCHEMA IF EXISTS identity CASCADE;

-- ============================================================================
-- PHASE 4: LOG ROLLBACK COMPLETION
-- ============================================================================

INSERT INTO identity_events (auth_user_id, event_type, metadata)
SELECT
  '00000000-0000-0000-0000-000000000000'::UUID,
  'migration_rolled_back',
  jsonb_build_object(
    'migration', 'identity_service_extraction',
    'timestamp', now(),
    'rollback_completed', true
  );

-- ============================================================================
-- POST-ROLLBACK VALIDATION
-- ============================================================================

-- Run the same validation function to ensure data integrity
SELECT * FROM identity.validate_migration_integrity();