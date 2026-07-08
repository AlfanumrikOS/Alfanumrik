-- Migration: 20260623000300_submit_quiz_v2_server_classify_error_type.sql
-- Purpose: PART C (mastery-integrity, CEO-approved) — make submit_quiz_results_v2
--          SERVER-CLASSIFY error_type for every WRONG response, store it on the
--          quiz_responses row, and feed the COMPUTED value (never the raw
--          client-supplied r->>'error_type') into update_learner_state_post_quiz
--          so concept_mastery.error_count_* finally moves on graded wrong answers.
--
-- BASE: this re-emits the CURRENT DEPLOYED body of submit_quiz_results_v2 —
--       migration 20260622030000 (resilient per-response PERFORM) — VERBATIM,
--       including:
--         * the 9-arg signature + SECURITY DEFINER + SET search_path = public,
--         * the Phase 2.8 idempotency replay short-circuit,
--         * the P1 score + P2 XP math (BYTE-IDENTICAL),
--         * the P3 anti-cheat flag logic,
--         * the RCA-2026-06-21 runtime topic_id fallback,
--         * the BEGIN/EXCEPTION wrapper around the per-response PERFORM,
--         * the compute_post_quiz_action EXCEPTION wrapper,
--         * the RETURN jsonb shape.
--       (20260623000100 changed update_learner_state_post_quiz, NOT this RPC, so
--        20260622030000 remains the canonical deployed submit body.)
--
-- ─── THE ONLY CHANGES vs 20260622030000 ──────────────────────────────────────
--   (1) DECLARE: add
--         v_error_type     TEXT;     -- the computed bucket for THIS response
--         v_prior_mastery  FLOAT;    -- prior concept mastery, read pre-BKT
--   (2) Inside the second response loop, for each response: AFTER computing
--       v_is_correct and BEFORE the quiz_responses INSERT, derive v_error_type
--       deterministically (server-authoritative). See the classification block.
--   (3) quiz_responses INSERT: add the error_type column = v_error_type.
--   (4) The per-response PERFORM update_learner_state_post_quiz passes
--       v_error_type (the COMPUTED value) in the p_error_type slot — replacing
--       the always-NULL raw (r->>'error_type')::TEXT.
--
-- ─── CLASSIFICATION HEURISTIC (assessment-authoritative, deterministic) ───────
--   Correct answers              -> v_error_type := NULL   (consumer already
--                                   guards: it only increments when NOT correct
--                                   AND p_error_type IS NOT NULL).
--   Wrong answers, in order:
--     careless    -> response time is implausibly fast (< CARELESS_FLOOR_SEC, the
--                    per-question floor; reuses the P3 3s/question anti-cheat
--                    boundary) AND prior concept mastery is NOT low
--                    (v_prior_mastery >= CONCEPTUAL_MASTERY_CUTOFF). Knew it,
--                    rushed, slipped.
--     conceptual  -> prior concept mastery is low
--                    (v_prior_mastery < CONCEPTUAL_MASTERY_CUTOFF). The
--                    "chosen-option maps to a known distractor/misconception tag"
--                    branch in the spec has NO data source on this schema
--                    (question_bank has no per-option misconception map — verified
--                    2026-06-23), so the deterministic low-prior-mastery signal is
--                    the conceptual trigger.
--     procedural  -> default wrong bucket otherwise (knew the concept, normal-paced,
--                    still wrong -> execution/method error).
--
--   Constants (inlined; single source is this RPC):
--     CARELESS_FLOOR_SEC          = 3      (P3 anti-cheat 3s/question boundary)
--     CONCEPTUAL_MASTERY_CUTOFF   = 0.40   (spec "prior mastery_probability < ~0.4";
--                                           also the 'developing' band boundary in
--                                           update_learner_state_post_quiz)
--
--   v_prior_mastery is read from concept_mastery.mastery_probability for
--   (p_student_id, v_q_topic_id) BEFORE this response's BKT update runs. A brand
--   new (never-attempted) concept reads NULL -> treated as low -> conceptual,
--   which is the correct default for a first wrong answer on an unseen concept.
--
-- CANONICAL-MASTERY CONTRACT INTACT: error_count_* still moves ONLY through the
--   graded submit path (this RPC -> update_learner_state_post_quiz). The value is
--   computed SERVER-SIDE from the graded outcome + timing + prior state — never a
--   student self-report. The classification read is non-mutating; the BKT update
--   below is the only writer.
--
-- ─── COLUMN-NAME CORRECTION (REQUIRED — not part of "verbatim") ───────────────
--   The deployed body (20260622030000) writes the per-response quiz_responses row
--   into columns selected_option + time_spent_seconds, and the idempotency-replay
--   block reads qr.selected_option. Verified against PROD on 2026-06-23: those two
--   columns DO NOT EXIST on public.quiz_responses (PostgREST returns 400 for
--   selected_option / time_spent_seconds; the canonical columns are
--   student_answer_index + time_taken_seconds — see the quiz_responses DDL in
--   00000000000000_baseline_from_prod.sql). The per-response INSERT has NO
--   error-isolation around it, so writing into a phantom column throws and aborts
--   the whole second pass — meaning error_type could never be persisted.
--   This migration therefore corrects three column references to the REAL columns:
--     * replay block:  qr.selected_option            -> qr.student_answer_index
--     * INSERT cols:   selected_option               -> student_answer_index
--                      time_spent_seconds            -> time_taken_seconds
--   The JSONB INPUT key (r->>'selected_option') is UNCHANGED — that is the client
--   payload contract, not a table column. This is the minimum change needed for
--   Part C to function; it does NOT touch P1/P2/P3/P4. ⚠️ FLAGGED for assessment +
--   testing review: this also un-breaks per-response quiz_responses persistence
--   that the deployed body could not perform.
--
-- P1 / P2 / P3 / P4: BYTE-IDENTICAL to 20260622030000 (score, XP, anti-cheat,
--   atomic-profile logic unchanged; only the broken column names are corrected).
--   P5: grades remain TEXT.
--
-- Idempotent: DROP FUNCTION IF EXISTS (exact 9-arg signature) + CREATE OR REPLACE.
-- SECURITY DEFINER retained (justified inline). No RLS impact. No schema change
--   here (the column landed in 20260623000200, earlier timestamp, runs first).
-- Owner: architect. Added: 2026-06-23. Reviewers: assessment, ai-engineer, testing, quality.

BEGIN;

DROP FUNCTION IF EXISTS public.submit_quiz_results_v2(
  UUID, UUID, TEXT, TEXT, TEXT, INTEGER, JSONB, INTEGER, UUID
);

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
  -- PART C (20260623000300): server-side error classification
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
  -- If the caller supplied an idempotency key AND a quiz_sessions row with
  -- that (student_id, key) pair already exists, return the cached shape
  -- WITHOUT re-running atomic_quiz_profile_update. The unique partial index
  -- guarantees we either find zero or one row.
  --
  -- We rebuild the per-question review array from quiz_responses +
  -- quiz_session_shuffles so the client can re-render the review screen
  -- exactly as it would have on the original commit.
  IF p_idempotency_key IS NOT NULL THEN
    SELECT id, total_questions, correct_answers, score_percent, score
      INTO v_existing
      FROM quiz_sessions
     WHERE student_id = p_student_id
       AND idempotency_key = p_idempotency_key
     LIMIT 1;

    IF v_existing.id IS NOT NULL THEN
      -- Rebuild the per-question review array. Best-effort: if the
      -- original responses are gone for any reason, return an empty
      -- questions[] — the score/xp shape is still correct.
      SELECT COALESCE(jsonb_agg(
               jsonb_build_object(
                 'question_id', qr.question_id,
                 'is_correct', qr.is_correct,
                 -- COLUMN-NAME CORRECTION (20260623000300): the canonical
                 -- quiz_responses table column is student_answer_index, NOT
                 -- selected_option (verified against prod 2026-06-23 — the column
                 -- selected_option does not exist; the deployed body referenced a
                 -- phantom column). See header note "COLUMN-NAME CORRECTION".
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
        'flagged', false,                -- replay; we don't re-evaluate flags
        'idempotent_replay', true,       -- ← the new contract bit
        'questions', v_review_questions
      );
    END IF;
  END IF;

  -- Validate session ownership: every shuffle row for this session must
  -- belong to the caller's student.
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

    -- Phase 1.2: explicit RAISE on missing snapshot.
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

  -- P1: score_percent = ROUND((v_correct / v_total) * 100). Identical to v1.
  v_score_percent := ROUND((v_correct::NUMERIC / v_total) * 100);

  -- P2: base + high_score_bonus + perfect_bonus, gated by P3 flag.
  IF v_flagged THEN
    v_xp := 0;
  ELSE
    v_xp := v_correct * 10;                              -- P2: XP_RULES.quiz_per_correct=10 (src/lib/xp-config.ts)
    IF v_score_percent >= 80 THEN v_xp := v_xp + 20; END IF; -- P2: XP_RULES.quiz_high_score_bonus=20
    IF v_score_percent = 100 THEN v_xp := v_xp + 50; END IF; -- P2: XP_RULES.quiz_perfect_bonus=50
  END IF;

  -- Insert quiz_sessions row. Phase 2.8: persist idempotency_key alongside
  -- the score columns so a subsequent retry hits the short-circuit branch.
  -- The unique partial index closes the race between two concurrent
  -- retries: the second INSERT raises a unique-violation, which the API
  -- layer is expected to translate into a 409 + redirect-to-results.
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

    -- RCA 2026-06-21: read subject + chapter_number alongside existing fields
    -- so we can derive topic_id at runtime when it is NULL on the question row.
    SELECT question_text, question_type, topic_id, bloom_level, difficulty,
           subject, chapter_number
      INTO v_q_text, v_q_type, v_q_topic_id, v_q_bloom, v_q_difficulty,
           v_q_subject, v_q_chapter
      FROM question_bank WHERE id = v_question_id;

    -- Fallback: derive topic_id from curriculum_topics if not stamped on question.
    -- Mirrors the join in migration 20260621000500 (backfill). Defence-in-depth:
    -- handles any future question that arrives with NULL topic_id before the
    -- bulk-import pipeline is fixed to stamp topic_id at write time.
    IF v_q_topic_id IS NULL THEN
      SELECT ct.id INTO v_q_topic_id
      FROM   public.curriculum_topics ct
      JOIN   public.subjects s ON s.id = ct.subject_id
      WHERE  s.code            = v_q_subject
        AND  ct.grade          = p_grade      -- p_grade is already the session-level grade (TEXT per P5)
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

    -- ─── PART C (20260623000300): SERVER-SIDE error_type classification ──
    -- Deterministic, server-authoritative. Correct answers -> NULL (the
    -- consumer already guards on NOT correct AND p_error_type IS NOT NULL).
    -- For wrong answers we read the PRIOR concept mastery (pre-BKT) for this
    -- topic and apply the heuristic: careless (fast + knew it) > conceptual
    -- (low prior mastery) > procedural (default wrong). The client-supplied
    -- r->>'error_type' is IGNORED — never trusted for a mastery-moving value.
    v_error_type := NULL;
    IF NOT v_is_correct THEN
      -- Prior concept mastery for this (student, topic). NULL when the concept
      -- has never been attempted -> treated as low -> conceptual default.
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

    -- COLUMN-NAME CORRECTION (20260623000300): the canonical quiz_responses
    -- columns are student_answer_index + time_taken_seconds, NOT selected_option
    -- + time_spent_seconds. Verified against prod 2026-06-23: selected_option and
    -- time_spent_seconds DO NOT EXIST on quiz_responses (PostgREST 400; the table
    -- carries student_answer_index + time_taken_seconds — see baseline_from_prod
    -- quiz_responses DDL). The deployed body (20260622030000) inserted into the
    -- phantom columns, so the per-response quiz_responses INSERT could never
    -- succeed (and there is NO error-isolation around this INSERT). This
    -- correction is REQUIRED for error_type to be stored at all; without it the
    -- whole second-pass INSERT throws. See header note "COLUMN-NAME CORRECTION".
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
      -- PHASE 0 fix: error-isolate the per-response learner-state write. A failure
      -- here (e.g. a missing column, a bad bloom level, a transient lock) must NOT
      -- abort the whole quiz submit. Mastery is best-effort; score/XP/atomic profile
      -- update below are authoritative and run regardless.
      BEGIN
        PERFORM update_learner_state_post_quiz(
          p_student_id,
          v_q_topic_id,
          v_is_correct,
          v_q_bloom,
          v_error_type,                                      -- PART C: COMPUTED value, not raw r->>'error_type'
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
    'idempotent_replay', false,
    'cme_next_action', v_cme_action,
    'cme_next_concept_id', v_cme_concept_id,
    'cme_reason', v_cme_reason,
    'questions', v_review_questions
  );
END;
$$;

COMMENT ON FUNCTION public.submit_quiz_results_v2(
  UUID, UUID, TEXT, TEXT, TEXT, INTEGER, JSONB, INTEGER, UUID
) IS
  'PART C (migration 20260623000300): server-classifies error_type for every WRONG '
  'response (careless | conceptual | procedural) from a DETERMINISTIC heuristic '
  '(response time + prior concept mastery), stores it on quiz_responses.error_type, '
  'and feeds the COMPUTED value into update_learner_state_post_quiz so '
  'concept_mastery.error_count_* moves on graded wrong answers. The client-supplied '
  'r->>''error_type'' is ignored (never trusted for a mastery-moving value). '
  'Canonical-mastery contract intact. P1/P2/P3/P4 byte-identical to 20260622030000. '
  'PHASE 0 (migration 20260622030000): wraps the per-response '
  'PERFORM update_learner_state_post_quiz(...) in a BEGIN/EXCEPTION block so a single '
  'failing learner-state write can no longer abort the whole quiz submit. '
  'RCA 2026-06-21 (migration 20260621000600): runtime topic_id fallback from '
  'curriculum_topics when question_bank.topic_id is NULL. '
  'Marking-Authenticity Phase 2.8 (migration 20260504100200): optional '
  'p_idempotency_key + replay short-circuit. Backwards-compatible: callers that omit '
  'the key fall through DEFAULT NULL and get the original behavior.';

INSERT INTO public.admin_audit_log (admin_id, action, entity_type, entity_id, details, created_at)
VALUES (
  NULL,
  'mastery_integrity.submit_quiz_v2_server_classify_error_type_patched',
  'system',
  NULL,
  jsonb_build_object(
    'migrated_at', now(),
    'reason', 'PART C: server-classify error_type per wrong response, store on quiz_responses, feed COMPUTED value into update_learner_state_post_quiz so error_count_* moves on graded wrong answers',
    'heuristic', jsonb_build_object(
      'careless', 'time_spent < 3s AND prior mastery >= 0.40',
      'conceptual', 'prior mastery < 0.40 (or never attempted)',
      'procedural', 'default wrong bucket otherwise'
    ),
    'function', 'submit_quiz_results_v2',
    'based_on', '20260622030000',
    'p1_p2_p3_p4', 'byte-identical'
  ),
  now()
);

COMMIT;
