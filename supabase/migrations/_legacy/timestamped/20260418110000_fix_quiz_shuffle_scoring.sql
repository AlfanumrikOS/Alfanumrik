-- Migration: 20260418110000_fix_quiz_shuffle_scoring.sql
-- Purpose: Fix P1 scoring-accuracy bug where submit_quiz_results() compared
--          the SHUFFLED display index sent by the client to the ORIGINAL
--          pre-shuffle index on question_bank, silently miscounting every
--          shuffled quiz. Canonical scoring path (Path B): client ships the
--          shuffle_map alongside selected_option; the RPC translates to
--          original-index space before the equality check. This preserves
--          server authority over anti-cheat (P3) because the server still
--          owns the correct_answer_index lookup.
--
-- Context:
--   - Migration 20260408000005 is the previous submit_quiz_results definition.
--   - Client fix shipped in commits aa4ed51 + a641a90 corrected the UI banner
--     and the client-computed is_correct flag, but the authoritative score
--     still came from this RPC, so students continued to see wrong scores on
--     the final scorecard and the downstream mastery/XP/Bloom writes stayed
--     corrupted.
--
-- Changes in this migration (atomic, idempotent):
--   1. ADD COLUMN shuffle_map INTEGER[] to quiz_responses  — audit trail for
--      super-admin ai-issues forensic review. Nullable; non-shuffled surfaces
--      (mobile, diagnostic, pyq, learn) leave it NULL.
--   2. REPLACE submit_quiz_results() with an implementation that:
--      a) Accepts a per-response `shuffle_map` JSONB array. When the array is
--         4 integers and `selected_option` is 0..3, translate to original
--         space via shuffle_map[selected_option]. All other shapes fall back
--         to treating selected_option as already-original — matches the
--         tolerance in src/lib/quiz-scoring.ts::resolveOriginalIndex.
--      b) Compares the original-space index to question_bank.correct_answer_index
--         and writes the resolved is_correct onto quiz_responses.
--      c) Stores both selected_option (shuffled, as the student clicked it)
--         AND shuffle_map (for post-hoc forensic replay) on each response row.
--      d) Emits a canary ops_events row (category='grounding.scoring',
--         severity='warning') whenever the client-asserted is_correct in the
--         payload disagrees with the server-computed is_correct. Post-fix
--         this should never fire in production; if it does it's a regression.
--   3. Preserves ALL other behaviour of the previous RPC:
--        - P1 score formula: ROUND((v_correct::NUMERIC / v_total) * 100)
--        - P2 XP formula + daily-cap (cap enforced in atomic_quiz_profile_update)
--        - P3 anti-cheat: all 3 checks (avg time, same-answer distribution,
--          response-count vs jsonb_array_length parity)
--        - P4 atomic submission via atomic_quiz_profile_update() with the
--          v_session_id 7th arg (added in 20260408000005 for xp dedup)
--        - user_question_history upsert for non-repetition tracking
--        - update_learner_state_post_quiz per-question BKT/Bloom/retention
--        - compute_post_quiz_action best-effort CME enrichment
--        - Same RPC signature and return shape — no client call-site change
--          required beyond the optional payload field.
--
-- Historical backfill: NONE (Option 2). Pre-migration quiz_sessions carry
-- miscounts that cannot be recomputed because shuffle maps were never stored
-- before this migration. The migration commit timestamp is the "scoring
-- integrity epoch" — see docs/runbooks/grounding/scoring-integrity-epoch.md.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS; CREATE OR REPLACE FUNCTION. Safe to
-- re-apply.

-- ──────────────────────────────────────────────────────────────────────────
-- 1. Audit column on quiz_responses
-- ──────────────────────────────────────────────────────────────────────────

ALTER TABLE quiz_responses
  ADD COLUMN IF NOT EXISTS shuffle_map INTEGER[];

COMMENT ON COLUMN quiz_responses.shuffle_map IS
  'Permutation applied to this question''s MCQ options at display time, or NULL '
  'for non-shuffled surfaces (mobile, diagnostic, mock-exam, pyq, learn). '
  'Used with selected_option to reconstruct what the student actually saw and '
  'clicked. Added by migration 20260418110000 as part of the P1 shuffle/index '
  'mismatch fix — the "scoring integrity epoch". Pre-epoch rows are NULL.';

-- ──────────────────────────────────────────────────────────────────────────
-- 2. submit_quiz_results — full replacement
-- ──────────────────────────────────────────────────────────────────────────

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
-- on behalf of the authenticated student. The caller is verified via
-- p_student_id ownership checks in the downstream RPC and the API route's
-- authorizeRequest().
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
  v_q_bloom TEXT;        -- bloom_level from question_bank
  v_q_difficulty INT;    -- difficulty from question_bank
  -- P3 Check 2: answer distribution tracking (on the SHUFFLED clicks, matching
  -- the client-side guard — "always picks B" equally suspicious whether B is
  -- original or shuffled).
  v_answer_counts    INT[]   := ARRAY[0,0,0,0];
  v_max_same_answer  INT     := 0;
  -- CME action variables
  v_cme_action TEXT;
  v_cme_concept_id UUID;
  v_cme_reason TEXT;
BEGIN
  -- ─ First pass: count + score in original-index space ─
  FOR r IN SELECT * FROM jsonb_array_elements(p_responses)
  LOOP
    v_total := v_total + 1;
    v_question_id := (r->>'question_id')::UUID;
    v_selected := (r->>'selected_option')::INTEGER;
    v_shuffle := r->'shuffle_map';

    -- Translate v_selected from SHUFFLED display space to ORIGINAL space.
    -- Must mirror src/lib/quiz-scoring.ts::resolveOriginalIndex exactly.
    v_shuffle_valid := (
      v_shuffle IS NOT NULL
      AND jsonb_typeof(v_shuffle) = 'array'
      AND jsonb_array_length(v_shuffle) = 4
      AND v_selected IS NOT NULL
      AND v_selected BETWEEN 0 AND 3
    );
    IF v_shuffle_valid THEN
      -- Defensive: every element must be a 0..3 integer, otherwise fall back.
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
        -- array indexing is 1-based in PL/pgSQL
        v_selected_orig := v_shuffle_arr[v_selected + 1];
      ELSE
        v_selected_orig := v_selected;
      END IF;
    ELSE
      v_selected_orig := v_selected;
    END IF;

    -- Server authority: the correct index always comes from question_bank.
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

    -- P3 Check 2: distribution is tracked on the shuffled click, matching
    -- the client's anti-pattern detection (an attacker clicking "always B"
    -- is still clicking index 1 regardless of shuffle).
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

  -- P3 Check 1: avg time < 3s -> flag, xp = 0
  v_avg_time := CASE WHEN v_total > 0 THEN p_time::NUMERIC / v_total ELSE 0 END;
  IF v_avg_time < 3.0 AND v_total > 0 THEN
    v_flagged := true;
  END IF;

  -- P3 Check 2: not all same answer if >3 questions
  IF v_total > 3 THEN
    v_max_same_answer := GREATEST(
      v_answer_counts[1], v_answer_counts[2],
      v_answer_counts[3], v_answer_counts[4]
    );
    IF v_max_same_answer = v_total THEN
      v_flagged := true;
    END IF;
  END IF;

  -- P3 Check 3: response count matches jsonb_array_length (dedup collapse detect)
  IF jsonb_array_length(p_responses) != v_total THEN
    v_flagged := true;
  END IF;

  -- P1: score_percent = ROUND((v_correct / v_total) * 100)
  v_score_percent := ROUND((v_correct::NUMERIC / v_total) * 100);

  -- P2: base + high_score_bonus + perfect_bonus (gated by P3 flag)
  IF v_flagged THEN
    v_xp := 0;
  ELSE
    v_xp := v_correct * 10;
    IF v_score_percent >= 80 THEN v_xp := v_xp + 20; END IF;
    IF v_score_percent = 100 THEN v_xp := v_xp + 50; END IF;
  END IF;

  -- Insert the session row.
  INSERT INTO quiz_sessions (
    student_id, subject, grade, topic_title, chapter_number,
    total_questions, correct_answers, score_percent,
    time_taken_seconds, score, is_completed, completed_at
  ) VALUES (
    p_student_id, p_subject, p_grade, p_topic, p_chapter,
    v_total, v_correct, v_score_percent,
    p_time, v_xp, true, NOW()
  ) RETURNING id INTO v_session_id;

  -- ─ Second pass: write quiz_responses + history + per-question learner state ─
  v_q_number := 0;
  FOR r IN SELECT * FROM jsonb_array_elements(p_responses)
  LOOP
    v_q_number := v_q_number + 1;
    v_question_id := (r->>'question_id')::UUID;
    v_selected := (r->>'selected_option')::INTEGER;
    v_shuffle := r->'shuffle_map';

    -- Re-derive v_selected_orig (same algorithm as pass 1).
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
        v_shuffle_arr := NULL;  -- Don't audit-trail a map we rejected.
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

    -- Canary: if the client asserted an is_correct value, verify it matches
    -- the server computation. A mismatch means the client and server
    -- disagreed on coordinate spaces — pre-fix this happened constantly;
    -- post-fix it should never happen. Silent production integration test.
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
          -- Canary must NEVER break a quiz submission. ops_events writes
          -- are best-effort; an observability failure cannot cost a student
          -- their XP.
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

    -- Unified learner state update (unchanged from 20260408000005).
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

  -- P4: atomic XP + profile update. v_session_id is the 7th argument so XP
  -- writes are idempotent via xp_transactions.reference_id.
  PERFORM atomic_quiz_profile_update(
    p_student_id, p_subject, v_xp, v_total, v_correct, p_time, v_session_id
  );

  -- CME: best-effort post-quiz action recommendation (error-isolated).
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

COMMENT ON FUNCTION submit_quiz_results IS
  'Submits quiz results with server-side verification, anti-cheat (all 3 P3 '
  'checks), XP calculation, and unified learner state update. '
  'P1 (migration 20260418110000): selected_option arrives in SHUFFLED display '
  'space; shuffle_map in the payload is used to translate back to original '
  'index space before comparing with question_bank.correct_answer_index. '
  'Algorithm mirrors src/lib/quiz-scoring.ts::resolveOriginalIndex. '
  'Canary: emits ops_events (category=grounding.scoring, severity=warning) '
  'when the client-asserted is_correct disagrees with the server computation. '
  'P3 checks: (1) avg time >= 3s, (2) not all same answer if >3 questions, '
  '(3) response count equals jsonb_array_length. '
  'P4: atomic via atomic_quiz_profile_update() with v_session_id for xp dedup.';

-- End of migration: 20260418110000_fix_quiz_shuffle_scoring.sql
-- Functions replaced: submit_quiz_results
-- Columns added:      quiz_responses.shuffle_map INTEGER[]
