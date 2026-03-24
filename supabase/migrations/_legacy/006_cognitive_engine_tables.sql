-- ═══════════════════════════════════════════════════════════════
-- ALFANUMRIK 2.0 — Cognitive Engine Database Migration
-- New tables for Bloom's progression, ZPD tracking, board papers,
-- learning velocity, knowledge gaps, and question responses.
-- Enhanced columns on question_bank and concept_mastery.
-- ═══════════════════════════════════════════════════════════════

-- ─── 1. CBSE Board Papers Reference Table ─────────────────────
CREATE TABLE IF NOT EXISTS cbse_board_papers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  year          smallint NOT NULL CHECK (year BETWEEN 2015 AND 2030),
  subject       text NOT NULL,
  set_code      text,                -- e.g. '65/1/1', '65/2/3'
  paper_section text,                -- e.g. 'A', 'B', 'C'
  total_marks   smallint DEFAULT 80,
  board         text DEFAULT 'CBSE',
  grade         text DEFAULT '10',
  paper_url     text,                -- optional link to PDF
  is_active     boolean DEFAULT true,
  created_at    timestamptz DEFAULT now(),
  UNIQUE(year, subject, set_code)
);

-- ─── 2. Bloom's Progression Tracking ──────────────────────────
-- Per-student, per-topic, per-bloom-level mastery tracking
CREATE TABLE IF NOT EXISTS bloom_progression (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id    uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  topic_id      uuid NOT NULL REFERENCES curriculum_topics(id) ON DELETE CASCADE,
  bloom_level   text NOT NULL CHECK (bloom_level IN ('remember', 'understand', 'apply', 'analyze', 'evaluate', 'create')),
  attempts      int DEFAULT 0,
  correct       int DEFAULT 0,
  mastery       real DEFAULT 0 CHECK (mastery BETWEEN 0 AND 1),
  last_attempted timestamptz,
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now(),
  UNIQUE(student_id, topic_id, bloom_level)
);

-- ─── 3. Cognitive Session Metrics ─────────────────────────────
-- Fatigue detection, difficulty adjustments, ZPD accuracy per session
CREATE TABLE IF NOT EXISTS cognitive_session_metrics (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id          uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  session_id          uuid REFERENCES quiz_sessions(id) ON DELETE SET NULL,
  zpd_target          real,           -- target difficulty (0-1)
  zpd_actual          real,           -- actual performance
  zpd_accuracy        real,           -- how well ZPD matched
  bloom_distribution  jsonb,          -- { remember: 2, understand: 3, apply: 1, ... }
  interleaving_ratio  real,           -- ratio of mixed topics (0-1)
  fatigue_detected    boolean DEFAULT false,
  difficulty_adjustments int DEFAULT 0, -- number of mid-session adjustments
  consecutive_errors  int DEFAULT 0,
  consecutive_correct int DEFAULT 0,
  avg_response_time   real,           -- seconds
  session_duration    int,            -- seconds
  questions_attempted int DEFAULT 0,
  created_at          timestamptz DEFAULT now()
);

-- ─── 4. Learning Velocity ────────────────────────────────────
-- Rate of mastery improvement, predicted mastery dates
CREATE TABLE IF NOT EXISTS learning_velocity (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id            uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  topic_id              uuid NOT NULL REFERENCES curriculum_topics(id) ON DELETE CASCADE,
  subject               text NOT NULL,
  velocity_score        real DEFAULT 0,     -- mastery points per session
  mastery_datapoints    jsonb DEFAULT '[]', -- [{date, mastery}] for regression
  predicted_mastery_date date,              -- when student will reach 0.95
  sessions_to_mastery   int,                -- estimated sessions remaining
  created_at            timestamptz DEFAULT now(),
  updated_at            timestamptz DEFAULT now(),
  UNIQUE(student_id, topic_id)
);

-- ─── 5. Knowledge Gaps ──────────────────────────────────────
-- Prerequisite chain analysis, gap detection
CREATE TABLE IF NOT EXISTS knowledge_gaps (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id          uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  topic_id            uuid NOT NULL REFERENCES curriculum_topics(id) ON DELETE CASCADE,
  prerequisite_topic_id uuid REFERENCES curriculum_topics(id) ON DELETE SET NULL,
  gap_type            text DEFAULT 'weak_prerequisite' CHECK (gap_type IN ('weak_prerequisite', 'missing_bloom_level', 'stale_knowledge', 'persistent_error')),
  severity            text DEFAULT 'medium' CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  description         text,
  description_hi      text,
  recommended_action  text,
  recommended_action_hi text,
  is_resolved         boolean DEFAULT false,
  detected_at         timestamptz DEFAULT now(),
  resolved_at         timestamptz,
  UNIQUE(student_id, topic_id, gap_type)
);

-- ─── 6. Question Responses (per-question detail) ─────────────
-- Enhanced response tracking with bloom level and reflection data
CREATE TABLE IF NOT EXISTS question_responses (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id        uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  question_id       uuid NOT NULL,
  session_id        uuid REFERENCES quiz_sessions(id) ON DELETE SET NULL,
  selected_option   smallint NOT NULL,
  is_correct        boolean NOT NULL,
  time_spent        real DEFAULT 0,         -- seconds
  bloom_level       text,
  difficulty        smallint,
  source            text DEFAULT 'practice', -- 'practice', 'board', 'cognitive'
  board_year        smallint,               -- if from board exam
  reflection_shown  boolean DEFAULT false,
  reflection_type   text,                   -- 'metacognitive', 'praise', 'pause'
  created_at        timestamptz DEFAULT now()
);

-- ─── 7. Enhance question_bank with board exam metadata ────────
-- Add columns for CBSE source tracking
DO $$ BEGIN
  ALTER TABLE question_bank ADD COLUMN IF NOT EXISTS source text DEFAULT 'internal';
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE question_bank ADD COLUMN IF NOT EXISTS board_year smallint;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE question_bank ADD COLUMN IF NOT EXISTS marks smallint DEFAULT 1;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE question_bank ADD COLUMN IF NOT EXISTS cbse_question_type text DEFAULT 'mcq';
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE question_bank ADD COLUMN IF NOT EXISTS paper_section text;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE question_bank ADD COLUMN IF NOT EXISTS set_code text;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE question_bank ADD COLUMN IF NOT EXISTS board_paper_id uuid REFERENCES cbse_board_papers(id);
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- ─── 8. Enhance concept_mastery with SM-2 fields ─────────────
DO $$ BEGIN
  ALTER TABLE concept_mastery ADD COLUMN IF NOT EXISTS ease_factor real DEFAULT 2.5;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE concept_mastery ADD COLUMN IF NOT EXISTS sm2_interval real DEFAULT 1;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE concept_mastery ADD COLUMN IF NOT EXISTS sm2_repetitions int DEFAULT 0;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- ─── 9. Indexes for performance ──────────────────────────────
CREATE INDEX IF NOT EXISTS idx_bloom_progression_student
  ON bloom_progression(student_id, topic_id);

CREATE INDEX IF NOT EXISTS idx_cognitive_metrics_student
  ON cognitive_session_metrics(student_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_learning_velocity_student
  ON learning_velocity(student_id, subject);

CREATE INDEX IF NOT EXISTS idx_knowledge_gaps_student_unresolved
  ON knowledge_gaps(student_id) WHERE NOT is_resolved;

CREATE INDEX IF NOT EXISTS idx_question_responses_student
  ON question_responses(student_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_question_responses_session
  ON question_responses(session_id);

CREATE INDEX IF NOT EXISTS idx_question_bank_source
  ON question_bank(source, board_year) WHERE source = 'cbse_board';

CREATE INDEX IF NOT EXISTS idx_question_bank_bloom
  ON question_bank(bloom_level, difficulty);

CREATE INDEX IF NOT EXISTS idx_cbse_board_papers_lookup
  ON cbse_board_papers(year, subject);

-- ─── 10. RLS Policies ────────────────────────────────────────
ALTER TABLE bloom_progression ENABLE ROW LEVEL SECURITY;
ALTER TABLE cognitive_session_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE learning_velocity ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_gaps ENABLE ROW LEVEL SECURITY;
ALTER TABLE question_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE cbse_board_papers ENABLE ROW LEVEL SECURITY;

-- Students can read their own data
CREATE POLICY "students_read_own_bloom" ON bloom_progression
  FOR SELECT USING (student_id IN (
    SELECT id FROM students WHERE auth_user_id = auth.uid()
  ));

CREATE POLICY "students_read_own_cognitive" ON cognitive_session_metrics
  FOR SELECT USING (student_id IN (
    SELECT id FROM students WHERE auth_user_id = auth.uid()
  ));

CREATE POLICY "students_read_own_velocity" ON learning_velocity
  FOR SELECT USING (student_id IN (
    SELECT id FROM students WHERE auth_user_id = auth.uid()
  ));

CREATE POLICY "students_read_own_gaps" ON knowledge_gaps
  FOR SELECT USING (student_id IN (
    SELECT id FROM students WHERE auth_user_id = auth.uid()
  ));

CREATE POLICY "students_read_own_responses" ON question_responses
  FOR SELECT USING (student_id IN (
    SELECT id FROM students WHERE auth_user_id = auth.uid()
  ));

-- Board papers are public read
CREATE POLICY "anyone_read_board_papers" ON cbse_board_papers
  FOR SELECT USING (true);

-- Service role can do everything (for edge functions)
CREATE POLICY "service_all_bloom" ON bloom_progression
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "service_all_cognitive" ON cognitive_session_metrics
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "service_all_velocity" ON learning_velocity
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "service_all_gaps" ON knowledge_gaps
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "service_all_responses" ON question_responses
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "service_all_board_papers" ON cbse_board_papers
  FOR ALL USING (auth.role() = 'service_role');

-- ─── 11. Helper function: get board exam questions ────────────
CREATE OR REPLACE FUNCTION get_board_exam_questions(
  p_subject text,
  p_grade text,
  p_year smallint DEFAULT NULL,
  p_count int DEFAULT 20
)
RETURNS SETOF question_bank
LANGUAGE sql STABLE
AS $$
  SELECT qb.*
  FROM question_bank qb
  JOIN subjects s ON s.id = qb.subject_id
  WHERE s.code = p_subject
    AND qb.is_active = true
    AND qb.source = 'cbse_board'
    AND (p_year IS NULL OR qb.board_year = p_year)
  ORDER BY
    CASE WHEN p_year IS NOT NULL THEN qb.board_year END DESC NULLS LAST,
    random()
  LIMIT p_count;
$$;

-- ─── 12. Helper function: get bloom progression for student ───
CREATE OR REPLACE FUNCTION get_bloom_progression(
  p_student_id uuid,
  p_subject text DEFAULT NULL
)
RETURNS TABLE(
  topic_id uuid,
  topic_title text,
  bloom_level text,
  mastery real,
  attempts int,
  correct int
)
LANGUAGE sql STABLE
AS $$
  SELECT
    bp.topic_id,
    ct.title AS topic_title,
    bp.bloom_level,
    bp.mastery,
    bp.attempts,
    bp.correct
  FROM bloom_progression bp
  JOIN curriculum_topics ct ON ct.id = bp.topic_id
  LEFT JOIN subjects s ON s.id = ct.subject_id
  WHERE bp.student_id = p_student_id
    AND (p_subject IS NULL OR s.code = p_subject)
  ORDER BY ct.display_order,
    CASE bp.bloom_level
      WHEN 'remember' THEN 1
      WHEN 'understand' THEN 2
      WHEN 'apply' THEN 3
      WHEN 'analyze' THEN 4
      WHEN 'evaluate' THEN 5
      WHEN 'create' THEN 6
    END;
$$;

-- ─── 13. Helper: get knowledge gaps for student ───────────────
CREATE OR REPLACE FUNCTION get_knowledge_gaps(
  p_student_id uuid,
  p_subject text DEFAULT NULL,
  p_limit int DEFAULT 10
)
RETURNS TABLE(
  id uuid,
  topic_title text,
  gap_type text,
  severity text,
  description text,
  description_hi text,
  recommended_action text,
  recommended_action_hi text,
  detected_at timestamptz
)
LANGUAGE sql STABLE
AS $$
  SELECT
    kg.id,
    ct.title AS topic_title,
    kg.gap_type,
    kg.severity,
    kg.description,
    kg.description_hi,
    kg.recommended_action,
    kg.recommended_action_hi,
    kg.detected_at
  FROM knowledge_gaps kg
  JOIN curriculum_topics ct ON ct.id = kg.topic_id
  LEFT JOIN subjects s ON s.id = ct.subject_id
  WHERE kg.student_id = p_student_id
    AND NOT kg.is_resolved
    AND (p_subject IS NULL OR s.code = p_subject)
  ORDER BY
    CASE kg.severity
      WHEN 'critical' THEN 1
      WHEN 'high' THEN 2
      WHEN 'medium' THEN 3
      WHEN 'low' THEN 4
    END,
    kg.detected_at DESC
  LIMIT p_limit;
$$;
