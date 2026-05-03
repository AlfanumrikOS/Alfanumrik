-- Migration: 20260411000001_teacher_assignments_and_submissions.sql
-- Purpose: Create assignments and assignment_submissions tables for the
--          teacher workflow — teachers author assignments from the question
--          bank, assign them to classes, and review student submissions.
--
-- P5:  Grade columns are TEXT strings "6"–"12", never integers.
-- P8:  RLS is enabled on every new table; all four access patterns are covered:
--       student own, parent linked (via guardian_student_links),
--       teacher assigned (via class_students + class_teachers), service role.
-- P9:  API routes must still call authorizeRequest() — RLS is a data layer
--      guard, not a substitute for route-level RBAC.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. assignments
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS assignments (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Soft reference: teachers(id).  Not a FK because service role bypasses RLS
  -- when inserting on behalf of the teacher, and we want to allow deletion of
  -- orphan rows without cascade surprises.
  teacher_id     UUID        NOT NULL,
  -- Nullable: an assignment may exist as a draft before being assigned to a class.
  class_id       UUID        REFERENCES classes(id) ON DELETE SET NULL,
  title          TEXT        NOT NULL,
  -- P5 note: 'type' is the assignment type, not a grade — no integer constraint needed.
  type           TEXT        NOT NULL DEFAULT 'quiz'
                             CHECK (type IN ('quiz', 'worksheet')),
  subject        TEXT,
  -- P5: grade stored as TEXT string "6"–"12" (or NULL for cross-grade assignments).
  grade          TEXT        CHECK (grade IS NULL OR grade IN ('6','7','8','9','10','11','12')),
  chapter        TEXT,
  difficulty     TEXT        DEFAULT 'medium'
                             CHECK (difficulty IN ('easy', 'medium', 'hard')),
  due_date       TIMESTAMPTZ,
  question_count INTEGER     DEFAULT 10,
  -- Array of question UUIDs from question_bank; soft reference (no FK on arrays in PG).
  question_ids   UUID[]      DEFAULT '{}',
  instructions   TEXT,
  is_active      BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- P8: RLS mandatory for every new table.
ALTER TABLE assignments ENABLE ROW LEVEL SECURITY;

-- ── Teacher: full CRUD on own assignments ────────────────────────────────────

CREATE POLICY "assignments_teacher_select" ON assignments
  FOR SELECT USING (
    teacher_id IN (
      SELECT id FROM teachers WHERE auth_user_id = auth.uid()
    )
  );

CREATE POLICY "assignments_teacher_insert" ON assignments
  FOR INSERT WITH CHECK (
    teacher_id IN (
      SELECT id FROM teachers WHERE auth_user_id = auth.uid()
    )
  );

CREATE POLICY "assignments_teacher_update" ON assignments
  FOR UPDATE USING (
    teacher_id IN (
      SELECT id FROM teachers WHERE auth_user_id = auth.uid()
    )
  );

CREATE POLICY "assignments_teacher_delete" ON assignments
  FOR DELETE USING (
    teacher_id IN (
      SELECT id FROM teachers WHERE auth_user_id = auth.uid()
    )
  );

-- ── Student: SELECT assignments for enrolled classes ─────────────────────────
-- A student may read an assignment when they are an active member of the
-- assignment's target class (via class_students).

CREATE POLICY "assignments_student_select" ON assignments
  FOR SELECT USING (
    class_id IS NOT NULL
    AND class_id IN (
      SELECT cs.class_id
        FROM class_students cs
        JOIN students s ON s.id = cs.student_id
       WHERE s.auth_user_id = auth.uid()
         AND cs.is_active = TRUE
    )
  );

-- ── Parent: SELECT assignments visible to their linked child ─────────────────
-- A guardian may read any assignment that their approved linked student can see.

CREATE POLICY "assignments_parent_select" ON assignments
  FOR SELECT USING (
    class_id IS NOT NULL
    AND class_id IN (
      SELECT cs.class_id
        FROM class_students cs
       WHERE cs.student_id IN (
               SELECT gsl.student_id
                 FROM guardian_student_links gsl
                 JOIN guardians g ON g.id = gsl.guardian_id
                WHERE g.auth_user_id = auth.uid()
                  AND gsl.status = 'approved'
             )
         AND cs.is_active = TRUE
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. assignment_submissions
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS assignment_submissions (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id UUID        NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  student_id    UUID        NOT NULL REFERENCES students(id)    ON DELETE CASCADE,
  -- score is 0–100 (percentage); NULL until graded/submitted.
  score         INTEGER     CHECK (score IS NULL OR (score >= 0 AND score <= 100)),
  -- Array of {question_id, selected_index} answer objects.
  answers       JSONB       DEFAULT '[]',
  submitted_at  TIMESTAMPTZ DEFAULT now(),
  -- Total time spent on the assignment in seconds; used for anti-cheat checks (P3).
  time_taken_s  INTEGER     CHECK (time_taken_s IS NULL OR time_taken_s >= 0),
  UNIQUE (assignment_id, student_id)
);

-- P8: RLS mandatory for every new table.
ALTER TABLE assignment_submissions ENABLE ROW LEVEL SECURITY;

-- ── Student: read/write own submissions ──────────────────────────────────────

CREATE POLICY "assignment_submissions_student_select" ON assignment_submissions
  FOR SELECT USING (
    student_id IN (
      SELECT id FROM students WHERE auth_user_id = auth.uid()
    )
  );

CREATE POLICY "assignment_submissions_student_insert" ON assignment_submissions
  FOR INSERT WITH CHECK (
    student_id IN (
      SELECT id FROM students WHERE auth_user_id = auth.uid()
    )
  );

CREATE POLICY "assignment_submissions_student_update" ON assignment_submissions
  FOR UPDATE USING (
    student_id IN (
      SELECT id FROM students WHERE auth_user_id = auth.uid()
    )
  );

-- ── Teacher: SELECT submissions for their own assignments ────────────────────
-- Join back through assignments to verify the teacher owns the assignment.

CREATE POLICY "assignment_submissions_teacher_select" ON assignment_submissions
  FOR SELECT USING (
    assignment_id IN (
      SELECT id FROM assignments
       WHERE teacher_id IN (
               SELECT id FROM teachers WHERE auth_user_id = auth.uid()
             )
    )
  );

-- ── Parent: SELECT submissions belonging to their linked child ───────────────

CREATE POLICY "assignment_submissions_parent_select" ON assignment_submissions
  FOR SELECT USING (
    student_id IN (
      SELECT gsl.student_id
        FROM guardian_student_links gsl
        JOIN guardians g ON g.id = gsl.guardian_id
       WHERE g.auth_user_id = auth.uid()
         AND gsl.status = 'approved'
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Indexes
-- ─────────────────────────────────────────────────────────────────────────────

-- assignments: teacher_id — used by RLS policies and teacher dashboard queries.
CREATE INDEX IF NOT EXISTS idx_assignments_teacher_id
  ON assignments (teacher_id);

-- assignments: class_id — used by RLS student/parent policies and class-level views.
CREATE INDEX IF NOT EXISTS idx_assignments_class_id
  ON assignments (class_id);

-- assignments: is_active + due_date — common filter for "active upcoming assignments".
CREATE INDEX IF NOT EXISTS idx_assignments_active_due
  ON assignments (is_active, due_date)
  WHERE is_active = TRUE;

-- assignment_submissions: assignment_id — FK + used in teacher SELECT policy join.
CREATE INDEX IF NOT EXISTS idx_assignment_submissions_assignment_id
  ON assignment_submissions (assignment_id);

-- assignment_submissions: student_id — FK + used in student/parent RLS policies.
CREATE INDEX IF NOT EXISTS idx_assignment_submissions_student_id
  ON assignment_submissions (student_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. updated_at trigger for assignments
--    (assignment_submissions has no updated_at column — immutable once submitted)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_assignments_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_assignments_updated_at ON assignments;
CREATE TRIGGER trg_assignments_updated_at
  BEFORE UPDATE ON assignments
  FOR EACH ROW
  EXECUTE FUNCTION update_assignments_updated_at();
