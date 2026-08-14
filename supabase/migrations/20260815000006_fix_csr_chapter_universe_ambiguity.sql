-- Fix 42702 in compute_subject_readiness.
-- Root cause: bare `chapter_number` in the chapter_universe CTE collided with the
-- RETURNS TABLE OUT variable of the same name. Migration 20260815000005 qualified the
-- LATERAL subquery in quiz_rollup but left chapter_universe untouched; Postgres aborts on
-- the FIRST ambiguity it parses, so the error text was unchanged and the fix looked inert.
-- Every reference to an OUT-parameter name is now table-qualified. USING(...) replaced with
-- explicit ON to remove a latent second instance of the same bug class.
-- Signature, return columns and scoring maths unchanged. Idempotent.
-- Rollback: re-apply 20260815000005's definition of this function.

CREATE OR REPLACE FUNCTION public.compute_subject_readiness(
  p_student_id uuid, p_grade text, p_subject text)
 RETURNS TABLE(chapter_number integer, level text, score integer,
   concepts_total integer, concepts_mastered integer,
   recent_quiz_count integer, rag_ready boolean)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_student_id uuid;
BEGIN
  SELECT s.id INTO v_student_id
  FROM students s
  WHERE (s.id = p_student_id OR s.auth_user_id = p_student_id)
    AND (auth.uid() IS NULL OR s.auth_user_id = auth.uid())
  LIMIT 1;

  IF v_student_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH chapter_universe AS (
    SELECT DISTINCT cu0.chapter_number AS chapter_number
    FROM chapter_concepts cu0
    WHERE cu0.grade = p_grade
      AND cu0.subject = p_subject
      AND cu0.is_active = true
  ),
  concept_rollup AS (
    SELECT
      cc.chapter_number AS chapter_number,
      COUNT(*)::int AS concepts_total,
      COALESCE(AVG(cms.mastery_score), 0)::numeric AS mastery_avg,
      COALESCE(SUM(CASE WHEN cms.cbse_ready THEN 1 ELSE 0 END), 0)::int AS concepts_mastered,
      COALESCE(SUM(cms.recall_successes), 0)::int AS spaced_reviews
    FROM chapter_concepts cc
    LEFT JOIN concept_mastery_score cms
      ON cms.concept_code = cc.slug
     AND cms.student_id = v_student_id
    WHERE cc.grade = p_grade
      AND cc.subject = p_subject
      AND cc.is_active = true
    GROUP BY cc.chapter_number
  ),
  quiz_rollup AS (
    SELECT
      cu.chapter_number AS chapter_number,
      COALESCE(AVG(q.score_percent), 0)::numeric AS recent_quiz_avg,
      COUNT(q.score_percent)::int AS recent_quiz_count
    FROM chapter_universe cu
    LEFT JOIN LATERAL (
      SELECT qs.score_percent
      FROM quiz_sessions qs
      WHERE qs.student_id = v_student_id
        AND qs.grade = p_grade
        AND qs.subject = p_subject
        AND qs.chapter_number = cu.chapter_number
        AND qs.is_completed = true
        AND qs.deleted_at IS NULL
      ORDER BY qs.completed_at DESC NULLS LAST
      LIMIT 5
    ) q ON true
    GROUP BY cu.chapter_number
  )
  SELECT
    cu.chapter_number,
    CASE
      WHEN COALESCE(cr.concepts_mastered::numeric / NULLIF(cr.concepts_total, 0), 0) >= 0.85
       AND COALESCE(qr.recent_quiz_avg, 0) >= 80
       AND COALESCE(cr.spaced_reviews, 0) >= 3
        THEN 'ready'
      WHEN COALESCE(cr.concepts_mastered::numeric / NULLIF(cr.concepts_total, 0), 0) >= 0.70
       AND COALESCE(qr.recent_quiz_avg, 0) >= 60
       AND COALESCE(cr.spaced_reviews, 0) >= 1
        THEN 'almost'
      WHEN COALESCE(cr.concepts_mastered::numeric / NULLIF(cr.concepts_total, 0), 0) >= 0.40
       AND COALESCE(qr.recent_quiz_count, 0) >= 1
        THEN 'building'
      ELSE 'not_yet'
    END AS level,
    LEAST(100, GREATEST(0, ROUND(
        0.50 * COALESCE(cr.mastery_avg, 0)
      + 0.30 * COALESCE(qr.recent_quiz_avg, 0)
      + 0.20 * LEAST(100, COALESCE(cr.spaced_reviews, 0) * 10)
    )::int))::int AS score,
    COALESCE(cr.concepts_total, 0) AS concepts_total,
    COALESCE(cr.concepts_mastered, 0) AS concepts_mastered,
    COALESCE(qr.recent_quiz_count, 0) AS recent_quiz_count,
    cbse_syllabus_rag_ready(p_grade, p_subject, cu.chapter_number) AS rag_ready
  FROM chapter_universe cu
  LEFT JOIN concept_rollup cr ON cr.chapter_number = cu.chapter_number
  LEFT JOIN quiz_rollup    qr ON qr.chapter_number = cu.chapter_number
  ORDER BY cu.chapter_number;
END;
$function$;
