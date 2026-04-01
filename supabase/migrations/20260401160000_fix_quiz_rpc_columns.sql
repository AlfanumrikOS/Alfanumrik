-- Migration: 20260401160000_fix_quiz_rpc_columns.sql
-- Purpose: Fix get_quiz_questions to use actual question_bank column names
--          (question_hi instead of question_text_hi, correct_answer_index instead of correct_option)

CREATE OR REPLACE FUNCTION get_quiz_questions(
  p_subject TEXT,
  p_grade TEXT,
  p_count INT DEFAULT 10,
  p_difficulty INT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_subject_id UUID;
  v_questions JSONB;
BEGIN
  SELECT id INTO v_subject_id FROM subjects WHERE code = p_subject LIMIT 1;

  IF v_subject_id IS NULL THEN
    RETURN '[]'::JSONB;
  END IF;

  -- Pull questions from question_bank if it exists, else from curriculum_topics
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'question_bank') THEN
    SELECT COALESCE(jsonb_agg(q), '[]'::JSONB) INTO v_questions
    FROM (
      SELECT id, question_text, question_hi, options, correct_answer_index,
             explanation, explanation_hi, difficulty, bloom_level, topic_id
        FROM question_bank
       WHERE subject = p_subject
         AND grade = p_grade
         AND is_active = true
         AND (p_difficulty IS NULL OR difficulty = p_difficulty)
       ORDER BY random()
       LIMIT p_count
    ) q;
  ELSE
    -- Fallback: generate placeholder from curriculum_topics
    SELECT COALESCE(jsonb_agg(t), '[]'::JSONB) INTO v_questions
    FROM (
      SELECT id, title AS question_text, title_hi AS question_hi,
             '["Option A","Option B","Option C","Option D"]'::JSONB AS options,
             0 AS correct_answer_index,
             description AS explanation,
             NULL AS explanation_hi,
             difficulty_level AS difficulty,
             'remember' AS bloom_level,
             id AS topic_id
        FROM curriculum_topics
       WHERE subject_id = v_subject_id
         AND grade = p_grade
         AND is_active = true
         AND (p_difficulty IS NULL OR difficulty_level = p_difficulty)
       ORDER BY random()
       LIMIT p_count
    ) t;
  END IF;

  RETURN v_questions;
END;
-- SECURITY DEFINER: required because question_bank RLS restricts direct student access;
-- this function mediates access with subject/grade/difficulty filtering
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;
