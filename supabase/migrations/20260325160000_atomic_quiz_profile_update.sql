-- Atomic quiz profile + student XP update
-- Eliminates the read-modify-write race condition in the client-side
-- quiz submission fallback, where concurrent submissions could lose XP
-- or corrupt session counters.

CREATE OR REPLACE FUNCTION atomic_quiz_profile_update(
  p_student_id UUID,
  p_subject TEXT,
  p_xp INT,
  p_total INT,
  p_correct INT,
  p_time_seconds INT
) RETURNS VOID AS $$
DECLARE
  v_time_minutes INT := GREATEST(1, ROUND(p_time_seconds / 60.0));
  v_new_xp BIGINT;
BEGIN
  -- 1. Upsert learning profile with atomic increments (no read-modify-write)
  INSERT INTO student_learning_profiles (
    student_id, subject, xp, total_sessions,
    total_questions_asked, total_questions_answered_correctly,
    total_time_minutes, last_session_at, streak_days, level, current_level
  ) VALUES (
    p_student_id, p_subject, p_xp, 1,
    p_total, p_correct,
    v_time_minutes, NOW(), 1, 1, 'beginner'
  )
  ON CONFLICT (student_id, subject) DO UPDATE SET
    xp = student_learning_profiles.xp + p_xp,
    total_sessions = student_learning_profiles.total_sessions + 1,
    total_questions_asked = student_learning_profiles.total_questions_asked + p_total,
    total_questions_answered_correctly = student_learning_profiles.total_questions_answered_correctly + p_correct,
    total_time_minutes = student_learning_profiles.total_time_minutes + v_time_minutes,
    last_session_at = NOW(),
    level = GREATEST(1, FLOOR((student_learning_profiles.xp + p_xp) / 500) + 1)
  RETURNING xp INTO v_new_xp;

  -- 2. Atomically update student XP and streak (no separate SELECT needed)
  UPDATE students SET
    xp_total = COALESCE(xp_total, 0) + p_xp,
    last_active = NOW(),
    streak_days = CASE
      -- Same day: keep current streak
      WHEN last_active::date = CURRENT_DATE THEN COALESCE(streak_days, 1)
      -- Consecutive day: increment streak
      WHEN last_active::date = CURRENT_DATE - 1 THEN COALESCE(streak_days, 0) + 1
      -- Gap: reset streak
      ELSE 1
    END
  WHERE id = p_student_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
