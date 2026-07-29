-- Migration: 20260729120001_fix_quiz_rpc_defects.sql
-- Purpose: Additive CREATE OR REPLACE FUNCTION fix cluster for CONFIRMED
--   defects found by a forensic audit in the live quiz-scoring RPC chain.
--   No DROPs. No signature changes. No table/RLS changes.
--
--   Fixed in this migration:
--     F1 + F7 -- public.submit_quiz_results_v2(): Anti-Cheat Check 3 compared
--       jsonb_array_length(p_responses) against
--       `SELECT array_length(question_ids, 1) FROM quiz_sessions WHERE id = p_session_id`.
--       quiz_sessions has NO question_ids column anywhere in the schema, AND
--       even if it did, quiz_sessions.id is a brand-new id minted later in
--       the SAME function call (`RETURNING id INTO v_quiz_session_id`) with
--       no relationship to p_session_id -- so the subquery could never match,
--       and the COALESCE(..., v_total) fallback made the check compare
--       v_total to itself (an unconditional pass). Fixed to count served
--       questions from quiz_session_shuffles, which IS correctly keyed by
--       p_session_id (confirmed against start_quiz_session's INSERT).
--     F3 -- public.atomic_quiz_profile_update() 7-arg overload: Step 5's
--       streak CASE read students.last_active AFTER Step 3 (a separate,
--       earlier UPDATE statement) had already set it to NOW(), so
--       `last_active::date = CURRENT_DATE` was always true and streaks could
--       never increment. Fixed by capturing the pre-call last_active value
--       into a local variable before Step 3 runs, and having Step 5 compare
--       against that captured value instead of re-reading the column.
--     F4 -- public.atomic_quiz_profile_update() 6-arg overload: read
--       `SUM(xp_earned) FROM quiz_sessions`, a column that does not exist
--       (confirmed against the baseline DDL; the real column is `score`) --
--       every call raised Postgres 42703. Fixed to read from the
--       xp_transactions ledger (daily_category='quiz'), matching the 7-arg
--       sibling overload's approach, so both overloads share one source of
--       truth for "today's already-earned quiz XP" and this overload no
--       longer errors.
--     F5 -- public.submit_quiz_results_v2(): computed an uncapped v_xp and
--       returned it directly as xp_earned (and stored it uncapped in
--       quiz_sessions.score), never applying the P2 200/day cap that the
--       7-arg atomic_quiz_profile_update enforces internally -- whose result
--       never propagated back because that overload RETURNS VOID. Fixed by
--       reading the actual capped amount back from the xp_transactions
--       ledger row the 7-arg call just wrote (keyed by the same
--       reference_id = 'quiz_' || session_id it derives internally -- this
--       mirrors the identical read-back pattern already used by the
--       TS-side fallback in packages/lib/src/supabase.ts), using that value
--       for both quiz_sessions.score and the returned xp_earned, and adding
--       an `xp_capped` boolean key (existing key name; frontend already
--       reads `results.xp_capped === true` for the cap banner).
--     F8 -- IST day-boundary off-by-one. `CURRENT_DATE` / `CURRENT_DATE AT
--       TIME ZONE 'Asia/Kolkata'` resolve in the session's (UTC) timezone,
--       so between 00:00-05:29 IST every "what day is it" check in these
--       RPCs (the two atomic_quiz_profile_update daily-cap reads, and the
--       7-arg overload's streak-day comparison) was silently reading
--       YESTERDAY's IST calendar day. Unified all of them on
--       `(now() AT TIME ZONE 'Asia/Kolkata')::date` as a single per-call
--       anchor, converted back to a timestamptz for range comparisons via
--       `<anchor> AT TIME ZONE 'Asia/Kolkata'`.
--
--   P1 score formula, P2 XP formula/values, and P3 anti-cheat THRESHOLDS
--   (3s/question, >3-question same-answer check) are UNCHANGED -- only the
--   broken Check 3 comparison source and the cap-propagation/day-boundary
--   plumbing around them are fixed.
--
--   Callers verified via grep across apps/host/src and packages/lib/src
--   before writing this migration:
--     - submit_quiz_results_v2: packages/lib/src/supabase.ts (L1 path),
--       apps/host/src/app/api/v2/quiz/submit/route.ts,
--       apps/host/src/app/api/quiz/submit/route.ts. Signature unchanged.
--     - atomic_quiz_profile_update 6-arg: packages/lib/src/domains/quiz.ts:374,
--       packages/lib/src/domains/profile.ts:117. Signature unchanged.
--     - atomic_quiz_profile_update 7-arg: packages/lib/src/supabase.ts
--       (both submit_quiz_results_v2's PERFORM call inside SQL and the L2
--       TS-side fallback), submit_quiz_results (v1, unchanged in this
--       migration). Signature and RETURNS VOID unchanged -- changing this to
--       RETURNS JSONB would require DROP + CREATE (Postgres forbids
--       CREATE OR REPLACE from changing return type) and was avoided;
--       F5 is instead solved entirely inside submit_quiz_results_v2 via the
--       ledger read-back described above.

-- ═══════════════════════════════════════════════════════════════════════════
-- FIX 1 (F1 + F7 + F5): submit_quiz_results_v2 — Check 3 + daily-cap propagation
-- ═══════════════════════════════════════════════════════════════════════════
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
  'in both quiz_sessions.score and the returned xp_earned/xp_capped fields.';

-- ═══════════════════════════════════════════════════════════════════════════
-- FIX 2 (F4 + F8): atomic_quiz_profile_update — 6-arg overload (RETURNS jsonb)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.atomic_quiz_profile_update(
  p_student_id   UUID,
  p_subject      TEXT,
  p_xp           INT,
  p_total        INT,
  p_correct      INT,
  p_time_seconds INT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_time_minutes  INT := GREATEST(1, ROUND(p_time_seconds / 60.0));
  v_daily_cap     INT := 200;  -- mirrors XP_RULES.quiz_daily_cap
  v_today_earned  INT;
  v_remaining     INT;
  v_effective_xp  INT;
  v_xp_capped     BOOLEAN := false;
  v_xp_excess     INT := 0;
  v_new_profile_xp BIGINT;
  v_ist_today     DATE;  -- FIX F8 (2026-07-29): single IST "what day is it" anchor
BEGIN
  -- SECURITY FIX (2026-07-02, Phase 3 Wave 1 #5): ownership check. This overload
  -- is called directly from the browser (JWT-bound anon-key client) by
  -- src/lib/domains/quiz.ts and src/lib/domains/profile.ts WITHOUT p_session_id.
  -- Prevents an authenticated caller from writing XP/profile rows onto an
  -- arbitrary p_student_id. Skipped when auth.uid() IS NULL (service-role
  -- callers bypass RLS and carry no JWT).
  IF auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM students
    WHERE id = p_student_id AND auth_user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Access denied: caller does not own student %', p_student_id;
  END IF;

  v_ist_today := (now() AT TIME ZONE 'Asia/Kolkata')::date;

  -- FIX F4 + F8 (2026-07-29):
  -- F4: quiz_sessions has NO xp_earned column (confirmed against the
  --     baseline DDL -- the column that actually holds a session's awarded
  --     XP is `score`, written by submit_quiz_results_v2/submit_quiz_results).
  --     `SUM(xp_earned) FROM quiz_sessions` therefore raised Postgres 42703
  --     on every call to this overload -- it always errored, it did not
  --     silently miscount.
  -- F8: the previous CURRENT_DATE-based range was anchored to the session's
  --     (UTC) timezone, not IST, causing an off-by-one during 00:00-05:29 IST.
  -- Fix: read today's-already-earned quiz XP from the SAME authoritative
  -- source the 7-arg sibling overload uses -- the xp_transactions ledger,
  -- daily_category='quiz' -- over an explicit Asia/Kolkata calendar day, so
  -- both overloads agree on both "where is XP tracked" and "what day is it".
  SELECT COALESCE(SUM(amount), 0)::INT
    INTO v_today_earned
    FROM public.xp_transactions
   WHERE student_id     = p_student_id
     AND daily_category = 'quiz'
     AND created_at    >= (v_ist_today AT TIME ZONE 'Asia/Kolkata')
     AND created_at    <  ((v_ist_today + 1) AT TIME ZONE 'Asia/Kolkata');

  -- ── 2. Clamp p_xp under the daily cap ──────────────────────────────
  v_remaining    := GREATEST(0, v_daily_cap - v_today_earned);
  v_effective_xp := LEAST(GREATEST(0, COALESCE(p_xp, 0)), v_remaining);

  IF v_effective_xp < COALESCE(p_xp, 0) THEN
    v_xp_capped := true;
    v_xp_excess := COALESCE(p_xp, 0) - v_effective_xp;
  END IF;

  -- ── 3. Upsert learning profile with the CLAMPED value ──────────────
  INSERT INTO public.student_learning_profiles (
    student_id, subject, xp, total_sessions,
    total_questions_asked, total_questions_answered_correctly,
    total_time_minutes, last_session_at, streak_days, level, current_level
  ) VALUES (
    p_student_id, p_subject, v_effective_xp, 1,
    p_total, p_correct,
    v_time_minutes, NOW(), 1, 1, 'beginner'
  )
  ON CONFLICT (student_id, subject) DO UPDATE SET
    xp = student_learning_profiles.xp + v_effective_xp,
    total_sessions = student_learning_profiles.total_sessions + 1,
    total_questions_asked = student_learning_profiles.total_questions_asked + p_total,
    total_questions_answered_correctly = student_learning_profiles.total_questions_answered_correctly + p_correct,
    total_time_minutes = student_learning_profiles.total_time_minutes + v_time_minutes,
    last_session_at = NOW(),
    level = GREATEST(1, FLOOR((student_learning_profiles.xp + v_effective_xp) / 500) + 1)
  RETURNING xp INTO v_new_profile_xp;

  -- ── 4. Update student totals + streak with the CLAMPED value ───────
  -- FIX F8 (2026-07-29): streak day-boundary now compares IST calendar dates
  -- (via v_ist_today) instead of a bare ::date truncation in the session's
  -- (UTC) timezone. This UPDATE is still a SINGLE statement, so `last_active`
  -- inside the CASE correctly refers to the PRE-update row value (Postgres
  -- evaluates every expression in an UPDATE's SET list against the OLD row,
  -- not sequentially) -- there is no F3-style ordering bug in this overload,
  -- only the timezone bug.
  UPDATE public.students SET
    xp_total = COALESCE(xp_total, 0) + v_effective_xp,
    last_active = NOW(),
    streak_days = CASE
      WHEN last_active IS NOT NULL
           AND (last_active AT TIME ZONE 'Asia/Kolkata')::date = v_ist_today
        THEN COALESCE(streak_days, 1)
      WHEN last_active IS NOT NULL
           AND (last_active AT TIME ZONE 'Asia/Kolkata')::date = v_ist_today - 1
        THEN COALESCE(streak_days, 0) + 1
      ELSE 1
    END
  WHERE id = p_student_id;

  -- ── 5. Return cap status so callers can warn the learner ───────────
  RETURN jsonb_build_object(
    'success',         true,
    'requested_xp',    COALESCE(p_xp, 0),
    'effective_xp',    v_effective_xp,
    'xp_capped',       v_xp_capped,
    'xp_cap_excess',   v_xp_excess,
    'today_earned',    v_today_earned,
    'daily_cap',       v_daily_cap,
    'remaining_today', GREATEST(0, v_remaining - v_effective_xp),
    'profile_xp',      v_new_profile_xp
  );
END;
$$;

COMMENT ON FUNCTION public.atomic_quiz_profile_update(UUID, TEXT, INT, INT, INT, INT) IS
  'Atomic quiz profile + student XP update with the P2 daily XP cap (200) enforced. '
  'Daily cap source of truth: src/lib/xp-rules.ts XP_RULES.quiz_daily_cap. Returns JSONB. '
  'SECURITY FIX 2026-07-02 (Phase 3 Wave 1 #5): ownership check. '
  'FIX 2026-07-29 (forensic audit F4/F8): the daily-earned-XP read no longer '
  'references the nonexistent quiz_sessions.xp_earned column (was raising '
  '42703 on every call); it now reads xp_transactions (daily_category=''quiz'') '
  'over an explicit Asia/Kolkata calendar day, matching the 7-arg sibling '
  'overload and removing a UTC/IST day-boundary off-by-one in both the cap '
  'read and the streak comparison.';

-- ═══════════════════════════════════════════════════════════════════════════
-- FIX 3 (F3 + F8): atomic_quiz_profile_update — 7-arg overload (RETURNS void)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.atomic_quiz_profile_update(
  p_student_id    UUID,
  p_subject       TEXT,
  p_xp            INT,
  p_total         INT,
  p_correct       INT,
  p_time_seconds  INT,
  p_session_id    UUID DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_time_minutes    INT     := GREATEST(1, ROUND(p_time_seconds / 60.0));
  v_today_quiz_xp   INTEGER := 0;
  v_xp_to_award     INTEGER := 0;
  v_reference_id    TEXT    := NULL;
  v_rows_inserted   INTEGER := 0;
  v_subject_clean   TEXT;
  v_auth_user_id    UUID;
  v_school_id       UUID;
  v_chapter_number  INT;
  -- FIX F3 + F8 (2026-07-29)
  v_prev_last_active TIMESTAMPTZ; -- students.last_active captured BEFORE this
                                    -- call's own writes touch it
  v_ist_today        DATE;         -- single IST "what day is it" anchor reused
                                    -- by both the ledger cap read and the
                                    -- streak comparison below
BEGIN
  -- SECURITY FIX (2026-07-02, Phase 3 Wave 1 #5): ownership check. This overload
  -- is called directly from the browser (JWT-bound anon-key client) by
  -- src/lib/supabase.ts WITH p_session_id, AND directly by service-role callers
  -- (e.g. the atomic-quiz-xp-42p10-e2e integration test) with no JWT at all.
  -- Prevents an authenticated caller from writing XP/profile/ledger/event rows
  -- onto an arbitrary p_student_id. Skipped when auth.uid() IS NULL so
  -- service-role callers (bypass RLS, carry no JWT) are unaffected — this is
  -- purely an app-level ownership assertion, not a privilege boundary.
  IF auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM students
    WHERE id = p_student_id AND auth_user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Access denied: caller does not own student %', p_student_id;
  END IF;

  -- FIX F3 (2026-07-29): capture last_active BEFORE Step 3 (or the award_xp()
  -- call inside CASE B) has a chance to overwrite it with NOW(). Step 5 below
  -- previously re-read students.last_active AFTER Step 3's own UPDATE (a
  -- SEPARATE, earlier statement -- unlike the 6-arg sibling overload, which
  -- does its XP write and streak update in ONE statement and is therefore
  -- immune to this) had already set it to NOW(), so
  -- `last_active::date = CURRENT_DATE` was true on every single call and the
  -- COALESCE(streak_days, 1) branch always won -- streaks could never
  -- increment. Capturing the pre-call value here and having Step 5 compare
  -- against THIS variable (instead of re-reading the column) fixes the
  -- ordering bug regardless of which of Step 3's two branches ran.
  SELECT last_active INTO v_prev_last_active
    FROM public.students
   WHERE id = p_student_id;

  -- FIX F8 (2026-07-29): single IST calendar-day anchor for this call.
  v_ist_today := (now() AT TIME ZONE 'Asia/Kolkata')::date;

  -- ── Normalise subject ──────────────────────────────────────────────────────
  v_subject_clean := CASE WHEN p_subject IS NULL OR p_subject = 'unknown'
                          THEN NULL ELSE p_subject END;

  -- ── Step 1: Compute today's already-awarded quiz XP (IST date boundary) ───
  -- P2: daily quiz XP cap = 200. Uses the ledger as the authoritative source.
  -- FIX F8 (2026-07-29): the previous expression
  --   created_at >= (CURRENT_DATE AT TIME ZONE 'Asia/Kolkata')
  -- computes CURRENT_DATE in the session's (UTC) timezone, so between
  -- 00:00-05:29 IST this resolved to YESTERDAY's IST midnight, undercounting
  -- the cap window by up to ~5.5 hours. Anchor on v_ist_today (today's actual
  -- IST calendar date, computed once above) instead.
  SELECT COALESCE(SUM(amount), 0)
    INTO v_today_quiz_xp
  FROM public.xp_transactions
  WHERE student_id    = p_student_id
    AND daily_category = 'quiz'
    AND created_at    >= (v_ist_today AT TIME ZONE 'Asia/Kolkata');

  -- Cap the award so total daily quiz XP never exceeds 200.
  -- If p_xp is 0 (flagged submission) or cap already reached, v_xp_to_award = 0.
  v_xp_to_award := GREATEST(0, LEAST(p_xp, 200 - v_today_quiz_xp));

  -- ── Step 2: Build reference_id for CASE A idempotency ────────────────────
  IF p_session_id IS NOT NULL THEN
    v_reference_id := 'quiz_' || p_session_id::TEXT;
  END IF;

  -- ── Step 3: Write ledger row and update XP totals ────────────────────────
  IF v_xp_to_award > 0 THEN

    IF v_reference_id IS NOT NULL THEN
      -- CASE A: session_id known — use direct INSERT with ON CONFLICT for strict
      -- idempotency. The unique partial index on reference_id guarantees that a
      -- re-submitted session is silently ignored. The ON CONFLICT clause carries
      -- the matching WHERE predicate so Postgres can infer the partial index
      -- (without it: 42P10). v_reference_id is always non-NULL inside this branch.
      INSERT INTO public.xp_transactions (
        student_id, amount, source, subject,
        daily_category, reference_id, metadata, created_at
      ) VALUES (
        p_student_id,
        v_xp_to_award,
        'quiz',
        v_subject_clean,
        'quiz',
        v_reference_id,
        jsonb_build_object(
          'session_id',   p_session_id,
          'total_q',      p_total,
          'correct_q',    p_correct,
          'time_seconds', p_time_seconds,
          'original_xp',  p_xp           -- amount before daily cap
        ),
        NOW()
      )
      ON CONFLICT (reference_id) WHERE reference_id IS NOT NULL DO NOTHING;

      GET DIAGNOSTICS v_rows_inserted = ROW_COUNT;

      -- Only increment students.xp_total when a new ledger row was actually
      -- inserted (i.e. this is not a re-submission).
      IF v_rows_inserted > 0 THEN
        UPDATE public.students SET
          xp_total    = COALESCE(xp_total, 0) + v_xp_to_award,
          last_active = NOW()
        WHERE id = p_student_id;

        -- Increment subject-specific XP in learning profiles if subject known.
        IF v_subject_clean IS NOT NULL THEN
          UPDATE public.student_learning_profiles SET
            xp = COALESCE(xp, 0) + v_xp_to_award
          WHERE student_id = p_student_id
            AND subject    = v_subject_clean;
        END IF;
      END IF;

    ELSE
      -- CASE B: no session_id (legacy 4-param callers) — delegate to award_xp.
      -- award_xp writes the ledger row and updates students.xp_total and
      -- student_learning_profiles.xp. We pass p_daily_cap = NULL because the
      -- cap has already been applied above (v_xp_to_award is already capped).
      PERFORM public.award_xp(
        p_student_id     := p_student_id,
        p_amount         := v_xp_to_award,
        p_source         := 'quiz',
        p_subject        := v_subject_clean,
        p_daily_category := 'quiz',
        p_daily_cap      := NULL,
        p_metadata       := jsonb_build_object(
                              'total_q',      p_total,
                              'correct_q',    p_correct,
                              'time_seconds', p_time_seconds,
                              'original_xp',  p_xp
                            )
      );
      -- award_xp sets last_active = now() on students when it awards > 0 XP.
      -- FIX F3 (2026-07-29): Step 5 below now reads v_prev_last_active
      -- (captured before this branch ran), not the column, so whether or not
      -- award_xp touches last_active here no longer affects the streak
      -- calculation's correctness.
    END IF;

  END IF;
  -- v_xp_to_award = 0: ledger and students.xp_total intentionally untouched.

  -- ── Step 4: Upsert student_learning_profiles for session counters ─────────
  -- XP column:
  --   On first INSERT — set to v_xp_to_award (the capped amount).
  --   On UPDATE — XP is NOT incremented here; Steps 3A/3B already handled it.
  -- Level recalculation reads the XP value already in the row plus what we
  -- just added, using EXCLUDED.xp to reference the first-insert value safely.
  INSERT INTO public.student_learning_profiles (
    student_id,
    subject,
    xp,
    total_sessions,
    total_questions_asked,
    total_questions_answered_correctly,
    total_time_minutes,
    last_session_at,
    streak_days,
    level,
    current_level
  ) VALUES (
    p_student_id,
    COALESCE(v_subject_clean, 'general'),
    v_xp_to_award,
    1,
    p_total,
    p_correct,
    v_time_minutes,
    NOW(),
    1,
    1,
    'beginner'
  )
  ON CONFLICT (student_id, subject) DO UPDATE SET
    total_sessions                     = student_learning_profiles.total_sessions + 1,
    total_questions_asked              = student_learning_profiles.total_questions_asked + p_total,
    total_questions_answered_correctly = student_learning_profiles.total_questions_answered_correctly + p_correct,
    total_time_minutes                 = student_learning_profiles.total_time_minutes + v_time_minutes,
    last_session_at                    = NOW(),
    -- Level uses the already-updated xp column (Step 3 incremented it before
    -- this upsert runs). FLOOR division by 500 matches the original formula.
    level = GREATEST(1, FLOOR(student_learning_profiles.xp / 500.0) + 1);

  -- ── Step 5: Update streak_days on students ────────────────────────────────
  -- FIX F3 + F8 (2026-07-29): compares v_prev_last_active (captured BEFORE
  -- Step 3 could touch the column — see the comment at capture time above)
  -- against IST calendar dates via v_ist_today, instead of re-reading the
  -- (by-now-already-updated-to-NOW()) students.last_active column truncated
  -- in the session's (UTC) timezone. This UPDATE still also sets
  -- last_active = NOW() so it is always refreshed for the NEXT call's
  -- comparison.
  UPDATE public.students SET
    last_active = NOW(),
    streak_days = CASE
      WHEN v_prev_last_active IS NOT NULL
           AND (v_prev_last_active AT TIME ZONE 'Asia/Kolkata')::date = v_ist_today
        THEN COALESCE(streak_days, 1)
      WHEN v_prev_last_active IS NOT NULL
           AND (v_prev_last_active AT TIME ZONE 'Asia/Kolkata')::date = v_ist_today - 1
        THEN COALESCE(streak_days, 0) + 1
      ELSE 1
    END
  WHERE id = p_student_id;

  -- ── Step 6: Publish state event ──────────────────────────────────────────
  IF p_session_id IS NOT NULL THEN
    -- Resolve auth_user_id and school_id
    SELECT auth_user_id, school_id
      INTO v_auth_user_id, v_school_id
      FROM public.students
     WHERE id = p_student_id;

    IF v_auth_user_id IS NOT NULL THEN
      -- Resolve chapter number from quiz_sessions (inserted by submit_quiz_results_v2)
      SELECT chapter_number INTO v_chapter_number
        FROM public.quiz_sessions
       WHERE id = p_session_id;

      INSERT INTO public.state_events (
        event_id,
        kind,
        actor_auth_user_id,
        tenant_id,
        idempotency_key,
        occurred_at,
        payload
      ) VALUES (
        gen_random_uuid(),
        'learner.quiz_completed',
        v_auth_user_id,
        v_school_id,
        'quiz-completed:' || p_session_id::text,
        NOW(),
        jsonb_build_object(
          'quizSessionId', p_session_id,
          'subjectCode',   COALESCE(v_subject_clean, 'unknown'),
          'chapterNumber', COALESCE(v_chapter_number, 1),
          'questionCount', p_total,
          'correctCount',  p_correct,
          'durationSec',   p_time_seconds,
          'xpEarned',      v_xp_to_award
        )
      )
      ON CONFLICT (idempotency_key) DO NOTHING;
    END IF;
  END IF;

END;
$$;

COMMENT ON FUNCTION public.atomic_quiz_profile_update(UUID, TEXT, INT, INT, INT, INT, UUID) IS
  'Atomically records a quiz session: P2 daily 200 XP quiz cap, ledger row, '
  'students.xp_total, student_learning_profiles upsert, streak, and the '
  'learner.quiz_completed state event. 42P10 fix (20260623000600): the '
  'ON CONFLICT (reference_id) clause carries the matching '
  'WHERE reference_id IS NOT NULL predicate so it can infer the partial unique '
  'index idx_xp_txn_reference_id. SECURITY FIX 2026-07-02 (Phase 3 Wave 1 #5): '
  'ownership check. FIX 2026-07-29 (forensic audit F3/F8): the streak '
  'day-boundary comparison in Step 5 now reads last_active captured BEFORE '
  'Step 3''s own write (previously it always re-read the already-updated '
  'value, making the streak permanently stuck), and every day-boundary check '
  'in this function is now anchored to a single Asia/Kolkata calendar-day '
  'value instead of the session''s (UTC) timezone. SECURITY DEFINER; '
  'search_path pinned.';
