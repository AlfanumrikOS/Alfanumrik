-- ═══ 008: Fix get_student_snapshot RPC, RLS policies, and stale overloads ═══
-- Applied: 2026-03-24

-- ═══ 1. CREATE get_student_snapshot RPC ═══
CREATE OR REPLACE FUNCTION public.get_student_snapshot(p_student_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_total_xp integer;
  v_streak integer;
  v_mastered integer;
  v_in_progress integer;
  v_quizzes integer;
  v_correct integer;
  v_asked integer;
BEGIN
  -- XP and streak from learning profiles
  SELECT COALESCE(SUM(xp), 0), COALESCE(MAX(streak_days), 0),
         COALESCE(SUM(total_questions_answered_correctly), 0),
         COALESCE(SUM(total_questions_asked), 0)
  INTO v_total_xp, v_streak, v_correct, v_asked
  FROM student_learning_profiles
  WHERE student_id = p_student_id;

  -- Also add XP from students table if higher
  SELECT GREATEST(v_total_xp, COALESCE(s.xp_total, 0)),
         GREATEST(v_streak, COALESCE(s.streak_days, 0))
  INTO v_total_xp, v_streak
  FROM students s WHERE s.id = p_student_id;

  -- Mastery counts from concept_mastery (mastery_probability is numeric)
  SELECT COUNT(*) FILTER (WHERE mastery_probability >= 0.95),
         COUNT(*) FILTER (WHERE mastery_probability > 0 AND mastery_probability < 0.95)
  INTO v_mastered, v_in_progress
  FROM concept_mastery
  WHERE student_id = p_student_id;

  -- If concept_mastery is empty, fall back to topic_mastery
  IF v_mastered = 0 AND v_in_progress = 0 THEN
    SELECT COUNT(*) FILTER (WHERE mastery_level >= 0.95),
           COUNT(*) FILTER (WHERE mastery_level > 0 AND mastery_level < 0.95)
    INTO v_mastered, v_in_progress
    FROM topic_mastery
    WHERE student_id = p_student_id;
  END IF;

  -- Quiz count
  SELECT COUNT(*) INTO v_quizzes
  FROM quiz_sessions
  WHERE student_id = p_student_id AND is_completed = true;

  RETURN jsonb_build_object(
    'total_xp', v_total_xp,
    'current_streak', v_streak,
    'topics_mastered', v_mastered,
    'topics_in_progress', v_in_progress,
    'quizzes_taken', v_quizzes,
    'avg_score', CASE WHEN v_asked > 0 THEN ROUND((v_correct::numeric / v_asked) * 100) ELSE 0 END
  );
END;
$$;

-- ═══ 2. FIX RLS POLICIES — add WITH CHECK for inserts on cognitive tables ═══

-- bloom_progression
DROP POLICY IF EXISTS "Students can view their own bloom progression" ON bloom_progression;
CREATE POLICY "bloom_own_select" ON bloom_progression FOR SELECT
  USING (auth.uid() IN (SELECT auth_user_id FROM students WHERE id = bloom_progression.student_id));
CREATE POLICY "bloom_own_insert" ON bloom_progression FOR INSERT
  WITH CHECK (auth.uid() IN (SELECT auth_user_id FROM students WHERE id = bloom_progression.student_id));
CREATE POLICY "bloom_own_update" ON bloom_progression FOR UPDATE
  USING (auth.uid() IN (SELECT auth_user_id FROM students WHERE id = bloom_progression.student_id))
  WITH CHECK (auth.uid() IN (SELECT auth_user_id FROM students WHERE id = bloom_progression.student_id));

-- cognitive_session_metrics
DROP POLICY IF EXISTS "Students can view their own cognitive metrics" ON cognitive_session_metrics;
CREATE POLICY "csm_own_select" ON cognitive_session_metrics FOR SELECT
  USING (auth.uid() IN (SELECT auth_user_id FROM students WHERE id = cognitive_session_metrics.student_id));
CREATE POLICY "csm_own_insert" ON cognitive_session_metrics FOR INSERT
  WITH CHECK (auth.uid() IN (SELECT auth_user_id FROM students WHERE id = cognitive_session_metrics.student_id));

-- knowledge_gaps
DROP POLICY IF EXISTS "Students can view their own knowledge gaps" ON knowledge_gaps;
CREATE POLICY "kg_own_select" ON knowledge_gaps FOR SELECT
  USING (auth.uid() IN (SELECT auth_user_id FROM students WHERE id = knowledge_gaps.student_id));
CREATE POLICY "kg_own_insert" ON knowledge_gaps FOR INSERT
  WITH CHECK (auth.uid() IN (SELECT auth_user_id FROM students WHERE id = knowledge_gaps.student_id));

-- learning_velocity
DROP POLICY IF EXISTS "Students can view their own learning velocity" ON learning_velocity;
CREATE POLICY "lv_own_select" ON learning_velocity FOR SELECT
  USING (auth.uid() IN (SELECT auth_user_id FROM students WHERE id = learning_velocity.student_id));
CREATE POLICY "lv_own_insert" ON learning_velocity FOR INSERT
  WITH CHECK (auth.uid() IN (SELECT auth_user_id FROM students WHERE id = learning_velocity.student_id));

-- question_responses
DROP POLICY IF EXISTS "Students can view their own question responses" ON question_responses;
CREATE POLICY "qr_own_select" ON question_responses FOR SELECT
  USING (auth.uid() IN (SELECT auth_user_id FROM students WHERE id = question_responses.student_id));
CREATE POLICY "qr_own_insert" ON question_responses FOR INSERT
  WITH CHECK (auth.uid() IN (SELECT auth_user_id FROM students WHERE id = question_responses.student_id));

-- ═══ 3. DROP STALE submit_quiz_results OVERLOADS ═══
DROP FUNCTION IF EXISTS public.submit_quiz_results(uuid, timestamptz, timestamptz, jsonb);
DROP FUNCTION IF EXISTS public.submit_quiz_results(uuid, timestamptz, timestamptz, jsonb, text);
DROP FUNCTION IF EXISTS public.submit_quiz_results(uuid, timestamptz, timestamptz, jsonb, text, text);
