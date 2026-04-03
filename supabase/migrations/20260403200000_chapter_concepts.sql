-- Migration: 20260403200000_chapter_concepts.sql
-- Purpose: Replace the empty chapter_content_sections approach with a structured
--          concept-based learning system via the chapter_concepts table and
--          get_chapter_concepts RPC.


-- ============================================================================
-- 1. chapter_concepts — structured concept-based content for chapter learning
-- ============================================================================

CREATE TABLE IF NOT EXISTS chapter_concepts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Location
  grade TEXT NOT NULL,                    -- P5: "6"-"12"
  subject TEXT NOT NULL,                  -- subject code: "science", "math"
  chapter_number INTEGER NOT NULL,
  chapter_title TEXT,

  -- Concept identity
  concept_number INTEGER NOT NULL,        -- order within chapter (1, 2, 3...)
  title TEXT NOT NULL,                    -- "Photosynthesis", "Ohm's Law"
  title_hi TEXT,                          -- Hindi title
  slug TEXT,                              -- URL-friendly: "photosynthesis"

  -- Structured content
  learning_objective TEXT NOT NULL,        -- "Understand how plants make food using sunlight"
  learning_objective_hi TEXT,
  explanation TEXT NOT NULL,               -- Concise explanation (NOT raw textbook dump)
  explanation_hi TEXT,
  key_formula TEXT,                        -- LaTeX or plain text formula if applicable

  -- Example
  example_title TEXT,                     -- "Worked Example" or specific title
  example_content TEXT,                   -- Step-by-step example
  example_content_hi TEXT,

  -- Common mistakes
  common_mistakes JSONB DEFAULT '[]',     -- ["Confusing speed with velocity", ...]

  -- Exam tips
  exam_tips JSONB DEFAULT '[]',           -- ["This concept appears frequently in board exams", ...]

  -- Visual support
  diagram_refs JSONB DEFAULT '[]',        -- ["Figure 2.1", "Table 2.3"] from content_media
  diagram_description TEXT,               -- Text description of the key diagram

  -- Practice question (embedded, for quick check)
  practice_question TEXT,                 -- "What is the SI unit of force?"
  practice_options JSONB,                 -- ["Newton", "Joule", "Watt", "Pascal"]
  practice_correct_index INTEGER,         -- 0
  practice_explanation TEXT,              -- "Force is measured in Newtons (N)"

  -- Metadata
  difficulty INTEGER DEFAULT 2,           -- 1=easy, 2=medium, 3=hard
  bloom_level TEXT DEFAULT 'understand',
  estimated_minutes INTEGER DEFAULT 5,    -- Reading time

  -- Traceability
  rag_chunk_ids UUID[] DEFAULT '{}',      -- Which RAG chunks this concept was built from
  syllabus_graph_id UUID,                 -- Link to cbse_syllabus_graph if exists
  question_bank_ids UUID[] DEFAULT '{}',  -- Questions related to this concept

  -- Status
  is_active BOOLEAN NOT NULL DEFAULT true,
  source TEXT DEFAULT 'ncert_2025',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Unique constraint (idempotent via DO block since CREATE TABLE IF NOT EXISTS
-- may skip table creation but constraint still needs to be safe)
DO $$ BEGIN
  ALTER TABLE chapter_concepts
    ADD CONSTRAINT uq_chapter_concepts_grade_subject_chapter_concept
    UNIQUE (grade, subject, chapter_number, concept_number);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- ============================================================================
-- 1b. CHECK constraints
-- ============================================================================

DO $$ BEGIN
  ALTER TABLE chapter_concepts
    ADD CONSTRAINT chk_cc_difficulty
    CHECK (difficulty BETWEEN 1 AND 3);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE chapter_concepts
    ADD CONSTRAINT chk_cc_bloom_level
    CHECK (bloom_level IN (
      'remember', 'understand', 'apply', 'analyze', 'evaluate', 'create'
    ));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE chapter_concepts
    ADD CONSTRAINT chk_cc_practice_correct_index
    CHECK (practice_correct_index IS NULL OR practice_correct_index BETWEEN 0 AND 3);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE chapter_concepts
    ADD CONSTRAINT chk_cc_estimated_minutes
    CHECK (estimated_minutes IS NULL OR estimated_minutes > 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- ============================================================================
-- 2. RLS on chapter_concepts
-- ============================================================================

ALTER TABLE chapter_concepts ENABLE ROW LEVEL SECURITY;

-- Public read for active content (curriculum reference data, not per-student)
DO $$ BEGIN
  CREATE POLICY "cc_public_read" ON chapter_concepts
    FOR SELECT USING (is_active = true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Service role full access for admin content management
DO $$ BEGIN
  CREATE POLICY "cc_service_all" ON chapter_concepts
    FOR ALL TO service_role
    USING (true)
    WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- ============================================================================
-- 3. Indexes on chapter_concepts
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_cc_chapter
  ON chapter_concepts(grade, subject, chapter_number) WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_cc_difficulty
  ON chapter_concepts(difficulty, bloom_level);


-- ============================================================================
-- 4. Updated_at trigger for chapter_concepts
-- ============================================================================

CREATE OR REPLACE FUNCTION update_chapter_concepts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_chapter_concepts_updated_at ON chapter_concepts;
CREATE TRIGGER trg_chapter_concepts_updated_at
  BEFORE UPDATE ON chapter_concepts
  FOR EACH ROW EXECUTE FUNCTION update_chapter_concepts_updated_at();


-- ============================================================================
-- 5. RPC: get_chapter_concepts
-- ============================================================================
-- SECURITY DEFINER: This function provides public read access to curated
-- chapter concept data. Using DEFINER to bypass RLS and apply filtering
-- within the function body, consistent with get_chapter_content and other
-- chapter/content RPCs in the codebase.

CREATE OR REPLACE FUNCTION get_chapter_concepts(
  p_grade TEXT,
  p_subject TEXT,
  p_chapter_number INTEGER
)
RETURNS TABLE(
  concept_id UUID,
  concept_number INTEGER,
  title TEXT,
  title_hi TEXT,
  learning_objective TEXT,
  learning_objective_hi TEXT,
  explanation TEXT,
  explanation_hi TEXT,
  key_formula TEXT,
  example_title TEXT,
  example_content TEXT,
  example_content_hi TEXT,
  common_mistakes JSONB,
  exam_tips JSONB,
  diagram_refs JSONB,
  diagram_description TEXT,
  practice_question TEXT,
  practice_options JSONB,
  practice_correct_index INTEGER,
  practice_explanation TEXT,
  difficulty INTEGER,
  bloom_level TEXT,
  estimated_minutes INTEGER
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_grade TEXT;
BEGIN
  -- Normalize grade: accept "7", "Grade 7", "grade7" -> "7" (P5 format)
  v_grade := CASE
    WHEN p_grade ~ '^\d+$' THEN p_grade
    WHEN p_grade ILIKE 'grade%' THEN regexp_replace(p_grade, '[^0-9]', '', 'g')
    ELSE p_grade
  END;

  RETURN QUERY
  SELECT
    cc.id AS concept_id,
    cc.concept_number,
    cc.title,
    cc.title_hi,
    cc.learning_objective,
    cc.learning_objective_hi,
    cc.explanation,
    cc.explanation_hi,
    cc.key_formula,
    cc.example_title,
    cc.example_content,
    cc.example_content_hi,
    cc.common_mistakes,
    cc.exam_tips,
    cc.diagram_refs,
    cc.diagram_description,
    cc.practice_question,
    cc.practice_options,
    cc.practice_correct_index,
    cc.practice_explanation,
    cc.difficulty,
    cc.bloom_level,
    cc.estimated_minutes
  FROM chapter_concepts cc
  WHERE cc.is_active = true
    AND cc.grade = v_grade
    AND cc.subject = p_subject
    AND cc.chapter_number = p_chapter_number
  ORDER BY cc.concept_number ASC;
END;
$$;


-- ============================================================================
-- End of migration: 20260403200000_chapter_concepts.sql
-- Tables created: chapter_concepts (with RLS + 2 policies + trigger)
-- Constraints added: 4 (difficulty, bloom_level, practice_correct_index, estimated_minutes)
-- Indexes added: 2 (idx_cc_chapter, idx_cc_difficulty)
-- RPCs created: get_chapter_concepts
-- ============================================================================
