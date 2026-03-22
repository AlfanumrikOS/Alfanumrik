-- Migration 003: Row Level Security Policies and Performance Indexes
-- Assumes tables from 001 and 002, and helper functions:
--   get_student_id_for_auth(), is_guardian_of(UUID), is_teacher_of(UUID)

-- =============================================================================
-- 1. ENABLE RLS ON ALL TABLES
-- =============================================================================

ALTER TABLE students ENABLE ROW LEVEL SECURITY;
ALTER TABLE teachers ENABLE ROW LEVEL SECURITY;
ALTER TABLE guardians ENABLE ROW LEVEL SECURITY;
ALTER TABLE guardian_student_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE class_enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE curriculum_topics ENABLE ROW LEVEL SECURITY;
ALTER TABLE interactive_simulations ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_learning_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE concept_mastery ENABLE ROW LEVEL SECURITY;
ALTER TABLE topic_mastery ENABLE ROW LEVEL SECURITY;
ALTER TABLE quiz_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE spaced_repetition_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE question_bank ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_simulation_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_response_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE study_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE study_plan_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE achievements ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_achievements ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_titles ENABLE ROW LEVEL SECURITY;
ALTER TABLE competitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE competition_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE feature_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_queue ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- 2. RLS POLICIES
-- =============================================================================

-- -----------------------------------------------------------------------------
-- students
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "students_select_own" ON students;
CREATE POLICY "students_select_own" ON students
  FOR SELECT USING (auth.uid() = auth_user_id);

DROP POLICY IF EXISTS "students_select_guardian" ON students;
CREATE POLICY "students_select_guardian" ON students
  FOR SELECT USING (is_guardian_of(id));

DROP POLICY IF EXISTS "students_select_teacher" ON students;
CREATE POLICY "students_select_teacher" ON students
  FOR SELECT USING (is_teacher_of(id));

DROP POLICY IF EXISTS "students_update_own" ON students;
CREATE POLICY "students_update_own" ON students
  FOR UPDATE USING (auth.uid() = auth_user_id)
  WITH CHECK (auth.uid() = auth_user_id);

-- -----------------------------------------------------------------------------
-- teachers
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "teachers_select_own" ON teachers;
CREATE POLICY "teachers_select_own" ON teachers
  FOR SELECT USING (auth.uid() = auth_user_id);

DROP POLICY IF EXISTS "teachers_update_own" ON teachers;
CREATE POLICY "teachers_update_own" ON teachers
  FOR UPDATE USING (auth.uid() = auth_user_id)
  WITH CHECK (auth.uid() = auth_user_id);

-- -----------------------------------------------------------------------------
-- guardians
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "guardians_select_own" ON guardians;
CREATE POLICY "guardians_select_own" ON guardians
  FOR SELECT USING (auth.uid() = auth_user_id);

DROP POLICY IF EXISTS "guardians_update_own" ON guardians;
CREATE POLICY "guardians_update_own" ON guardians
  FOR UPDATE USING (auth.uid() = auth_user_id)
  WITH CHECK (auth.uid() = auth_user_id);

-- -----------------------------------------------------------------------------
-- guardian_student_links
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "gsl_select" ON guardian_student_links;
CREATE POLICY "gsl_select" ON guardian_student_links
  FOR SELECT USING (
    student_id = get_student_id_for_auth()
    OR guardian_id IN (SELECT id FROM guardians WHERE auth_user_id = auth.uid())
  );

DROP POLICY IF EXISTS "gsl_insert" ON guardian_student_links;
CREATE POLICY "gsl_insert" ON guardian_student_links
  FOR INSERT WITH CHECK (
    guardian_id IN (SELECT id FROM guardians WHERE auth_user_id = auth.uid())
  );

-- -----------------------------------------------------------------------------
-- classes
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "classes_select" ON classes;
CREATE POLICY "classes_select" ON classes
  FOR SELECT USING (
    teacher_id IN (SELECT id FROM teachers WHERE auth_user_id = auth.uid())
    OR id IN (SELECT class_id FROM class_enrollments WHERE student_id = get_student_id_for_auth())
  );

DROP POLICY IF EXISTS "classes_insert" ON classes;
CREATE POLICY "classes_insert" ON classes
  FOR INSERT WITH CHECK (
    teacher_id IN (SELECT id FROM teachers WHERE auth_user_id = auth.uid())
  );

DROP POLICY IF EXISTS "classes_update" ON classes;
CREATE POLICY "classes_update" ON classes
  FOR UPDATE USING (
    teacher_id IN (SELECT id FROM teachers WHERE auth_user_id = auth.uid())
  ) WITH CHECK (
    teacher_id IN (SELECT id FROM teachers WHERE auth_user_id = auth.uid())
  );

DROP POLICY IF EXISTS "classes_delete" ON classes;
CREATE POLICY "classes_delete" ON classes
  FOR DELETE USING (
    teacher_id IN (SELECT id FROM teachers WHERE auth_user_id = auth.uid())
  );

-- -----------------------------------------------------------------------------
-- class_enrollments
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "ce_select" ON class_enrollments;
CREATE POLICY "ce_select" ON class_enrollments
  FOR SELECT USING (
    student_id = get_student_id_for_auth()
    OR class_id IN (
      SELECT id FROM classes
      WHERE teacher_id IN (SELECT id FROM teachers WHERE auth_user_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "ce_insert" ON class_enrollments;
CREATE POLICY "ce_insert" ON class_enrollments
  FOR INSERT WITH CHECK (
    class_id IN (
      SELECT id FROM classes
      WHERE teacher_id IN (SELECT id FROM teachers WHERE auth_user_id = auth.uid())
    )
  );

-- -----------------------------------------------------------------------------
-- Student-owned learning data (bulk policies)
-- Tables: student_learning_profiles, concept_mastery, topic_mastery,
--         quiz_sessions, spaced_repetition_cards, student_simulation_progress,
--         chat_sessions, study_plans, student_achievements, student_titles,
--         competition_entries
-- -----------------------------------------------------------------------------

DO $$
DECLARE
  tbl TEXT;
  tbls TEXT[] := ARRAY[
    'student_learning_profiles',
    'concept_mastery',
    'topic_mastery',
    'quiz_sessions',
    'spaced_repetition_cards',
    'student_simulation_progress',
    'chat_sessions',
    'study_plans',
    'student_achievements',
    'student_titles',
    'competition_entries'
  ];
BEGIN
  FOREACH tbl IN ARRAY tbls LOOP
    -- SELECT own
    EXECUTE format('DROP POLICY IF EXISTS "%s_select_own" ON %I', tbl, tbl);
    EXECUTE format(
      'CREATE POLICY "%s_select_own" ON %I FOR SELECT USING (student_id = get_student_id_for_auth())',
      tbl, tbl
    );

    -- SELECT as guardian
    EXECUTE format('DROP POLICY IF EXISTS "%s_select_guardian" ON %I', tbl, tbl);
    EXECUTE format(
      'CREATE POLICY "%s_select_guardian" ON %I FOR SELECT USING (is_guardian_of(student_id))',
      tbl, tbl
    );

    -- SELECT as teacher
    EXECUTE format('DROP POLICY IF EXISTS "%s_select_teacher" ON %I', tbl, tbl);
    EXECUTE format(
      'CREATE POLICY "%s_select_teacher" ON %I FOR SELECT USING (is_teacher_of(student_id))',
      tbl, tbl
    );

    -- INSERT own
    EXECUTE format('DROP POLICY IF EXISTS "%s_insert_own" ON %I', tbl, tbl);
    EXECUTE format(
      'CREATE POLICY "%s_insert_own" ON %I FOR INSERT WITH CHECK (student_id = get_student_id_for_auth())',
      tbl, tbl
    );

    -- UPDATE own
    EXECUTE format('DROP POLICY IF EXISTS "%s_update_own" ON %I', tbl, tbl);
    EXECUTE format(
      'CREATE POLICY "%s_update_own" ON %I FOR UPDATE USING (student_id = get_student_id_for_auth()) WITH CHECK (student_id = get_student_id_for_auth())',
      tbl, tbl
    );
  END LOOP;
END
$$;

-- -----------------------------------------------------------------------------
-- study_plan_tasks
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "spt_select" ON study_plan_tasks;
CREATE POLICY "spt_select" ON study_plan_tasks
  FOR SELECT USING (
    plan_id IN (SELECT id FROM study_plans WHERE student_id = get_student_id_for_auth())
  );

DROP POLICY IF EXISTS "spt_update" ON study_plan_tasks;
CREATE POLICY "spt_update" ON study_plan_tasks
  FOR UPDATE USING (
    plan_id IN (SELECT id FROM study_plans WHERE student_id = get_student_id_for_auth())
  ) WITH CHECK (
    plan_id IN (SELECT id FROM study_plans WHERE student_id = get_student_id_for_auth())
  );

-- -----------------------------------------------------------------------------
-- ai_response_reports
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "air_insert_own" ON ai_response_reports;
CREATE POLICY "air_insert_own" ON ai_response_reports
  FOR INSERT WITH CHECK (student_id = get_student_id_for_auth());

DROP POLICY IF EXISTS "air_select_own" ON ai_response_reports;
CREATE POLICY "air_select_own" ON ai_response_reports
  FOR SELECT USING (student_id = get_student_id_for_auth());

-- -----------------------------------------------------------------------------
-- Content tables (read-only for all authenticated users)
-- Tables: subjects, curriculum_topics, interactive_simulations,
--         achievements, feature_flags, question_bank, competitions
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "subjects_select_authenticated" ON subjects;
CREATE POLICY "subjects_select_authenticated" ON subjects
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "curriculum_topics_select_authenticated" ON curriculum_topics;
CREATE POLICY "curriculum_topics_select_authenticated" ON curriculum_topics
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "interactive_simulations_select_authenticated" ON interactive_simulations;
CREATE POLICY "interactive_simulations_select_authenticated" ON interactive_simulations
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "achievements_select_authenticated" ON achievements;
CREATE POLICY "achievements_select_authenticated" ON achievements
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "feature_flags_select_authenticated" ON feature_flags;
CREATE POLICY "feature_flags_select_authenticated" ON feature_flags
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "question_bank_select_authenticated" ON question_bank;
CREATE POLICY "question_bank_select_authenticated" ON question_bank
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "competitions_select_authenticated" ON competitions;
CREATE POLICY "competitions_select_authenticated" ON competitions
  FOR SELECT TO authenticated USING (true);

-- -----------------------------------------------------------------------------
-- notifications
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "notifications_select" ON notifications;
CREATE POLICY "notifications_select" ON notifications
  FOR SELECT USING (
    recipient_id = get_student_id_for_auth()
    OR recipient_id IN (SELECT id FROM teachers WHERE auth_user_id = auth.uid())
    OR recipient_id IN (SELECT id FROM guardians WHERE auth_user_id = auth.uid())
  );

DROP POLICY IF EXISTS "notifications_update" ON notifications;
CREATE POLICY "notifications_update" ON notifications
  FOR UPDATE USING (
    recipient_id = get_student_id_for_auth()
    OR recipient_id IN (SELECT id FROM teachers WHERE auth_user_id = auth.uid())
    OR recipient_id IN (SELECT id FROM guardians WHERE auth_user_id = auth.uid())
  ) WITH CHECK (
    recipient_id = get_student_id_for_auth()
    OR recipient_id IN (SELECT id FROM teachers WHERE auth_user_id = auth.uid())
    OR recipient_id IN (SELECT id FROM guardians WHERE auth_user_id = auth.uid())
  );

-- -----------------------------------------------------------------------------
-- support_tickets
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "support_tickets_insert" ON support_tickets;
CREATE POLICY "support_tickets_insert" ON support_tickets
  FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "support_tickets_select_own" ON support_tickets;
CREATE POLICY "support_tickets_select_own" ON support_tickets
  FOR SELECT USING (student_id = get_student_id_for_auth());

-- -----------------------------------------------------------------------------
-- assignments
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "assignments_select" ON assignments;
CREATE POLICY "assignments_select" ON assignments
  FOR SELECT USING (
    class_id IN (
      SELECT id FROM classes
      WHERE teacher_id IN (SELECT id FROM teachers WHERE auth_user_id = auth.uid())
    )
    OR class_id IN (
      SELECT class_id FROM class_enrollments
      WHERE student_id = get_student_id_for_auth()
    )
  );

DROP POLICY IF EXISTS "assignments_insert" ON assignments;
CREATE POLICY "assignments_insert" ON assignments
  FOR INSERT WITH CHECK (
    class_id IN (
      SELECT id FROM classes
      WHERE teacher_id IN (SELECT id FROM teachers WHERE auth_user_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "assignments_update" ON assignments;
CREATE POLICY "assignments_update" ON assignments
  FOR UPDATE USING (
    class_id IN (
      SELECT id FROM classes
      WHERE teacher_id IN (SELECT id FROM teachers WHERE auth_user_id = auth.uid())
    )
  ) WITH CHECK (
    class_id IN (
      SELECT id FROM classes
      WHERE teacher_id IN (SELECT id FROM teachers WHERE auth_user_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "assignments_delete" ON assignments;
CREATE POLICY "assignments_delete" ON assignments
  FOR DELETE USING (
    class_id IN (
      SELECT id FROM classes
      WHERE teacher_id IN (SELECT id FROM teachers WHERE auth_user_id = auth.uid())
    )
  );

-- -----------------------------------------------------------------------------
-- task_queue (service_role only — no public policies)
-- RLS is enabled but no policies are created, so only service_role can access.
-- -----------------------------------------------------------------------------

-- =============================================================================
-- 3. PERFORMANCE INDEXES
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_students_auth_user_id
  ON students(auth_user_id);

CREATE INDEX IF NOT EXISTS idx_slp_student_subject
  ON student_learning_profiles(student_id, subject);

CREATE INDEX IF NOT EXISTS idx_cm_student_concept
  ON concept_mastery(student_id, concept_id);

CREATE INDEX IF NOT EXISTS idx_cm_student_review
  ON concept_mastery(student_id, next_review_at);

CREATE INDEX IF NOT EXISTS idx_tm_student_subject
  ON topic_mastery(student_id, subject);

CREATE INDEX IF NOT EXISTS idx_qs_student_completed
  ON quiz_sessions(student_id, completed_at DESC);

CREATE INDEX IF NOT EXISTS idx_src_student_review
  ON spaced_repetition_cards(student_id, next_review_date);

CREATE INDEX IF NOT EXISTS idx_gsl_invite_code
  ON guardian_student_links(invite_code);

CREATE INDEX IF NOT EXISTS idx_gsl_student
  ON guardian_student_links(student_id);

CREATE INDEX IF NOT EXISTS idx_gsl_guardian
  ON guardian_student_links(guardian_id);

CREATE INDEX IF NOT EXISTS idx_ce_student
  ON class_enrollments(student_id);

CREATE INDEX IF NOT EXISTS idx_ce_class
  ON class_enrollments(class_id);

CREATE INDEX IF NOT EXISTS idx_notif_recipient
  ON notifications(recipient_id, recipient_type, is_read, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sim_subject_grade
  ON interactive_simulations(subject_code, grade, is_active);

CREATE INDEX IF NOT EXISTS idx_chat_student_updated
  ON chat_sessions(student_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_tq_queue_status
  ON task_queue(queue_name, status, created_at);

CREATE INDEX IF NOT EXISTS idx_ct_subject_grade
  ON curriculum_topics(subject_id, grade, is_active, display_order);

CREATE INDEX IF NOT EXISTS idx_qb_grade_subject
  ON question_bank(grade, subject_id, is_active);

CREATE INDEX IF NOT EXISTS idx_spt_plan_order
  ON study_plan_tasks(plan_id, day_number, task_order);

CREATE INDEX IF NOT EXISTS idx_comp_status
  ON competitions(status);

CREATE INDEX IF NOT EXISTS idx_assignments_class
  ON assignments(class_id, due_date);
