-- Migration: Add written answer columns to quiz_responses
-- Purpose: Support SA/MA/LA question types in the main quiz flow.
--          These columns store student-written text answers and AI evaluation
--          results. All columns are nullable so existing MCQ responses remain
--          unaffected.
--
-- Related changes:
--   - src/app/quiz/page.tsx: renders WrittenAnswerInput for non-MCQ questions
--   - supabase/functions/ncert-question-engine/: evaluates written answers via Claude

ALTER TABLE quiz_responses ADD COLUMN IF NOT EXISTS student_answer_text TEXT;
ALTER TABLE quiz_responses ADD COLUMN IF NOT EXISTS marks_awarded NUMERIC;
ALTER TABLE quiz_responses ADD COLUMN IF NOT EXISTS rubric_feedback TEXT;

-- Index for querying written responses (e.g. for review or analytics)
CREATE INDEX IF NOT EXISTS idx_quiz_responses_answer_text_not_null
  ON quiz_responses (quiz_session_id)
  WHERE student_answer_text IS NOT NULL;

COMMENT ON COLUMN quiz_responses.student_answer_text IS 'Student typed answer for SA/MA/LA questions. NULL for MCQ.';
COMMENT ON COLUMN quiz_responses.marks_awarded IS 'AI-evaluated marks for written answers (0 to marks_possible). NULL for MCQ.';
COMMENT ON COLUMN quiz_responses.rubric_feedback IS 'AI-generated CBSE rubric feedback for written answers. NULL for MCQ.';