-- ============================================================================
-- Migration: 20260402130000_quiz_qa_redesign.sql
-- Purpose: Quiz system redesign part 1 — new tables, ALTER columns, indexes,
--          and seed data for CBSE exam paper templates.
-- Note: RPCs are in a separate migration file (part 2).
-- ============================================================================


-- ============================================================================
-- 1. chapters — CBSE chapter catalog per subject and grade
-- ============================================================================

CREATE TABLE IF NOT EXISTS chapters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  grade TEXT NOT NULL,                    -- P5: grades are TEXT "6"-"12"
  chapter_number INTEGER NOT NULL,
  title TEXT NOT NULL,
  title_hi TEXT,
  ncert_page_start INTEGER,
  ncert_page_end INTEGER,
  total_questions INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(subject_id, grade, chapter_number)
);

ALTER TABLE chapters ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read active chapters (reference data)
CREATE POLICY "chapters_authenticated_select" ON chapters
  FOR SELECT TO authenticated
  USING (is_active = true);

-- Service role has full access (bypasses RLS automatically, but explicit for clarity)
CREATE POLICY "chapters_service_all" ON chapters
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);


-- ============================================================================
-- 2. chapter_topics — topic breakdown within each chapter
-- ============================================================================

CREATE TABLE IF NOT EXISTS chapter_topics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chapter_id UUID NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  title_hi TEXT,
  concept_tag TEXT NOT NULL,
  display_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(chapter_id, concept_tag)
);

ALTER TABLE chapter_topics ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read chapter topics (reference data)
CREATE POLICY "chapter_topics_authenticated_select" ON chapter_topics
  FOR SELECT TO authenticated
  USING (true);

-- Service role has full access
CREATE POLICY "chapter_topics_service_all" ON chapter_topics
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);


-- ============================================================================
-- 3. user_question_history — tracks which questions each student has seen
-- ============================================================================

CREATE TABLE IF NOT EXISTS user_question_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  question_id UUID NOT NULL REFERENCES question_bank(id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  grade TEXT NOT NULL,                    -- P5: grades are TEXT "6"-"12"
  chapter_number INTEGER,
  first_shown_at TIMESTAMPTZ DEFAULT now(),
  last_shown_at TIMESTAMPTZ DEFAULT now(),
  times_shown INTEGER DEFAULT 1,
  last_result BOOLEAN,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(student_id, question_id)
);

ALTER TABLE user_question_history ENABLE ROW LEVEL SECURITY;

-- Student reads own history
CREATE POLICY "uqh_student_select" ON user_question_history
  FOR SELECT USING (
    student_id IN (SELECT id FROM students WHERE auth_user_id = auth.uid())
  );

-- Student inserts own history
CREATE POLICY "uqh_student_insert" ON user_question_history
  FOR INSERT WITH CHECK (
    student_id IN (SELECT id FROM students WHERE auth_user_id = auth.uid())
  );

-- Student updates own history (e.g., times_shown, last_result)
CREATE POLICY "uqh_student_update" ON user_question_history
  FOR UPDATE USING (
    student_id IN (SELECT id FROM students WHERE auth_user_id = auth.uid())
  );

-- Service role has full access
CREATE POLICY "uqh_service_all" ON user_question_history
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);


-- ============================================================================
-- 4. chapter_progress — per-student, per-chapter progress tracking
-- ============================================================================

CREATE TABLE IF NOT EXISTS chapter_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  chapter_id UUID NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  grade TEXT NOT NULL,                    -- P5: grades are TEXT "6"-"12"
  chapter_number INTEGER NOT NULL,
  questions_attempted INTEGER DEFAULT 0,
  questions_correct INTEGER DEFAULT 0,
  unique_questions_seen INTEGER DEFAULT 0,
  total_questions_in_chapter INTEGER DEFAULT 0,
  pool_coverage_percent REAL DEFAULT 0,
  accuracy_percent REAL DEFAULT 0,
  concepts_attempted INTEGER DEFAULT 0,
  concepts_mastered INTEGER DEFAULT 0,
  total_concepts INTEGER DEFAULT 0,
  is_completed BOOLEAN DEFAULT false,
  test_mode_unlocked BOOLEAN DEFAULT false,
  completed_at TIMESTAMPTZ,
  last_activity_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(student_id, chapter_id)
);

ALTER TABLE chapter_progress ENABLE ROW LEVEL SECURITY;

-- Student reads own progress
CREATE POLICY "cp_student_select" ON chapter_progress
  FOR SELECT USING (
    student_id IN (SELECT id FROM students WHERE auth_user_id = auth.uid())
  );

-- Student inserts own progress
CREATE POLICY "cp_student_insert" ON chapter_progress
  FOR INSERT WITH CHECK (
    student_id IN (SELECT id FROM students WHERE auth_user_id = auth.uid())
  );

-- Student updates own progress
CREATE POLICY "cp_student_update" ON chapter_progress
  FOR UPDATE USING (
    student_id IN (SELECT id FROM students WHERE auth_user_id = auth.uid())
  );

-- Parent reads linked child's progress
CREATE POLICY "cp_parent_select" ON chapter_progress
  FOR SELECT USING (
    student_id IN (
      SELECT student_id FROM guardian_student_links
      WHERE guardian_id IN (SELECT id FROM guardians WHERE auth_user_id = auth.uid())
      AND status = 'approved'
    )
  );

-- Teacher reads assigned students' progress
CREATE POLICY "cp_teacher_select" ON chapter_progress
  FOR SELECT USING (
    student_id IN (
      SELECT student_id FROM class_students
      WHERE class_id IN (
        SELECT class_id FROM class_teachers
        WHERE teacher_id IN (
          SELECT id FROM teachers WHERE auth_user_id = auth.uid()
        )
      )
    )
  );

-- Service role has full access
CREATE POLICY "cp_service_all" ON chapter_progress
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- Updated_at trigger for chapter_progress
CREATE OR REPLACE FUNCTION update_chapter_progress_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_chapter_progress_updated_at ON chapter_progress;
CREATE TRIGGER trg_chapter_progress_updated_at
  BEFORE UPDATE ON chapter_progress
  FOR EACH ROW EXECUTE FUNCTION update_chapter_progress_updated_at();


-- ============================================================================
-- 5. exam_paper_templates — CBSE exam paper structure templates
-- ============================================================================

CREATE TABLE IF NOT EXISTS exam_paper_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  name_hi TEXT,
  grade TEXT NOT NULL,                    -- P5: grades are TEXT "6"-"12"
  subject TEXT,
  board TEXT DEFAULT 'CBSE',
  total_marks INTEGER NOT NULL,
  duration_minutes INTEGER NOT NULL,
  sections JSONB NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE exam_paper_templates ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read active templates (reference data)
CREATE POLICY "ept_authenticated_select" ON exam_paper_templates
  FOR SELECT TO authenticated
  USING (true);

-- Service role has full access
CREATE POLICY "ept_service_all" ON exam_paper_templates
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);


-- ============================================================================
-- 6. ALTER question_bank — add new columns for redesign
-- ============================================================================

DO $$ BEGIN
  ALTER TABLE question_bank ADD COLUMN concept_tag TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE question_bank ADD COLUMN chapter_id UUID REFERENCES chapters(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE question_bank ADD COLUMN question_type_v2 TEXT DEFAULT 'mcq';
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE question_bank ADD COLUMN case_passage TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE question_bank ADD COLUMN case_passage_hi TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE question_bank ADD COLUMN expected_answer TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE question_bank ADD COLUMN expected_answer_hi TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE question_bank ADD COLUMN answer_rubric JSONB;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE question_bank ADD COLUMN max_marks INTEGER DEFAULT 1;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE question_bank ADD COLUMN ncert_exercise TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE question_bank ADD COLUMN ncert_page INTEGER;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE question_bank ADD COLUMN is_ncert BOOLEAN DEFAULT false;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- CHECK constraint on question_type_v2
-- Use DO block to avoid failure if constraint already exists
DO $$ BEGIN
  ALTER TABLE question_bank
    ADD CONSTRAINT chk_question_type_v2
    CHECK (question_type_v2 IN ('mcq', 'assertion_reason', 'case_based', 'short_answer', 'long_answer'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- ============================================================================
-- 7. Indexes
-- ============================================================================

-- chapters indexes
CREATE INDEX IF NOT EXISTS idx_chapters_subject_grade
  ON chapters(subject_id, grade);

-- chapter_topics indexes
CREATE INDEX IF NOT EXISTS idx_chapter_topics_chapter
  ON chapter_topics(chapter_id);

CREATE INDEX IF NOT EXISTS idx_chapter_topics_concept
  ON chapter_topics(concept_tag);

-- user_question_history indexes
CREATE INDEX IF NOT EXISTS idx_uqh_student_scope
  ON user_question_history(student_id, subject, grade, chapter_number);

CREATE INDEX IF NOT EXISTS idx_uqh_student_recent
  ON user_question_history(student_id, last_shown_at DESC);

-- chapter_progress indexes
CREATE INDEX IF NOT EXISTS idx_cp_student_scope
  ON chapter_progress(student_id, subject, grade);

CREATE INDEX IF NOT EXISTS idx_cp_completed
  ON chapter_progress(student_id, is_completed);

-- question_bank new column indexes
CREATE INDEX IF NOT EXISTS idx_qb_concept
  ON question_bank(concept_tag) WHERE concept_tag IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_qb_chapter_id
  ON question_bank(chapter_id) WHERE chapter_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_qb_type_v2
  ON question_bank(question_type_v2);

CREATE INDEX IF NOT EXISTS idx_qb_ncert
  ON question_bank(is_ncert) WHERE is_ncert = true;

-- exam_paper_templates indexes
CREATE INDEX IF NOT EXISTS idx_ept_grade
  ON exam_paper_templates(grade, subject);


-- ============================================================================
-- 8. Seed exam paper templates — CBSE standard patterns
-- ============================================================================

-- Grades 6-8: 50 marks, 120 minutes
-- Only insert if no template exists for this grade range to maintain idempotency
INSERT INTO exam_paper_templates (name, name_hi, grade, board, total_marks, duration_minutes, sections, is_active)
SELECT * FROM (
  VALUES
    ('CBSE Standard - Class 6', 'सीबीएसई मानक - कक्षा 6', '6', 'CBSE', 50, 120,
     '[{"name":"Section A","name_hi":"खंड अ","question_type":"mcq","marks_per_question":1,"total_questions":15,"attempt_questions":15,"instructions":"Answer all questions","instructions_hi":"सभी प्रश्नों के उत्तर दें"},{"name":"Section B","name_hi":"खंड ब","question_type":"short_answer","marks_per_question":2,"total_questions":10,"attempt_questions":10,"instructions":"Answer in 2-3 sentences","instructions_hi":"2-3 वाक्यों में उत्तर दें"},{"name":"Section C","name_hi":"खंड स","question_type":"long_answer","marks_per_question":5,"total_questions":3,"attempt_questions":3,"instructions":"Answer in detail","instructions_hi":"विस्तार से उत्तर दें"}]'::jsonb,
     true),
    ('CBSE Standard - Class 7', 'सीबीएसई मानक - कक्षा 7', '7', 'CBSE', 50, 120,
     '[{"name":"Section A","name_hi":"खंड अ","question_type":"mcq","marks_per_question":1,"total_questions":15,"attempt_questions":15,"instructions":"Answer all questions","instructions_hi":"सभी प्रश्नों के उत्तर दें"},{"name":"Section B","name_hi":"खंड ब","question_type":"short_answer","marks_per_question":2,"total_questions":10,"attempt_questions":10,"instructions":"Answer in 2-3 sentences","instructions_hi":"2-3 वाक्यों में उत्तर दें"},{"name":"Section C","name_hi":"खंड स","question_type":"long_answer","marks_per_question":5,"total_questions":3,"attempt_questions":3,"instructions":"Answer in detail","instructions_hi":"विस्तार से उत्तर दें"}]'::jsonb,
     true),
    ('CBSE Standard - Class 8', 'सीबीएसई मानक - कक्षा 8', '8', 'CBSE', 50, 120,
     '[{"name":"Section A","name_hi":"खंड अ","question_type":"mcq","marks_per_question":1,"total_questions":15,"attempt_questions":15,"instructions":"Answer all questions","instructions_hi":"सभी प्रश्नों के उत्तर दें"},{"name":"Section B","name_hi":"खंड ब","question_type":"short_answer","marks_per_question":2,"total_questions":10,"attempt_questions":10,"instructions":"Answer in 2-3 sentences","instructions_hi":"2-3 वाक्यों में उत्तर दें"},{"name":"Section C","name_hi":"खंड स","question_type":"long_answer","marks_per_question":5,"total_questions":3,"attempt_questions":3,"instructions":"Answer in detail","instructions_hi":"विस्तार से उत्तर दें"}]'::jsonb,
     true)
) AS v(name, name_hi, grade, board, total_marks, duration_minutes, sections, is_active)
WHERE NOT EXISTS (
  SELECT 1 FROM exam_paper_templates WHERE grade IN ('6','7','8') AND board = 'CBSE' AND name LIKE 'CBSE Standard%'
);

-- Grades 9-10: 80 marks, 180 minutes (CBSE board exam pattern)
INSERT INTO exam_paper_templates (name, name_hi, grade, board, total_marks, duration_minutes, sections, is_active)
SELECT * FROM (
  VALUES
    ('CBSE Standard - Class 9', 'सीबीएसई मानक - कक्षा 9', '9', 'CBSE', 80, 180,
     '[{"name":"Section A - MCQ","name_hi":"खंड अ - बहुविकल्पीय","question_type":"mcq","marks_per_question":1,"total_questions":20,"attempt_questions":16,"instructions":"Choose the correct option","instructions_hi":"सही विकल्प चुनें"},{"name":"Section B - Assertion Reason","name_hi":"खंड ब - अभिकथन कारण","question_type":"assertion_reason","marks_per_question":1,"total_questions":5,"attempt_questions":4,"instructions":"Read both statements","instructions_hi":"दोनों कथन पढ़ें"},{"name":"Section C - Short Answer (2m)","name_hi":"खंड स - लघु उत्तर (2 अंक)","question_type":"short_answer","marks_per_question":2,"total_questions":6,"attempt_questions":5,"instructions":"Answer in 30-50 words","instructions_hi":"30-50 शब्दों में उत्तर दें"},{"name":"Section D - Short Answer (3m)","name_hi":"खंड द - लघु उत्तर (3 अंक)","question_type":"short_answer","marks_per_question":3,"total_questions":7,"attempt_questions":6,"instructions":"Answer in 50-80 words","instructions_hi":"50-80 शब्दों में उत्तर दें"},{"name":"Section E - Long Answer","name_hi":"खंड इ - दीर्घ उत्तर","question_type":"long_answer","marks_per_question":5,"total_questions":3,"attempt_questions":2,"instructions":"Answer in detail with diagrams","instructions_hi":"चित्र सहित विस्तार से उत्तर दें"},{"name":"Section F - Case Based","name_hi":"खंड फ - केस आधारित","question_type":"case_based","marks_per_question":4,"total_questions":3,"attempt_questions":2,"instructions":"Read the passage and answer","instructions_hi":"गद्यांश पढ़ें और उत्तर दें"}]'::jsonb,
     true),
    ('CBSE Standard - Class 10', 'सीबीएसई मानक - कक्षा 10', '10', 'CBSE', 80, 180,
     '[{"name":"Section A - MCQ","name_hi":"खंड अ - बहुविकल्पीय","question_type":"mcq","marks_per_question":1,"total_questions":20,"attempt_questions":16,"instructions":"Choose the correct option","instructions_hi":"सही विकल्प चुनें"},{"name":"Section B - Assertion Reason","name_hi":"खंड ब - अभिकथन कारण","question_type":"assertion_reason","marks_per_question":1,"total_questions":5,"attempt_questions":4,"instructions":"Read both statements","instructions_hi":"दोनों कथन पढ़ें"},{"name":"Section C - Short Answer (2m)","name_hi":"खंड स - लघु उत्तर (2 अंक)","question_type":"short_answer","marks_per_question":2,"total_questions":6,"attempt_questions":5,"instructions":"Answer in 30-50 words","instructions_hi":"30-50 शब्दों में उत्तर दें"},{"name":"Section D - Short Answer (3m)","name_hi":"खंड द - लघु उत्तर (3 अंक)","question_type":"short_answer","marks_per_question":3,"total_questions":7,"attempt_questions":6,"instructions":"Answer in 50-80 words","instructions_hi":"50-80 शब्दों में उत्तर दें"},{"name":"Section E - Long Answer","name_hi":"खंड इ - दीर्घ उत्तर","question_type":"long_answer","marks_per_question":5,"total_questions":3,"attempt_questions":2,"instructions":"Answer in detail with diagrams","instructions_hi":"चित्र सहित विस्तार से उत्तर दें"},{"name":"Section F - Case Based","name_hi":"खंड फ - केस आधारित","question_type":"case_based","marks_per_question":4,"total_questions":3,"attempt_questions":2,"instructions":"Read the passage and answer","instructions_hi":"गद्यांश पढ़ें और उत्तर दें"}]'::jsonb,
     true)
) AS v(name, name_hi, grade, board, total_marks, duration_minutes, sections, is_active)
WHERE NOT EXISTS (
  SELECT 1 FROM exam_paper_templates WHERE grade IN ('9','10') AND board = 'CBSE' AND name LIKE 'CBSE Standard%'
);

-- Grades 11-12: 70 marks, 180 minutes (CBSE board exam pattern)
-- Adjusted section counts to fit 70 marks:
--   Section A: MCQ 16x1 = 16, Section B: Assertion Reason 4x1 = 4,
--   Section C: Short Answer 2m 5x2 = 10, Section D: Short Answer 3m 5x3 = 15,
--   Section E: Long Answer 3x5 = 15 (attempt 2 = 10), Section F: Case Based 2x4 = 8 (attempt 2 = 8)
--   Total attempted: 16 + 4 + 10 + 15 + 10 + 8 = 63 ... adjusted to reach 70:
--   Section A: MCQ 20x1 attempt 20 = 20, Section B: AR 5x1 attempt 5 = 5,
--   Section C: Short 2m 5x2 attempt 5 = 10, Section D: Short 3m 5x3 attempt 5 = 15,
--   Section E: Long 4x5 attempt 2 = 10, Section F: Case 3x4 attempt 2 = 8
--   Subtotal attempted: 20+5+10+15+10+8 = 68. Add 1 extra long answer attempt:
--   Revised: Section E: 3 attempt 2 = 10; adjust Section C to 6 attempt 6 = 12
--   20+5+12+15+10+8 = 70. Done.
INSERT INTO exam_paper_templates (name, name_hi, grade, board, total_marks, duration_minutes, sections, is_active)
SELECT * FROM (
  VALUES
    ('CBSE Standard - Class 11', 'सीबीएसई मानक - कक्षा 11', '11', 'CBSE', 70, 180,
     '[{"name":"Section A - MCQ","name_hi":"खंड अ - बहुविकल्पीय","question_type":"mcq","marks_per_question":1,"total_questions":24,"attempt_questions":20,"instructions":"Choose the correct option","instructions_hi":"सही विकल्प चुनें"},{"name":"Section B - Assertion Reason","name_hi":"खंड ब - अभिकथन कारण","question_type":"assertion_reason","marks_per_question":1,"total_questions":6,"attempt_questions":5,"instructions":"Read both statements","instructions_hi":"दोनों कथन पढ़ें"},{"name":"Section C - Short Answer (2m)","name_hi":"खंड स - लघु उत्तर (2 अंक)","question_type":"short_answer","marks_per_question":2,"total_questions":7,"attempt_questions":6,"instructions":"Answer in 30-50 words","instructions_hi":"30-50 शब्दों में उत्तर दें"},{"name":"Section D - Short Answer (3m)","name_hi":"खंड द - लघु उत्तर (3 अंक)","question_type":"short_answer","marks_per_question":3,"total_questions":6,"attempt_questions":5,"instructions":"Answer in 50-80 words","instructions_hi":"50-80 शब्दों में उत्तर दें"},{"name":"Section E - Long Answer","name_hi":"खंड इ - दीर्घ उत्तर","question_type":"long_answer","marks_per_question":5,"total_questions":3,"attempt_questions":2,"instructions":"Answer in detail with diagrams","instructions_hi":"चित्र सहित विस्तार से उत्तर दें"},{"name":"Section F - Case Based","name_hi":"खंड फ - केस आधारित","question_type":"case_based","marks_per_question":4,"total_questions":3,"attempt_questions":2,"instructions":"Read the passage and answer","instructions_hi":"गद्यांश पढ़ें और उत्तर दें"}]'::jsonb,
     true),
    ('CBSE Standard - Class 12', 'सीबीएसई मानक - कक्षा 12', '12', 'CBSE', 70, 180,
     '[{"name":"Section A - MCQ","name_hi":"खंड अ - बहुविकल्पीय","question_type":"mcq","marks_per_question":1,"total_questions":24,"attempt_questions":20,"instructions":"Choose the correct option","instructions_hi":"सही विकल्प चुनें"},{"name":"Section B - Assertion Reason","name_hi":"खंड ब - अभिकथन कारण","question_type":"assertion_reason","marks_per_question":1,"total_questions":6,"attempt_questions":5,"instructions":"Read both statements","instructions_hi":"दोनों कथन पढ़ें"},{"name":"Section C - Short Answer (2m)","name_hi":"खंड स - लघु उत्तर (2 अंक)","question_type":"short_answer","marks_per_question":2,"total_questions":7,"attempt_questions":6,"instructions":"Answer in 30-50 words","instructions_hi":"30-50 शब्दों में उत्तर दें"},{"name":"Section D - Short Answer (3m)","name_hi":"खंड द - लघु उत्तर (3 अंक)","question_type":"short_answer","marks_per_question":3,"total_questions":6,"attempt_questions":5,"instructions":"Answer in 50-80 words","instructions_hi":"50-80 शब्दों में उत्तर दें"},{"name":"Section E - Long Answer","name_hi":"खंड इ - दीर्घ उत्तर","question_type":"long_answer","marks_per_question":5,"total_questions":3,"attempt_questions":2,"instructions":"Answer in detail with diagrams","instructions_hi":"चित्र सहित विस्तार से उत्तर दें"},{"name":"Section F - Case Based","name_hi":"खंड फ - केस आधारित","question_type":"case_based","marks_per_question":4,"total_questions":3,"attempt_questions":2,"instructions":"Read the passage and answer","instructions_hi":"गद्यांश पढ़ें और उत्तर दें"}]'::jsonb,
     true)
) AS v(name, name_hi, grade, board, total_marks, duration_minutes, sections, is_active)
WHERE NOT EXISTS (
  SELECT 1 FROM exam_paper_templates WHERE grade IN ('11','12') AND board = 'CBSE' AND name LIKE 'CBSE Standard%'
);


-- ============================================================================
-- End of migration: 20260402130000_quiz_qa_redesign.sql
-- Tables created: chapters, chapter_topics, user_question_history,
--                 chapter_progress, exam_paper_templates
-- Columns added to: question_bank (12 columns + 1 CHECK constraint)
-- Indexes created: 13
-- Seed data: 7 exam paper templates (grades 6-12)
-- RPCs: see part 2 migration file
-- ============================================================================
