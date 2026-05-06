-- A-03: Add is_verified=true filter + p_chapter_number support to get_quiz_questions RPC
-- Only SME-verified questions should reach students.
CREATE OR REPLACE FUNCTION public.get_quiz_questions(
  p_subject       text,
  p_grade         text,
  p_count         integer  DEFAULT 10,
  p_difficulty    integer  DEFAULT NULL,
  p_chapter_number integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_questions JSONB;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'question_bank') THEN
    SELECT COALESCE(jsonb_agg(q), '[]'::JSONB) INTO v_questions
    FROM (
      SELECT id, question_text, question_hi, question_type, options, correct_answer_index,
             explanation, explanation_hi, hint, difficulty, bloom_level, chapter_number
        FROM question_bank
       WHERE subject   = p_subject
         AND grade     = p_grade
         AND is_active   = true
         AND is_verified = true   -- A-03: only verified questions
         AND (p_difficulty     IS NULL OR difficulty     = p_difficulty)
         AND (p_chapter_number IS NULL OR chapter_number = p_chapter_number)
       ORDER BY random()
       LIMIT p_count
    ) q;
  ELSE
    v_questions := '[]'::JSONB;
  END IF;

  RETURN v_questions;
END;
$function$;
