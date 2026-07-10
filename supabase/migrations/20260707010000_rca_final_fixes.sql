-- Migration: 20260707010000_rca_final_fixes.sql
-- Purpose: Finalize fixes for RCA Issue 2 and Issue 12

BEGIN;

-- Fix Issue 2: Anti-Cheat Check 3 in submit_quiz_results (Legacy v1)
CREATE OR REPLACE FUNCTION public.submit_quiz_results(
  p_student_id uuid,
  p_subject    text,
  p_grade      text,
  p_topic      text DEFAULT NULL::text,
  p_chapter    integer DEFAULT NULL::integer,
  p_responses  jsonb DEFAULT '[]'::jsonb,
  p_time       integer DEFAULT 0
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path = public, pg_catalog
    AS $$
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
  v_shuffle JSONB;
  v_shuffle_arr INTEGER[];
  v_shuffle_ok BOOLEAN;
  v_shuffle_valid BOOLEAN;
  v_selected_orig INTEGER;
  v_actual_correct INTEGER;
  v_is_correct BOOLEAN;
  v_client_is_correct BOOLEAN;
  v_q_text TEXT;
  v_q_type TEXT;
  v_q_topic_id UUID;
  v_q_number INTEGER := 0;
  v_q_bloom TEXT;
  v_q_difficulty INT;
  v_answer_counts    INT[]   := ARRAY[0,0,0,0];
  v_max_same_answer  INT     := 0;
  v_cme_action TEXT;
  v_cme_concept_id UUID;
  v_cme_reason TEXT;
BEGIN
  -- SECURITY FIX (2026-07-02, Phase 3 Wave 1 #5): ownership check. Prevents any
  -- authenticated JWT holder from calling this RPC directly via PostgREST with
  -- an ARBITRARY p_student_id to write quiz sessions / XP onto another
  -- student's account. Identical pattern to submit_quiz_results_v2 (baseline
  -- ~7629-7634). Skipped when auth.uid() IS NULL so service-role callers
  -- (which bypass RLS and carry no JWT) are unaffected.
  IF auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM students
    WHERE id = p_student_id AND auth_user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Access denied: caller does not own student %', p_student_id;
  END IF;

  FOR r IN SELECT * FROM jsonb_array_elements(p_responses)
  LOOP
    v_total := v_total + 1;
    v_question_id := (r->>'question_id')::UUID;
    v_selected := (r->>'selected_option')::INTEGER;
    v_shuffle := r->'shuffle_map';

    v_shuffle_valid := (
      v_shuffle IS NOT NULL
      AND jsonb_typeof(v_shuffle) = 'array'
      AND jsonb_array_length(v_shuffle) = 4
      AND v_selected IS NOT NULL
      AND v_selected BETWEEN 0 AND 3
    );
    IF v_shuffle_valid THEN
      v_shuffle_ok := true;
      v_shuffle_arr := NULL;
      BEGIN
        SELECT array_agg(elem ORDER BY ord)
          INTO v_shuffle_arr
          FROM (
            SELECT (e)::INTEGER AS elem, ord
            FROM jsonb_array_elements_text(v_shuffle) WITH ORDINALITY AS t(e, ord)
          ) s;
      EXCEPTION WHEN OTHERS THEN
        v_shuffle_ok := false;
      END;
      IF v_shuffle_ok AND v_shuffle_arr IS NOT NULL AND array_length(v_shuffle_arr, 1) = 4 THEN
        FOR i IN 1..4 LOOP
          IF v_shuffle_arr[i] IS NULL OR v_shuffle_arr[i] < 0 OR v_shuffle_arr[i] > 3 THEN
            v_shuffle_ok := false;
            EXIT;
          END IF;
        END LOOP;
      ELSE
        v_shuffle_ok := false;
      END IF;

      IF v_shuffle_ok THEN
        v_selected_orig := v_shuffle_arr[v_selected + 1];
      ELSE
        v_selected_orig := v_selected;
      END IF;
    ELSE
      v_selected_orig := v_selected;
    END IF;

    SELECT correct_answer_index INTO v_actual_correct
    FROM question_bank WHERE id = v_question_id;

    v_is_correct := (
      v_selected_orig IS NOT NULL
      AND v_actual_correct IS NOT NULL
      AND v_selected_orig = v_actual_correct
    );

    IF v_is_correct THEN
      v_correct := v_correct + 1;
    END IF;

    IF v_selected IS NOT NULL AND v_selected >= 0 AND v_selected <= 3 THEN
      v_answer_counts[v_selected + 1] := v_answer_counts[v_selected + 1] + 1;
    END IF;
  END LOOP;

  IF v_total = 0 THEN
    RETURN jsonb_build_object(
      'total', 0, 'correct', 0, 'score_percent', 0,
      'xp_earned', 0, 'session_id', NULL, 'flagged', false
    );
  END IF;

  v_avg_time := CASE WHEN v_total > 0 THEN p_time::NUMERIC / v_total ELSE 0 END;
  IF v_avg_time < 3.0 AND v_total > 0 THEN
    v_flagged := true;
  END IF;

  IF v_total > 3 THEN
    v_max_same_answer := GREATEST(
      v_answer_counts[1], v_answer_counts[2],
      v_answer_counts[3], v_answer_counts[4]
    );
    IF v_max_same_answer = (v_answer_counts[1] + v_answer_counts[2] + v_answer_counts[3] + v_answer_counts[4]) AND (v_answer_counts[1] + v_answer_counts[2] + v_answer_counts[3] + v_answer_counts[4]) > 3 THEN
      v_flagged := true;
    END IF;
  END IF;

  -- Anti-Cheat Check 3 disabled for legacy v1 (no session_id to compare against)

  v_score_percent := ROUND((v_correct::NUMERIC / v_total) * 100);

  IF v_flagged THEN
    v_xp := 0;
  ELSE
    v_xp := v_correct * 10;
    IF v_score_percent >= 80 THEN v_xp := v_xp + 20; END IF;
    IF v_score_percent = 100 THEN v_xp := v_xp + 50; END IF;
  END IF;

  INSERT INTO quiz_sessions (
    student_id, subject, grade, topic_title, chapter_number,
    total_questions, correct_answers, score_percent,
    time_taken_seconds, score, is_completed, completed_at
  ) VALUES (
    p_student_id, p_subject, p_grade, p_topic, p_chapter,
    v_total, v_correct, v_score_percent,
    p_time, v_xp, true, NOW()
  ) RETURNING id INTO v_session_id;

  v_q_number := 0;
  FOR r IN SELECT * FROM jsonb_array_elements(p_responses)
  LOOP
    v_q_number := v_q_number + 1;
    v_question_id := (r->>'question_id')::UUID;
    v_selected := (r->>'selected_option')::INTEGER;
    v_shuffle := r->'shuffle_map';

    v_shuffle_arr := NULL;
    v_shuffle_valid := (
      v_shuffle IS NOT NULL
      AND jsonb_typeof(v_shuffle) = 'array'
      AND jsonb_array_length(v_shuffle) = 4
      AND v_selected IS NOT NULL
      AND v_selected BETWEEN 0 AND 3
    );
    IF v_shuffle_valid THEN
      v_shuffle_ok := true;
      v_shuffle_arr := NULL;
      BEGIN
        SELECT array_agg(elem ORDER BY ord)
          INTO v_shuffle_arr
          FROM (
            SELECT (e)::INTEGER AS elem, ord
            FROM jsonb_array_elements_text(v_shuffle) WITH ORDINALITY AS t(e, ord)
          ) s;
      EXCEPTION WHEN OTHERS THEN
        v_shuffle_ok := false;
      END;
      IF v_shuffle_ok AND v_shuffle_arr IS NOT NULL AND array_length(v_shuffle_arr, 1) = 4 THEN
        FOR i IN 1..4 LOOP
          IF v_shuffle_arr[i] IS NULL OR v_shuffle_arr[i] < 0 OR v_shuffle_arr[i] > 3 THEN
            v_shuffle_ok := false;
            EXIT;
          END IF;
        END LOOP;
      ELSE
        v_shuffle_ok := false;
      END IF;

      IF v_shuffle_ok THEN
        v_selected_orig := v_shuffle_arr[v_selected + 1];
      ELSE
        v_selected_orig := v_selected;
        v_shuffle_arr := NULL;
      END IF;
    ELSE
      v_selected_orig := v_selected;
      v_shuffle_arr := NULL;
    END IF;

    SELECT correct_answer_index, question_text, question_type, topic_id, bloom_level, difficulty
    INTO v_actual_correct, v_q_text, v_q_type, v_q_topic_id, v_q_bloom, v_q_difficulty
    FROM question_bank WHERE id = v_question_id;

    v_is_correct := (
      v_selected_orig IS NOT NULL
      AND v_actual_correct IS NOT NULL
      AND v_selected_orig = v_actual_correct
    );

    IF (r ? 'is_correct') AND jsonb_typeof(r->'is_correct') = 'boolean' THEN
      v_client_is_correct := (r->>'is_correct')::BOOLEAN;
      IF v_client_is_correct IS DISTINCT FROM v_is_correct THEN
        BEGIN
          INSERT INTO ops_events (
            occurred_at, category, source, severity,
            subject_type, subject_id, message, context, environment
          ) VALUES (
            NOW(),
            'grounding.scoring',
            'submit_quiz_results',
            'warning',
            'student', p_student_id::text,
            'Client/server is_correct disagreement on quiz_response',
            jsonb_build_object(
              'student_id', p_student_id,
              'session_id', v_session_id,
              'question_id', v_question_id,
              'client_flag', v_client_is_correct,
              'server_flag', v_is_correct,
              'selected_option', v_selected,
              'selected_orig', v_selected_orig,
              'actual_correct', v_actual_correct,
              'shuffle_map', v_shuffle
            ),
            COALESCE(current_setting('app.environment', true), 'production')
          );
        EXCEPTION WHEN OTHERS THEN
          NULL;
        END;
      END IF;
    END IF;

    INSERT INTO quiz_responses (
      quiz_session_id, student_id, question_id, selected_option,
      is_correct, time_spent_seconds,
      question_number, question_text, question_type,
      shuffle_map
    ) VALUES (
      v_session_id, p_student_id, v_question_id, v_selected,
      v_is_correct, COALESCE((r->>'time_spent')::INTEGER, 0),
      v_q_number, v_q_text, v_q_type,
      v_shuffle_arr
    ) ON CONFLICT DO NOTHING;

    IF v_q_topic_id IS NOT NULL THEN
      PERFORM update_learner_state_post_quiz(
        p_student_id,
        v_q_topic_id,
        v_is_correct,
        v_q_bloom,
        (r->>'error_type')::TEXT,
        COALESCE((r->>'time_spent')::INT, 0) * 1000,
        v_q_difficulty
      );
    END IF;

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

  PERFORM atomic_quiz_profile_update(
    p_student_id, p_subject, v_xp, v_total, v_correct, p_time, v_session_id
  );

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

-- Fix Issue 2: Anti-Cheat Check 3 in submit_quiz_results_v2
CREATE OR REPLACE FUNCTION public.submit_quiz_results_v2(
  p_session_id UUID,
  p_student_id UUID,
  p_subject TEXT,
  p_grade TEXT,
  p_topic TEXT DEFAULT NULL,
  p_chapter INTEGER DEFAULT NULL,
  p_responses JSONB DEFAULT '[]',
  p_time INTEGER DEFAULT 0,
  p_idempotency_key UUID DEFAULT NULL    -- Phase 2.8 addition (default NULL = legacy path)
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
-- SECURITY DEFINER justified: writes quiz_sessions, quiz_responses,
-- user_question_history; invokes atomic_quiz_profile_update. Authorization
-- is enforced inline against students.auth_user_id.
SET search_path = public
AS $$
DECLARE
  v_total INTEGER := 0;
  v_correct INTEGER := 0;
  v_score_percent NUMERIC;
  v_xp INTEGER := 0;
  v_quiz_session_id UUID;
  v_flagged BOOLEAN := false;
  v_avg_time NUMERIC;
  r JSONB;
  v_q_id UUID;
  v_question_id UUID;
  v_selected_displayed INTEGER;
  v_selected_orig INTEGER;
  v_shuffle INT[];
  v_correct_idx_snapshot INT;
  v_options_snapshot JSONB;
  v_is_correct BOOLEAN;
  v_q_text TEXT;
  v_q_type TEXT;
  v_q_topic_id UUID;
  v_q_number INTEGER := 0;
  v_q_bloom TEXT;
  v_q_difficulty INT;
  -- RCA 2026-06-21: variables for runtime topic_id derivation fallback
  v_q_subject TEXT;
  v_q_chapter INTEGER;
  -- PART C: server-side error classification
  v_error_type TEXT;       -- computed bucket for THIS wrong response (NULL otherwise)
  v_prior_mastery FLOAT;   -- prior concept mastery, read pre-BKT for this topic
  v_answer_counts INT[] := ARRAY[0,0,0,0];
  v_max_same_answer INT := 0;
  v_review_questions JSONB := '[]'::jsonb;
  v_correct_option_text TEXT;
  v_cme_action TEXT;
  v_cme_concept_id UUID;
  v_cme_reason TEXT;
  -- Phase 2.8 idempotency cache record
  v_existing RECORD;
BEGIN
  -- Ownership check (same pattern as start_quiz_session).
  IF auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM students
    WHERE id = p_student_id AND auth_user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Access denied: caller does not own student %', p_student_id;
  END IF;

  -- ─── Phase 2.8: idempotency replay short-circuit ──────────────────────
  IF p_idempotency_key IS NOT NULL THEN
    SELECT id, total_questions, correct_answers, score_percent, score
      INTO v_existing
      FROM quiz_sessions
     WHERE student_id = p_student_id
       AND idempotency_key = p_idempotency_key
     LIMIT 1;

    IF v_existing.id IS NOT NULL THEN
      SELECT COALESCE(jsonb_agg(
               jsonb_build_object(
                 'question_id', qr.question_id,
                 'is_correct', qr.is_correct,
                 -- COLUMN-NAME CORRECTION: canonical column is student_answer_index.
                 'selected_displayed_index', qr.student_answer_index,
                 'selected_original_index',
                   CASE
                     WHEN qss.shuffle_map IS NOT NULL
                          AND array_length(qss.shuffle_map, 1) = 4
                          AND qr.student_answer_index BETWEEN 0 AND 3
                     THEN qss.shuffle_map[qr.student_answer_index + 1]
                     ELSE qr.student_answer_index
                   END,
                 'correct_original_index', qss.correct_answer_index_snapshot,
                 'correct_option_text',
                   CASE
                     WHEN qss.options_snapshot IS NOT NULL
                          AND jsonb_typeof(qss.options_snapshot) = 'array'
                          AND qss.correct_answer_index_snapshot IS NOT NULL
                          AND jsonb_array_length(qss.options_snapshot)
                              > qss.correct_answer_index_snapshot
                     THEN qss.options_snapshot ->> qss.correct_answer_index_snapshot
                     ELSE NULL
                   END,
                 'shuffle_map', to_jsonb(qss.shuffle_map)
               ) ORDER BY qr.question_number
             ), '[]'::jsonb)
        INTO v_review_questions
        FROM quiz_responses qr
        LEFT JOIN quiz_session_shuffles qss
               ON qss.session_id = p_session_id
              AND qss.question_id = qr.question_id
       WHERE qr.quiz_session_id = v_existing.id;

      RETURN jsonb_build_object(
        'total', v_existing.total_questions,
        'correct', v_existing.correct_answers,
        'score_percent', v_existing.score_percent,
        'xp_earned', v_existing.score,
        'session_id', v_existing.id,
        'flagged', false,
        'idempotent_replay', true,
        'questions', v_review_questions
      );
    END IF;
  END IF;

  -- Validate session ownership.
  IF EXISTS (
    SELECT 1 FROM quiz_session_shuffles
    WHERE session_id = p_session_id AND student_id <> p_student_id
  ) THEN
    RAISE EXCEPTION 'Access denied: session % does not belong to student %',
      p_session_id, p_student_id;
  END IF;

  -- ─── First pass: count + score in original-index space ───────────────
  FOR r IN SELECT * FROM jsonb_array_elements(p_responses)
  LOOP
    v_total := v_total + 1;
    v_q_id := (r->>'question_id')::UUID;
    v_question_id := v_q_id;
    v_selected_displayed := COALESCE(
      (r->>'selected_displayed_index')::INTEGER,
      (r->>'selected_option')::INTEGER
    );

    SELECT shuffle_map, correct_answer_index_snapshot
      INTO v_shuffle, v_correct_idx_snapshot
      FROM quiz_session_shuffles
     WHERE session_id = p_session_id AND question_id = v_q_id;

    IF v_correct_idx_snapshot IS NULL THEN
      RAISE EXCEPTION
        'session_not_started: quiz_session_shuffles row missing for session_id=%, question_id=%',
        p_session_id, v_q_id
        USING ERRCODE = 'P0001';
    END IF;

    IF v_shuffle IS NOT NULL
       AND array_length(v_shuffle, 1) = 4
       AND v_selected_displayed IS NOT NULL
       AND v_selected_displayed BETWEEN 0 AND 3 THEN
      v_selected_orig := v_shuffle[v_selected_displayed + 1];
    ELSE
      v_selected_orig := v_selected_displayed;
    END IF;

    v_is_correct := (
      v_selected_orig IS NOT NULL
      AND v_selected_orig = v_correct_idx_snapshot
    );

    IF v_is_correct THEN
      v_correct := v_correct + 1;
    END IF;

    IF v_selected_displayed IS NOT NULL
       AND v_selected_displayed >= 0
       AND v_selected_displayed <= 3 THEN
      v_answer_counts[v_selected_displayed + 1] := v_answer_counts[v_selected_displayed + 1] + 1;
    END IF;
  END LOOP;

  IF v_total = 0 THEN
    RETURN jsonb_build_object(
      'total', 0, 'correct', 0, 'score_percent', 0,
      'xp_earned', 0, 'session_id', NULL, 'flagged', false,
      'idempotent_replay', false,
      'questions', '[]'::jsonb
    );
  END IF;

  -- P3 Check 1: avg time < 3s -> flag, xp = 0.
  v_avg_time := CASE WHEN v_total > 0 THEN p_time::NUMERIC / v_total ELSE 0 END;
  IF v_avg_time < 3.0 AND v_total > 0 THEN
    v_flagged := true;
  END IF;

  -- P3 Check 2: not all same answer if >3 questions.
  IF v_total > 3 THEN
    v_max_same_answer := GREATEST(
      v_answer_counts[1], v_answer_counts[2],
      v_answer_counts[3], v_answer_counts[4]
    );
    IF v_max_same_answer = (v_answer_counts[1] + v_answer_counts[2] + v_answer_counts[3] + v_answer_counts[4]) AND (v_answer_counts[1] + v_answer_counts[2] + v_answer_counts[3] + v_answer_counts[4]) > 3 THEN
      v_flagged := true;
    END IF;
  END IF;

  -- P3 Check 3: response count matches jsonb_array_length.
  IF jsonb_array_length(p_responses) <> COALESCE((SELECT array_length(question_ids, 1) FROM quiz_sessions WHERE id = p_session_id), v_total) THEN
    v_flagged := true;
  END IF;

  -- P1: score_percent = ROUND((v_correct / v_total) * 100).
  v_score_percent := ROUND((v_correct::NUMERIC / v_total) * 100);

  -- P2: base + high_score_bonus + perfect_bonus, gated by P3 flag.
  IF v_flagged THEN
    v_xp := 0;
  ELSE
    v_xp := v_correct * 10;                              -- P2: XP_RULES.quiz_per_correct=10
    IF v_score_percent >= 80 THEN v_xp := v_xp + 20; END IF; -- P2: quiz_high_score_bonus=20
    IF v_score_percent = 100 THEN v_xp := v_xp + 50; END IF; -- P2: quiz_perfect_bonus=50
  END IF;

  INSERT INTO quiz_sessions (
    student_id, subject, grade, topic_title, chapter_number,
    total_questions, correct_answers, score_percent,
    time_taken_seconds, score, is_completed, completed_at,
    idempotency_key
  ) VALUES (
    p_student_id, p_subject, p_grade, p_topic, p_chapter,
    v_total, v_correct, v_score_percent,
    p_time, v_xp, true, NOW(),
    p_idempotency_key
  ) RETURNING id INTO v_quiz_session_id;

  -- ─── Second pass: write quiz_responses + history + per-question state ─
  v_q_number := 0;
  FOR r IN SELECT * FROM jsonb_array_elements(p_responses)
  LOOP
    v_q_number := v_q_number + 1;
    v_question_id := (r->>'question_id')::UUID;
    v_selected_displayed := COALESCE(
      (r->>'selected_displayed_index')::INTEGER,
      (r->>'selected_option')::INTEGER
    );

    SELECT shuffle_map, correct_answer_index_snapshot, options_snapshot
      INTO v_shuffle, v_correct_idx_snapshot, v_options_snapshot
      FROM quiz_session_shuffles
     WHERE session_id = p_session_id AND question_id = v_question_id;

    IF v_correct_idx_snapshot IS NULL THEN
      RAISE EXCEPTION
        'session_not_started: quiz_session_shuffles row missing in second pass for session_id=%, question_id=%',
        p_session_id, v_question_id
        USING ERRCODE = 'P0001';
    END IF;

    IF v_shuffle IS NOT NULL
       AND array_length(v_shuffle, 1) = 4
       AND v_selected_displayed IS NOT NULL
       AND v_selected_displayed BETWEEN 0 AND 3 THEN
      v_selected_orig := v_shuffle[v_selected_displayed + 1];
    ELSE
      v_selected_orig := v_selected_displayed;
    END IF;

    SELECT question_text, question_type, topic_id, bloom_level, difficulty,
           subject, chapter_number
      INTO v_q_text, v_q_type, v_q_topic_id, v_q_bloom, v_q_difficulty,
           v_q_subject, v_q_chapter
      FROM question_bank WHERE id = v_question_id;

    IF v_q_topic_id IS NULL THEN
      SELECT ct.id INTO v_q_topic_id
      FROM   public.curriculum_topics ct
      JOIN   public.subjects s ON s.id = ct.subject_id
      WHERE  s.code            = v_q_subject
        AND  ct.grade          = p_grade
        AND  ct.chapter_number = v_q_chapter
        AND  ct.is_active      = true
      ORDER BY ct.display_order ASC
      LIMIT 1;
    END IF;

    v_is_correct := (
      v_selected_orig IS NOT NULL
      AND v_selected_orig = v_correct_idx_snapshot
    );

    IF v_options_snapshot IS NOT NULL
       AND jsonb_typeof(v_options_snapshot) = 'array'
       AND jsonb_array_length(v_options_snapshot) > v_correct_idx_snapshot THEN
      v_correct_option_text := v_options_snapshot ->> v_correct_idx_snapshot;
    ELSE
      v_correct_option_text := NULL;
    END IF;

    -- ─── PART C: SERVER-SIDE error_type classification (deterministic) ──
    v_error_type := NULL;
    IF NOT v_is_correct THEN
      v_prior_mastery := NULL;
      IF v_q_topic_id IS NOT NULL THEN
        SELECT cm.mastery_probability
          INTO v_prior_mastery
          FROM concept_mastery cm
         WHERE cm.student_id = p_student_id
           AND cm.topic_id   = v_q_topic_id;
      END IF;

      IF COALESCE((r->>'time_spent')::INT, 0) < 3            -- CARELESS_FLOOR_SEC (P3 3s/q boundary)
         AND v_prior_mastery IS NOT NULL
         AND v_prior_mastery >= 0.40 THEN                    -- CONCEPTUAL_MASTERY_CUTOFF
        v_error_type := 'careless';
      ELSIF v_prior_mastery IS NULL
         OR v_prior_mastery < 0.40 THEN                      -- CONCEPTUAL_MASTERY_CUTOFF
        v_error_type := 'conceptual';
      ELSE
        v_error_type := 'procedural';
      END IF;
    END IF;

    -- COLUMN-NAME CORRECTION: student_answer_index + time_taken_seconds are the
    -- canonical columns (NOT selected_option / time_spent_seconds — phantom).
    INSERT INTO quiz_responses (
      quiz_session_id, student_id, question_id, student_answer_index,
      is_correct, time_taken_seconds,
      question_number, question_text, question_type,
      shuffle_map, error_type
    ) VALUES (
      v_quiz_session_id, p_student_id, v_question_id, v_selected_displayed,
      v_is_correct, COALESCE((r->>'time_spent')::INTEGER, 0),
      v_q_number, v_q_text, v_q_type,
      v_shuffle, v_error_type
    ) ON CONFLICT DO NOTHING;

    IF v_q_topic_id IS NOT NULL THEN
      BEGIN
        PERFORM update_learner_state_post_quiz(
          p_student_id,
          v_q_topic_id,
          v_is_correct,
          v_q_bloom,
          v_error_type,                                      -- PART C: COMPUTED value
          COALESCE((r->>'time_spent')::INT, 0) * 1000,
          v_q_difficulty
        );
      EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'submit_quiz_results_v2: update_learner_state_post_quiz failed for student=% topic=% (non-fatal): %',
          p_student_id, v_q_topic_id, SQLERRM;
      END;
    END IF;

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

    v_review_questions := v_review_questions || jsonb_build_array(
      jsonb_build_object(
        'question_id', v_question_id,
        'is_correct', v_is_correct,
        'selected_displayed_index', v_selected_displayed,
        'selected_original_index', v_selected_orig,
        'correct_original_index', v_correct_idx_snapshot,
        'correct_option_text', v_correct_option_text,
        'shuffle_map', to_jsonb(v_shuffle)
      )
    );
  END LOOP;

  -- P4: atomic XP + profile update.
  PERFORM atomic_quiz_profile_update(
    p_student_id, p_subject, v_xp, v_total, v_correct, p_time, v_quiz_session_id
  );

  -- CME: best-effort post-quiz action (error-isolated).
  BEGIN
    SELECT ca.action_type, ca.concept_id, ca.reason
      INTO v_cme_action, v_cme_concept_id, v_cme_reason
      FROM compute_post_quiz_action(p_student_id, p_subject, p_grade) ca;

    UPDATE quiz_sessions
       SET cme_next_action = v_cme_action,
           cme_next_concept_id = v_cme_concept_id,
           cme_reason = v_cme_reason
     WHERE id = v_quiz_session_id;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN jsonb_build_object(
    'total', v_total,
    'correct', v_correct,
    'score_percent', v_score_percent,
    'xp_earned', v_xp,
    'session_id', v_quiz_session_id,
    'flagged', v_flagged,
    'idempotent_replay', false,
    'cme_next_action', v_cme_action,
    'cme_next_concept_id', v_cme_concept_id,
    'cme_reason', v_cme_reason,
    'questions', v_review_questions
  );
END;
$$;

-- Fix Issue 12: RAG similarity floor vs quality gate
CREATE OR REPLACE FUNCTION "public"."match_rag_chunks_ncert"("query_text" "text", "p_subject_code" "text", "p_grade" "text", "match_count" integer DEFAULT 10, "p_chapter_number" integer DEFAULT NULL::integer, "p_chapter_title" "text" DEFAULT NULL::"text", "p_concept" "text" DEFAULT NULL::"text", "p_content_type" "text" DEFAULT NULL::"text", "p_quality_score_gate" double precision DEFAULT 0.4, "p_min_similarity" double precision DEFAULT 0.5, "query_embedding" "public"."vector" DEFAULT NULL::"public"."vector") RETURNS TABLE("id" "uuid", "content" "text", "chapter_title" "text", "topic" "text", "concept" "text", "similarity" double precision, "content_type" "text", "media_url" "text", "media_type" "text", "media_description" "text", "question_text" "text", "answer_text" "text", "question_type" "text", "marks_expected" integer, "bloom_level" "text", "ncert_exercise" "text", "page_number" integer, "chapter_number" integer, "source" "text")
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
DECLARE
  v_grade        TEXT;
  v_query        tsquery;
  v_count        INTEGER;
  v_words        TEXT[];
  v_k CONSTANT   INTEGER := 60;
  v_fetch_count  INTEGER;
BEGIN
  v_grade := CASE
    WHEN p_grade ~ '^\d+$' THEN p_grade
    WHEN p_grade ILIKE 'grade%' THEN regexp_replace(p_grade, '[^0-9]', '', 'g')
    ELSE p_grade
  END;

  v_query := plainto_tsquery('english', query_text);
  v_fetch_count := GREATEST(match_count * 4, 60);

  IF query_embedding IS NOT NULL THEN
    RETURN QUERY
    WITH vec AS (
      SELECT
        c.id, c.chunk_text, c.chapter_title, c.topic, c.concept,
        c.content_type, c.media_url, c.media_type, c.media_description,
        c.question_text, c.answer_text, c.question_type, c.marks_expected,
        c.bloom_level, c.ncert_exercise, c.page_number, c.chapter_number, c.source,
        ROW_NUMBER() OVER (ORDER BY c.embedding <=> query_embedding) AS rank_vec
      FROM rag_content_chunks c
      WHERE c.is_active = TRUE
        AND c.embedding IS NOT NULL
        AND c.subject_code = p_subject_code
        AND c.grade_short  = v_grade
        AND c.source       = 'ncert_2025'
        AND (c.quality_score IS NULL OR c.quality_score >= p_quality_score_gate)
        AND (p_chapter_number IS NULL OR c.chapter_number = p_chapter_number)
        AND (p_chapter_title  IS NULL OR c.chapter_title ILIKE '%' || p_chapter_title || '%')
        AND (p_concept        IS NULL OR c.concept = p_concept)
        AND (p_content_type   IS NULL OR c.content_type = p_content_type)
        AND 1 - (c.embedding <=> query_embedding) >= p_min_similarity
      ORDER BY c.embedding <=> query_embedding
      LIMIT v_fetch_count
    ),
    fts AS (
      SELECT
        c.id, c.chunk_text, c.chapter_title, c.topic, c.concept,
        c.content_type, c.media_url, c.media_type, c.media_description,
        c.question_text, c.answer_text, c.question_type, c.marks_expected,
        c.bloom_level, c.ncert_exercise, c.page_number, c.chapter_number, c.source,
        ROW_NUMBER() OVER (ORDER BY ts_rank(c.search_vector, v_query) DESC) AS rank_fts
      FROM rag_content_chunks c
      WHERE c.is_active = TRUE
        AND c.subject_code = p_subject_code
        AND c.grade_short  = v_grade
        AND c.source       = 'ncert_2025'
        AND c.search_vector @@ v_query
        AND (c.quality_score IS NULL OR c.quality_score >= p_quality_score_gate)
        AND (p_chapter_number IS NULL OR c.chapter_number = p_chapter_number)
        AND (p_chapter_title  IS NULL OR c.chapter_title ILIKE '%' || p_chapter_title || '%')
        AND (p_concept        IS NULL OR c.concept = p_concept)
        AND (p_content_type   IS NULL OR c.content_type = p_content_type)
      ORDER BY ts_rank(c.search_vector, v_query) DESC
      LIMIT v_fetch_count
    ),
    fused AS (
      SELECT
        COALESCE(v.id, f.id)                                 AS id,
        COALESCE(v.chunk_text, f.chunk_text)                 AS content,
        COALESCE(v.chapter_title, f.chapter_title)           AS chapter_title,
        COALESCE(v.topic, f.topic)                           AS topic,
        COALESCE(v.concept, f.concept)                       AS concept,
        COALESCE(v.content_type, f.content_type)             AS content_type,
        COALESCE(v.media_url, f.media_url)                   AS media_url,
        COALESCE(v.media_type, f.media_type)                 AS media_type,
        COALESCE(v.media_description, f.media_description)   AS media_description,
        COALESCE(v.question_text, f.question_text)           AS question_text,
        COALESCE(v.answer_text, f.answer_text)               AS answer_text,
        COALESCE(v.question_type, f.question_type)           AS question_type,
        COALESCE(v.marks_expected, f.marks_expected)         AS marks_expected,
        COALESCE(v.bloom_level, f.bloom_level)               AS bloom_level,
        COALESCE(v.ncert_exercise, f.ncert_exercise)         AS ncert_exercise,
        COALESCE(v.page_number, f.page_number)               AS page_number,
        COALESCE(v.chapter_number, f.chapter_number)         AS chapter_number,
        COALESCE(v.source, f.source)                         AS source,
        (
          COALESCE(1.0 / (v_k + v.rank_vec), 0)
          + COALESCE(1.0 / (v_k + f.rank_fts), 0)
        )::FLOAT                                             AS rrf_score
      FROM vec v
      FULL OUTER JOIN fts f ON v.id = f.id
    )
    SELECT
      fused.id, fused.content, fused.chapter_title, fused.topic, fused.concept,
      fused.rrf_score AS similarity,
      fused.content_type, fused.media_url, fused.media_type, fused.media_description,
      fused.question_text, fused.answer_text, fused.question_type, fused.marks_expected,
      fused.bloom_level, fused.ncert_exercise, fused.page_number, fused.chapter_number, fused.source
    FROM fused
    ORDER BY fused.rrf_score DESC
    LIMIT match_count;

    GET DIAGNOSTICS v_count = ROW_COUNT;
    IF v_count > 0 THEN RETURN; END IF;
  END IF;

  RETURN QUERY
  SELECT
    c.id, c.chunk_text, c.chapter_title, c.topic, c.concept,
    ts_rank(c.search_vector, v_query)::FLOAT,
    c.content_type, c.media_url, c.media_type, c.media_description,
    c.question_text, c.answer_text, c.question_type, c.marks_expected,
    c.bloom_level, c.ncert_exercise, c.page_number, c.chapter_number, c.source
  FROM rag_content_chunks c
  WHERE c.is_active = TRUE
    AND c.subject_code = p_subject_code
    AND c.grade_short  = v_grade
    AND c.source       = 'ncert_2025'
    AND c.search_vector @@ v_query
    AND (c.quality_score IS NULL OR c.quality_score >= p_quality_score_gate)
    AND (p_chapter_number IS NULL OR c.chapter_number = p_chapter_number)
    AND (p_chapter_title  IS NULL OR c.chapter_title ILIKE '%' || p_chapter_title || '%')
    AND (p_concept        IS NULL OR c.concept = p_concept)
    AND (p_content_type   IS NULL OR c.content_type = p_content_type)
  ORDER BY ts_rank(c.search_vector, v_query) DESC
  LIMIT match_count;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count > 0 THEN RETURN; END IF;

  v_words := string_to_array(lower(query_text), ' ');
  RETURN QUERY
  SELECT
    c.id, c.chunk_text, c.chapter_title, c.topic, c.concept,
    0.3::FLOAT, c.content_type, c.media_url, c.media_type, c.media_description,
    c.question_text, c.answer_text, c.question_type, c.marks_expected,
    c.bloom_level, c.ncert_exercise, c.page_number, c.chapter_number, c.source
  FROM rag_content_chunks c
  WHERE c.is_active = TRUE
    AND c.subject_code = p_subject_code
    AND c.grade_short  = v_grade
    AND c.source       = 'ncert_2025'
    AND (c.quality_score IS NULL OR c.quality_score >= p_quality_score_gate)
    AND (p_chapter_number IS NULL OR c.chapter_number = p_chapter_number)
    AND (p_chapter_title  IS NULL OR c.chapter_title ILIKE '%' || p_chapter_title || '%')
    AND (
      lower(c.chunk_text) LIKE '%' || COALESCE(v_words[1],'') || '%'
      OR (array_length(v_words, 1) >= 2 AND lower(c.chunk_text) LIKE '%' || v_words[2] || '%')
      OR lower(COALESCE(c.topic,''))   LIKE '%' || COALESCE(v_words[1],'') || '%'
      OR lower(COALESCE(c.concept,'')) LIKE '%' || COALESCE(v_words[1],'') || '%'
    )
  LIMIT match_count;
END;
$_$;

COMMIT;
