-- MIGRATION: 20260427000100_misconception_ontology
-- =====================================================
-- Migration: 20260427000100_misconception_ontology.sql
-- Purpose: Phase 3 of Foxy moat plan — introduce the misconception ontology and
--          per-student skill state tables that back BKT/IRT calibration and
--          targeted remediation. Adds 3 tables, all RLS-enabled.
--
-- Note: wrong_answer_remediations table is defined in 20260428000100_wrong_answer_remediations.sql (separate migration to align with /api/foxy/remediation API contract).
--
-- Tables created:
--   1. learning_objectives          — fine-grained CBSE skills/LOs per chapter
--   2. question_misconceptions      — distractor → misconception code mapping
--   3. student_skill_state          — per-student BKT/IRT state per LO
--
-- Idempotent (IF NOT EXISTS, EXCEPTION blocks for re-runs).
-- P8 invariant: every new table has RLS enabled in the same migration.
-- P5 invariant: no integer grades.
-- P9 invariant: server-side enforcement via RLS; clients never bypass.
--
-- Reference: docs/foxy-moat-plan.md Phase 3 (Misconception ontology schema).

-- ============================================================================
-- 1. learning_objectives
-- ============================================================================
CREATE TABLE IF NOT EXISTS learning_objectives (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chapter_id UUID NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  code TEXT UNIQUE NOT NULL,
  statement TEXT NOT NULL,
  statement_hi TEXT,
  bloom_level SMALLINT NOT NULL CHECK (bloom_level BETWEEN 1 AND 6),
  prereq_objective_ids UUID[] NOT NULL DEFAULT '{}',
  skill_tags TEXT[] NOT NULL DEFAULT '{}',
  bkt_p_learn NUMERIC(4,3) NOT NULL DEFAULT 0.20,
  bkt_p_slip NUMERIC(4,3) NOT NULL DEFAULT 0.10,
  bkt_p_guess NUMERIC(4,3) NOT NULL DEFAULT 0.25,
  bkt_calibrated_at TIMESTAMPTZ,
  bkt_sample_n INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE learning_objectives IS
  'Fine-grained CBSE learning objectives per chapter. Drives BKT priors, RAG '
  'retrieval grounding, and adaptive selection. Phase 3 of Foxy moat plan.';
COMMENT ON COLUMN learning_objectives.code IS
  'Stable human-readable code, e.g. "PHY-7-MOTION-LO-01". Used as join key '
  'across content pipeline.';
COMMENT ON COLUMN learning_objectives.bkt_calibrated_at IS
  'Set by nightly calibration job (Phase 4) when bkt_sample_n >= 30 across '
  'student responses tied to this LO.';
COMMENT ON COLUMN learning_objectives.bkt_p_learn IS
  'BKT P(T) — probability of transitioning from unknown to known on a practice opportunity. Default 0.20 (Pardos & Heffernan 2010 high-guess MCQ band); recalibrated nightly when bkt_sample_n >= 200.';
COMMENT ON COLUMN learning_objectives.bkt_p_slip IS
  'BKT P(slip) — probability student knows the skill but answers wrong. Default 0.10 per Corbett & Anderson (1995); recalibrated.';
COMMENT ON COLUMN learning_objectives.bkt_p_guess IS
  'BKT P(guess) — probability student does not know but answers right. Default 0.25 (4-option MCQ chance floor); recalibrated.';

CREATE INDEX IF NOT EXISTS idx_learning_objectives_chapter
  ON learning_objectives(chapter_id);
CREATE INDEX IF NOT EXISTS idx_learning_objectives_skill_tags
  ON learning_objectives USING GIN (skill_tags);
CREATE INDEX IF NOT EXISTS idx_learning_objectives_prereqs
  ON learning_objectives USING GIN (prereq_objective_ids);

-- updated_at trigger
CREATE OR REPLACE FUNCTION update_learning_objectives_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_learning_objectives_updated_at ON learning_objectives;
CREATE TRIGGER trg_learning_objectives_updated_at
  BEFORE UPDATE ON learning_objectives
  FOR EACH ROW EXECUTE FUNCTION update_learning_objectives_updated_at();

-- RLS
ALTER TABLE learning_objectives ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "learning_objectives_authenticated_read"
    ON learning_objectives FOR SELECT
    TO authenticated
    USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Writes are reserved for service_role (bypasses RLS by default). No INSERT/
-- UPDATE/DELETE policies are created, which means non-service-role clients
-- cannot mutate this table.

-- ============================================================================
-- 2. question_misconceptions
-- ============================================================================
CREATE TABLE IF NOT EXISTS question_misconceptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id UUID NOT NULL REFERENCES question_bank(id) ON DELETE CASCADE,
  distractor_index SMALLINT NOT NULL CHECK (distractor_index BETWEEN 0 AND 3),
  misconception_code TEXT NOT NULL,
  misconception_label TEXT NOT NULL,
  misconception_label_hi TEXT,
  remediation_chunk_id UUID REFERENCES rag_content_chunks(id) ON DELETE SET NULL,
  remediation_concept_id UUID REFERENCES chapter_concepts(id) ON DELETE SET NULL,
  curator_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (question_id, distractor_index)
);

COMMENT ON TABLE question_misconceptions IS
  'Maps each MCQ distractor to a named misconception and a remediation '
  'pointer. Curated by content team; consumed by Foxy and quiz feedback. '
  'Phase 3 of Foxy moat plan.';
COMMENT ON COLUMN question_misconceptions.misconception_code IS
  'Stable code, e.g. "confuses_mass_with_weight". Aggregates across questions.';

CREATE INDEX IF NOT EXISTS idx_question_misconceptions_question
  ON question_misconceptions(question_id);
CREATE INDEX IF NOT EXISTS idx_question_misconceptions_code
  ON question_misconceptions(misconception_code);

-- RLS
ALTER TABLE question_misconceptions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "question_misconceptions_authenticated_read"
    ON question_misconceptions FOR SELECT
    TO authenticated
    USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Writes reserved for service_role.

-- ============================================================================
-- 3. student_skill_state
-- ============================================================================
CREATE TABLE IF NOT EXISTS student_skill_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  learning_objective_id UUID NOT NULL REFERENCES learning_objectives(id) ON DELETE CASCADE,
  p_know NUMERIC(5,4) NOT NULL DEFAULT 0.10,
  p_learn NUMERIC(4,3) NOT NULL DEFAULT 0.20,
  p_slip NUMERIC(4,3) NOT NULL DEFAULT 0.10,
  p_guess NUMERIC(4,3) NOT NULL DEFAULT 0.25,
  theta NUMERIC(5,3) NOT NULL DEFAULT 0,
  theta_se NUMERIC(5,3) NOT NULL DEFAULT 1.5,
  last_n_responses JSONB NOT NULL DEFAULT '[]'::jsonb,
  total_attempts INT NOT NULL DEFAULT 0,
  total_correct INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (student_id, learning_objective_id)
);

COMMENT ON TABLE student_skill_state IS
  'Per-student, per-LO BKT/IRT state. last_n_responses is a ring buffer of '
  'the most recent 20 responses (oldest dropped on the application side). '
  'Phase 3 of Foxy moat plan.';
COMMENT ON COLUMN student_skill_state.theta IS
  'IRT theta (ability) on N(0,1) scale. Bounded [-4, 4] in update functions. Cold-start 0.';
COMMENT ON COLUMN student_skill_state.theta_se IS
  'IRT ability standard error. Cold-start default 1.5 per Wainer (2000) and van der Linden (2010); tighter values commit early and starve item-information gain. Calibration job updates this from response data.';
COMMENT ON COLUMN student_skill_state.p_know IS
  'BKT prior P(L0) — probability student knows the skill before any practice. Cold-start 0.10 per Corbett & Anderson (1995); calibrated per-skill in Phase 4.';

CREATE INDEX IF NOT EXISTS idx_student_skill_state_student
  ON student_skill_state(student_id);
CREATE INDEX IF NOT EXISTS idx_student_skill_state_lo
  ON student_skill_state(learning_objective_id);

-- updated_at trigger
CREATE OR REPLACE FUNCTION update_student_skill_state_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_student_skill_state_updated_at ON student_skill_state;
CREATE TRIGGER trg_student_skill_state_updated_at
  BEFORE UPDATE ON student_skill_state
  FOR EACH ROW EXECUTE FUNCTION update_student_skill_state_updated_at();

-- RLS
ALTER TABLE student_skill_state ENABLE ROW LEVEL SECURITY;

-- Student reads their own skill state only
DO $$ BEGIN
  CREATE POLICY "student_skill_state_student_select"
    ON student_skill_state FOR SELECT
    TO authenticated
    USING (
      student_id IN (
        SELECT id FROM students WHERE auth_user_id = auth.uid()
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Parent reads linked child skill state (approved links only)
DO $$ BEGIN
  CREATE POLICY "student_skill_state_parent_select"
    ON student_skill_state FOR SELECT
    TO authenticated
    USING (
      student_id IN (
        SELECT student_id FROM guardian_student_links
        WHERE guardian_id IN (
          SELECT id FROM guardians WHERE auth_user_id = auth.uid()
        )
        AND status = 'approved'
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Teacher reads assigned-class students' skill state
DO $$ BEGIN
  CREATE POLICY "student_skill_state_teacher_select"
    ON student_skill_state FOR SELECT
    TO authenticated
    USING (
      student_id IN (
        SELECT student_id FROM class_enrollments
        WHERE class_id IN (
          SELECT ct.class_id FROM class_teachers ct JOIN teachers t ON t.id = ct.teacher_id WHERE t.auth_user_id = auth.uid() AND ct.is_active = true
        )
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Writes reserved for service_role (BKT update RPC will use service-role context).



-- =====================================================
