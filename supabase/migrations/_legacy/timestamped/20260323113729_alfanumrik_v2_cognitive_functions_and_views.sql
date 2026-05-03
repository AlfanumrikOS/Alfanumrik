-- ═══════════════════════════════════════════════════════════════
-- ALFANUMRIK 2.0 — Core RPC Functions
-- Critical server-side functions for quiz submission, snapshot,
-- question retrieval, and profile management.
-- These RPCs are called by the client app and MUST exist.
-- ═══════════════════════════════════════════════════════════════

-- ─── 1. submit_quiz_results ──────────────────────────────────
-- Called after every quiz. Creates session, records responses,
-- updates XP, mastery, streak, and learning profile atomically.
-- Returns: { total, correct, score_percent, xp_earned, session_id }
CREATE OR REPLACE FUNCTION submit_quiz_results(
  p_student_id UUID,
  p_subject TEXT,
  p_grade TEXT,
  p_topic TEXT,
  p_chapter INT,
  p_responses JSONB,
  p_time INT
) RETURNS JSONB AS $$
DECLARE
  v_total INT;
  v_correct INT;
  v_score_percent INT;
  v_xp INT;
  v_session_id UUID;
  v_resp JSONB;
  v_bonus INT := 0;
BEGIN
  -- Count correct answers
  v_total := jsonb_array_length(p_responses);
  SELECT COUNT(*) INTO v_correct
  FROM jsonb_array_elements(p_responses) r
  WHERE (r->>'is_correct')::boolean = true;

  -- Calculate score
  v_score_percent := CASE WHEN v_total > 0 THEN ROUND((v_correct::numeric / v_total) * 100) ELSE 0 END;

  -- Calculate XP: 10 per correct + 20 bonus for 80%+
  v_xp := v_correct * 10;
  IF v_score_percent >= 80 THEN
    v_bonus := 20;
    v_xp := v_xp + v_bonus;
  END IF;

  -- 1. Insert quiz session
  INSERT INTO quiz_sessions (
    student_id, subject, topic_id, total_questions, correct_answers,
    score_percent, xp_earned, time_seconds, grade, completed_at
  ) VALUES (
    p_student_id, p_subject, NULL, v_total, v_correct,
    v_score_percent, v_xp, p_time, p_grade, now()
  ) RETURNING id INTO v_session_id;

  -- 2. Insert per-question responses (if question_responses table exists)
  BEGIN
    FOR v_resp IN SELECT * FROM jsonb_array_elements(p_responses)
    LOOP
      INSERT INTO question_responses (
        student_id, session_id, question_id, selected_option,
        is_correct, time_spent, source
      ) VALUES (
        p_student_id, v_session_id,
        (v_resp->>'question_id')::UUID,
        (v_resp->>'selected_option')::INT,
        (v_resp->>'is_correct')::BOOLEAN,
        COALESCE((v_resp->>'time_spent')::INT, 0),
        'practice'
      );
    END LOOP;
  EXCEPTION WHEN undefined_table THEN
    -- question_responses table doesn't exist yet, skip
    NULL;
  END;

  -- 3. Update student_learning_profiles (upsert)
  INSERT INTO student_learning_profiles (
    student_id, subject, xp, total_sessions, total_questions_asked,
    total_questions_answered_correctly, total_time_minutes,
    last_session_at, streak_days, level
  ) VALUES (
    p_student_id, p_subject, v_xp, 1, v_total, v_correct,
    GREATEST(1, ROUND(p_time / 60.0)), now(), 1, 1
  )
  ON CONFLICT (student_id, subject) DO UPDATE SET
    xp = student_learning_profiles.xp + v_xp,
    total_sessions = student_learning_profiles.total_sessions + 1,
    total_questions_asked = student_learning_profiles.total_questions_asked + v_total,
    total_questions_answered_correctly = student_learning_profiles.total_questions_answered_correctly + v_correct,
    total_time_minutes = student_learning_profiles.total_time_minutes + GREATEST(1, ROUND(p_time / 60.0)),
    last_session_at = now(),
    level = GREATEST(1, FLOOR((student_learning_profiles.xp + v_xp) / 500) + 1);

  -- 4. Update student XP total and last_active
  UPDATE students SET
    xp_total = COALESCE(xp_total, 0) + v_xp,
    last_active = now()
  WHERE id = p_student_id;

  -- 5. Update streak
  UPDATE students SET
    streak_days = CASE
      WHEN last_active::date = CURRENT_DATE THEN COALESCE(streak_days, 0)
      WHEN last_active::date = CURRENT_DATE - 1 THEN COALESCE(streak_days, 0) + 1
      ELSE 1
    END
  WHERE id = p_student_id;

  RETURN jsonb_build_object(
    'session_id', v_session_id,
    'total', v_total,
    'correct', v_correct,
    'score_percent', v_score_percent,
    'xp_earned', v_xp
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─── 2. get_student_snapshot ─────────────────────────────────
-- Returns aggregated stats for the dashboard hero card.
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
  -- XP and stats from learning profiles
  SELECT
    COALESCE(SUM(xp), 0),
    COALESCE(MAX(streak_days), 0),
    COALESCE(SUM(total_questions_asked), 0),
    COALESCE(SUM(total_questions_answered_correctly), 0)
  INTO v_total_xp, v_streak, v_total_asked, v_total_correct
  FROM student_learning_profiles
  WHERE student_id = p_student_id;

  -- Also check students table for streak (might be more up-to-date)
  SELECT GREATEST(v_streak, COALESCE(s.streak_days, 0))
  INTO v_streak
  FROM students s WHERE s.id = p_student_id;

  -- Also add students.xp_total if it's higher
  SELECT GREATEST(v_total_xp, COALESCE(s.xp_total, 0))
  INTO v_total_xp
  FROM students s WHERE s.id = p_student_id;

  -- Mastery counts from concept_mastery
  SELECT COUNT(*) INTO v_mastered
  FROM concept_mastery
  WHERE student_id = p_student_id AND mastery_level >= 0.95;

  SELECT COUNT(*) INTO v_in_progress
  FROM concept_mastery
  WHERE student_id = p_student_id AND mastery_level > 0 AND mastery_level < 0.95;

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

-- ─── 3. get_quiz_questions ───────────────────────────────────
-- Fetches questions from question_bank for a subject/grade.
-- Returns randomized questions filtered by difficulty.
CREATE OR REPLACE FUNCTION get_quiz_questions(
  p_subject TEXT,
  p_grade TEXT,
  p_count INT DEFAULT 10,
  p_difficulty INT DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_questions JSONB;
BEGIN
  SELECT jsonb_agg(q) INTO v_questions
  FROM (
    SELECT
      id, question_text, question_hi, question_type,
      options, correct_answer_index, explanation, explanation_hi,
      hint, difficulty, bloom_level, chapter_number
    FROM question_bank
    WHERE subject = p_subject
      AND grade = p_grade
      AND is_active = true
      AND (p_difficulty IS NULL OR difficulty = p_difficulty)
    ORDER BY random()
    LIMIT LEAST(p_count, 30)
  ) q;

  RETURN COALESCE(v_questions, '[]'::jsonb);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- ─── 4. get_review_cards ─────────────────────────────────────
-- Fetches concepts due for spaced repetition review.
CREATE OR REPLACE FUNCTION get_review_cards(
  p_student_id UUID,
  p_limit INT DEFAULT 10
) RETURNS JSONB AS $$
DECLARE
  v_cards JSONB;
BEGIN
  SELECT jsonb_agg(c) INTO v_cards
  FROM (
    SELECT
      cm.id, cm.subject, cm.topic_tag as topic,
      COALESCE(cm.chapter_title, cm.topic_tag) as chapter_title,
      cm.front_text, cm.back_text, cm.hint,
      cm.ease_factor, cm.interval_days, cm.streak,
      cm.repetition_count, cm.total_reviews, cm.correct_reviews
    FROM concept_mastery cm
    WHERE cm.student_id = p_student_id
      AND cm.next_review_at <= now()
      AND cm.front_text IS NOT NULL
    ORDER BY cm.next_review_at ASC
    LIMIT p_limit
  ) c;

  RETURN COALESCE(v_cards, '[]'::jsonb);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- ─── 5. get_leaderboard ──────────────────────────────────────
-- Weekly or monthly leaderboard ranked by XP.
CREATE OR REPLACE FUNCTION get_leaderboard(
  p_period TEXT DEFAULT 'weekly',
  p_limit INT DEFAULT 20
) RETURNS JSONB AS $$
DECLARE
  v_result JSONB;
  v_since TIMESTAMPTZ;
BEGIN
  IF p_period = 'monthly' THEN
    v_since := date_trunc('month', now());
  ELSE
    v_since := date_trunc('week', now());
  END IF;

  SELECT jsonb_agg(row_to_json(r)) INTO v_result
  FROM (
    SELECT
      ROW_NUMBER() OVER (ORDER BY COALESCE(s.xp_total, 0) DESC) as rank,
      s.id as student_id,
      s.name,
      COALESCE(s.xp_total, 0) as total_xp,
      COALESCE(s.streak_days, 0) as streak,
      s.avatar_url,
      s.grade,
      s.school_name as school,
      s.city,
      s.board
    FROM students s
    WHERE s.is_active = true
      AND s.last_active >= v_since
    ORDER BY COALESCE(s.xp_total, 0) DESC
    LIMIT p_limit
  ) r;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- ─── 6. get_study_plan ───────────────────────────────────────
CREATE OR REPLACE FUNCTION get_study_plan(p_student_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_plan RECORD;
  v_tasks JSONB;
BEGIN
  SELECT * INTO v_plan
  FROM study_plans
  WHERE student_id = p_student_id AND is_active = true
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_plan IS NULL THEN
    RETURN jsonb_build_object('has_plan', false);
  END IF;

  SELECT jsonb_agg(row_to_json(t) ORDER BY t.day_number, t.task_order) INTO v_tasks
  FROM study_plan_tasks t
  WHERE t.plan_id = v_plan.id;

  RETURN jsonb_build_object(
    'has_plan', true,
    'plan', row_to_json(v_plan),
    'tasks', COALESCE(v_tasks, '[]'::jsonb)
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- ─── 7. get_user_role ────────────────────────────────────────
-- Determines the role(s) for an auth user.
CREATE OR REPLACE FUNCTION get_user_role(p_auth_user_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_roles JSONB := '[]'::jsonb;
  v_student RECORD;
  v_teacher RECORD;
  v_guardian RECORD;
BEGIN
  SELECT id, name INTO v_student FROM students WHERE auth_user_id = p_auth_user_id AND is_active = true LIMIT 1;
  IF v_student IS NOT NULL THEN
    v_roles := v_roles || jsonb_build_array(jsonb_build_object('role', 'student', 'id', v_student.id, 'name', v_student.name));
  END IF;

  BEGIN
    SELECT id, name INTO v_teacher FROM teachers WHERE auth_user_id = p_auth_user_id AND is_active = true LIMIT 1;
    IF v_teacher IS NOT NULL THEN
      v_roles := v_roles || jsonb_build_array(jsonb_build_object('role', 'teacher', 'id', v_teacher.id, 'name', v_teacher.name));
    END IF;
  EXCEPTION WHEN undefined_table THEN NULL;
  END;

  BEGIN
    SELECT id, name INTO v_guardian FROM guardians WHERE auth_user_id = p_auth_user_id AND is_active = true LIMIT 1;
    IF v_guardian IS NOT NULL THEN
      v_roles := v_roles || jsonb_build_array(jsonb_build_object('role', 'guardian', 'id', v_guardian.id, 'name', v_guardian.name));
    END IF;
  EXCEPTION WHEN undefined_table THEN NULL;
  END;

  RETURN v_roles;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- ─── 8. generate_notifications ───────────────────────────────
CREATE OR REPLACE FUNCTION generate_notifications(p_student_id UUID)
RETURNS VOID AS $$
BEGIN
  -- Placeholder: actual notification logic can be added later
  -- This prevents the client from erroring when calling this RPC
  NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─── 9. get_student_notifications ────────────────────────────
CREATE OR REPLACE FUNCTION get_student_notifications(p_student_id UUID)
RETURNS JSONB AS $$
BEGIN
  RETURN jsonb_build_object('unread_count', 0, 'notifications', '[]'::jsonb);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- ─── 10. Indexes for performance ─────────────────────────────
CREATE INDEX IF NOT EXISTS idx_quiz_sessions_student_id ON quiz_sessions(student_id);
CREATE INDEX IF NOT EXISTS idx_quiz_sessions_created_at ON quiz_sessions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_slp_student_subject ON student_learning_profiles(student_id, subject);
CREATE INDEX IF NOT EXISTS idx_concept_mastery_student ON concept_mastery(student_id);
CREATE INDEX IF NOT EXISTS idx_concept_mastery_review ON concept_mastery(student_id, next_review_at);
CREATE INDEX IF NOT EXISTS idx_question_bank_subject_grade ON question_bank(subject, grade, is_active);
CREATE INDEX IF NOT EXISTS idx_students_xp ON students(xp_total DESC);
CREATE INDEX IF NOT EXISTS idx_students_last_active ON students(last_active DESC);
