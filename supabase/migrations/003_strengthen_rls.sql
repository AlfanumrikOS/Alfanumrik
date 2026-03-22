-- ============================================================
-- Migration 003: Strengthen Row Level Security Policies
-- Project: Alfanumrik
-- Description: Adds and updates RLS policies for guardians
--              and teachers to access student learning data,
--              and service role policies for system tables
-- ============================================================

-- ============================================================
-- SECTION 1: Enable RLS on System Tables
-- ============================================================

ALTER TABLE task_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- SECTION 2: Guardian and Teacher SELECT Policies
--            for Student Learning Data
-- ============================================================

-- Guardian SELECT on concept_mastery
DROP POLICY IF EXISTS "concept_mastery_select_guardian" ON concept_mastery;
CREATE POLICY "concept_mastery_select_guardian" ON concept_mastery
  FOR SELECT USING (is_guardian_of(student_id));

-- Teacher SELECT on concept_mastery
DROP POLICY IF EXISTS "concept_mastery_select_teacher" ON concept_mastery;
CREATE POLICY "concept_mastery_select_teacher" ON concept_mastery
  FOR SELECT USING (is_teacher_of(student_id));

-- Guardian SELECT on spaced_repetition_cards
DROP POLICY IF EXISTS "spaced_repetition_cards_select_guardian" ON spaced_repetition_cards;
CREATE POLICY "spaced_repetition_cards_select_guardian" ON spaced_repetition_cards
  FOR SELECT USING (is_guardian_of(student_id));

-- Teacher SELECT on spaced_repetition_cards
DROP POLICY IF EXISTS "spaced_repetition_cards_select_teacher" ON spaced_repetition_cards;
CREATE POLICY "spaced_repetition_cards_select_teacher" ON spaced_repetition_cards
  FOR SELECT USING (is_teacher_of(student_id));

-- Guardian SELECT on student_simulation_progress
DROP POLICY IF EXISTS "student_simulation_progress_select_guardian" ON student_simulation_progress;
CREATE POLICY "student_simulation_progress_select_guardian" ON student_simulation_progress
  FOR SELECT USING (is_guardian_of(student_id));

-- Teacher SELECT on student_simulation_progress
DROP POLICY IF EXISTS "student_simulation_progress_select_teacher" ON student_simulation_progress;
CREATE POLICY "student_simulation_progress_select_teacher" ON student_simulation_progress
  FOR SELECT USING (is_teacher_of(student_id));

-- Guardian SELECT on study_plan_tasks
DROP POLICY IF EXISTS "study_plan_tasks_select_guardian" ON study_plan_tasks;
CREATE POLICY "study_plan_tasks_select_guardian" ON study_plan_tasks
  FOR SELECT USING (
    plan_id IN (
      SELECT id FROM study_plans WHERE is_guardian_of(student_id)
    )
  );

-- Teacher SELECT on study_plan_tasks
DROP POLICY IF EXISTS "study_plan_tasks_select_teacher" ON study_plan_tasks;
CREATE POLICY "study_plan_tasks_select_teacher" ON study_plan_tasks
  FOR SELECT USING (
    plan_id IN (
      SELECT id FROM study_plans WHERE is_teacher_of(student_id)
    )
  );

-- Guardian SELECT on study_plans
DROP POLICY IF EXISTS "study_plans_select_guardian" ON study_plans;
CREATE POLICY "study_plans_select_guardian" ON study_plans
  FOR SELECT USING (is_guardian_of(student_id));

-- Teacher SELECT on study_plans
DROP POLICY IF EXISTS "study_plans_select_teacher" ON study_plans;
CREATE POLICY "study_plans_select_teacher" ON study_plans
  FOR SELECT USING (is_teacher_of(student_id));

-- Guardian SELECT on quiz_sessions
DROP POLICY IF EXISTS "quiz_sessions_select_guardian" ON quiz_sessions;
CREATE POLICY "quiz_sessions_select_guardian" ON quiz_sessions
  FOR SELECT USING (is_guardian_of(student_id));

-- Teacher SELECT on quiz_sessions
DROP POLICY IF EXISTS "quiz_sessions_select_teacher" ON quiz_sessions;
CREATE POLICY "quiz_sessions_select_teacher" ON quiz_sessions
  FOR SELECT USING (is_teacher_of(student_id));

-- Guardian SELECT on student_learning_profiles
DROP POLICY IF EXISTS "student_learning_profiles_select_guardian" ON student_learning_profiles;
CREATE POLICY "student_learning_profiles_select_guardian" ON student_learning_profiles
  FOR SELECT USING (is_guardian_of(student_id));

-- Teacher SELECT on student_learning_profiles
DROP POLICY IF EXISTS "student_learning_profiles_select_teacher" ON student_learning_profiles;
CREATE POLICY "student_learning_profiles_select_teacher" ON student_learning_profiles
  FOR SELECT USING (is_teacher_of(student_id));

-- Guardian SELECT on topic_mastery
DROP POLICY IF EXISTS "topic_mastery_select_guardian" ON topic_mastery;
CREATE POLICY "topic_mastery_select_guardian" ON topic_mastery
  FOR SELECT USING (is_guardian_of(student_id));

-- Teacher SELECT on topic_mastery
DROP POLICY IF EXISTS "topic_mastery_select_teacher" ON topic_mastery;
CREATE POLICY "topic_mastery_select_teacher" ON topic_mastery
  FOR SELECT USING (is_teacher_of(student_id));

-- ============================================================
-- SECTION 3: Service Role Policies
-- ============================================================

-- Service role INSERT on notifications (for system-generated messages)
DROP POLICY IF EXISTS "notifications_insert_service_role" ON notifications;
CREATE POLICY "notifications_insert_service_role" ON notifications
  FOR INSERT TO service_role WITH CHECK (true);

-- Service role SELECT on notifications (for administrative access)
DROP POLICY IF EXISTS "notifications_select_service_role" ON notifications;
CREATE POLICY "notifications_select_service_role" ON notifications
  FOR SELECT TO service_role USING (true);

-- Service role UPDATE on notifications
DROP POLICY IF EXISTS "notifications_update_service_role" ON notifications;
CREATE POLICY "notifications_update_service_role" ON notifications
  FOR UPDATE TO service_role USING (true) WITH CHECK (true);

-- Service role on task_queue (full access for background jobs)
DROP POLICY IF EXISTS "task_queue_service_role" ON task_queue;
CREATE POLICY "task_queue_service_role" ON task_queue
  TO service_role USING (true) WITH CHECK (true);

-- ============================================================
-- SECTION 4: Student Learning Profile Policies
-- ============================================================

-- Student SELECT own profiles
DROP POLICY IF EXISTS "student_learning_profiles_select_own" ON student_learning_profiles;
CREATE POLICY "student_learning_profiles_select_own" ON student_learning_profiles
  FOR SELECT USING (student_id = get_student_id_for_auth());

-- Student INSERT own profiles
DROP POLICY IF EXISTS "student_learning_profiles_insert_own" ON student_learning_profiles;
CREATE POLICY "student_learning_profiles_insert_own" ON student_learning_profiles
  FOR INSERT WITH CHECK (student_id = get_student_id_for_auth());

-- Student UPDATE own profiles
DROP POLICY IF EXISTS "student_learning_profiles_update_own" ON student_learning_profiles;
CREATE POLICY "student_learning_profiles_update_own" ON student_learning_profiles
  FOR UPDATE USING (student_id = get_student_id_for_auth()) WITH CHECK (student_id = get_student_id_for_auth());

-- ============================================================
-- SECTION 5: Concept Mastery Policies
-- ============================================================

-- Student SELECT own mastery data
DROP POLICY IF EXISTS "concept_mastery_select_own" ON concept_mastery;
CREATE POLICY "concept_mastery_select_own" ON concept_mastery
  FOR SELECT USING (student_id = get_student_id_for_auth());

-- Student INSERT own mastery data
DROP POLICY IF EXISTS "concept_mastery_insert_own" ON concept_mastery;
CREATE POLICY "concept_mastery_insert_own" ON concept_mastery
  FOR INSERT WITH CHECK (student_id = get_student_id_for_auth());

-- Student UPDATE own mastery data
DROP POLICY IF EXISTS "concept_mastery_update_own" ON concept_mastery;
CREATE POLICY "concept_mastery_update_own" ON concept_mastery
  FOR UPDATE USING (student_id = get_student_id_for_auth()) WITH CHECK (student_id = get_student_id_for_auth());

-- ============================================================
-- SECTION 6: Spaced Repetition Cards Policies
-- ============================================================

-- Student SELECT own cards
DROP POLICY IF EXISTS "spaced_repetition_cards_select_own" ON spaced_repetition_cards;
CREATE POLICY "spaced_repetition_cards_select_own" ON spaced_repetition_cards
  FOR SELECT USING (student_id = get_student_id_for_auth());

-- Student INSERT own cards
DROP POLICY IF EXISTS "spaced_repetition_cards_insert_own" ON spaced_repetition_cards;
CREATE POLICY "spaced_repetition_cards_insert_own" ON spaced_repetition_cards
  FOR INSERT WITH CHECK (student_id = get_student_id_for_auth());

-- Student UPDATE own cards
DROP POLICY IF EXISTS "spaced_repetition_cards_update_own" ON spaced_repetition_cards;
CREATE POLICY "spaced_repetition_cards_update_own" ON spaced_repetition_cards
  FOR UPDATE USING (student_id = get_student_id_for_auth()) WITH CHECK (student_id = get_student_id_for_auth());

-- ============================================================
-- SECTION 7: Student Simulation Progress Policies
-- ============================================================

-- Student SELECT own simulations
DROP POLICY IF EXISTS "student_simulation_progress_select_own" ON student_simulation_progress;
CREATE POLICY "student_simulation_progress_select_own" ON student_simulation_progress
  FOR SELECT USING (student_id = get_student_id_for_auth());

-- Student INSERT own simulations
DROP POLICY IF EXISTS "student_simulation_progress_insert_own" ON student_simulation_progress;
CREATE POLICY "student_simulation_progress_insert_own" ON student_simulation_progress
  FOR INSERT WITH CHECK (student_id = get_student_id_for_auth());

-- Student UPDATE own simulations
DROP POLICY IF EXISTS "student_simulation_progress_update_own" ON student_simulation_progress;
CREATE POLICY "student_simulation_progress_update_own" ON student_simulation_progress
  FOR UPDATE USING (student_id = get_student_id_for_auth()) WITH CHECK (student_id = get_student_id_for_auth());

-- ============================================================
-- SECTION 8: Study Plans and Tasks Policies
-- ============================================================

-- Student SELECT own plans
DROP POLICY IF EXISTS "study_plans_select_own" ON study_plans;
CREATE POLICY "study_plans_select_own" ON study_plans
  FOR SELECT USING (student_id = get_student_id_for_auth());

-- Student INSERT own plans
DROP POLICY IF EXISTS "study_plans_insert_own" ON study_plans;
CREATE POLICY "study_plans_insert_own" ON study_plans
  FOR INSERT WITH CHECK (student_id = get_student_id_for_auth());

-- Student UPDATE own plans
DROP POLICY IF EXISTS "study_plans_update_own" ON study_plans;
CREATE POLICY "study_plans_update_own" ON study_plans
  FOR UPDATE USING (student_id = get_student_id_for_auth()) WITH CHECK (student_id = get_student_id_for_auth());

-- Study plan tasks policies
DROP POLICY IF EXISTS "study_plan_tasks_select_own" ON study_plan_tasks;
CREATE POLICY "study_plan_tasks_select_own" ON study_plan_tasks
  FOR SELECT USING (
    plan_id IN (SELECT id FROM study_plans WHERE student_id = get_student_id_for_auth())
  );

DROP POLICY IF EXISTS "study_plan_tasks_insert_own" ON study_plan_tasks;
CREATE POLICY "study_plan_tasks_insert_own" ON study_plan_tasks
  FOR INSERT WITH CHECK (
    plan_id IN (SELECT id FROM study_plans WHERE student_id = get_student_id_for_auth())
  );

DROP POLICY IF EXISTS "study_plan_tasks_update_own" ON study_plan_tasks;
CREATE POLICY "study_plan_tasks_update_own" ON study_plan_tasks
  FOR UPDATE USING (
    plan_id IN (SELECT id FROM study_plans WHERE student_id = get_student_id_for_auth())
  ) WITH CHECK (
    plan_id IN (SELECT id FROM study_plans WHERE student_id = get_student_id_for_auth())
  );

-- ============================================================
-- SECTION 9: Quiz Sessions Policies
-- ============================================================

-- Student SELECT own quiz sessions
DROP POLICY IF EXISTS "quiz_sessions_select_own" ON quiz_sessions;
CREATE POLICY "quiz_sessions_select_own" ON quiz_sessions
  FOR SELECT USING (student_id = get_student_id_for_auth());

-- Student INSERT own quiz sessions
DROP POLICY IF EXISTS "quiz_sessions_insert_own" ON quiz_sessions;
CREATE POLICY "quiz_sessions_insert_own" ON quiz_sessions
  FOR INSERT WITH CHECK (student_id = get_student_id_for_auth());

-- Student UPDATE own quiz sessions
DROP POLICY IF EXISTS "quiz_sessions_update_own" ON quiz_sessions;
CREATE POLICY "quiz_sessions_update_own" ON quiz_sessions
  FOR UPDATE USING (student_id = get_student_id_for_auth()) WITH CHECK (student_id = get_student_id_for_auth());

-- ============================================================
-- SECTION 10: Topic Mastery Policies
-- ============================================================

-- Student SELECT own topic mastery
DROP POLICY IF EXISTS "topic_mastery_select_own" ON topic_mastery;
CREATE POLICY "topic_mastery_select_own" ON topic_mastery
  FOR SELECT USING (student_id = get_student_id_for_auth());

-- Student INSERT own topic mastery
DROP POLICY IF EXISTS "topic_mastery_insert_own" ON topic_mastery;
CREATE POLICY "topic_mastery_insert_own" ON topic_mastery
  FOR INSERT WITH CHECK (student_id = get_student_id_for_auth());

-- Student UPDATE own topic mastery
DROP POLICY IF EXISTS "topic_mastery_update_own" ON topic_mastery;
CREATE POLICY "topic_mastery_update_own" ON topic_mastery
  FOR UPDATE USING (student_id = get_student_id_for_auth()) WITH CHECK (student_id = get_student_id_for_auth());
