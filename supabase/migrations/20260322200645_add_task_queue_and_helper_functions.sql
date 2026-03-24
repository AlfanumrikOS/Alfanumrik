-- ============================================================
-- Migration 001: Task Queue and Helper Functions
-- Project: Alfanumrik
-- Description: Adds task queue table, helper functions for
--              authentication checks, and indexes for
--              class relationships
-- ============================================================

-- ============================================================
-- SECTION 1: Task Queue Table
-- ============================================================

-- Async background task queue for AI generation, notifications, etc.
CREATE TABLE IF NOT EXISTS task_queue (
  id            BIGSERIAL PRIMARY KEY,
  queue_name    TEXT NOT NULL,
  payload       JSONB NOT NULL DEFAULT '{}',
  status        TEXT DEFAULT 'pending'
                CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  attempts      INT DEFAULT 0,
  max_attempts  INT DEFAULT 3,
  created_at    TIMESTAMPTZ DEFAULT now(),
  processing_at TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ,
  error         TEXT
);

-- ============================================================
-- SECTION 2: Helper Functions
-- ============================================================

-- Returns the students.id that belongs to the currently
-- authenticated Supabase auth user.
CREATE OR REPLACE FUNCTION get_student_id_for_auth()
RETURNS UUID AS $$
  SELECT id FROM students WHERE auth_user_id = auth.uid();
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- Returns TRUE if the currently authenticated user is an
-- active guardian of the given student.
CREATE OR REPLACE FUNCTION is_guardian_of(p_student_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS(
    SELECT 1
    FROM guardian_student_links gsl
    JOIN guardians g ON g.id = gsl.guardian_id
    WHERE gsl.student_id = p_student_id
      AND g.auth_user_id  = auth.uid()
      AND gsl.status      = 'active'
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- Returns TRUE if the currently authenticated user is a
-- teacher of any class the given student is enrolled in.
CREATE OR REPLACE FUNCTION is_teacher_of(p_student_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS(
    SELECT 1
    FROM class_students cs
    JOIN class_teachers ct ON ct.class_id = cs.class_id
    JOIN teachers t ON t.id = ct.teacher_id
    WHERE cs.student_id = p_student_id
      AND t.auth_user_id = auth.uid()
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- ============================================================
-- SECTION 3: Performance Indexes
-- ============================================================

-- Indexes on class relationships for efficient teacher/guardian lookups
CREATE INDEX IF NOT EXISTS idx_class_students_student_id
  ON class_students(student_id);

CREATE INDEX IF NOT EXISTS idx_class_students_class_id
  ON class_students(class_id);

CREATE INDEX IF NOT EXISTS idx_class_teachers_teacher_id
  ON class_teachers(teacher_id);

CREATE INDEX IF NOT EXISTS idx_class_teachers_class_id
  ON class_teachers(class_id);
