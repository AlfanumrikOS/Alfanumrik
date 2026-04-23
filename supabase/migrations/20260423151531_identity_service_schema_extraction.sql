-- Migration: 20260423151531_identity_service_schema_extraction
-- High-risk migration: Extract identity service tables to dedicated schema
-- Affects P15 onboarding integrity - test rollback procedures before production
-- Estimated downtime: 5-10 minutes during foreign key updates

-- ============================================================================
-- PHASE 1: SCHEMA CREATION AND PERMISSIONS
-- ============================================================================

-- Create identity schema for user management service
CREATE SCHEMA IF NOT EXISTS identity;

-- Grant schema usage to the public roles involved in migration
GRANT USAGE ON SCHEMA identity TO authenticated;
GRANT USAGE ON SCHEMA identity TO anon;

-- Grant service role full access (for identity operations)
GRANT USAGE ON SCHEMA identity TO service_role;
GRANT CREATE ON SCHEMA identity TO service_role;
GRANT ALL ON SCHEMA identity TO service_role;

-- Ensure future identity tables receive the proper default privileges
ALTER DEFAULT PRIVILEGES IN SCHEMA identity GRANT SELECT ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA identity GRANT SELECT ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA identity GRANT ALL ON TABLES TO service_role;

-- Compatibility: preserve legacy unqualified table access during rollout.
-- This lets existing `FROM 'students'` / `FROM 'teachers'` queries continue
-- to resolve to `identity.*` after the tables are moved.
ALTER ROLE anon SET search_path = identity, public, auth, extensions;
ALTER ROLE authenticated SET search_path = identity, public, auth, extensions;
ALTER ROLE service_role SET search_path = identity, public, auth, extensions;

-- ============================================================================
-- PHASE 2: TABLE MIGRATION WITH DEPENDENCY ORDER
-- ============================================================================

-- 2.1 Move independent tables first (schools - no FK dependencies)
ALTER TABLE public.schools SET SCHEMA identity;

-- 2.2 Move user_roles (depends on auth.users, no other table deps)
ALTER TABLE public.user_roles SET SCHEMA identity;

-- 2.3 Move identity_events (depends on auth.users only)
ALTER TABLE public.identity_events SET SCHEMA identity;

-- 2.4 Move user_active_sessions (depends on auth.users only)
ALTER TABLE public.user_active_sessions SET SCHEMA identity;

-- 2.5 Move students (depends on schools, auth.users)
ALTER TABLE public.students SET SCHEMA identity;

-- 2.6 Move teachers (depends on schools, auth.users)
ALTER TABLE public.teachers SET SCHEMA identity;

-- 2.7 Move guardians (depends on auth.users only)
ALTER TABLE public.guardians SET SCHEMA identity;

-- 2.8 Move classes (depends on schools)
ALTER TABLE public.classes SET SCHEMA identity;

-- 2.9 Move class_students (depends on classes, students)
ALTER TABLE public.class_students SET SCHEMA identity;

-- 2.10 Move guardian_student_links (depends on guardians, students)
ALTER TABLE public.guardian_student_links SET SCHEMA identity;

-- ============================================================================
-- PHASE 3: UPDATE FOREIGN KEY REFERENCES (SCHEMA-QUALIFIED)
-- ============================================================================

-- Update all foreign key references to use identity schema
-- This is done in dependency order to avoid constraint violations

-- 3.1 Tables referencing students
ALTER TABLE public.student_learning_profiles DROP CONSTRAINT IF EXISTS student_learning_profiles_student_id_fkey;
ALTER TABLE public.student_learning_profiles ADD CONSTRAINT student_learning_profiles_student_id_fkey
  FOREIGN KEY (student_id) REFERENCES identity.students(id) ON DELETE CASCADE;

ALTER TABLE public.concept_mastery DROP CONSTRAINT IF EXISTS concept_mastery_student_id_fkey;
ALTER TABLE public.concept_mastery ADD CONSTRAINT concept_mastery_student_id_fkey
  FOREIGN KEY (student_id) REFERENCES identity.students(id) ON DELETE CASCADE;

ALTER TABLE public.topic_mastery DROP CONSTRAINT IF EXISTS topic_mastery_student_id_fkey;
ALTER TABLE public.topic_mastery ADD CONSTRAINT topic_mastery_student_id_fkey
  FOREIGN KEY (student_id) REFERENCES identity.students(id) ON DELETE CASCADE;

ALTER TABLE public.chat_sessions DROP CONSTRAINT IF EXISTS chat_sessions_student_id_fkey;
ALTER TABLE public.chat_sessions ADD CONSTRAINT chat_sessions_student_id_fkey
  FOREIGN KEY (student_id) REFERENCES identity.students(id) ON DELETE CASCADE;

ALTER TABLE public.quiz_sessions DROP CONSTRAINT IF EXISTS quiz_sessions_student_id_fkey;
ALTER TABLE public.quiz_sessions ADD CONSTRAINT quiz_sessions_student_id_fkey
  FOREIGN KEY (student_id) REFERENCES identity.students(id) ON DELETE CASCADE;

ALTER TABLE public.quiz_responses DROP CONSTRAINT IF EXISTS quiz_responses_student_id_fkey;
ALTER TABLE public.quiz_responses ADD CONSTRAINT quiz_responses_student_id_fkey
  FOREIGN KEY (student_id) REFERENCES identity.students(id) ON DELETE CASCADE;

ALTER TABLE public.study_plans DROP CONSTRAINT IF EXISTS study_plans_student_id_fkey;
ALTER TABLE public.study_plans ADD CONSTRAINT study_plans_student_id_fkey
  FOREIGN KEY (student_id) REFERENCES identity.students(id) ON DELETE CASCADE;

ALTER TABLE public.study_plan_tasks DROP CONSTRAINT IF EXISTS study_plan_tasks_student_id_fkey;
ALTER TABLE public.study_plan_tasks ADD CONSTRAINT study_plan_tasks_student_id_fkey
  FOREIGN KEY (student_id) REFERENCES identity.students(id) ON DELETE CASCADE;

ALTER TABLE public.spaced_repetition_cards DROP CONSTRAINT IF EXISTS spaced_repetition_cards_student_id_fkey;
ALTER TABLE public.spaced_repetition_cards ADD CONSTRAINT spaced_repetition_cards_student_id_fkey
  FOREIGN KEY (student_id) REFERENCES identity.students(id) ON DELETE CASCADE;

ALTER TABLE public.competition_participants DROP CONSTRAINT IF EXISTS competition_participants_student_id_fkey;
ALTER TABLE public.competition_participants ADD CONSTRAINT competition_participants_student_id_fkey
  FOREIGN KEY (student_id) REFERENCES identity.students(id) ON DELETE CASCADE;

ALTER TABLE public.daily_activity DROP CONSTRAINT IF EXISTS daily_activity_student_id_fkey;
ALTER TABLE public.daily_activity ADD CONSTRAINT daily_activity_student_id_fkey
  FOREIGN KEY (student_id) REFERENCES identity.students(id) ON DELETE CASCADE;

ALTER TABLE public.student_simulation_progress DROP CONSTRAINT IF EXISTS student_simulation_progress_student_id_fkey;
ALTER TABLE public.student_simulation_progress ADD CONSTRAINT student_simulation_progress_student_id_fkey
  FOREIGN KEY (student_id) REFERENCES identity.students(id) ON DELETE CASCADE;

ALTER TABLE public.classroom_poll_responses DROP CONSTRAINT IF EXISTS classroom_poll_responses_student_id_fkey;
ALTER TABLE public.classroom_poll_responses ADD CONSTRAINT classroom_poll_responses_student_id_fkey
  FOREIGN KEY (student_id) REFERENCES identity.students(id) ON DELETE CASCADE;

-- Additional tables from cascade fixes migration
ALTER TABLE public.adaptive_interactions DROP CONSTRAINT IF EXISTS adaptive_interactions_student_id_fkey;
ALTER TABLE public.adaptive_interactions ADD CONSTRAINT adaptive_interactions_student_id_fkey
  FOREIGN KEY (student_id) REFERENCES identity.students(id) ON DELETE CASCADE;

ALTER TABLE public.adaptive_mastery DROP CONSTRAINT IF EXISTS adaptive_mastery_student_id_fkey;
ALTER TABLE public.adaptive_mastery ADD CONSTRAINT adaptive_mastery_student_id_fkey
  FOREIGN KEY (student_id) REFERENCES identity.students(id) ON DELETE CASCADE;

ALTER TABLE public.at_risk_alerts DROP CONSTRAINT IF EXISTS at_risk_alerts_student_id_fkey;
ALTER TABLE public.at_risk_alerts ADD CONSTRAINT at_risk_alerts_student_id_fkey
  FOREIGN KEY (student_id) REFERENCES identity.students(id) ON DELETE CASCADE;

ALTER TABLE public.chapter_study_sessions DROP CONSTRAINT IF EXISTS chapter_study_sessions_student_id_fkey;
ALTER TABLE public.chapter_study_sessions ADD CONSTRAINT chapter_study_sessions_student_id_fkey
  FOREIGN KEY (student_id) REFERENCES identity.students(id) ON DELETE CASCADE;

ALTER TABLE public.interleave_queue DROP CONSTRAINT IF EXISTS interleave_queue_student_id_fkey;
ALTER TABLE public.interleave_queue ADD CONSTRAINT interleave_queue_student_id_fkey
  FOREIGN KEY (student_id) REFERENCES identity.students(id) ON DELETE CASCADE;

ALTER TABLE public.learning_journey DROP CONSTRAINT IF EXISTS learning_journey_student_id_fkey;
ALTER TABLE public.learning_journey ADD CONSTRAINT learning_journey_student_id_fkey
  FOREIGN KEY (student_id) REFERENCES identity.students(id) ON DELETE CASCADE;

ALTER TABLE public.narrative_progress DROP CONSTRAINT IF EXISTS narrative_progress_student_id_fkey;
ALTER TABLE public.narrative_progress ADD CONSTRAINT narrative_progress_student_id_fkey
  FOREIGN KEY (student_id) REFERENCES identity.students(id) ON DELETE CASCADE;

-- 3.2 Tables referencing teachers
ALTER TABLE public.class_teachers DROP CONSTRAINT IF EXISTS class_teachers_teacher_id_fkey;
ALTER TABLE public.class_teachers ADD CONSTRAINT class_teachers_teacher_id_fkey
  FOREIGN KEY (teacher_id) REFERENCES identity.teachers(id) ON DELETE CASCADE;

-- 3.3 Tables referencing guardians
ALTER TABLE public.guardian_student_links DROP CONSTRAINT IF EXISTS guardian_student_links_guardian_id_fkey;
ALTER TABLE public.guardian_student_links ADD CONSTRAINT guardian_student_links_guardian_id_fkey
  FOREIGN KEY (guardian_id) REFERENCES identity.guardians(id) ON DELETE CASCADE;

-- 3.4 Tables referencing schools
ALTER TABLE public.classes DROP CONSTRAINT IF EXISTS classes_school_id_fkey;
ALTER TABLE public.classes ADD CONSTRAINT classes_school_id_fkey
  FOREIGN KEY (school_id) REFERENCES identity.schools(id) ON DELETE CASCADE;

ALTER TABLE identity.students DROP CONSTRAINT IF EXISTS students_school_id_fkey;
ALTER TABLE identity.students ADD CONSTRAINT students_school_id_fkey
  FOREIGN KEY (school_id) REFERENCES identity.schools(id);

ALTER TABLE identity.teachers DROP CONSTRAINT IF EXISTS teachers_school_id_fkey;
ALTER TABLE identity.teachers ADD CONSTRAINT teachers_school_id_fkey
  FOREIGN KEY (school_id) REFERENCES identity.schools(id);

-- 3.5 Tables referencing classes
ALTER TABLE public.class_students DROP CONSTRAINT IF EXISTS class_students_class_id_fkey;
ALTER TABLE public.class_students ADD CONSTRAINT class_students_class_id_fkey
  FOREIGN KEY (class_id) REFERENCES identity.classes(id) ON DELETE CASCADE;

ALTER TABLE public.class_teachers DROP CONSTRAINT IF EXISTS class_teachers_class_id_fkey;
ALTER TABLE public.class_teachers ADD CONSTRAINT class_teachers_class_id_fkey
  FOREIGN KEY (class_id) REFERENCES identity.classes(id) ON DELETE CASCADE;

-- ============================================================================
-- PHASE 4: UPDATE RLS POLICIES FOR NEW SCHEMA
-- ============================================================================

-- 4.1 Students table RLS (identity schema)
DROP POLICY IF EXISTS students_select_own ON identity.students;
DROP POLICY IF EXISTS students_insert_own ON identity.students;
DROP POLICY IF EXISTS students_update_own ON identity.students;
DROP POLICY IF EXISTS students_service_role ON identity.students;

CREATE POLICY students_select_own ON identity.students
  FOR SELECT TO authenticated
  USING (auth_user_id = auth.uid());

CREATE POLICY students_insert_own ON identity.students
  FOR INSERT TO authenticated
  WITH CHECK (auth_user_id = auth.uid());

CREATE POLICY students_update_own ON identity.students
  FOR UPDATE TO authenticated
  USING (auth_user_id = auth.uid())
  WITH CHECK (auth_user_id = auth.uid());

CREATE POLICY students_service_role ON identity.students
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- 4.2 Teachers table RLS
DROP POLICY IF EXISTS teachers_select_own ON identity.teachers;
DROP POLICY IF EXISTS teachers_insert_own ON identity.teachers;
DROP POLICY IF EXISTS teachers_update_own ON identity.teachers;
DROP POLICY IF EXISTS teachers_service_role ON identity.teachers;

CREATE POLICY teachers_select_own ON identity.teachers
  FOR SELECT TO authenticated
  USING (auth_user_id = auth.uid());

CREATE POLICY teachers_insert_own ON identity.teachers
  FOR INSERT TO authenticated
  WITH CHECK (auth_user_id = auth.uid());

CREATE POLICY teachers_update_own ON identity.teachers
  FOR UPDATE TO authenticated
  USING (auth_user_id = auth.uid())
  WITH CHECK (auth_user_id = auth.uid());

CREATE POLICY teachers_service_role ON identity.teachers
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- 4.3 Guardians table RLS
DROP POLICY IF EXISTS guardians_select_own ON identity.guardians;
DROP POLICY IF EXISTS guardians_insert_own ON identity.guardians;
DROP POLICY IF EXISTS guardians_update_own ON identity.guardians;
DROP POLICY IF EXISTS guardians_service_role ON identity.guardians;

CREATE POLICY guardians_select_own ON identity.guardians
  FOR SELECT TO authenticated
  USING (auth_user_id = auth.uid());

CREATE POLICY guardians_insert_own ON identity.guardians
  FOR INSERT TO authenticated
  WITH CHECK (auth_user_id = auth.uid());

CREATE POLICY guardians_update_own ON identity.guardians
  FOR UPDATE TO authenticated
  USING (auth_user_id = auth.uid())
  WITH CHECK (auth_user_id = auth.uid());

CREATE POLICY guardians_service_role ON identity.guardians
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- 4.4 Schools table RLS (public read for onboarding)
DROP POLICY IF EXISTS schools_select_public ON identity.schools;
DROP POLICY IF EXISTS schools_service_role ON identity.schools;

CREATE POLICY schools_select_public ON identity.schools
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY schools_service_role ON identity.schools
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- 4.5 Classes table RLS
DROP POLICY IF EXISTS classes_select_public ON identity.classes;
DROP POLICY IF EXISTS classes_service_role ON identity.classes;

CREATE POLICY classes_select_public ON identity.classes
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY classes_service_role ON identity.classes
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- 4.6 Class_students table RLS
DROP POLICY IF EXISTS class_students_select_public ON identity.class_students;
DROP POLICY IF EXISTS class_students_service_role ON identity.class_students;

CREATE POLICY class_students_select_public ON identity.class_students
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY class_students_service_role ON identity.class_students
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- 4.7 Guardian_student_links table RLS
DROP POLICY IF EXISTS guardian_student_links_select_related ON identity.guardian_student_links;
DROP POLICY IF EXISTS guardian_student_links_insert_related ON identity.guardian_student_links;
DROP POLICY IF EXISTS guardian_student_links_update_related ON identity.guardian_student_links;
DROP POLICY IF EXISTS guardian_student_links_service_role ON identity.guardian_student_links;

CREATE POLICY guardian_student_links_select_related ON identity.guardian_student_links
  FOR SELECT TO authenticated
  USING (
    guardian_id IN (SELECT id FROM identity.guardians WHERE auth_user_id = auth.uid()) OR
    student_id IN (SELECT id FROM identity.students WHERE auth_user_id = auth.uid())
  );

CREATE POLICY guardian_student_links_insert_related ON identity.guardian_student_links
  FOR INSERT TO authenticated
  WITH CHECK (
    guardian_id IN (SELECT id FROM identity.guardians WHERE auth_user_id = auth.uid()) OR
    student_id IN (SELECT id FROM identity.students WHERE auth_user_id = auth.uid())
  );

CREATE POLICY guardian_student_links_update_related ON identity.guardian_student_links
  FOR UPDATE TO authenticated
  USING (
    guardian_id IN (SELECT id FROM identity.guardians WHERE auth_user_id = auth.uid()) OR
    student_id IN (SELECT id FROM identity.students WHERE auth_user_id = auth.uid())
  )
  WITH CHECK (
    guardian_id IN (SELECT id FROM identity.guardians WHERE auth_user_id = auth.uid()) OR
    student_id IN (SELECT id FROM identity.students WHERE auth_user_id = auth.uid())
  );

CREATE POLICY guardian_student_links_service_role ON identity.guardian_student_links
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- 4.8 User_roles table RLS
DROP POLICY IF EXISTS user_roles_select_own ON identity.user_roles;
DROP POLICY IF EXISTS user_roles_insert ON identity.user_roles;
DROP POLICY IF EXISTS user_roles_update ON identity.user_roles;
DROP POLICY IF EXISTS user_roles_delete ON identity.user_roles;
DROP POLICY IF EXISTS user_roles_service_role ON identity.user_roles;

CREATE POLICY user_roles_select_own ON identity.user_roles
  FOR SELECT TO authenticated
  USING (auth_user_id = auth.uid());

CREATE POLICY user_roles_insert ON identity.user_roles
  FOR INSERT TO authenticated
  WITH CHECK (auth_user_id = auth.uid());

CREATE POLICY user_roles_update ON identity.user_roles
  FOR UPDATE TO authenticated
  USING (auth_user_id = auth.uid())
  WITH CHECK (auth_user_id = auth.uid());

CREATE POLICY user_roles_delete ON identity.user_roles
  FOR DELETE TO authenticated
  USING (auth_user_id = auth.uid());

CREATE POLICY user_roles_service_role ON identity.user_roles
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- 4.9 User_active_sessions table RLS
DROP POLICY IF EXISTS uas_own_read ON identity.user_active_sessions;
DROP POLICY IF EXISTS uas_service ON identity.user_active_sessions;

CREATE POLICY uas_own_read ON identity.user_active_sessions
  FOR SELECT TO authenticated
  USING (auth_user_id = auth.uid());

CREATE POLICY uas_service ON identity.user_active_sessions
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- 4.10 Identity_events table RLS
DROP POLICY IF EXISTS ie_service ON identity.identity_events;

CREATE POLICY ie_service ON identity.identity_events
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- Apply explicit object permissions to all migrated identity tables.
-- Some tables were moved into `identity` after the initial GRANTs above.
GRANT SELECT ON ALL TABLES IN SCHEMA identity TO anon;
GRANT SELECT ON ALL TABLES IN SCHEMA identity TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA identity TO service_role;

-- ============================================================================
-- PHASE 5: CROSS-SERVICE PERMISSIONS
-- ============================================================================

-- Grant specific permissions to other services
-- Quiz service needs to read student data for scoring
GRANT SELECT ON identity.students TO anon;
GRANT SELECT ON identity.students TO authenticated;

-- Foxy service needs to read student profiles for personalization
GRANT SELECT ON identity.students TO anon;
GRANT SELECT ON identity.students TO authenticated;

-- Admin service needs full access to all identity tables
GRANT ALL ON ALL TABLES IN SCHEMA identity TO service_role;

-- ============================================================================
-- PHASE 6: VALIDATION AND MONITORING
-- ============================================================================

-- Create validation function to check migration integrity
CREATE OR REPLACE FUNCTION identity.validate_migration_integrity()
RETURNS TABLE(table_name TEXT, record_count BIGINT, fk_violations BIGINT) LANGUAGE plpgsql AS $$
BEGIN
  -- Check record counts
  RETURN QUERY SELECT 'identity.students'::TEXT, COUNT(*)::BIGINT, 0::BIGINT FROM identity.students;
  RETURN QUERY SELECT 'identity.teachers'::TEXT, COUNT(*)::BIGINT, 0::BIGINT FROM identity.teachers;
  RETURN QUERY SELECT 'identity.guardians'::TEXT, COUNT(*)::BIGINT, 0::BIGINT FROM identity.guardians;
  RETURN QUERY SELECT 'identity.schools'::TEXT, COUNT(*)::BIGINT, 0::BIGINT FROM identity.schools;
  RETURN QUERY SELECT 'identity.classes'::TEXT, COUNT(*)::BIGINT, 0::BIGINT FROM identity.classes;
  RETURN QUERY SELECT 'identity.class_students'::TEXT, COUNT(*)::BIGINT, 0::BIGINT FROM identity.class_students;
  RETURN QUERY SELECT 'identity.guardian_student_links'::TEXT, COUNT(*)::BIGINT, 0::BIGINT FROM identity.guardian_student_links;
  RETURN QUERY SELECT 'identity.user_roles'::TEXT, COUNT(*)::BIGINT, 0::BIGINT FROM identity.user_roles;
  RETURN QUERY SELECT 'identity.user_active_sessions'::TEXT, COUNT(*)::BIGINT, 0::BIGINT FROM identity.user_active_sessions;
  RETURN QUERY SELECT 'identity.identity_events'::TEXT, COUNT(*)::BIGINT, 0::BIGINT FROM identity.identity_events;
END;
$$;

-- Log migration completion
INSERT INTO identity.identity_events (auth_user_id, event_type, metadata)
SELECT
  '00000000-0000-0000-0000-000000000000'::UUID,
  'migration_completed',
  jsonb_build_object(
    'migration', 'identity_service_extraction',
    'timestamp', now(),
    'tables_moved', jsonb_build_array(
      'students', 'teachers', 'guardians', 'schools', 'classes',
      'class_students', 'guardian_student_links', 'user_roles',
      'user_active_sessions', 'identity_events'
    )
  );

-- ============================================================================
-- ROLLBACK PROCEDURES (DOCUMENTED BELOW)
-- ============================================================================

/*
ROLLBACK MIGRATION: 20260423151531_rollback_identity_service_extraction.sql

-- Phase 1: Move tables back to public schema
ALTER TABLE identity.students SET SCHEMA public;
ALTER TABLE identity.teachers SET SCHEMA public;
ALTER TABLE identity.guardians SET SCHEMA public;
ALTER TABLE identity.schools SET SCHEMA public;
ALTER TABLE identity.classes SET SCHEMA public;
ALTER TABLE identity.class_students SET SCHEMA public;
ALTER TABLE identity.guardian_student_links SET SCHEMA public;
ALTER TABLE identity.user_roles SET SCHEMA public;
ALTER TABLE identity.user_active_sessions SET SCHEMA public;
ALTER TABLE identity.identity_events SET SCHEMA public;

-- Phase 2: Update foreign keys back to public schema
-- [Reverse all the ALTER TABLE ... DROP CONSTRAINT / ADD CONSTRAINT statements]

-- Phase 3: Drop identity schema
DROP SCHEMA IF EXISTS identity CASCADE;

-- Phase 4: Log rollback
INSERT INTO identity_events (auth_user_id, event_type, metadata)
SELECT '00000000-0000-0000-0000-000000000000'::UUID, 'migration_rolled_back',
       jsonb_build_object('migration', 'identity_service_extraction', 'timestamp', now());
*/