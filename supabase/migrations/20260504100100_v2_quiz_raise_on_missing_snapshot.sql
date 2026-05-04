-- Migration: 20260504100100_v2_quiz_raise_on_missing_snapshot.sql
-- Purpose:    Marking-Authenticity Phase 1.2 — close the silent-zero-score
--             failure mode in submit_quiz_results_v2 when a session has no
--             quiz_session_shuffles row (i.e., the client never invoked
--             start_quiz_session). Today the function falls through and treats
--             selected_displayed_index as already-original, then scores against
--             a NULL correct_answer_index_snapshot — which always evaluates to
--             FALSE — silently zeroing every answer.
--
-- One-line behavior change:
--   When v_correct_idx_snapshot IS NULL during the first pass, RAISE EXCEPTION
--   with code P0001 instead of silently scoring zero.
--
-- Everything else is byte-identical to the original definition in
-- _legacy/timestamped/20260428160000_quiz_session_shuffles.sql:320-624 — same
-- ownership check, same P3 anti-cheat checks, same P1 score formula, same P2
-- XP formula, same P4 atomic_quiz_profile_update call, same return shape:
--   { total, correct, score_percent, xp_earned, session_id, flagged,
--     cme_next_action, cme_next_concept_id, cme_reason, questions[] }
--
-- Why P0001:
--   PostgreSQL standard "raise_exception" SQLSTATE used elsewhere in this
--   codebase. The Next.js submit handler can pattern-match the message prefix
--   `session_not_started:` to translate this into HTTP 409 + a UX hint
--   ("Please restart your quiz") instead of HTTP 500.
--
-- Backwards compatibility:
--   - Sessions started via start_quiz_session() are unaffected (snapshot row
--     always exists).
--   - Mobile + legacy paths still call submit_quiz_results (v1), which is
--     untouched.
--   - The atomic_quiz_profile_update call is reached only after the per-row
--     RAISE has been cleared, so a partial-write scenario is impossible: the
--     function exits before the INSERT into quiz_sessions. P4 (atomicity) is
--     preserved end-to-end.
--
-- Idempotent: CREATE OR REPLACE FUNCTION. Safe to re-apply. The function
-- signature (UUID, UUID, TEXT, TEXT, TEXT, INTEGER, JSONB, INTEGER) is
-- identical to the previous version — no callers need to change.
--
-- Reversible: re-apply migration 20260428160000 from _legacy/timestamped to
-- restore the prior silent-zero behavior. Re-instating that bug is a P1
-- regression so rollback should only be done with assessment + ai-engineer
-- approval and an incident ticket.

CREATE OR REPLACE FUNCTION public.submit_quiz_results_v2(
  p_session_id UUID,
  p_student_id UUID,
  p_subject TEXT,
  p_grade TEXT,
  p_topic TEXT DEFAULT NULL,
  p_chapter INTEGER DEFAULT NULL,
  p_responses JSONB DEFAULT '[]',
  p_time INTEGER DEFAULT 0
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
  v_q_id UUID;                       -- Phase 1.2: renamed from v_question_id for the RAISE message format token
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
  v_answer_counts INT[] := ARRAY[0,0,0,0];
  v_max_same_answer INT := 0;
  v_review_questions JSONB := '[]'::jsonb;
  v_correct_option_text TEXT;
  v_cme_action TEXT;
  v_cme_concept_id UUID;
  v_cme_reason TEXT;
BEGIN
  -- Ownership check (same pattern as start_quiz_session).
  IF auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM students
    WHERE id = p_student_id AND auth_user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Access denied: caller does not own student %', p_student_id;
  END IF;

  -- Validate session ownership: every shuffle row for this session must
  -- belong to the caller's student.
  -- Phase 1.2 note: the original "fall-through if no shuffle rows" comment
  -- has been removed because that path is now an explicit RAISE below.
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
    -- v2 contract: client sends `selected_displayed_index`, NOT
    -- `selected_option`. Accept both keys for resilience while the
    -- web client transitions; mobile + legacy paths still call v1.
    v_selected_displayed := COALESCE(
      (r->>'selected_displayed_index')::INTEGER,
      (r->>'selected_option')::INTEGER
    );

    -- Look up snapshot. service_role-context calls bypass RLS, so this
    -- read works inside the SECURITY DEFINER function.
    SELECT shuffle_map, correct_answer_index_snapshot
      INTO v_shuffle, v_correct_idx_snapshot
      FROM quiz_session_shuffles
     WHERE session_id = p_session_id AND question_id = v_q_id;

    -- ─── Phase 1.2 (THIS migration): the only behavior change ───────────
    -- The legacy function fell through here when v_correct_idx_snapshot was
    -- NULL, treating selected_displayed_index as already-original and
    -- always scoring is_correct=false (because v_correct_idx_snapshot was
    -- still NULL when the comparison ran). That silently zero-scored every
    -- answer in any session that skipped start_quiz_session.
    --
    -- New behavior: explicit RAISE so the API layer can convert to a
    -- 409 with a "restart your quiz" UX hint instead of a confused "you
    -- got 0 right" result screen. SQLSTATE P0001 lets the Next.js handler
    -- pattern-match by code rather than by message text.
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
      -- 1-based PL/pgSQL array indexing.
      v_selected_orig := v_shuffle[v_selected_displayed + 1];
    ELSE
      -- Snapshot exists but shuffle map is malformed OR client sent an
      -- out-of-range index. Treat selected as already-original (matches
      -- v1 fallback semantics for malformed-shuffle case). v_correct_idx_snapshot
      -- is guaranteed non-NULL by the check above.
      v_selected_orig := v_selected_displayed;
    END IF;

    v_is_correct := (
      v_selected_orig IS NOT NULL
      AND v_selected_orig = v_correct_idx_snapshot
    );

    IF v_is_correct THEN
      v_correct := v_correct + 1;
    END IF;

    -- P3 Check 2: distribution tracked on the SHUFFLED click (matches v1).
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
    IF v_max_same_answer = v_total THEN
      v_flagged := true;
    END IF;
  END IF;

  -- P3 Check 3: response count matches jsonb_array_length.
  IF jsonb_array_length(p_responses) <> v_total THEN
    v_flagged := true;
  END IF;

  -- P1: score_percent = ROUND((v_correct / v_total) * 100). Identical to v1.
  v_score_percent := ROUND((v_correct::NUMERIC / v_total) * 100);

  -- P2: base + high_score_bonus + perfect_bonus, gated by P3 flag.
  IF v_flagged THEN
    v_xp := 0;
  ELSE
    v_xp := v_correct * 10;
    IF v_score_percent >= 80 THEN v_xp := v_xp + 20; END IF;
    IF v_score_percent = 100 THEN v_xp := v_xp + 50; END IF;
  END IF;

  -- Insert quiz_sessions row.
  INSERT INTO quiz_sessions (
    student_id, subject, grade, topic_title, chapter_number,
    total_questions, correct_answers, score_percent,
    time_taken_seconds, score, is_completed, completed_at
  ) VALUES (
    p_student_id, p_subject, p_grade, p_topic, p_chapter,
    v_total, v_correct, v_score_percent,
    p_time, v_xp, true, NOW()
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

    -- v_correct_idx_snapshot cannot be NULL here: the first pass would have
    -- raised. Defensive guard kept so future refactors don't reintroduce
    -- the silent-zero bug.
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

    SELECT question_text, question_type, topic_id, bloom_level, difficulty
      INTO v_q_text, v_q_type, v_q_topic_id, v_q_bloom, v_q_difficulty
      FROM question_bank WHERE id = v_question_id;

    v_is_correct := (
      v_selected_orig IS NOT NULL
      AND v_selected_orig = v_correct_idx_snapshot
    );

    -- Resolve correct_option_text from the SNAPSHOT (not live question_bank).
    IF v_options_snapshot IS NOT NULL
       AND jsonb_typeof(v_options_snapshot) = 'array'
       AND jsonb_array_length(v_options_snapshot) > v_correct_idx_snapshot THEN
      v_correct_option_text := v_options_snapshot ->> v_correct_idx_snapshot;
    ELSE
      v_correct_option_text := NULL;
    END IF;

    INSERT INTO quiz_responses (
      quiz_session_id, student_id, question_id, student_answer_index,
      is_correct, time_taken_seconds,
      question_number, question_text, question_type,
      shuffle_map
    ) VALUES (
      v_quiz_session_id, p_student_id, v_question_id, v_selected_displayed,
      v_is_correct, COALESCE((r->>'time_spent')::INTEGER, 0),
      v_q_number, v_q_text, v_q_type,
      v_shuffle
    ) ON CONFLICT DO NOTHING;

    -- Unified learner state update (matches v1).
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

    -- Append to review payload — the v2 contract returns per-question
    -- review data so the client review screen never derives correct
    -- answer text from its own (potentially-stale) options array.
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

  -- P4: atomic XP + profile update via the same RPC v1 uses.
  PERFORM atomic_quiz_profile_update(
    p_student_id, p_subject, v_xp, v_total, v_correct, p_time, v_quiz_session_id
  );

  -- CME: best-effort post-quiz action (error-isolated, matches v1).
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
    'cme_next_action', v_cme_action,
    'cme_next_concept_id', v_cme_concept_id,
    'cme_reason', v_cme_reason,
    -- Per-question review payload — server is the single source of truth
    -- for correct_option_text. QuizResults.tsx must consume this, not
    -- derive from its own options array.
    'questions', v_review_questions
  );
END;
$$;

COMMENT ON FUNCTION public.submit_quiz_results_v2(UUID, UUID, TEXT, TEXT, TEXT, INTEGER, JSONB, INTEGER) IS
  'Marking-Authenticity Phase 1.2 (migration 20260504100100): closes the silent '
  'zero-score bug where a missing quiz_session_shuffles row (i.e., client '
  'submitted without first calling start_quiz_session) would fall through and '
  'score every answer wrong against a NULL snapshot. Now raises P0001 with '
  '''session_not_started:'' prefix so the API layer can return HTTP 409 + UX '
  'hint. All other behavior (P1 score formula, P2 XP rules, P3 anti-cheat, '
  'P4 atomic update, return shape) is byte-identical to the prior definition '
  'in migration 20260428160000.';

-- End of migration: 20260504100100_v2_quiz_raise_on_missing_snapshot.sql
