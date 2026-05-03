-- ============================================================
-- Create missing RPCs called by the frontend
-- Applied: 2026-03-24
-- ============================================================

-- 1. get_bloom_progression: Returns bloom level progression for a student
CREATE OR REPLACE FUNCTION public.get_bloom_progression(
  p_student_id UUID,
  p_subject TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
BEGIN
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'concept_id', bp.concept_id,
      'subject', bp.subject,
      'current_bloom_level', bp.current_bloom_level,
      'zpd_bloom_level', bp.zpd_bloom_level,
      'remember_mastery', bp.remember_mastery,
      'understand_mastery', bp.understand_mastery,
      'apply_mastery', bp.apply_mastery,
      'analyze_mastery', bp.analyze_mastery,
      'evaluate_mastery', bp.evaluate_mastery,
      'create_mastery', bp.create_mastery,
      'updated_at', bp.updated_at
    ) ORDER BY bp.updated_at DESC
  ), '[]'::jsonb)
  INTO v_result
  FROM bloom_progression bp
  WHERE bp.student_id = p_student_id
    AND (p_subject IS NULL OR bp.subject = p_subject);

  RETURN v_result;
END;
$$;

-- 2. get_board_exam_questions: Returns board exam questions filtered by subject/grade/year
CREATE OR REPLACE FUNCTION public.get_board_exam_questions(
  p_subject TEXT,
  p_grade TEXT,
  p_count INT DEFAULT 20,
  p_year INT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
BEGIN
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', q.id,
      'subject', q.subject,
      'grade', q.grade,
      'chapter_number', q.chapter_number,
      'chapter_title', q.chapter_title,
      'topic', q.topic,
      'question_text', q.question_text,
      'question_type', q.question_type,
      'options', q.options,
      'correct_answer_index', q.correct_answer_index,
      'explanation', q.explanation,
      'hint', q.hint,
      'difficulty', q.difficulty,
      'bloom_level', q.bloom_level,
      'board_year', q.board_year
    )
  ), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT *
    FROM question_bank
    WHERE subject = p_subject
      AND grade = p_grade
      AND is_active = true
      AND source = 'board_exam'
      AND (p_year IS NULL OR board_year = p_year)
    ORDER BY random()
    LIMIT p_count
  ) q;

  RETURN v_result;
END;
$$;

-- 3. get_knowledge_gaps: Returns knowledge gaps for a student
CREATE OR REPLACE FUNCTION public.get_knowledge_gaps(
  p_student_id UUID,
  p_subject TEXT DEFAULT NULL,
  p_limit INT DEFAULT 10
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
BEGIN
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', kg.id,
      'student_id', kg.student_id,
      'concept_id', kg.concept_id,
      'subject', kg.subject,
      'gap_type', kg.gap_type,
      'severity', kg.severity,
      'detected_at', kg.detected_at,
      'evidence', kg.evidence,
      'recommended_remediation', kg.recommended_remediation,
      'is_resolved', kg.is_resolved,
      'resolved_at', kg.resolved_at
    ) ORDER BY kg.severity DESC, kg.detected_at DESC
  ), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT *
    FROM knowledge_gaps
    WHERE student_id = p_student_id
      AND (p_subject IS NULL OR subject = p_subject)
      AND is_resolved = false
    ORDER BY severity DESC, detected_at DESC
    LIMIT p_limit
  ) kg;

  RETURN v_result;
END;
$$;
