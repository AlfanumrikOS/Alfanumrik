-- Migration: 20260408000005_wire_session_id_dedup.sql
-- Purpose: Wire v_session_id into the atomic_quiz_profile_update() call inside
--          submit_quiz_results() so that XP deduplication is active.
--
-- Background:
--   20260408000004_link_quiz_xp_to_ledger.sql added an optional 7th parameter
--   p_session_id UUID DEFAULT NULL to atomic_quiz_profile_update(). When provided,
--   the function writes reference_id = 'quiz_' || session_id into xp_transactions,
--   making the INSERT idempotent via a unique index on reference_id.
--
--   submit_quiz_results() already populates v_session_id via
--   "INSERT INTO quiz_sessions ... RETURNING id INTO v_session_id", but the
--   subsequent PERFORM atomic_quiz_profile_update(...) call was passing only 6
--   arguments, leaving p_session_id NULL and deduplication inactive.
--
-- Change (the ONLY difference from 20260408000001):
--   Line: PERFORM atomic_quiz_profile_update(p_student_id, p_subject, v_xp, v_total, v_correct, p_time);
--   → becomes:
--   Line: PERFORM atomic_quiz_profile_update(p_student_id, p_subject, v_xp, v_total, v_correct, p_time, v_session_id);
--
-- All P1-P5 invariants are fully preserved — no other logic was changed.
--   P1 score formula: ROUND((v_correct::NUMERIC / v_total) * 100)           [unchanged]
--   P2 XP formula: v_correct*10 + high_score_bonus + perfect_bonus          [unchanged]
--   P3 anti-cheat: all 3 checks (avg time, same-answer, count)              [unchanged]
--   P4 atomic submission: via atomic_quiz_profile_update() single call      [unchanged]
--   P5 grade as TEXT parameter                                               [unchanged]
--
-- Idempotent: CREATE OR REPLACE — safe to re-apply.

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
-- SECURITY DEFINER justified: this function must write to quiz_sessions,
-- quiz_responses, user_question_history, and invoke atomic_quiz_profile_update
-- on behalf of the authenticated student. The caller is verified via p_student_id
-- ownership checks in the downstream RPC and the API route's authorizeRequest().
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
  v_q_bloom TEXT;        -- bloom_level from question_bank
  v_q_difficulty INT;    -- difficulty from question_bank
  -- P3 Check 2: answer distribution tracking
  v_answer_counts    INT[]   := ARRAY[0,0,0,0];
  v_max_same_answer  INT     := 0;
  -- CME action variables
  v_cme_action TEXT;
  v_cme_concept_id UUID;
  v_cme_reason TEXT;
BEGIN
  -- Server-side verification: count and verify each response
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

    -- P3 Check 2: Track answer distribution for all-same-answer detection
    IF v_selected >= 0 AND v_selected <= 3 THEN
      v_answer_counts[v_selected + 1] := v_answer_counts[v_selected + 1] + 1;
    END IF;
  END LOOP;

  IF v_total = 0 THEN
    RETURN jsonb_build_object(
      'total', 0, 'correct', 0, 'score_percent', 0,
      'xp_earned', 0, 'session_id', NULL, 'flagged', false
    );
  END IF;

  -- Server-side anti-cheat (P3 Check 1): avg time < 3s -> flagged, xp = 0
  v_avg_time := CASE WHEN v_total > 0 THEN p_time::NUMERIC / v_total ELSE 0 END;
  IF v_avg_time < 3.0 AND v_total > 0 THEN
    v_flagged := true;
  END IF;

  -- P3 Check 2: Not all same answer if >3 questions
  IF v_total > 3 THEN
    v_max_same_answer := GREATEST(
      v_answer_counts[1], v_answer_counts[2],
      v_answer_counts[3], v_answer_counts[4]
    );
    IF v_max_same_answer = v_total THEN
      v_flagged := true;
    END IF;
  END IF;

  -- P3 Check 3: Response count equals question count
  -- jsonb_array_length(p_responses) is the submitted count; v_total is the iterated count.
  -- If they diverge (e.g. duplicate keys collapsed by JSONB), flag it.
  IF jsonb_array_length(p_responses) != v_total THEN
    v_flagged := true;
  END IF;

  -- P1 score formula: ROUND((v_correct::NUMERIC / v_total) * 100)
  v_score_percent := ROUND((v_correct::NUMERIC / v_total) * 100);

  -- P2 XP formula: base + high_score_bonus + perfect_bonus
  IF v_flagged THEN
    v_xp := 0;  -- Anti-cheat: no XP for flagged submissions
  ELSE
    v_xp := v_correct * 10;
    IF v_score_percent >= 80 THEN v_xp := v_xp + 20; END IF;
    IF v_score_percent = 100 THEN v_xp := v_xp + 50; END IF;
  END IF;

  -- Insert quiz session with CORRECT column names
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

  -- Insert quiz responses with question audit trail + unified learner update + history
  v_q_number := 0;
  FOR r IN SELECT * FROM jsonb_array_elements(p_responses)
  LOOP
    v_q_number := v_q_number + 1;
    v_question_id := (r->>'question_id')::UUID;
    v_selected := (r->>'selected_option')::INTEGER;

    -- Look up question details for audit trail and learner state update
    SELECT correct_answer_index, question_text, question_type, topic_id, bloom_level, difficulty
    INTO v_actual_correct, v_q_text, v_q_type, v_q_topic_id, v_q_bloom, v_q_difficulty
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

    -- Unified learner state update per question (replaces update_concept_mastery_bkt)
    -- Passes bloom_level, error_type, response_time_ms, and difficulty for
    -- full BKT + Bloom mastery + error classification + retention + streak update.
    IF v_q_topic_id IS NOT NULL THEN
      PERFORM update_learner_state_post_quiz(
        p_student_id,
        v_q_topic_id,
        v_is_correct,
        v_q_bloom,                                      -- bloom_level from question_bank
        (r->>'error_type')::TEXT,                        -- error_type from client response
        COALESCE((r->>'time_spent')::INT, 0) * 1000,    -- convert seconds to milliseconds
        v_q_difficulty                                   -- difficulty from question_bank
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

  -- Atomic profile + XP update.
  -- v_session_id is passed as the 7th argument (added in migration 20260408000005)
  -- so that atomic_quiz_profile_update() can write reference_id = 'quiz_' || v_session_id
  -- to xp_transactions, making XP awards idempotent against double-submission.
  PERFORM atomic_quiz_profile_update(
    p_student_id, p_subject, v_xp, v_total, v_correct, p_time, v_session_id
  );

  -- CME: compute and store post-quiz action recommendation
  -- Wrapped in BEGIN/EXCEPTION so CME failures can NEVER break quiz submission.
  -- The quiz result is already saved; this is a best-effort enrichment.
  BEGIN
    SELECT ca.action_type, ca.concept_id, ca.reason
    INTO v_cme_action, v_cme_concept_id, v_cme_reason
    FROM compute_post_quiz_action(p_student_id, p_subject, p_grade) ca;

    UPDATE quiz_sessions
    SET cme_next_action = v_cme_action,
        cme_next_concept_id = v_cme_concept_id,
        cme_reason = v_cme_reason
    WHERE id = v_session_id;
  EXCEPTION WHEN OTHERS THEN
    -- CME recommendation failed -- log nothing, lose nothing.
    -- The quiz submission itself is unaffected.
    NULL;
  END;

  RETURN jsonb_build_object(
    'total', v_total,
    'correct', v_correct,
    'score_percent', v_score_percent,
    'xp_earned', v_xp,
    'session_id', v_session_id,
    'flagged', v_flagged,
    'cme_next_action', v_cme_action,
    'cme_next_concept_id', v_cme_concept_id,
    'cme_reason', v_cme_reason
  );
END;
$$;

COMMENT ON FUNCTION submit_quiz_results IS
  'Submits quiz results with server-side verification, anti-cheat (all 3 P3 checks), '
  'XP calculation, and unified learner state update (BKT + Bloom mastery + error '
  'classification + retention + streak + CME action). '
  'P3 checks: (1) avg time >= 3s, (2) not all same answer if >3 questions, '
  '(3) response count equals question count. Added checks 2 and 3 server-side in '
  'migration 20260408000001. '
  'Migration 20260408000005: wired v_session_id as 7th argument to '
  'atomic_quiz_profile_update() activating XP deduplication via xp_transactions.reference_id.';

-- End of migration: 20260408000005_wire_session_id_dedup.sql
-- Functions replaced:
--   submit_quiz_results -- passed v_session_id to atomic_quiz_profile_update (7th arg)
