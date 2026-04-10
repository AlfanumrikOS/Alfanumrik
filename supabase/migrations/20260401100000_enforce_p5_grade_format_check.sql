-- Migration: 20260401100000_enforce_p5_grade_format_check.sql
-- Purpose: Add CHECK constraint on question_bank.grade and curriculum_topics.grade
--          to enforce P5 (grades are plain strings "6" through "12", never "Grade X").
--          Also normalizes any remaining non-P5 grades as a safety net.

-- Step 1: Normalize any "Grade X" format rows that may have been inserted
-- before the remote fix migration (20260320145032) or after via direct SQL.
UPDATE question_bank
   SET grade = regexp_replace(grade, '^Grade\s+', '')
 WHERE grade ~ '^Grade\s+';

UPDATE curriculum_topics
   SET grade = regexp_replace(grade, '^Grade\s+', '')
 WHERE grade ~ '^Grade\s+';

-- Step 2: Add CHECK constraint on question_bank.grade
-- Idempotent: drop if exists, then create.
DO $$ BEGIN
  ALTER TABLE question_bank DROP CONSTRAINT IF EXISTS chk_question_bank_grade_p5;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

ALTER TABLE question_bank
  ADD CONSTRAINT chk_question_bank_grade_p5
  CHECK (grade IN ('6','7','8','9','10','11','12'));

-- Step 3: Add CHECK constraint on curriculum_topics.grade
DO $$ BEGIN
  ALTER TABLE curriculum_topics DROP CONSTRAINT IF EXISTS chk_curriculum_topics_grade_p5;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

ALTER TABLE curriculum_topics
  ADD CONSTRAINT chk_curriculum_topics_grade_p5
  CHECK (grade IN ('6','7','8','9','10','11','12'));

-- NOTE: rag_content_chunks intentionally uses "Grade X" format and is NOT constrained here.
-- The seed script (scripts/seed-question-bank.ts) correctly maps between formats:
--   rag_content_chunks: "Grade 10" (for RAG lookups)
--   question_bank: "10" (P5 format for quiz serving)
