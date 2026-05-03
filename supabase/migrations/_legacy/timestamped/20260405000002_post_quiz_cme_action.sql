-- ============================================================================
-- Migration: 20260405000002_post_quiz_cme_action.sql
-- Purpose: Wire CME recommendation into the quiz submission flow.
--   1. Add cme_next_action, cme_next_concept_id, cme_reason to quiz_sessions
--   2. Create compute_post_quiz_action RPC (what should student do next?)
--   3. Update submit_quiz_results to call compute_post_quiz_action and store
--      the result — wrapped in BEGIN/EXCEPTION so it never fails the submission.
-- ============================================================================


-- ============================================================================
-- 1. ADD CME COLUMNS TO quiz_sessions
-- ============================================================================

DO $$ BEGIN
  ALTER TABLE quiz_sessions ADD COLUMN cme_next_action TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE quiz_sessions ADD COLUMN cme_next_concept_id UUID;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE quiz_sessions ADD COLUMN cme_reason TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Index for querying recent CME recommendations per student
CREATE INDEX IF NOT EXISTS idx_quiz_sessions_cme_action
  ON quiz_sessions(student_id, cme_next_action)
  WHERE cme_next_action IS NOT NULL;


-- ============================================================================
-- 2. RPC: compute_post_quiz_action
--    Given a student + subject + grade, analyzes concept_mastery to recommend
--    what the student should do next. Joins through chapter_topics → chapters
--    → subjects to filter by subject.
--
-- SECURITY DEFINER: Required because this is called from submit_quiz_results
-- (already SECURITY DEFINER) after quiz completion. The caller has already
-- validated the student. Direct RLS-based access would fail inside a
-- SECURITY DEFINER chain.
--
-- Decision priority (first match wins):
--   1. error_count_conceptual >= 3        → 'remediate'  (deep misunderstanding)
--   2. current_retention < 0.5 AND
--      mastery_level > 0.4                → 'revise'     (forgetting learned material)
--   3. weakest mastery < 0.3              → 'teach'      (new/unknown concept)
--   4. weakest mastery < 0.6              → 'practice'   (developing skill)
--   5. weakest mastery < 0.85             → 'challenge'  (push to mastery)
--   6. otherwise                          → 'exam_prep'  (ready for assessment)
-- ============================================================================

CREATE OR REPLACE FUNCTION compute_post_quiz_action(
  p_student_id UUID,
  p_subject TEXT,
  p_grade TEXT
)
RETURNS TABLE(action_type TEXT, concept_id UUID, topic_title TEXT, reason TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_action TEXT;
  v_concept_id UUID;
  v_topic_title TEXT;
  v_reason TEXT;
  v_mastery FLOAT;
  v_retention FLOAT;
  v_err_conceptual INT;
BEGIN
  -- Priority 1: Find topic with high conceptual error count (>= 3)
  SELECT
    cm.topic_id,
    ct.title,
    COALESCE(cm.mastery_level::FLOAT, cm.mastery_probability, 0),
    cm.error_count_conceptual
  INTO v_concept_id, v_topic_title, v_mastery, v_err_conceptual
  FROM concept_mastery cm
  JOIN chapter_topics ct ON ct.id = cm.topic_id
  JOIN chapters ch ON ch.id = ct.chapter_id
  JOIN subjects s ON s.id = ch.subject_id
  WHERE cm.student_id = p_student_id
    AND s.code = p_subject
    AND ch.grade = p_grade
    AND COALESCE(cm.error_count_conceptual, 0) >= 3
  ORDER BY cm.error_count_conceptual DESC, COALESCE(cm.mastery_level::FLOAT, cm.mastery_probability, 0) ASC
  LIMIT 1;

  IF v_concept_id IS NOT NULL THEN
    RETURN QUERY SELECT
      'remediate'::TEXT,
      v_concept_id,
      v_topic_title,
      ('Deep conceptual gaps detected (' || v_err_conceptual || ' conceptual errors). Needs targeted remediation.')::TEXT;
    RETURN;
  END IF;

  -- Priority 2: Find topic being forgotten (was learned but retention decayed)
  SELECT
    cm.topic_id,
    ct.title,
    COALESCE(cm.mastery_level::FLOAT, cm.mastery_probability, 0),
    COALESCE(cm.current_retention, 0)
  INTO v_concept_id, v_topic_title, v_mastery, v_retention
  FROM concept_mastery cm
  JOIN chapter_topics ct ON ct.id = cm.topic_id
  JOIN chapters ch ON ch.id = ct.chapter_id
  JOIN subjects s ON s.id = ch.subject_id
  WHERE cm.student_id = p_student_id
    AND s.code = p_subject
    AND ch.grade = p_grade
    AND COALESCE(cm.current_retention, 0) < 0.5
    AND COALESCE(cm.mastery_level::FLOAT, cm.mastery_probability, 0) > 0.4
  ORDER BY cm.current_retention ASC
  LIMIT 1;

  IF v_concept_id IS NOT NULL THEN
    RETURN QUERY SELECT
      'revise'::TEXT,
      v_concept_id,
      v_topic_title,
      ('Retention dropped to ' || ROUND(v_retention::NUMERIC * 100) || '% despite prior mastery. Revision needed before it is lost.')::TEXT;
    RETURN;
  END IF;

  -- Priority 3-6: Find weakest topic by mastery level and classify
  SELECT
    cm.topic_id,
    ct.title,
    COALESCE(cm.mastery_level::FLOAT, cm.mastery_probability, 0)
  INTO v_concept_id, v_topic_title, v_mastery
  FROM concept_mastery cm
  JOIN chapter_topics ct ON ct.id = cm.topic_id
  JOIN chapters ch ON ch.id = ct.chapter_id
  JOIN subjects s ON s.id = ch.subject_id
  WHERE cm.student_id = p_student_id
    AND s.code = p_subject
    AND ch.grade = p_grade
  ORDER BY COALESCE(cm.mastery_level::FLOAT, cm.mastery_probability, 0) ASC
  LIMIT 1;

  IF v_concept_id IS NULL THEN
    -- No concept_mastery rows at all for this student+subject+grade.
    -- Return exam_prep as a safe default.
    RETURN QUERY SELECT
      'exam_prep'::TEXT,
      NULL::UUID,
      NULL::TEXT,
      'No mastery data available for this subject. Ready for general practice.'::TEXT;
    RETURN;
  END IF;

  -- Classify by mastery level
  IF v_mastery < 0.3 THEN
    v_action := 'teach';
    v_reason := 'Mastery at ' || ROUND(v_mastery::NUMERIC * 100) || '%. This concept needs teaching from scratch.';
  ELSIF v_mastery < 0.6 THEN
    v_action := 'practice';
    v_reason := 'Mastery at ' || ROUND(v_mastery::NUMERIC * 100) || '%. More practice needed to build fluency.';
  ELSIF v_mastery < 0.85 THEN
    v_action := 'challenge';
    v_reason := 'Mastery at ' || ROUND(v_mastery::NUMERIC * 100) || '%. Ready for harder problems to push toward mastery.';
  ELSE
    v_action := 'exam_prep';
    v_reason := 'All topics above 85% mastery. Ready for exam-level practice.';
  END IF;

  RETURN QUERY SELECT v_action, v_concept_id, v_topic_title, v_reason;
  RETURN;
END;
$$;

COMMENT ON FUNCTION compute_post_quiz_action IS
  'Analyzes concept_mastery for a student+subject+grade and returns the recommended next action (remediate/revise/teach/practice/challenge/exam_prep) with the target concept.';


-- ============================================================================
-- 3. UPDATE submit_quiz_results — add CME action call at the end
--
-- This is CREATE OR REPLACE of the function from
-- 20260403500000_fix_submit_quiz_the_one_fix.sql with ALL existing logic
-- preserved exactly. The only addition is a BEGIN/EXCEPTION block before
-- the final RETURN that calls compute_post_quiz_action and stores the
-- result in quiz_sessions. This block can NEVER fail the quiz submission.
--
-- SECURITY DEFINER: Required because the function inserts into quiz_sessions,
-- quiz_responses, user_question_history, and calls atomic_quiz_profile_update
-- and update_concept_mastery_bkt on behalf of the authenticated student.
-- RLS on those tables would block direct inserts from the student role.
-- ============================================================================

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
  -- CME action variables
  v_cme_action TEXT;
  v_cme_concept_id UUID;
  v_cme_reason TEXT;
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

  -- ── CME: compute and store post-quiz action recommendation ──
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
    -- CME recommendation failed — log nothing, lose nothing.
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


-- ============================================================================
-- End of migration: 20260405000002_post_quiz_cme_action.sql
-- Columns added:
--   quiz_sessions: cme_next_action, cme_next_concept_id, cme_reason
-- Functions created:
--   compute_post_quiz_action — analyzes mastery to recommend next action
-- Functions replaced:
--   submit_quiz_results — same logic + CME call in safe BEGIN/EXCEPTION block
-- ============================================================================
