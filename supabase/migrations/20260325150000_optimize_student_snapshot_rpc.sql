-- Optimize get_student_snapshot: combine 6 queries into 3
-- Before: 6 sequential queries (learning_profiles, students x2, concept_mastery x2, quiz_sessions)
-- After:  3 queries (students+profiles join, concept_mastery conditional agg, quiz_sessions)

CREATE OR REPLACE FUNCTION get_student_snapshot(p_student_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_total_xp BIGINT;
  v_streak INT;
  v_mastered INT;
  v_in_progress INT;
  v_quizzes INT;
  v_avg_score INT;
  v_total_asked BIGINT;
  v_total_correct BIGINT;
BEGIN
  -- Combined query: merge student_learning_profiles aggregates with students table fallbacks
  SELECT
    GREATEST(COALESCE(lp.sum_xp, 0), COALESCE(s.xp_total, 0)),
    GREATEST(COALESCE(lp.max_streak, 0), COALESCE(s.streak_days, 0)),
    COALESCE(lp.sum_asked, 0),
    COALESCE(lp.sum_correct, 0)
  INTO v_total_xp, v_streak, v_total_asked, v_total_correct
  FROM students s
  LEFT JOIN LATERAL (
    SELECT
      SUM(xp) AS sum_xp,
      MAX(streak_days) AS max_streak,
      SUM(total_questions_asked) AS sum_asked,
      SUM(total_questions_answered_correctly) AS sum_correct
    FROM student_learning_profiles
    WHERE student_id = p_student_id
  ) lp ON true
  WHERE s.id = p_student_id;

  -- Combined mastery counts: single scan with conditional aggregation
  SELECT
    COUNT(*) FILTER (WHERE mastery_level >= 0.95),
    COUNT(*) FILTER (WHERE mastery_level > 0 AND mastery_level < 0.95)
  INTO v_mastered, v_in_progress
  FROM concept_mastery
  WHERE student_id = p_student_id AND mastery_level > 0;

  -- Quiz count
  SELECT COUNT(*) INTO v_quizzes
  FROM quiz_sessions
  WHERE student_id = p_student_id;

  -- Average score
  v_avg_score := CASE WHEN v_total_asked > 0
    THEN ROUND((v_total_correct::numeric / v_total_asked) * 100)
    ELSE 0 END;

  RETURN jsonb_build_object(
    'total_xp', v_total_xp,
    'current_streak', v_streak,
    'topics_mastered', v_mastered,
    'topics_in_progress', v_in_progress,
    'quizzes_taken', v_quizzes,
    'avg_score', v_avg_score
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;
