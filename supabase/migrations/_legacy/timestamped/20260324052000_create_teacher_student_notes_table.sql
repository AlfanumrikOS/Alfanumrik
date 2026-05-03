-- Teacher student notes: allows teachers to add private notes/goals per student
CREATE TABLE IF NOT EXISTS teacher_student_notes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id  UUID NOT NULL REFERENCES teachers(id),
  student_id  UUID NOT NULL REFERENCES students(id),
  note        TEXT,
  custom_goal TEXT,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE (teacher_id, student_id)
);

ALTER TABLE teacher_student_notes ENABLE ROW LEVEL SECURITY;

-- Teachers can manage their own notes
CREATE POLICY "teachers_own_notes_select" ON teacher_student_notes FOR SELECT
  USING (auth.uid() IN (SELECT auth_user_id FROM teachers WHERE id = teacher_student_notes.teacher_id));

CREATE POLICY "teachers_own_notes_insert" ON teacher_student_notes FOR INSERT
  WITH CHECK (auth.uid() IN (SELECT auth_user_id FROM teachers WHERE id = teacher_student_notes.teacher_id));

CREATE POLICY "teachers_own_notes_update" ON teacher_student_notes FOR UPDATE
  USING (auth.uid() IN (SELECT auth_user_id FROM teachers WHERE id = teacher_student_notes.teacher_id))
  WITH CHECK (auth.uid() IN (SELECT auth_user_id FROM teachers WHERE id = teacher_student_notes.teacher_id));

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_tsn_teacher_student ON teacher_student_notes(teacher_id, student_id);
