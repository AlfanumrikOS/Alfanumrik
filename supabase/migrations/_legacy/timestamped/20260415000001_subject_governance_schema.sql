-- supabase/migrations/20260415000001_subject_governance_schema.sql
-- Subject governance: schema. Safe additive migration. No data changes.

BEGIN;

-- Ensure gen_random_uuid() is available
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. Extend subjects master
ALTER TABLE subjects
  ADD COLUMN IF NOT EXISTS name_hi TEXT,
  ADD COLUMN IF NOT EXISTS subject_kind TEXT NOT NULL DEFAULT 'cbse_core'
    CHECK (subject_kind IN ('cbse_core','cbse_elective','platform_elective'));

-- 2. Grade-subject map
CREATE TABLE IF NOT EXISTS grade_subject_map (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  grade            TEXT NOT NULL CHECK (grade IN ('6','7','8','9','10','11','12')),
  subject_code     TEXT NOT NULL REFERENCES subjects(code) ON UPDATE CASCADE,
  stream           TEXT CHECK (stream IN ('science','commerce','humanities') OR stream IS NULL),
  is_core          BOOLEAN NOT NULL DEFAULT TRUE,
  min_questions_seeded INT NOT NULL DEFAULT 10,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS grade_subject_map_uniq
  ON grade_subject_map (grade, subject_code, stream) NULLS NOT DISTINCT;
CREATE INDEX IF NOT EXISTS grade_subject_map_subject_idx ON grade_subject_map (subject_code);

ALTER TABLE grade_subject_map ENABLE ROW LEVEL SECURITY;
CREATE POLICY gsm_read_all ON grade_subject_map FOR SELECT USING (true);
-- writes only via service role

-- 3. Plan-subject access
CREATE TABLE IF NOT EXISTS plan_subject_access (
  plan_code     TEXT NOT NULL CHECK (plan_code IN ('free','starter','pro','unlimited')),
  subject_code  TEXT NOT NULL REFERENCES subjects(code) ON UPDATE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (plan_code, subject_code)
);
ALTER TABLE plan_subject_access ENABLE ROW LEVEL SECURITY;
CREATE POLICY psa_read_all ON plan_subject_access FOR SELECT USING (true);

-- 4. Students stream column
ALTER TABLE students
  ADD COLUMN IF NOT EXISTS stream TEXT
    CHECK (stream IN ('science','commerce','humanities') OR stream IS NULL);

-- 5. subscription_plans.max_subjects
ALTER TABLE subscription_plans
  ADD COLUMN IF NOT EXISTS max_subjects INT NULL;

-- 6. student_subject_enrollment join table
CREATE TABLE IF NOT EXISTS student_subject_enrollment (
  student_id    UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  subject_code  TEXT NOT NULL REFERENCES subjects(code) ON UPDATE CASCADE,
  selected_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  source        TEXT NOT NULL DEFAULT 'student'
    CHECK (source IN ('student','admin','migration','onboarding')),
  PRIMARY KEY (student_id, subject_code)
);
CREATE INDEX IF NOT EXISTS sse_student_idx ON student_subject_enrollment (student_id);

ALTER TABLE student_subject_enrollment ENABLE ROW LEVEL SECURITY;
CREATE POLICY sse_read_own ON student_subject_enrollment FOR SELECT
  USING (student_id = auth.uid());
CREATE POLICY sse_write_own ON student_subject_enrollment FOR ALL
  USING (student_id = auth.uid()) WITH CHECK (student_id = auth.uid());

-- 7. Legacy archive
CREATE TABLE IF NOT EXISTS legacy_subjects_archive (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id    UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  invalid_subjects TEXT[] NOT NULL,
  reason        TEXT NOT NULL,
  archived_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lsa_student_idx ON legacy_subjects_archive (student_id);

-- 8. question_bank subject FK (NOT VALID — validate after cleanup)
ALTER TABLE question_bank
  ADD CONSTRAINT question_bank_subject_fk
  FOREIGN KEY (subject) REFERENCES subjects(code) ON UPDATE CASCADE NOT VALID;

COMMIT;