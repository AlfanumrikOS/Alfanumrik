-- Cognitive Mastery Engine (CME) — Foundation Tables
-- Per-concept learner state, revision scheduling, error logging, exam readiness

CREATE TABLE IF NOT EXISTS cme_concept_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL,
  concept_id UUID NOT NULL,
  mastery_mean FLOAT DEFAULT 0.3,
  mastery_variance FLOAT DEFAULT 0.25,
  retention_half_life FLOAT DEFAULT 48.0,
  last_practiced_at TIMESTAMPTZ,
  current_retention FLOAT DEFAULT 0.3,
  max_difficulty_succeeded INT DEFAULT 1,
  error_count_conceptual INT DEFAULT 0,
  error_count_procedural INT DEFAULT 0,
  error_count_careless INT DEFAULT 0,
  avg_response_time_ms INT,
  confidence_score FLOAT DEFAULT 0.5,
  total_attempts INT DEFAULT 0,
  total_correct INT DEFAULT 0,
  streak_current INT DEFAULT 0,
  mastery_velocity FLOAT DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(student_id, concept_id)
);

CREATE INDEX IF NOT EXISTS idx_cme_state_student ON cme_concept_state(student_id);
CREATE INDEX IF NOT EXISTS idx_cme_state_lookup ON cme_concept_state(student_id, concept_id);
CREATE INDEX IF NOT EXISTS idx_cme_state_mastery ON cme_concept_state(student_id, current_retention);

CREATE TABLE IF NOT EXISTS cme_revision_schedule (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL,
  concept_id UUID NOT NULL,
  due_at TIMESTAMPTZ NOT NULL,
  priority FLOAT DEFAULT 0,
  revision_type TEXT DEFAULT 'revision' CHECK (revision_type IN ('revision','remediation','challenge')),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cme_revision_due ON cme_revision_schedule(student_id, due_at) WHERE completed_at IS NULL;

CREATE TABLE IF NOT EXISTS cme_error_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL,
  concept_id UUID NOT NULL,
  question_id UUID,
  error_type TEXT NOT NULL CHECK (error_type IN ('conceptual','procedural','careless','unknown')),
  student_answer TEXT,
  correct_answer TEXT,
  response_time_ms INT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cme_errors_student ON cme_error_log(student_id, concept_id, created_at DESC);

CREATE TABLE IF NOT EXISTS cme_exam_readiness (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL,
  exam_type TEXT DEFAULT 'periodic',
  overall_score FLOAT,
  predicted_marks FLOAT,
  chapter_breakdown JSONB,
  weakest_chapters TEXT[],
  computed_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cme_readiness_student ON cme_exam_readiness(student_id, computed_at DESC);

CREATE TABLE IF NOT EXISTS cme_action_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL,
  action_type TEXT NOT NULL,
  concept_id UUID,
  question_id UUID,
  reason TEXT,
  was_followed BOOLEAN,
  outcome TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cme_actions_student ON cme_action_log(student_id, created_at DESC);

-- RLS
ALTER TABLE cme_concept_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE cme_revision_schedule ENABLE ROW LEVEL SECURITY;
ALTER TABLE cme_error_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE cme_exam_readiness ENABLE ROW LEVEL SECURITY;
ALTER TABLE cme_action_log ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN CREATE POLICY cme_state_service ON cme_concept_state FOR ALL TO service_role USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY cme_revision_service ON cme_revision_schedule FOR ALL TO service_role USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY cme_error_service ON cme_error_log FOR ALL TO service_role USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY cme_readiness_service ON cme_exam_readiness FOR ALL TO service_role USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY cme_actions_service ON cme_action_log FOR ALL TO service_role USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE POLICY cme_state_own ON cme_concept_state FOR SELECT TO authenticated USING (student_id IN (SELECT id FROM students WHERE auth_user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY cme_revision_own ON cme_revision_schedule FOR SELECT TO authenticated USING (student_id IN (SELECT id FROM students WHERE auth_user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY cme_readiness_own ON cme_exam_readiness FOR SELECT TO authenticated USING (student_id IN (SELECT id FROM students WHERE auth_user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
