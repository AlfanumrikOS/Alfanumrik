-- Migration: 20260805100200_submit_quiz_v2_persist_hint_level.sql
-- Purpose: Foxy North-Star Phase 0 item F8 (server contract, step 2) —
--   ONE additive change to public.submit_quiz_results_v2: each element of
--   p_responses MAY carry "hint_level" (0=none .. 3); when present and valid
--   it is persisted into the new quiz_responses.hint_level column (added by
--   companion migration 20260805100100_quiz_responses_hint_level.sql).
--
-- Source body: copied byte-for-byte from the NEWEST prior definition in
--   20260729120001_fix_quiz_rpc_defects.sql (verified newest via grep across
--   supabase/migrations for `CREATE OR REPLACE FUNCTION public.submit_quiz_
--   results_v2` on 2026-08-05 — the only later-timestamped hits are under
--   _legacy/, which the CLI never applies). The ONLY deltas are:
--     (1) DECLARE adds v_hint_level SMALLINT;
--     (2) the second-pass loop reads (r->>'hint_level')::smallint,
--         normalized to NULL when absent/out-of-range so a malformed client
--         value can NEVER 23514-abort the whole submission transaction;
--     (3) the quiz_responses INSERT gains the hint_level column/value;
--     (4) the function COMMENT is extended.
--
-- Invariants untouched (verified by diff against the 20260729120001 body):
--   P1 score formula, P2 XP values + daily-cap read-back, P3 all three
--   anti-cheat checks, P4 single-RPC atomicity (same transaction, same
--   atomic_quiz_profile_update PERFORM), P5 grade stays TEXT. Signature
--   unchanged — safe CREATE OR REPLACE.

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
  -- 20260729 fix cluster (F1/F7/F5): served-question count + daily-cap propagation
  v_served_count INT;           -- F1/F7: rows actually served for this session
  v_xp_effective INT;           -- F5: CAPPED xp read back from the ledger
  v_xp_capped BOOLEAN := false; -- F5: surfaced so the client cap banner can render
  -- 20260805 Foxy North-Star F8: per-response hint tier (NULL when absent/invalid)
  v_hint_level SMALLINT;
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
      'xp_capped', false,
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

  -- P3 Check 3 (FIX F1+F7, 2026-07-29): response count must equal the number
  -- of questions actually SERVED for this session.
  --
  -- The old expression compared against
  --   (SELECT array_length(question_ids, 1) FROM quiz_sessions WHERE id = p_session_id)
  -- which was doubly broken:
  --   (a) quiz_sessions has NO question_ids column anywhere in the schema
  --       (grep across the entire migration chain confirms zero hits outside
  --       this one dead reference) -> would raise 42703, AND
  --   (b) even if the column existed, quiz_sessions.id is a BRAND NEW id
  --       minted a few lines below in *this* function
  --       (`INSERT INTO quiz_sessions (...) RETURNING id INTO v_quiz_session_id`)
  --       -- it has no relationship to p_session_id, so the subquery could
  --       never match a row. The COALESCE(..., v_total) fallback then made
  --       the check compare v_total to itself: an unconditional pass
  --       (tautology), silently defeating anti-cheat Check 3 on every call.
  --
  -- p_session_id is actually the id returned by start_quiz_session(), which
  -- is the SAME id start_quiz_session used as quiz_session_shuffles.session_id
  -- when it wrote one row per served question (baseline ~7167-7174). This
  -- function already queries quiz_session_shuffles by session_id = p_session_id
  -- in both the first and second pass above/below, confirming that table IS
  -- correctly keyed by p_session_id. COUNT(*) against it is therefore the
  -- correct "how many questions were served" source.
  --
  -- Fail-closed: an unexpected 0 count (should be unreachable here, since the
  -- first-pass loop above already RAISEs if any response's shuffle row is
  -- missing) still flags rather than silently passing.
  SELECT COUNT(*) INTO v_served_count
    FROM quiz_session_shuffles
   WHERE session_id = p_session_id;

  IF v_served_count = 0 OR jsonb_array_length(p_responses) <> v_served_count THEN
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

    -- F8 (2026-08-05, Foxy North-Star): each response MAY carry "hint_level"
    -- (0 = no hint .. 3). Normalize defensively via a regex guard (no
    -- per-row subtransaction): absent, non-numeric, or out-of-range values
    -- become NULL so a malformed client payload can never violate
    -- quiz_responses_hint_level_check and abort the whole submission
    -- transaction. hint_level is telemetry — it feeds NO scoring/XP/anti-cheat
    -- decision in this function (P1/P2/P3 untouched).
    v_hint_level := CASE
      WHEN (r->>'hint_level') ~ '^[0-3]$' THEN (r->>'hint_level')::SMALLINT
      ELSE NULL
    END;

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
    -- F8 (2026-08-05): hint_level added — the ONLY change to this INSERT.
    INSERT INTO quiz_responses (
      quiz_session_id, student_id, question_id, student_answer_index,
      is_correct, time_taken_seconds,
      question_number, question_text, question_type,
      shuffle_map, error_type, hint_level
    ) VALUES (
      v_quiz_session_id, p_student_id, v_question_id, v_selected_displayed,
      v_is_correct, COALESCE((r->>'time_spent')::INTEGER, 0),
      v_q_number, v_q_text, v_q_type,
      v_shuffle, v_error_type, v_hint_level
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

  -- FIX F5 (2026-07-29): the 7-arg atomic_quiz_profile_update call above
  -- RETURNS VOID, so its internal P2 daily-XP-cap clamp (computed from the
  -- xp_transactions ledger) never reached this function's return value --
  -- v2 was returning the raw UNCAPPED v_xp as xp_earned (and storing it
  -- uncapped in quiz_sessions.score) and never surfacing xp_capped, so the
  -- client-side cap banner could never render on this path.
  --
  -- Read the CAPPED amount back from the exact ledger row that call just
  -- wrote, keyed by the SAME reference_id it derives internally
  -- ('quiz_' || session_id, where "session_id" there is v_quiz_session_id --
  -- confirmed by reading the 7-arg overload's own body). This mirrors the
  -- identical read-back pattern already used by the TS-side fallback in
  -- packages/lib/src/supabase.ts (submitQuizResults L2 fallback), so this is
  -- a proven-safe technique in this codebase, not a new invention. No ledger
  -- row exists when the cap was already fully reached before this call (the
  -- 7-arg overload skips its INSERT when the clamped award is 0) -- that
  -- case correctly resolves to effective XP = 0 below.
  SELECT amount INTO v_xp_effective
    FROM xp_transactions
   WHERE reference_id = 'quiz_' || v_quiz_session_id::text
   LIMIT 1;

  v_xp_effective := COALESCE(v_xp_effective, 0);
  v_xp_capped := v_xp_effective < v_xp;
  v_xp := v_xp_effective;

  -- Persist the CAPPED amount into quiz_sessions.score. The row above was
  -- inserted with the pre-cap value because the cap is only knowable after
  -- the ledger write completes (which needs v_quiz_session_id, which the
  -- INSERT itself produces) -- so this UPDATE is the correction pass.
  UPDATE quiz_sessions SET score = v_xp WHERE id = v_quiz_session_id;

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
    'xp_capped', v_xp_capped,
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

COMMENT ON FUNCTION public.submit_quiz_results_v2(UUID, UUID, TEXT, TEXT, TEXT, INTEGER, JSONB, INTEGER, UUID) IS
  'v2 server-shuffle quiz submission RPC. P1/P2/P3/P4 formulas unchanged. '
  'FIX 2026-07-29 (forensic audit F1/F7/F5): Anti-Cheat Check 3 now counts '
  'served questions from quiz_session_shuffles (correctly keyed by '
  'p_session_id) instead of a nonexistent quiz_sessions.question_ids column '
  'joined on the wrong id; the daily XP cap (enforced inside the 7-arg '
  'atomic_quiz_profile_update ledger writer) is now read back and reflected '
  'in both quiz_sessions.score and the returned xp_earned/xp_capped fields. '
  'ADDITIVE 2026-08-05 (Foxy North-Star F8): each p_responses element MAY '
  'carry "hint_level" (0-3); valid values persist to quiz_responses.hint_level '
  '(telemetry only — no scoring/XP/anti-cheat input), invalid/absent -> NULL.';
