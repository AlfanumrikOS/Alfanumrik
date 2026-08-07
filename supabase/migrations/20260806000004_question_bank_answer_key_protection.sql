-- Migration: Question bank answer-key protection (P1-4)
-- Audit remediation 2026-08-07 -- REBUILT against real schema (prod).
--
-- Real schema facts (verified from baseline 00000000000000):
--   question_bank columns include: id, subject, grade, topic_id, chapter_number,
--     question_text, question_hi, question_type, options (jsonb), explanation,
--     difficulty, bloom_level, is_active, is_verified, created_at, updated_at,
--     marks, correct_answer_index, correct_answer_text, solution_steps (jsonb).
--   There is NO `topic`, NO `option_a..option_d`, NO `board` column.
--   This migration previously used those assumed columns and failed on apply
--   (SQLSTATE 42703: column "topic" does not exist). Rebuilt to use the real ones.

-- Safe-read view for students (withholds answer keys)
CREATE OR REPLACE VIEW public.question_bank_student_safe AS
SELECT
  id,
  subject,
  grade,
  topic_id,
  chapter_number,
  question_text,
  question_hi,
  question_type,
  options,
  explanation,
  explanation_hi,
  difficulty,
  bloom_level,
  is_active,
  is_verified,
  created_at,
  updated_at,
  marks,
  -- Explicitly EXCLUDE: correct_answer_index, correct_answer_text, solution_steps
  NULL::integer AS correct_answer_index,
  NULL::text AS correct_answer_text,
  NULL::jsonb AS solution_steps
FROM public.question_bank;

-- RPC: server-authorized answer-key read (correct jsonb return type)
CREATE OR REPLACE FUNCTION public.get_question_answer_key(
  p_question_id uuid
) RETURNS TABLE(
  correct_answer_index integer,
  correct_answer_text text,
  solution_steps jsonb
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT
    qb.correct_answer_index,
    qb.correct_answer_text,
    qb.solution_steps
  FROM public.question_bank qb
  WHERE qb.id = p_question_id;
$$;

REVOKE ALL ON FUNCTION public.get_question_answer_key(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_question_answer_key(uuid) TO authenticated, service_role;

COMMENT ON TABLE public.question_bank IS
  'Answer keys (correct_answer_index, correct_answer_text, solution_steps) are '
  'sensitive. Student-facing reads MUST use question_bank_student_safe view. '
  'Server-authorized reads use get_question_answer_key() RPC. (2026-08-07)';
