-- 006_cognitive_engine_v2.sql
-- Alfanumrik 2.0 Cognitive Engine tables, indexes, and RLS policies

-- 1. CBSE Board Papers
CREATE TABLE cbse_board_papers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  year int NOT NULL CHECK (year BETWEEN 2015 AND 2024),
  set_code text,
  subject text NOT NULL,
  paper_section text,
  total_marks int,
  created_at timestamptz DEFAULT now()
);

-- 2. Bloom Progression
CREATE TABLE bloom_progression (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  topic_id uuid NOT NULL REFERENCES curriculum_topics(id) ON DELETE CASCADE,
  bloom_level text NOT NULL DEFAULT 'remember'
    CHECK (bloom_level IN ('remember','understand','apply','analyze','evaluate','create')),
  correct_at_level int DEFAULT 0,
  total_at_level int DEFAULT 0,
  mastered_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (student_id, topic_id, bloom_level)
);

-- 3. Cognitive Session Metrics
CREATE TABLE cognitive_session_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid REFERENCES students(id) ON DELETE CASCADE,
  session_id uuid,
  questions_answered int DEFAULT 0,
  correct_streak int DEFAULT 0,
  wrong_streak int DEFAULT 0,
  avg_time_per_question numeric,
  session_duration_minutes numeric,
  recent_accuracy numeric,
  difficulty_adjustments int DEFAULT 0,
  fatigue_detected boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

-- 4. Learning Velocity
CREATE TABLE learning_velocity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid REFERENCES students(id) ON DELETE CASCADE,
  topic_id uuid REFERENCES curriculum_topics(id) ON DELETE CASCADE,
  velocity numeric,
  predicted_days_to_target int,
  data_points jsonb,
  calculated_at timestamptz DEFAULT now(),
  UNIQUE (student_id, topic_id)
);

-- 5. Knowledge Gaps
CREATE TABLE knowledge_gaps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid REFERENCES students(id) ON DELETE CASCADE,
  topic_id uuid REFERENCES curriculum_topics(id) ON DELETE CASCADE,
  missing_prerequisites uuid[],
  severity text CHECK (severity IN ('critical','moderate','minor')),
  resolved boolean DEFAULT false,
  detected_at timestamptz DEFAULT now()
);

-- 6. Question Responses
CREATE TABLE question_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid REFERENCES students(id) ON DELETE CASCADE,
  question_id uuid,
  session_id uuid,
  bloom_level text,
  is_correct boolean,
  time_spent_seconds numeric,
  selected_option text,
  reflection_shown boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

-- 7. ALTER question_bank: add CBSE source columns
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'question_bank') THEN
    ALTER TABLE question_bank
      ADD COLUMN IF NOT EXISTS source text DEFAULT 'curated',
      ADD COLUMN IF NOT EXISTS board_year int,
      ADD COLUMN IF NOT EXISTS marks int,
      ADD COLUMN IF NOT EXISTS cbse_question_type text,
      ADD COLUMN IF NOT EXISTS paper_section text;
  END IF;
END $$;

-- 8. ALTER concept_mastery: add SM-2 spaced repetition columns
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'concept_mastery') THEN
    ALTER TABLE concept_mastery
      ADD COLUMN IF NOT EXISTS ease_factor numeric DEFAULT 2.5,
      ADD COLUMN IF NOT EXISTS sm2_interval int DEFAULT 1,
      ADD COLUMN IF NOT EXISTS sm2_repetitions int DEFAULT 0,
      ADD COLUMN IF NOT EXISTS next_review_date timestamptz;
  END IF;
END $$;

-- ============ INDEXES ============
CREATE INDEX idx_bloom_progression_student ON bloom_progression (student_id);
CREATE INDEX idx_cognitive_session_student ON cognitive_session_metrics (student_id);
CREATE INDEX idx_learning_velocity_student ON learning_velocity (student_id);
CREATE INDEX idx_knowledge_gaps_student ON knowledge_gaps (student_id);
CREATE INDEX idx_question_responses_student ON question_responses (student_id);
CREATE INDEX idx_question_responses_session ON question_responses (session_id);

-- ============ ROW LEVEL SECURITY ============

-- cbse_board_papers: public read
ALTER TABLE cbse_board_papers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read board papers"
  ON cbse_board_papers FOR SELECT USING (true);

-- bloom_progression
ALTER TABLE bloom_progression ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Students read own bloom progression"
  ON bloom_progression FOR SELECT
  USING (student_id = auth.uid());
CREATE POLICY "Students insert own bloom progression"
  ON bloom_progression FOR INSERT
  WITH CHECK (student_id = auth.uid());
CREATE POLICY "Students update own bloom progression"
  ON bloom_progression FOR UPDATE
  USING (student_id = auth.uid());

-- cognitive_session_metrics
ALTER TABLE cognitive_session_metrics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Students read own session metrics"
  ON cognitive_session_metrics FOR SELECT
  USING (student_id = auth.uid());
CREATE POLICY "Students insert own session metrics"
  ON cognitive_session_metrics FOR INSERT
  WITH CHECK (student_id = auth.uid());

-- learning_velocity
ALTER TABLE learning_velocity ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Students read own velocity"
  ON learning_velocity FOR SELECT
  USING (student_id = auth.uid());

-- knowledge_gaps
ALTER TABLE knowledge_gaps ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Students read own gaps"
  ON knowledge_gaps FOR SELECT
  USING (student_id = auth.uid());

-- question_responses
ALTER TABLE question_responses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Students read own responses"
  ON question_responses FOR SELECT
  USING (student_id = auth.uid());
CREATE POLICY "Students insert own responses"
  ON question_responses FOR INSERT
  WITH CHECK (student_id = auth.uid());
