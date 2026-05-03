-- Migration: 20260416210000_phase2_classes_reports.sql
-- Purpose: Phase 2A B2B school tables — class_enrollments, school_announcements,
--          school_questions, school_exams, plus report-query composite indexes.
--
-- NOTE: A legacy `class_students` table exists from 000_core_schema.sql and is
-- still referenced by 5+ source files. This migration creates the canonical
-- `class_enrollments` table with a cleaner design (UNIQUE constraint, partial
-- indexes). A future migration should migrate data from class_students to
-- class_enrollments and deprecate the old table.

-- ============================================================================
-- 0. Helper: get_admin_school_id()
-- Returns the school_id for the currently authenticated admin user.
-- Used in RLS policies so school admins can access their own school's data.
-- ============================================================================
CREATE OR REPLACE FUNCTION get_admin_school_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT school_id FROM teachers
  WHERE auth_user_id = auth.uid()
  LIMIT 1
$$;

-- ============================================================================
-- 1. class_enrollments
-- ============================================================================
CREATE TABLE IF NOT EXISTS class_enrollments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id    UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  student_id  UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  enrolled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_active   BOOLEAN NOT NULL DEFAULT true,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(class_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_class_enrollments_class
  ON class_enrollments (class_id) WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_class_enrollments_student
  ON class_enrollments (student_id) WHERE is_active = true;

ALTER TABLE class_enrollments ENABLE ROW LEVEL SECURITY;

-- Service role bypass (API routes use service role)
CREATE POLICY "class_enrollments_service_role" ON class_enrollments
  FOR ALL USING (auth.role() = 'service_role');

-- School admins can view enrollments for their school's classes
CREATE POLICY "class_enrollments_school_admin_select" ON class_enrollments
  FOR SELECT TO authenticated
  USING (
    class_id IN (
      SELECT id FROM classes WHERE school_id = get_admin_school_id()
    )
  );

-- Students can view their own enrollments
CREATE POLICY "class_enrollments_student_select" ON class_enrollments
  FOR SELECT TO authenticated
  USING (
    student_id IN (
      SELECT id FROM students WHERE auth_user_id = auth.uid()
    )
  );

-- Parents can view enrollments for linked children
CREATE POLICY "class_enrollments_parent_select" ON class_enrollments
  FOR SELECT TO authenticated
  USING (
    student_id IN (
      SELECT student_id FROM guardian_student_links
      WHERE guardian_id IN (
        SELECT id FROM guardians WHERE auth_user_id = auth.uid()
      )
      AND status = 'approved'
    )
  );

-- Teachers can view enrollments for classes they teach
CREATE POLICY "class_enrollments_teacher_select" ON class_enrollments
  FOR SELECT TO authenticated
  USING (
    class_id IN (
      SELECT class_id FROM class_teachers
      WHERE teacher_id IN (
        SELECT id FROM teachers WHERE auth_user_id = auth.uid()
      )
      AND is_active = true
    )
  );

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_class_enrollments_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_class_enrollments_updated_at ON class_enrollments;
CREATE TRIGGER trg_class_enrollments_updated_at
  BEFORE UPDATE ON class_enrollments
  FOR EACH ROW EXECUTE FUNCTION update_class_enrollments_updated_at();


-- ============================================================================
-- 2. school_announcements
-- ============================================================================
CREATE TABLE IF NOT EXISTS school_announcements (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id       UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  title_hi        TEXT,
  body            TEXT NOT NULL,
  body_hi         TEXT,
  target_grades   TEXT[],
  target_classes  UUID[],
  created_by      UUID NOT NULL REFERENCES auth.users(id),
  published_at    TIMESTAMPTZ,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_announcements_school
  ON school_announcements (school_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_announcements_published
  ON school_announcements (school_id, published_at DESC)
  WHERE is_active = true AND published_at IS NOT NULL;

ALTER TABLE school_announcements ENABLE ROW LEVEL SECURITY;

-- Service role bypass
CREATE POLICY "announcements_service_role" ON school_announcements
  FOR ALL USING (auth.role() = 'service_role');

-- School admins can manage announcements for their school
CREATE POLICY "announcements_school_admin_select" ON school_announcements
  FOR SELECT TO authenticated
  USING (
    school_id = get_admin_school_id()
  );

-- Students can read published announcements for their school
CREATE POLICY "announcements_student_select" ON school_announcements
  FOR SELECT TO authenticated
  USING (
    is_active = true
    AND published_at IS NOT NULL
    AND published_at <= now()
    AND school_id IN (
      SELECT school_id FROM students
      WHERE auth_user_id = auth.uid()
      AND school_id IS NOT NULL
    )
  );

-- Parents can read published announcements for their children's schools
CREATE POLICY "announcements_parent_select" ON school_announcements
  FOR SELECT TO authenticated
  USING (
    is_active = true
    AND published_at IS NOT NULL
    AND published_at <= now()
    AND school_id IN (
      SELECT s.school_id FROM students s
      JOIN guardian_student_links gsl ON gsl.student_id = s.id
      JOIN guardians g ON g.id = gsl.guardian_id
      WHERE g.auth_user_id = auth.uid()
      AND gsl.status = 'approved'
      AND s.school_id IS NOT NULL
    )
  );

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_school_announcements_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_school_announcements_updated_at ON school_announcements;
CREATE TRIGGER trg_school_announcements_updated_at
  BEFORE UPDATE ON school_announcements
  FOR EACH ROW EXECUTE FUNCTION update_school_announcements_updated_at();


-- ============================================================================
-- 3. school_questions (custom school content)
-- ============================================================================
CREATE TABLE IF NOT EXISTS school_questions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id             UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  subject               TEXT NOT NULL,
  grade                 TEXT NOT NULL,
  topic                 TEXT NOT NULL,
  question_text         TEXT NOT NULL,
  options               JSONB NOT NULL,
  correct_answer_index  INT NOT NULL CHECK (correct_answer_index BETWEEN 0 AND 3),
  explanation           TEXT NOT NULL,
  difficulty            TEXT NOT NULL CHECK (difficulty IN ('easy', 'medium', 'hard')),
  bloom_level           TEXT NOT NULL CHECK (bloom_level IN (
                          'remember', 'understand', 'apply',
                          'analyze', 'evaluate', 'create'
                        )),
  created_by            UUID REFERENCES auth.users(id),
  approved              BOOLEAN NOT NULL DEFAULT false,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_school_questions_school
  ON school_questions (school_id, subject, grade);

CREATE INDEX IF NOT EXISTS idx_school_questions_approved
  ON school_questions (school_id, subject, grade)
  WHERE approved = true;

ALTER TABLE school_questions ENABLE ROW LEVEL SECURITY;

-- Service role bypass
CREATE POLICY "school_questions_service_role" ON school_questions
  FOR ALL USING (auth.role() = 'service_role');

-- School admins/teachers can view questions for their school
CREATE POLICY "school_questions_school_admin_select" ON school_questions
  FOR SELECT TO authenticated
  USING (
    school_id = get_admin_school_id()
  );

-- Students can view approved questions for their school (for quizzes)
CREATE POLICY "school_questions_student_select" ON school_questions
  FOR SELECT TO authenticated
  USING (
    approved = true
    AND school_id IN (
      SELECT school_id FROM students
      WHERE auth_user_id = auth.uid()
      AND school_id IS NOT NULL
    )
  );

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_school_questions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_school_questions_updated_at ON school_questions;
CREATE TRIGGER trg_school_questions_updated_at
  BEFORE UPDATE ON school_questions
  FOR EACH ROW EXECUTE FUNCTION update_school_questions_updated_at();


-- ============================================================================
-- 4. school_exams
-- ============================================================================
CREATE TABLE IF NOT EXISTS school_exams (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id         UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  title             TEXT NOT NULL,
  subject           TEXT NOT NULL,
  grade             TEXT NOT NULL,
  target_classes    UUID[],
  question_count    INT NOT NULL DEFAULT 20,
  duration_minutes  INT NOT NULL DEFAULT 30,
  start_time        TIMESTAMPTZ NOT NULL,
  end_time          TIMESTAMPTZ NOT NULL,
  created_by        UUID REFERENCES auth.users(id),
  status            TEXT NOT NULL DEFAULT 'scheduled'
                    CHECK (status IN ('draft', 'scheduled', 'active', 'completed', 'cancelled')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT school_exams_time_order CHECK (end_time > start_time)
);

CREATE INDEX IF NOT EXISTS idx_school_exams_school
  ON school_exams (school_id, status);

CREATE INDEX IF NOT EXISTS idx_school_exams_schedule
  ON school_exams (school_id, start_time, end_time)
  WHERE status IN ('scheduled', 'active');

ALTER TABLE school_exams ENABLE ROW LEVEL SECURITY;

-- Service role bypass
CREATE POLICY "school_exams_service_role" ON school_exams
  FOR ALL USING (auth.role() = 'service_role');

-- School admins/teachers can view exams for their school
CREATE POLICY "school_exams_school_admin_select" ON school_exams
  FOR SELECT TO authenticated
  USING (
    school_id = get_admin_school_id()
  );

-- Students can view active/scheduled exams for their school
CREATE POLICY "school_exams_student_select" ON school_exams
  FOR SELECT TO authenticated
  USING (
    status IN ('scheduled', 'active')
    AND school_id IN (
      SELECT school_id FROM students
      WHERE auth_user_id = auth.uid()
      AND school_id IS NOT NULL
    )
  );

-- Parents can view exams for their children's schools
CREATE POLICY "school_exams_parent_select" ON school_exams
  FOR SELECT TO authenticated
  USING (
    school_id IN (
      SELECT s.school_id FROM students s
      JOIN guardian_student_links gsl ON gsl.student_id = s.id
      JOIN guardians g ON g.id = gsl.guardian_id
      WHERE g.auth_user_id = auth.uid()
      AND gsl.status = 'approved'
      AND s.school_id IS NOT NULL
    )
  );

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_school_exams_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_school_exams_updated_at ON school_exams;
CREATE TRIGGER trg_school_exams_updated_at
  BEFORE UPDATE ON school_exams
  FOR EACH ROW EXECUTE FUNCTION update_school_exams_updated_at();


-- ============================================================================
-- 5. Add school_id to quiz_sessions for report queries
-- The column does not exist yet; add it idempotently.
-- ============================================================================
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'quiz_sessions'
      AND column_name = 'school_id'
  ) THEN
    ALTER TABLE quiz_sessions ADD COLUMN school_id UUID REFERENCES schools(id);
  END IF;
END $$;

COMMENT ON COLUMN quiz_sessions.school_id IS
  'Denormalized from students.school_id at quiz creation time for efficient school-level reporting.';


-- ============================================================================
-- 6. Composite indexes for report queries
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_quiz_sessions_school_subject
  ON quiz_sessions (school_id, subject, created_at DESC)
  WHERE school_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_quiz_sessions_student_subject
  ON quiz_sessions (student_id, subject, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_students_school_grade
  ON students (school_id, grade)
  WHERE school_id IS NOT NULL AND is_active = true;
