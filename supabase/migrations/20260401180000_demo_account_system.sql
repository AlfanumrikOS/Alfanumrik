-- ────────────────────────────────────────────────────────────────
-- Demo Account System
-- Adds is_demo flag, demo data seeding RPC, and reset RPC
-- ────────────────────────────────────────────────────────────────

-- 1. Add is_demo column to all user tables
ALTER TABLE students ADD COLUMN IF NOT EXISTS is_demo BOOLEAN DEFAULT FALSE;
ALTER TABLE teachers ADD COLUMN IF NOT EXISTS is_demo BOOLEAN DEFAULT FALSE;
ALTER TABLE guardians ADD COLUMN IF NOT EXISTS is_demo BOOLEAN DEFAULT FALSE;

-- Index for filtering demo users out of analytics
CREATE INDEX IF NOT EXISTS idx_students_is_demo ON students(is_demo) WHERE is_demo = true;
CREATE INDEX IF NOT EXISTS idx_teachers_is_demo ON teachers(is_demo) WHERE is_demo = true;
CREATE INDEX IF NOT EXISTS idx_guardians_is_demo ON guardians(is_demo) WHERE is_demo = true;

-- 2. RPC: Reset a demo student to clean state
-- Clears all activity data but preserves the account itself
-- SECURITY DEFINER: Required because this function deletes across multiple tables
-- (quiz_sessions, chat_sessions, etc.) that the calling admin does not own via RLS.
-- Caller authorization is enforced explicitly via admin_users check.
CREATE OR REPLACE FUNCTION reset_demo_student(p_student_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_demo BOOLEAN;
BEGIN
  -- Check caller is admin
  IF NOT EXISTS (SELECT 1 FROM admin_users WHERE auth_user_id = auth.uid() AND is_active = true) THEN
    RAISE EXCEPTION 'Unauthorized: admin access required';
  END IF;

  -- Verify this is actually a demo account
  SELECT is_demo INTO v_is_demo FROM students WHERE id = p_student_id;
  IF v_is_demo IS NOT TRUE THEN
    RAISE EXCEPTION 'Cannot reset non-demo account';
  END IF;

  -- Clear quiz sessions and responses
  DELETE FROM question_responses WHERE session_id IN (
    SELECT id FROM quiz_sessions WHERE student_id = p_student_id
  );

  DELETE FROM quiz_sessions WHERE student_id = p_student_id;

  -- Clear chat sessions
  DELETE FROM chat_sessions WHERE student_id = p_student_id;

  -- Clear daily usage
  DELETE FROM student_daily_usage WHERE student_id = p_student_id;

  -- Clear mastery data
  DELETE FROM topic_mastery WHERE student_id = p_student_id;
  DELETE FROM concept_mastery WHERE student_id = p_student_id;

  -- Clear experiment observations
  DELETE FROM experiment_observations WHERE student_id = p_student_id;

  -- Reset student stats
  UPDATE students SET
    xp_total = 0,
    streak_days = 0,
    subscription_plan = 'pro',
    onboarding_completed = false,
    last_active = now(),
    updated_at = now()
  WHERE id = p_student_id;

  -- Reset learning profile if exists
  UPDATE student_learning_profiles SET
    xp = 0,
    level = 1,
    streak_days = 0,
    longest_streak = 0,
    total_sessions = 0,
    total_questions_answered_correctly = 0,
    total_questions_asked = 0,
    updated_at = now()
  WHERE student_id = p_student_id;

  RETURN jsonb_build_object(
    'success', true,
    'student_id', p_student_id,
    'reset_at', now()
  );
END;
$$;

-- 3. RPC: Seed demo data for a student
-- Creates realistic quiz history, mastery data, and activity
-- SECURITY DEFINER: Required because this function inserts into quiz_sessions and
-- updates student_learning_profiles for a student the admin does not own via RLS.
-- Caller authorization is enforced explicitly via admin_users check.
CREATE OR REPLACE FUNCTION seed_demo_student_data(
  p_student_id UUID,
  p_scenario TEXT DEFAULT 'average'  -- 'weak', 'average', 'high_performer'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_demo BOOLEAN;
  v_grade TEXT;
  v_score_base INT;
  v_xp_total INT;
  v_streak INT;
  v_i INT;
BEGIN
  -- Check caller is admin
  IF NOT EXISTS (SELECT 1 FROM admin_users WHERE auth_user_id = auth.uid() AND is_active = true) THEN
    RAISE EXCEPTION 'Unauthorized: admin access required';
  END IF;

  -- Verify demo account
  SELECT is_demo, grade INTO v_is_demo, v_grade FROM students WHERE id = p_student_id;
  IF v_is_demo IS NOT TRUE THEN
    RAISE EXCEPTION 'Cannot seed non-demo account';
  END IF;

  -- First reset
  PERFORM reset_demo_student(p_student_id);

  -- Set scenario parameters
  CASE p_scenario
    WHEN 'weak' THEN
      v_score_base := 35; v_xp_total := 120; v_streak := 2;
    WHEN 'high_performer' THEN
      v_score_base := 88; v_xp_total := 2400; v_streak := 21;
    ELSE -- average
      v_score_base := 62; v_xp_total := 750; v_streak := 7;
  END CASE;

  -- Seed 15 quiz sessions across last 30 days
  FOR v_i IN 1..15 LOOP
    INSERT INTO quiz_sessions (
      student_id, subject, grade, total_questions, correct_answers,
      wrong_answers, score_percent, time_taken_seconds,
      is_completed, completed_at, created_at
    ) VALUES (
      p_student_id,
      CASE (v_i % 3) WHEN 0 THEN 'math' WHEN 1 THEN 'science' ELSE 'english' END,
      v_grade,
      10,
      LEAST(10, GREATEST(1, (v_score_base + (v_i % 5) * 3 - 6) / 10)),
      10 - LEAST(10, GREATEST(1, (v_score_base + (v_i % 5) * 3 - 6) / 10)),
      LEAST(100, GREATEST(10, v_score_base + (v_i % 5) * 3 - 6)),
      (v_i * 47 + 120),
      true,
      now() - ((30 - v_i * 2) || ' days')::INTERVAL,
      now() - ((30 - v_i * 2) || ' days')::INTERVAL
    );
  END LOOP;

  -- Update student stats
  UPDATE students SET
    xp_total = v_xp_total,
    streak_days = v_streak,
    subscription_plan = 'pro',
    onboarding_completed = true,
    last_active = now(),
    updated_at = now()
  WHERE id = p_student_id;

  -- Update learning profile (per subject, matching the unique constraint)
  INSERT INTO student_learning_profiles (student_id, subject, xp, level, streak_days, longest_streak, total_sessions, total_questions_answered_correctly, total_questions_asked)
  VALUES
    (p_student_id, 'math', v_xp_total / 3, GREATEST(1, v_xp_total / 1500 + 1), v_streak, v_streak + 3, 5, v_score_base * 5 / 100, 50),
    (p_student_id, 'science', v_xp_total / 3, GREATEST(1, v_xp_total / 1500 + 1), v_streak, v_streak + 3, 5, v_score_base * 5 / 100, 50),
    (p_student_id, 'english', v_xp_total / 3, GREATEST(1, v_xp_total / 1500 + 1), v_streak, v_streak + 3, 5, v_score_base * 5 / 100, 50)
  ON CONFLICT (student_id, subject) DO UPDATE SET
    xp = EXCLUDED.xp,
    level = EXCLUDED.level,
    streak_days = EXCLUDED.streak_days,
    longest_streak = EXCLUDED.longest_streak,
    total_sessions = EXCLUDED.total_sessions,
    total_questions_answered_correctly = EXCLUDED.total_questions_answered_correctly,
    total_questions_asked = EXCLUDED.total_questions_asked,
    updated_at = now();

  RETURN jsonb_build_object(
    'success', true,
    'student_id', p_student_id,
    'scenario', p_scenario,
    'quizzes_seeded', 15,
    'xp', v_xp_total,
    'streak', v_streak
  );
END;
$$;

-- 4. RPC: Get all demo accounts for super-admin
-- SECURITY DEFINER: Required because this function reads student/teacher/guardian
-- rows across all accounts (not just the caller's own), which RLS would block.
-- Caller authorization is enforced explicitly via admin_users check.
CREATE OR REPLACE FUNCTION get_demo_accounts()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
BEGIN
  -- Check caller is admin
  IF NOT EXISTS (SELECT 1 FROM admin_users WHERE auth_user_id = auth.uid() AND is_active = true) THEN
    RAISE EXCEPTION 'Unauthorized: admin access required';
  END IF;

  SELECT jsonb_build_object(
    'students', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', id, 'name', name, 'email', email, 'grade', grade,
      'xp_total', xp_total, 'streak_days', streak_days,
      'subscription_plan', subscription_plan, 'last_active', last_active
    )) FROM students WHERE is_demo = true), '[]'::JSONB),
    'teachers', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', id, 'name', name, 'email', email
    )) FROM teachers WHERE is_demo = true), '[]'::JSONB),
    'guardians', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', id, 'name', name, 'email', email
    )) FROM guardians WHERE is_demo = true), '[]'::JSONB)
  ) INTO v_result;

  RETURN v_result;
END;
$$;
