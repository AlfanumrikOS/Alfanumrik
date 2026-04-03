-- ============================================================================
-- Migration: 20260403500000_fix_submit_quiz_the_one_fix.sql
-- Purpose: THE ONE FIX — correct submit_quiz_results, create atomic_quiz_profile_update,
--          enable non-repetition tracking + server-side anti-cheat.
--
-- Applied live to production on 2026-04-03 via Supabase SQL editor.
-- This migration file records what was applied for version control.
--
-- WHAT THIS FIXES:
-- 1. submit_quiz_results had wrong column names:
--    - Used question_count / correct_count (don't exist in quiz_sessions)
--    - Correct columns: total_questions, correct_answers, score (not xp_earned)
--    - Used topic (column is topic_title in quiz_sessions)
-- 2. atomic_quiz_profile_update didn't exist as a 6-param function initially:
--    - Called by both the RPC and the client fallback
--    - Always failed silently, meaning XP/profile never updated atomically
-- 3. user_question_history was never populated by submit_quiz_results:
--    - Non-repetition (seen-question avoidance) was dead code
-- 4. Server-side anti-cheat was missing from submit_quiz_results:
--    - avg time < 3s per question → flagged, xp_earned = 0
-- 5. quiz_responses was missing question_number, question_text, question_type
--    columns for audit trail
-- 6. BKT mastery update (update_concept_mastery_bkt) was never called per
--    question in submit_quiz_results
-- 7. Dead RPCs submit_quiz_results_safe and submit_quiz_results_rpc removed
-- ============================================================================


-- ============================================================================
-- 1. Add missing columns to quiz_responses for audit trail
-- ============================================================================

DO $$ BEGIN
  ALTER TABLE quiz_responses ADD COLUMN question_number INTEGER;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE quiz_responses ADD COLUMN question_text TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE quiz_responses ADD COLUMN question_type TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;


-- ============================================================================
-- 2. Unique constraint on user_question_history(student_id, question_id)
--    Required for ON CONFLICT in the non-repetition INSERT.
--    The table was created with UNIQUE(student_id, question_id) in
--    20260402130000 but we ensure it exists idempotently here.
-- ============================================================================

DO $$ BEGIN
  ALTER TABLE user_question_history
    ADD CONSTRAINT uqh_student_question_unique UNIQUE (student_id, question_id);
EXCEPTION
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_object THEN NULL;
END $$;


-- ============================================================================
-- 3. CREATE OR REPLACE atomic_quiz_profile_update (6-param version)
--    Atomically increments XP, session counts, streak in
--    student_learning_profiles + students.xp_total.
-- SECURITY DEFINER: Required because this function updates both
-- student_learning_profiles and students tables on behalf of the
-- authenticated student, crossing RLS boundaries.
-- ============================================================================

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
-- SECURITY DEFINER: needed for cross-table updates across RLS boundaries


-- ============================================================================
-- 4. 4-param overload for backward compatibility
--    Earlier migrations (20260329140000, 20260329170000) call this with 4 args.
-- SECURITY DEFINER: matches the 6-param version.
-- ============================================================================

CREATE OR REPLACE FUNCTION atomic_quiz_profile_update(
  p_student_id UUID,
  p_xp INT,
  p_correct INT,
  p_total INT
) RETURNS VOID AS $$
BEGIN
  PERFORM atomic_quiz_profile_update(
    p_student_id,
    'unknown'::TEXT,
    p_xp,
    p_total,
    p_correct,
    0
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- SECURITY DEFINER: delegates to 6-param SECURITY DEFINER version


-- ============================================================================
-- 5. DROP + CREATE OR REPLACE submit_quiz_results
--    The corrected RPC with:
--    - Correct column names: total_questions, correct_answers, topic_title, score
--    - question_number, question_text, question_type in quiz_responses INSERT
--    - BKT mastery update via update_concept_mastery_bkt per question
--    - user_question_history INSERT with ON CONFLICT for non-repetition
--    - Server-side anti-cheat: avg time < 3s → flagged, xp_earned=0
--    - Calls atomic_quiz_profile_update at the end
--
-- We DROP first to ensure clean replacement (parameter list may differ).
-- SECURITY DEFINER: Required because the function inserts into quiz_sessions,
-- quiz_responses, user_question_history, and calls atomic_quiz_profile_update
-- and update_concept_mastery_bkt on behalf of the authenticated student.
-- RLS on those tables would block direct inserts from the student role.
-- ============================================================================

DROP FUNCTION IF EXISTS submit_quiz_results(UUID, TEXT, TEXT, TEXT, INTEGER, JSONB, INTEGER);

CREATE OR REPLACE FUNCTION submit_quiz_results(
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
  v_flagged BOOLEAN := false;
  v_avg_time NUMERIC;
  r JSONB;
  v_question_id UUID;
  v_selected INTEGER;
  v_actual_correct INTEGER;
  v_is_correct BOOLEAN;
  v_q_text TEXT;
  v_q_type TEXT;
  v_q_topic_id UUID;
  v_q_number INTEGER := 0;
BEGIN
  -- ── Server-side verification: count and verify each response ──
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
    RETURN jsonb_build_object(
      'total', 0, 'correct', 0, 'score_percent', 0,
      'xp_earned', 0, 'session_id', NULL, 'flagged', false
    );
  END IF;

  -- ── Server-side anti-cheat (P3): avg time < 3s → flagged, xp = 0 ──
  v_avg_time := CASE WHEN v_total > 0 THEN p_time::NUMERIC / v_total ELSE 0 END;
  IF v_avg_time < 3.0 AND v_total > 0 THEN
    v_flagged := true;
  END IF;

  -- ── P2 XP formula: base + high_score_bonus + perfect_bonus ──
  v_score_percent := ROUND((v_correct::NUMERIC / v_total) * 100);
  IF v_flagged THEN
    v_xp := 0;  -- Anti-cheat: no XP for flagged submissions
  ELSE
    v_xp := v_correct * 10;
    IF v_score_percent >= 80 THEN v_xp := v_xp + 20; END IF;
    IF v_score_percent = 100 THEN v_xp := v_xp + 50; END IF;
  END IF;

  -- ── Insert quiz session with CORRECT column names ──
  -- quiz_sessions columns: total_questions (not question_count),
  -- correct_answers (not correct_count), topic_title (not topic),
  -- score (not xp_earned)
  INSERT INTO quiz_sessions (
    student_id, subject, grade, topic_title, chapter_number,
    total_questions, correct_answers, score_percent,
    time_taken_seconds, score, is_completed, completed_at
  ) VALUES (
    p_student_id, p_subject, p_grade, p_topic, p_chapter,
    v_total, v_correct, v_score_percent,
    p_time, v_xp, true, NOW()
  ) RETURNING id INTO v_session_id;

  -- ── Insert quiz responses with question audit trail + BKT + history ──
  v_q_number := 0;
  FOR r IN SELECT * FROM jsonb_array_elements(p_responses)
  LOOP
    v_q_number := v_q_number + 1;
    v_question_id := (r->>'question_id')::UUID;
    v_selected := (r->>'selected_option')::INTEGER;

    -- Look up question details for audit trail and BKT
    SELECT correct_answer_index, question_text, question_type, topic_id
    INTO v_actual_correct, v_q_text, v_q_type, v_q_topic_id
    FROM question_bank WHERE id = v_question_id;

    v_is_correct := (v_selected IS NOT NULL AND v_actual_correct IS NOT NULL AND v_selected = v_actual_correct);

    -- Insert quiz response with question audit fields
    INSERT INTO quiz_responses (
      quiz_session_id, student_id, question_id, selected_option,
      is_correct, time_spent_seconds,
      question_number, question_text, question_type
    ) VALUES (
      v_session_id, p_student_id, v_question_id, v_selected,
      v_is_correct, COALESCE((r->>'time_spent')::INTEGER, 0),
      v_q_number, v_q_text, v_q_type
    ) ON CONFLICT DO NOTHING;

    -- BKT mastery update per question (if topic_id exists)
    IF v_q_topic_id IS NOT NULL THEN
      PERFORM update_concept_mastery_bkt(
        p_student_id,
        v_q_topic_id,
        v_is_correct
      );
    END IF;

    -- user_question_history INSERT for non-repetition tracking
    INSERT INTO user_question_history (
      student_id, question_id, subject, grade, chapter_number,
      first_shown_at, last_shown_at, times_shown, last_result
    ) VALUES (
      p_student_id, v_question_id, p_subject, p_grade, p_chapter,
      NOW(), NOW(), 1, v_is_correct
    ) ON CONFLICT (student_id, question_id) DO UPDATE SET
      last_shown_at = NOW(),
      times_shown = user_question_history.times_shown + 1,
      last_result = v_is_correct;
  END LOOP;

  -- ── Atomic profile + XP update ──
  PERFORM atomic_quiz_profile_update(
    p_student_id, p_subject, v_xp, v_total, v_correct, p_time
  );

  RETURN jsonb_build_object(
    'total', v_total,
    'correct', v_correct,
    'score_percent', v_score_percent,
    'xp_earned', v_xp,
    'session_id', v_session_id,
    'flagged', v_flagged
  );
END;
$$;


-- ============================================================================
-- 6. Drop dead RPCs that are no longer called anywhere
-- ============================================================================

DROP FUNCTION IF EXISTS submit_quiz_results_safe(UUID, TEXT, TEXT, TEXT, INTEGER, JSONB, INTEGER);
DROP FUNCTION IF EXISTS submit_quiz_results_rpc(UUID, TEXT, TEXT, TEXT, INTEGER, JSONB, INTEGER);
-- Also drop any other signatures that may exist
DROP FUNCTION IF EXISTS submit_quiz_results_safe(UUID, TEXT, TEXT, JSONB, INTEGER);
DROP FUNCTION IF EXISTS submit_quiz_results_rpc(UUID, TEXT, TEXT, JSONB, INTEGER);


-- ============================================================================
-- End of migration: 20260403500000_fix_submit_quiz_the_one_fix.sql
-- Functions created/replaced:
--   1. atomic_quiz_profile_update (6-param) — atomic XP + profile + streak
--   2. atomic_quiz_profile_update (4-param) — backward compat overload
--   3. submit_quiz_results — corrected RPC with right columns, anti-cheat,
--      BKT mastery, non-repetition history, audit trail
-- Columns added:
--   quiz_responses: question_number, question_text, question_type
-- Constraints added:
--   user_question_history: UNIQUE(student_id, question_id)
-- Functions dropped:
--   submit_quiz_results_safe, submit_quiz_results_rpc
-- ============================================================================
