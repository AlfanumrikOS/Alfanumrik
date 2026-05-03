-- ────────────────────────────────────────────────────────────────
-- experiment_observations: persists student lab observations
-- Fixes dead-end "What did you observe?" UI in STEM Centre
-- Supports both simple (free-text) and guided (structured) experiments
-- ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS experiment_observations (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id              UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  simulation_id           TEXT NOT NULL,
  experiment_id           TEXT,
  observation_type        TEXT NOT NULL DEFAULT 'simple'
                          CHECK (observation_type IN ('simple', 'guided')),
  observation_text        TEXT,
  structured_observations JSONB,
  data_entries            JSONB,
  conclusion              TEXT,
  quiz_score              INTEGER,
  total_questions         INTEGER,
  time_spent_seconds      INTEGER DEFAULT 0,
  grade                   TEXT NOT NULL,
  subject                 TEXT NOT NULL,
  created_at              TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE experiment_observations ENABLE ROW LEVEL SECURITY;

-- Students insert their own observations
CREATE POLICY "students_insert_own_observations"
  ON experiment_observations FOR INSERT
  WITH CHECK (student_id = get_student_id_for_auth());

-- Students read their own observations
CREATE POLICY "students_read_own_observations"
  ON experiment_observations FOR SELECT
  USING (student_id = get_student_id_for_auth());

-- Parents read linked child observations
CREATE POLICY "guardians_read_linked_observations"
  ON experiment_observations FOR SELECT
  USING (is_guardian_of(student_id));

-- Teachers read observations of students in their classes
CREATE POLICY "teachers_read_class_observations"
  ON experiment_observations FOR SELECT
  USING (is_teacher_of(student_id));

-- Super-admins read all
CREATE POLICY "admin_read_all_observations"
  ON experiment_observations FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM admin_users WHERE auth_user_id = auth.uid() AND is_active = true
    )
  );

-- Indexes
CREATE INDEX IF NOT EXISTS idx_experiment_obs_student
  ON experiment_observations(student_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_experiment_obs_simulation
  ON experiment_observations(simulation_id);
