-- Migration: 20260402090000_fix_p2_xp_bonus_no_min_questions.sql
-- Purpose: Remove v_total >= 5 gate from XP bonus conditions in submit_quiz_results.
--
-- Product invariant P2 defines XP bonuses as:
--   score_percent >= 80 → +20 XP (high_score_bonus)
--   score_percent = 100 → +50 XP (perfect_bonus)
-- with NO minimum question count requirement.
--
-- The previous version gated both bonuses on v_total >= 5, causing students
-- who perfected 1-4 question quizzes to lose up to 70 XP each.
--
-- This fix was applied directly to production on 2026-04-02 via Supabase
-- SQL editor. This migration file records the change for version control.

-- SECURITY DEFINER: required because the function inserts into quiz_sessions,
-- quiz_responses, and calls atomic_quiz_profile_update on behalf of the
-- authenticated student. RLS on those tables would block direct inserts
-- from the student role without service-level access.

CREATE OR REPLACE FUNCTION public.submit_quiz_results(
  p_student_id UUID,
  p_subject TEXT,
  p_grade TEXT,
  p_topic TEXT DEFAULT NULL,
  p_chapter INTEGER DEFAULT NULL,
  p_responses JSONB DEFAULT '[]',
  p_time INTEGER DEFAULT 0
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_total INTEGER := 0;
  v_correct INTEGER := 0;
  v_score_percent NUMERIC;
  v_xp INTEGER := 0;
  v_session_id UUID;
  r JSONB;
  v_question_id UUID;
  v_selected INTEGER;
  v_actual_correct INTEGER;
  v_is_correct BOOLEAN;
BEGIN
  FOR r IN SELECT * FROM jsonb_array_elements(p_responses)
  LOOP
    v_total := v_total + 1;
    v_question_id := (r->>'question_id')::UUID;
    v_selected := (r->>'selected_option')::INTEGER;

    -- Server verifies: look up actual correct answer from question_bank
    SELECT correct_answer_index INTO v_actual_correct
    FROM question_bank WHERE id = v_question_id;

    v_is_correct := (v_selected IS NOT NULL AND v_actual_correct IS NOT NULL AND v_selected = v_actual_correct);

    IF v_is_correct THEN
      v_correct := v_correct + 1;
    END IF;
  END LOOP;

  IF v_total = 0 THEN
    RETURN jsonb_build_object('total', 0, 'correct', 0, 'score_percent', 0, 'xp_earned', 0, 'session_id', NULL);
  END IF;

  -- P2 XP formula: base + high_score_bonus + perfect_bonus (no minimum question count)
  v_score_percent := ROUND((v_correct::NUMERIC / v_total) * 100);
  v_xp := v_correct * 10;
  IF v_score_percent >= 80 THEN v_xp := v_xp + 20; END IF;
  IF v_score_percent = 100 THEN v_xp := v_xp + 50; END IF;

  INSERT INTO quiz_sessions (
    student_id, subject, grade, topic, chapter_number,
    question_count, correct_count, score_percent,
    time_taken_seconds, xp_earned, completed_at
  ) VALUES (
    p_student_id, p_subject, p_grade, p_topic, p_chapter,
    v_total, v_correct, v_score_percent,
    p_time, v_xp, NOW()
  ) RETURNING id INTO v_session_id;

  FOR r IN SELECT * FROM jsonb_array_elements(p_responses)
  LOOP
    v_question_id := (r->>'question_id')::UUID;
    v_selected := (r->>'selected_option')::INTEGER;

    SELECT correct_answer_index INTO v_actual_correct
    FROM question_bank WHERE id = v_question_id;

    v_is_correct := (v_selected IS NOT NULL AND v_actual_correct IS NOT NULL AND v_selected = v_actual_correct);

    INSERT INTO quiz_responses (
      quiz_session_id, question_id, selected_option,
      is_correct, time_spent_seconds
    ) VALUES (
      v_session_id, v_question_id, v_selected,
      v_is_correct, COALESCE((r->>'time_spent')::INTEGER, 0)
    ) ON CONFLICT DO NOTHING;
  END LOOP;

  PERFORM atomic_quiz_profile_update(p_student_id, v_xp, v_correct, v_total);

  RETURN jsonb_build_object(
    'total', v_total,
    'correct', v_correct,
    'score_percent', v_score_percent,
    'xp_earned', v_xp,
    'session_id', v_session_id
  );
END;
$$;
