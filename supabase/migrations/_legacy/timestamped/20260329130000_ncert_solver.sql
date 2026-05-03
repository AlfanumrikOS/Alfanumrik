-- ============================================================
-- NCERT Solver System Tables
-- Tracks solver results, verification, and accuracy metrics
-- ============================================================

-- 1. Solver results log — every question solved
CREATE TABLE IF NOT EXISTS solver_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid REFERENCES students(id) ON DELETE CASCADE,
  question_text text NOT NULL,
  subject text NOT NULL,
  grade text NOT NULL,
  question_type text NOT NULL, -- mcq, numerical, short_answer, etc.
  solver_type text NOT NULL,   -- deterministic, rule_based, llm_reasoning, hybrid
  answer text NOT NULL,
  steps jsonb DEFAULT '[]',
  concept text,
  explanation text,
  common_mistake text,
  formula_used text,
  confidence numeric(3,2) NOT NULL, -- 0.00 to 1.00
  verified boolean NOT NULL DEFAULT false,
  verification_issues jsonb DEFAULT '[]',
  rag_context_used boolean DEFAULT false,
  marks integer,
  response_time_ms integer,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_solver_student ON solver_results(student_id);
CREATE INDEX IF NOT EXISTS idx_solver_subject ON solver_results(subject, grade);
CREATE INDEX IF NOT EXISTS idx_solver_confidence ON solver_results(confidence) WHERE confidence < 0.7;

-- 2. Solver accuracy tracking — aggregated per subject/type
CREATE TABLE IF NOT EXISTS solver_accuracy (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject text NOT NULL,
  grade text NOT NULL,
  question_type text NOT NULL,
  solver_type text NOT NULL,
  total_solved integer DEFAULT 0,
  verified_correct integer DEFAULT 0,
  verified_incorrect integer DEFAULT 0,
  avg_confidence numeric(3,2) DEFAULT 0,
  last_updated_at timestamptz DEFAULT now(),
  CONSTRAINT solver_accuracy_unique UNIQUE (subject, grade, question_type, solver_type)
);

-- 3. Verified formulas/rules cache — deterministic solver reference
CREATE TABLE IF NOT EXISTS ncert_formulas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject text NOT NULL,
  grade text NOT NULL,
  chapter text,
  concept text NOT NULL,
  formula text NOT NULL,          -- the formula in LaTeX or plain text
  formula_name text NOT NULL,     -- e.g. "Pythagorean Theorem"
  variables jsonb DEFAULT '{}',   -- {"a": "first side", "b": "second side", "c": "hypotenuse"}
  example text,                   -- worked example
  common_mistakes jsonb DEFAULT '[]', -- ["confusing a^2+b^2 with (a+b)^2"]
  ncert_page_ref text,            -- e.g. "Class 10, Chapter 6, Page 128"
  is_verified boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_formulas_subject ON ncert_formulas(subject, grade);
CREATE UNIQUE INDEX IF NOT EXISTS idx_formulas_unique ON ncert_formulas(subject, grade, formula_name);

-- RLS
ALTER TABLE solver_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE solver_accuracy ENABLE ROW LEVEL SECURITY;
ALTER TABLE ncert_formulas ENABLE ROW LEVEL SECURITY;

CREATE POLICY solver_own_read ON solver_results FOR SELECT USING (student_id = get_my_student_id());
CREATE POLICY solver_service ON solver_results FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY accuracy_read ON solver_accuracy FOR SELECT USING (true);
CREATE POLICY accuracy_service ON solver_accuracy FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY formulas_read ON ncert_formulas FOR SELECT USING (true);
CREATE POLICY formulas_service ON ncert_formulas FOR ALL TO service_role USING (true) WITH CHECK (true);
