-- Migration: 20260814000016_submit_quiz_v2_written_answer_scoring.sql
-- Purpose: P0 — make submit_quiz_results_v2 able to accept and SCORE written
--   (non-MCQ) responses instead of aborting the entire submission.
--
-- ─── THE DEFECT (pre-existing, student-visible, total data loss) ───────────
-- The per-response loops looked the response up in quiz_session_shuffles and,
-- if no snapshot row existed, RAISEd:
--
--     IF v_correct_idx_snapshot IS NULL THEN
--       RAISE EXCEPTION 'session_not_started: ...' USING ERRCODE = 'P0001';
--
-- unconditionally, BEFORE any anti-cheat check could run. The web client only
-- ever handed `start_quiz_session` the MCQ question ids, so NO written
-- (short/medium/long-answer, NCERT-exercise) question ever had a snapshot row.
-- Consequence: ANY quiz containing at least one non-MCQ question could not be
-- submitted at all. A PURE written quiz was worse — zero MCQ ids meant
-- start_quiz_session was never called, p_session_id arrived NULL, and every
-- response missed. The student saw a network-error toast, earned 0 XP, and no
-- quiz_sessions row was ever written; retrying re-raised forever.
--
-- The client half of the fix (same change set) makes the page snapshot EVERY
-- served question via `collectSessionQuestionIds`
-- (packages/lib/src/quiz/session-contract.ts). start_quiz_session already
-- handles a non-MCQ correctly — for anything that is not a 4-option MCQ it
-- stores an identity shuffle and an EMPTY options snapshot (20260801100800:
-- 219-236). That empty snapshot is exactly the server-side "served, but not as
-- an MCQ" marker this migration keys off, and it also makes P3 anti-cheat
-- Check 3's served-row COUNT(*) correct for mixed and written-only quizzes.
--
-- ─── WHAT THIS MIGRATION CHANGES (the complete list) ──────────────────────
-- 1. Both passes now classify each response into an MCQ lane or a WRITTEN
--    lane, using SERVER state only:
--
--      v_is_written := (no usable 4-option snapshot for this response)
--                      AND question_bank.question_type is not an MCQ type
--
--    A client cannot select its own lane: `options_snapshot` is written by
--    start_quiz_session at serve time and `question_type` is read live from
--    question_bank. A response the server considers an MCQ takes the existing
--    index-comparison path, byte-for-byte unchanged.
--
-- 2. The `session_not_started` RAISE is now guarded by `NOT v_is_written`.
--    An MCQ response with no snapshot row still aborts with P0001 exactly as
--    before — the tamper / never-started-session guard from 20260504100100 is
--    fully preserved, it simply no longer fires on written answers that were
--    never supposed to have an option snapshot in the first place.
--
-- 3. Written correctness is derived from the AI rubric marks:
--
--      v_is_correct := v_marks_possible > 0
--                      AND v_marks_awarded >= v_marks_possible * 0.5
--
--    This is the SAME >= 50%-of-marks rule the ncert-question-engine
--    evaluation already applied when it showed the student their per-question
--    verdict during the quiz, so the P1 numerator now equals the number of
--    "correct" verdicts the student actually saw. P1's formula
--    (ROUND(correct / total * 100)) is untouched — only which responses land
--    in `v_correct` changes, and only for responses that previously could not
--    be submitted at all.
--
--    Both marks values arrive through a regex guard (identical technique to
--    the existing hint_level / confidence guards), so a malformed payload
--    yields 0 rather than a cast error that would abort the P4 transaction.
--    marks_awarded is then clamped into [0, marks_possible].
--
--    TRUST NOTE (deliberate, documented): marks_awarded / marks_possible are
--    client-supplied, so a hand-crafted PostgREST call could claim full marks
--    on a written answer. This is not a new exposure — it is the pre-existing
--    trust boundary of the whole written-answer flow, whose grading happens in
--    the ncert-question-engine Edge Function and is never persisted
--    server-side keyed to the session. Re-deriving from the marks is strictly
--    better than the alternative of trusting a client `is_correct` boolean
--    (which _mapV2 already strips). Closing it properly requires
--    ncert-question-engine to persist its evaluation against
--    (session_id, question_id) and this RPC to read it back — tracked as a
--    follow-up, NOT in scope for a P0 restore-service fix. XP is unaffected in
--    the meantime beyond the normal quiz lane, which is already daily-capped.
--
-- 4. Written answers are now RECORDED, not just scored: the quiz_responses
--    INSERT gains student_answer_text, marks_awarded, rubric_feedback and
--    marks. Those four columns already exist (baseline:12207-12225) and were
--    added for exactly this purpose; nothing in v2 had ever populated them.
--    MCQ rows keep marks = 1 (the column default) and NULL in the other three.
--
-- 5. One-line defensive tidy: the second pass's `correct_option_text` guard
--    gains `AND v_correct_idx_snapshot IS NOT NULL`, making it identical to
--    the guard the idempotent-replay branch has always used. Behaviourally a
--    no-op (`x > NULL` is already NULL/false), but a written response is the
--    first case that can legitimately reach it with a NULL index.
--
-- ─── WHAT THIS MIGRATION DOES *NOT* CHANGE ────────────────────────────────
--   P1  score formula .................. identical
--   P2  XP literals + daily-cap read-back identical
--   P3  all three checks + thresholds .. identical (Check 3 still counts
--       quiz_session_shuffles rows; the client fix is what makes that count
--       right for non-MCQ quizzes)
--   P4  single-transaction submit + p_idempotency_key replay .... identical
--   P5  grade stays TEXT
--   Function SIGNATURE ................. identical (11 params) — this is a
--       plain CREATE OR REPLACE, no DROP, no new overload, so the Phase 4
--       `p_idempotency_key = sessionId` contract and every existing caller
--       (web submitQuizResults, /api/quiz/submit, /api/v2/quiz/submit,
--       mobile) keep working unchanged.
--
-- Body copied from the NEWEST prior definition,
-- 20260809000500_submit_quiz_v2_unhinted_bonus.sql (verified newest by grep
-- across supabase/migrations for `submit_quiz_results_v2` on 2026-08-11 — the
-- 20260814000000..15 cluster references it but never redefines it). Deltas
-- beyond the numbered list above: none.
--
-- Idempotent: CREATE OR REPLACE + REVOKE/GRANT only. Safe to re-run.
-- Ordering: REQUIRES 20260809000500 (11-param signature) and 20260801100800
--   (start_quiz_session writing non-MCQ snapshot rows).
-- Owner: backend (P0 restore-service fix). Reviewers (P14): architect (RPC
--   surface + the documented marks trust boundary), assessment (written-answer
--   scoring rule + P1 numerator), frontend (client half), testing, mobile
--   (contract unchanged — no client change required). Added: 2026-08-11.

BEGIN;

CREATE OR REPLACE FUNCTION public.submit_quiz_results_v2(
  p_session_id UUID,
  p_student_id UUID,
  p_subject TEXT,
  p_grade TEXT,
  p_topic TEXT DEFAULT NULL,
  p_chapter INTEGER DEFAULT NULL,
  p_responses JSONB DEFAULT '[]',
  p_time INTEGER DEFAULT 0,
  p_idempotency_key UUID DEFAULT NULL,   -- Phase 2.8 addition (default NULL = legacy path)
  -- Phase 3 (20260809000500): unhinted-mastery bonus economy — DEFAULTs
  -- mirror xp-config (REG-48-style parity pin); client-supplied values are
  -- clamped downward to these constants when auth.uid() is set.
  p_unhinted_xp INTEGER DEFAULT 2,
  p_unhinted_cap INTEGER DEFAULT 30
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
-- SECURITY DEFINER justified: writes quiz_sessions, quiz_responses,
-- user_question_history, student_misconceptions; invokes
-- atomic_quiz_profile_update and award_xp_capped. Authorization is enforced
-- inline against students.auth_user_id.
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
  -- 20260807 Phase 2 event capture (D2/D3/D6/D7)
  v_options_version_at_serve INT;  -- D2: server-held snapshot version
  v_integrity_hash TEXT;           -- D2: server-held snapshot hash
  v_answer_method TEXT;            -- D3: whitelisted capture method
  v_confidence SMALLINT;           -- D6: self-reported confidence 1..5 or NULL
  v_misconception_id UUID;         -- D7: matched question_misconceptions.id
  v_misconception_code TEXT;       -- D7: its stable pattern code
  -- 20260809 Phase 3: unhinted-mastery bonus lane
  v_unhinted_count INT := 0;       -- correct answers with hint_level = 0
  v_unhinted_rate INT;             -- effective per-question bonus (clamped)
  v_unhinted_cap_eff INT;          -- effective daily cap (clamped)
  v_unhinted_award JSONB;          -- award_xp_capped result
  v_unhinted_bonus INT := 0;       -- effective bonus actually credited
  -- 20260814000016 P0: written (non-MCQ) response lane
  v_is_written BOOLEAN := false;   -- this response is scored from rubric marks
  v_marks_awarded NUMERIC;         -- AI-evaluated marks for a written answer
  v_marks_possible NUMERIC;        -- marks the written question was worth
  v_student_answer_text TEXT;      -- the student's typed answer
  v_rubric_feedback TEXT;          -- AI rubric feedback for that answer
BEGIN
  -- Ownership check (same pattern as start_quiz_session).
  IF auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM students
    WHERE id = p_student_id AND auth_user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Access denied: caller does not own student %', p_student_id;
  END IF;

  -- Phase 3 (20260809000500): resolve the effective bonus economy. Browser-
  -- originated calls (auth.uid() set) are clamped DOWNWARD to the canonical
  -- defaults so a hand-crafted PostgREST call can never raise its own bonus;
  -- service-role callers (auth.uid() NULL) pass values from xp-config
  -- unclamped. Keep these clamp constants identical to the param DEFAULTs.
  v_unhinted_rate    := GREATEST(0, COALESCE(p_unhinted_xp, 0));
  v_unhinted_cap_eff := GREATEST(0, COALESCE(p_unhinted_cap, 0));
  IF auth.uid() IS NOT NULL THEN
    v_unhinted_rate    := LEAST(v_unhinted_rate, 2);
    v_unhinted_cap_eff := LEAST(v_unhinted_cap_eff, 30);
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

    SELECT shuffle_map, correct_answer_index_snapshot, options_snapshot
      INTO v_shuffle, v_correct_idx_snapshot, v_options_snapshot
      FROM quiz_session_shuffles
     WHERE session_id = p_session_id AND question_id = v_q_id;

    -- P0 (20260814000016): decide the scoring lane from SERVER state ONLY.
    -- `options_snapshot` was written by start_quiz_session at serve time and
    -- `question_type` is read live from question_bank — the client can
    -- influence neither, so it cannot elect the written lane for an MCQ.
    v_q_type := NULL;
    SELECT question_type INTO v_q_type FROM question_bank WHERE id = v_q_id;

    v_is_written := (
         v_correct_idx_snapshot IS NULL
      OR v_options_snapshot IS NULL
      OR jsonb_typeof(v_options_snapshot) <> 'array'
      OR jsonb_array_length(v_options_snapshot) <> 4
    ) AND lower(COALESCE(v_q_type, '')) NOT IN ('mcq', 'multiple_choice', 'objective');

    -- Tamper / never-started guard (20260504100100) — PRESERVED for MCQ.
    -- A written response legitimately has no option snapshot to grade
    -- against, so it must not abort the whole submission.
    IF NOT v_is_written AND v_correct_idx_snapshot IS NULL THEN
      RAISE EXCEPTION
        'session_not_started: quiz_session_shuffles row missing for session_id=%, question_id=%',
        p_session_id, v_q_id
        USING ERRCODE = 'P0001';
    END IF;

    IF v_is_written THEN
      -- WRITTEN LANE. Correctness from the AI rubric marks, using the SAME
      -- >= 50%-of-marks rule the student was already shown per question.
      -- Regex-guarded so a malformed payload can never raise a cast error
      -- and abort the submit transaction (P4).
      v_marks_awarded := CASE
        WHEN (r->>'marks_awarded') ~ '^[0-9]+(\.[0-9]+)?$' THEN (r->>'marks_awarded')::NUMERIC
        ELSE NULL
      END;
      v_marks_possible := CASE
        WHEN (r->>'marks_possible') ~ '^[0-9]+(\.[0-9]+)?$' THEN (r->>'marks_possible')::NUMERIC
        ELSE NULL
      END;
      v_marks_possible := COALESCE(v_marks_possible, 0);
      v_marks_awarded  := COALESCE(v_marks_awarded, 0);
      v_marks_awarded  := LEAST(GREATEST(v_marks_awarded, 0), v_marks_possible);
      v_selected_orig  := NULL;   -- no option space; never inherit the previous row
      v_is_correct     := (v_marks_possible > 0 AND v_marks_awarded >= v_marks_possible * 0.5);
    ELSE
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
    END IF;

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
  -- p_time is ELAPSED seconds. (The web client used to pass the exam-mode
  -- COUNTDOWN remainder here, which inverted this check; fixed client-side by
  -- computeElapsedSeconds in packages/lib/src/quiz/session-contract.ts. The
  -- threshold below is unchanged.)
  v_avg_time := CASE WHEN v_total > 0 THEN p_time::NUMERIC / v_total ELSE 0 END;
  IF v_avg_time < 3.0 AND v_total > 0 THEN
    v_flagged := true;
  END IF;

  -- P3 Check 2: not all same answer if >3 questions.
  -- Written responses carry selected_displayed = -1 and are therefore not
  -- counted in v_answer_counts — an all-written quiz cannot trip this check,
  -- which is correct: there is no option index to repeat.
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
  -- p_session_id is the id returned by start_quiz_session(), which is the SAME
  -- id it used as quiz_session_shuffles.session_id when it wrote one row per
  -- served question. COUNT(*) against it is therefore the correct "how many
  -- questions were served" source.
  --
  -- 20260814000016: this only became correct for non-MCQ quizzes once the
  -- client started snapshotting EVERY served question, not just the MCQs (see
  -- collectSessionQuestionIds). Before that, a mixed quiz always had more
  -- responses than served rows. Unchanged here — the comparison is the same.
  --
  -- Fail-closed: an unexpected 0 count still flags rather than silently
  -- passing.
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
    -- (0 = no hint .. 5). Normalize defensively via a regex guard (no
    -- per-row subtransaction): absent, non-numeric, or out-of-range values
    -- become NULL so a malformed client payload can never violate
    -- quiz_responses_hint_level_check and abort the whole submission
    -- transaction.
    v_hint_level := CASE
      WHEN (r->>'hint_level') ~ '^[0-5]$' THEN (r->>'hint_level')::SMALLINT
      ELSE NULL
    END;

    -- D3 (2026-08-07, Phase 2): answer_method — server whitelist, same
    -- normalize-never-abort pattern. Unknown/absent -> 'mcq'.
    v_answer_method := CASE
      WHEN (r->>'answer_method') IN ('mcq', 'typed', 'voice', 'scan')
      THEN (r->>'answer_method')
      ELSE 'mcq'
    END;

    -- D6 (2026-08-07, Phase 2): confidence — regex-guard 1..5, else NULL.
    v_confidence := CASE
      WHEN (r->>'confidence') ~ '^[1-5]$' THEN (r->>'confidence')::SMALLINT
      ELSE NULL
    END;

    -- D2 (2026-08-07, Phase 2): the existing per-question snapshot SELECT is
    -- extended to also read the SERVER-HELD snapshot version + integrity hash
    -- (written by start_quiz_session; NOT NULL since 20260504100500). Zero
    -- client trust — the client cannot influence either value.
    SELECT shuffle_map, correct_answer_index_snapshot, options_snapshot,
           options_version_at_serve, integrity_hash
      INTO v_shuffle, v_correct_idx_snapshot, v_options_snapshot,
           v_options_version_at_serve, v_integrity_hash
      FROM quiz_session_shuffles
     WHERE session_id = p_session_id AND question_id = v_question_id;

    -- P0 (20260814000016): same server-only lane decision as the first pass.
    v_q_type := NULL;
    SELECT question_type INTO v_q_type FROM question_bank WHERE id = v_question_id;

    v_is_written := (
         v_correct_idx_snapshot IS NULL
      OR v_options_snapshot IS NULL
      OR jsonb_typeof(v_options_snapshot) <> 'array'
      OR jsonb_array_length(v_options_snapshot) <> 4
    ) AND lower(COALESCE(v_q_type, '')) NOT IN ('mcq', 'multiple_choice', 'objective');

    IF NOT v_is_written AND v_correct_idx_snapshot IS NULL THEN
      RAISE EXCEPTION
        'session_not_started: quiz_session_shuffles row missing in second pass for session_id=%, question_id=%',
        p_session_id, v_question_id
        USING ERRCODE = 'P0001';
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

    -- P0 (20260814000016): explicit per-iteration reset of the written-answer
    -- columns so an MCQ row can never inherit the previous row's marks.
    v_marks_awarded := CASE
      WHEN (r->>'marks_awarded') ~ '^[0-9]+(\.[0-9]+)?$' THEN (r->>'marks_awarded')::NUMERIC
      ELSE NULL
    END;
    v_marks_possible := CASE
      WHEN (r->>'marks_possible') ~ '^[0-9]+(\.[0-9]+)?$' THEN (r->>'marks_possible')::NUMERIC
      ELSE NULL
    END;
    v_student_answer_text := NULLIF(r->>'student_answer_text', '');
    v_rubric_feedback     := NULLIF(r->>'rubric_feedback', '');

    IF v_is_written THEN
      v_marks_possible := COALESCE(v_marks_possible, 0);
      v_marks_awarded  := COALESCE(v_marks_awarded, 0);
      v_marks_awarded  := LEAST(GREATEST(v_marks_awarded, 0), v_marks_possible);
      v_selected_orig  := NULL;
      v_is_correct     := (v_marks_possible > 0 AND v_marks_awarded >= v_marks_possible * 0.5);
    ELSE
      -- MCQ lane: the written columns stay NULL so quiz_responses keeps its
      -- documented "NULL for MCQ" semantics (baseline:12229-12235).
      v_marks_awarded       := NULL;
      v_marks_possible      := NULL;
      v_student_answer_text := NULL;
      v_rubric_feedback     := NULL;

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
    END IF;

    -- Phase 3 (20260809000500): unhinted-mastery tally. hint_level = 0 means
    -- the client EXPLICITLY reported "answered with no hint"; NULL (not
    -- reported / legacy clients) deliberately earns nothing.
    IF v_is_correct AND v_hint_level = 0 THEN
      v_unhinted_count := v_unhinted_count + 1;
    END IF;

    IF v_options_snapshot IS NOT NULL
       AND jsonb_typeof(v_options_snapshot) = 'array'
       AND v_correct_idx_snapshot IS NOT NULL
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

    -- D7 (2026-08-07, Phase 2): wrong-answer misconception match on the TRUE
    -- ORIGINAL-space distractor index this RPC already re-derived from the
    -- server shuffle snapshot. Explicit per-iteration reset — a correct answer
    -- must never inherit the previous iteration's match. (A written response
    -- has v_selected_orig NULL and is skipped: there is no distractor.)
    v_misconception_id := NULL;
    v_misconception_code := NULL;
    IF NOT v_is_correct
       AND v_selected_orig IS NOT NULL
       AND v_selected_orig BETWEEN 0 AND 3 THEN
      SELECT qm.id, qm.misconception_code
        INTO v_misconception_id, v_misconception_code
        FROM question_misconceptions qm
       WHERE qm.question_id = v_question_id
         AND qm.distractor_index = v_selected_orig
       LIMIT 1;
    END IF;

    -- COLUMN-NAME CORRECTION: student_answer_index + time_taken_seconds are the
    -- canonical columns (NOT selected_option / time_spent_seconds — phantom).
    -- F8 (2026-08-05): hint_level added.
    -- Phase 2 (2026-08-07): question_version, content_hash, answer_method,
    -- confidence, misconception_id added (columns from 20260807000200).
    -- P0 (20260814000016): student_answer_text / marks_awarded /
    -- rubric_feedback / marks added — the written answer is now RECORDED, not
    -- just scored. All four columns pre-exist (baseline:12207-12225) and were
    -- added for written answers; v2 had simply never populated them. MCQ rows
    -- get NULL in the first three and marks = 1, which is the column default,
    -- so nothing about an MCQ row changes.
    INSERT INTO quiz_responses (
      quiz_session_id, student_id, question_id, student_answer_index,
      is_correct, time_taken_seconds,
      question_number, question_text, question_type,
      shuffle_map, error_type, hint_level,
      question_version, content_hash, answer_method, confidence,
      misconception_id,
      student_answer_text, marks_awarded, rubric_feedback, marks
    ) VALUES (
      v_quiz_session_id, p_student_id, v_question_id, v_selected_displayed,
      v_is_correct, COALESCE((r->>'time_spent')::INTEGER, 0),
      v_q_number, v_q_text, v_q_type,
      v_shuffle, v_error_type, v_hint_level,
      v_options_version_at_serve, v_integrity_hash, v_answer_method, v_confidence,
      v_misconception_id,
      v_student_answer_text, v_marks_awarded, v_rubric_feedback,
      COALESCE(v_marks_possible, 1)::INT
    ) ON CONFLICT DO NOTHING;

    -- Phase 2 (6): student_misconceptions lifecycle. ERROR-ISOLATED — a
    -- failure here must NEVER abort the submit transaction (P4). Free-text
    -- columns (question_text / student_answer / correct_answer) stay NULL (P13).
    BEGIN
      IF NOT v_is_correct
         AND v_misconception_id IS NOT NULL
         AND v_misconception_code IS NOT NULL
         AND v_q_topic_id IS NOT NULL THEN
        -- Wrong + curated mapping matched -> ONE open row per
        -- (student, pattern, concept); re-detection bumps detected_at.
        INSERT INTO student_misconceptions (
          student_id, pattern_code, concept_code, detected_at, is_resolved
        ) VALUES (
          p_student_id, v_misconception_code, v_q_topic_id::text, now(), false
        )
        ON CONFLICT (student_id, pattern_code, concept_code)
          WHERE is_resolved = false
        DO UPDATE SET detected_at = now();
      ELSIF v_is_correct AND v_q_topic_id IS NOT NULL THEN
        -- Correct on a question whose curated mappings match an open row for
        -- the same student + pattern + concept -> resolve it.
        UPDATE student_misconceptions sm
           SET is_resolved         = true,
               resolved_at         = now(),
               resolution_method   = 'quiz_correct',
               attempts_to_resolve = COALESCE(sm.attempts_to_resolve, 0) + 1
         WHERE sm.student_id  = p_student_id
           AND sm.is_resolved = false
           AND sm.concept_code = v_q_topic_id::text
           AND sm.pattern_code IN (
                 SELECT qm.misconception_code
                   FROM question_misconceptions qm
                  WHERE qm.question_id = v_question_id
               );
      END IF;
    EXCEPTION WHEN OTHERS THEN
      NULL;  -- lifecycle is best-effort telemetry; never aborts submit (P4)
    END;

    IF v_q_topic_id IS NOT NULL THEN
      BEGIN
        -- Phase 2 (1): v_hint_level passed through as the new 8th positional
        -- arg (20260807000400) so evidence counters see the hint tier.
        PERFORM update_learner_state_post_quiz(
          p_student_id,
          v_q_topic_id,
          v_is_correct,
          v_q_bloom,
          v_error_type,                                      -- PART C: COMPUTED value
          COALESCE((r->>'time_spent')::INT, 0) * 1000,
          v_q_difficulty,
          v_hint_level
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

  -- FIX F5 (2026-07-29): read the CAPPED amount back from the exact ledger row
  -- the 7-arg atomic_quiz_profile_update just wrote (it RETURNS VOID, so its
  -- internal P2 daily-cap clamp never reached this function's return value).
  -- No ledger row exists when the cap was already fully reached before this
  -- call — that case correctly resolves to effective XP = 0 below.
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

  -- Phase 3 (20260809000500): unhinted-mastery bonus — SEPARATE capped lane
  -- via award_xp_capped (20260809000300). daily_category 'unhinted_mastery'
  -- has its own cap (v_unhinted_cap_eff); it does NOT consume the 200 XP
  -- 'quiz' cap. reference_id keyed to the session -> a replayed submission
  -- cannot double-award. Gated on NOT v_flagged (P3: flagged earns nothing).
  -- ERROR-ISOLATED: the bonus lane can never abort the submit (P4).
  IF NOT v_flagged AND v_unhinted_count > 0 AND v_unhinted_rate > 0 THEN
    BEGIN
      v_unhinted_award := award_xp_capped(
        p_student_id,
        'unhinted_mastery',
        v_unhinted_count * v_unhinted_rate,
        v_unhinted_cap_eff,
        'unhinted_mastery',
        'unhinted_' || v_quiz_session_id::text,
        jsonb_build_object(
          'quiz_session_id', v_quiz_session_id,
          'unhinted_correct', v_unhinted_count,
          'per_question_xp', v_unhinted_rate
        )
      );
      v_unhinted_bonus := COALESCE((v_unhinted_award->>'effective_xp')::INT, 0);
    EXCEPTION WHEN OTHERS THEN
      v_unhinted_bonus := 0;
      RAISE NOTICE 'submit_quiz_results_v2: award_xp_capped(unhinted_mastery) failed for student=% session=% (non-fatal): %',
        p_student_id, v_quiz_session_id, SQLERRM;
    END;
  END IF;

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
    'questions', v_review_questions,
    -- Phase 3 (20260809000500): ADDITIVE keys — quiz-lane xp_earned above is
    -- unchanged; the bonus rides its own ledger lane.
    'unhinted_correct', v_unhinted_count,
    'unhinted_bonus_xp', v_unhinted_bonus
  );
END;
$$;

COMMENT ON FUNCTION public.submit_quiz_results_v2(UUID, UUID, TEXT, TEXT, TEXT, INTEGER, JSONB, INTEGER, UUID, INTEGER, INTEGER) IS
  'v2 server-shuffle quiz submission RPC. P1/P2/P3/P4 formulas unchanged. '
  'FIX 2026-07-29 (forensic audit F1/F7/F5): Anti-Cheat Check 3 counts served '
  'questions from quiz_session_shuffles; the daily XP cap is read back from '
  'the ledger and reflected in quiz_sessions.score + xp_earned/xp_capped. '
  'ADDITIVE 2026-08-05 (Foxy North-Star F8): per-response "hint_level". '
  'ADDITIVE 2026-08-07 (Phase 2 event capture): hint_level to '
  'update_learner_state_post_quiz; snapshot version/hash persisted; '
  'answer_method whitelisted; confidence regex-guarded; misconception match + '
  'error-isolated lifecycle. '
  'ADDITIVE 2026-08-09 (Phase 3): p_unhinted_xp/p_unhinted_cap params and the '
  'capped unhinted_mastery bonus lane. '
  'P0 FIX 2026-08-11 (20260814000016): WRITTEN (non-MCQ) responses no longer '
  'abort the submission. Each response is classified into an MCQ lane or a '
  'written lane from SERVER state only (the serve-time options_snapshot plus '
  'question_bank.question_type — the client cannot elect its lane). The '
  'session_not_started P0001 RAISE is preserved for MCQ responses with no '
  'snapshot row. Written correctness is derived from the AI rubric marks '
  '(marks_awarded >= marks_possible * 0.5 — the same rule the student was '
  'shown), regex-guarded and clamped, and the answer text + marks + rubric '
  'feedback are now persisted to the pre-existing quiz_responses columns. '
  'Before this fix ANY quiz containing at least one non-MCQ question could '
  'not be submitted at all: the RPC raised before any anti-cheat check, no '
  'quiz_sessions row was written and the student lost the whole attempt.';

-- Re-pin the grant posture (idempotent; the signature is unchanged so the
-- existing grants survive CREATE OR REPLACE, but pin it explicitly per
-- 20260515000002 + 20260707020000).
REVOKE ALL ON FUNCTION public.submit_quiz_results_v2(UUID, UUID, TEXT, TEXT, TEXT, INTEGER, JSONB, INTEGER, UUID, INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.submit_quiz_results_v2(UUID, UUID, TEXT, TEXT, TEXT, INTEGER, JSONB, INTEGER, UUID, INTEGER, INTEGER) FROM anon;
GRANT EXECUTE ON FUNCTION public.submit_quiz_results_v2(UUID, UUID, TEXT, TEXT, TEXT, INTEGER, JSONB, INTEGER, UUID, INTEGER, INTEGER) TO authenticated, service_role;

COMMIT;

-- End of migration: 20260814000016_submit_quiz_v2_written_answer_scoring.sql
-- Tables touched:    none (quiz_responses columns all pre-exist)
-- Functions touched: submit_quiz_results_v2 (CREATE OR REPLACE, same signature)
-- Triggers touched:  none
-- RLS touched:       none
