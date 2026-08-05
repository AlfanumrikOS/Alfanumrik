-- Migration: 20260809000500_submit_quiz_v2_unhinted_bonus.sql
-- Purpose: Foxy North-Star Phase 3 — (1) widen the hint_level regex guard in
--   submit_quiz_results_v2 ('^[0-3]$' -> '^[0-5]$', pairing the column-CHECK
--   widen in 20260809000400) and (2) add the capped unhinted-mastery bonus:
--   after scoring, correct answers with hint_level = 0 earn a small bonus via
--   award_xp_capped (20260809000300) in the SAME transaction.
--
-- ─── BODY-COPY STRATEGY (documented design decision) ──────────────────────
-- Source body: copied byte-for-byte from the NEWEST prior definition,
-- 20260807000500_submit_quiz_v2_event_capture.sql (verified newest via grep
-- across supabase/migrations for `submit_quiz_results_v2` on 2026-08-05; the
-- only later hits are under _legacy/, never applied). Per the Phase-3 task's
-- PREFERRED option, this file carries BOTH Phase-3 deltas in ONE body copy —
-- 20260809000400 stayed column-CHECK-only — so the 500-line body is copied
-- once, not twice (one divergence surface instead of two).
--
-- ─── SIGNATURE WIDENING (DROP + CREATE, precedent 20260504100200) ─────────
-- CREATE OR REPLACE cannot extend a function's parameter list — it would
-- create a SECOND overload, and a 9-arg call would then be ambiguous against
-- an 11-param function whose last two have DEFAULTs ("function is not
-- unique"), breaking the live quiz path at runtime. So, exactly as
-- 20260504100200 did when it added p_idempotency_key: DROP the old signature
-- and CREATE the widened one inside this migration's single transaction.
-- This is a function-signature swap, NOT a DROP TABLE/COLUMN. Grants are
-- re-established below for the new signature (REVOKE PUBLIC/anon/
-- authenticated-default, GRANT authenticated + service_role — the posture
-- 20260515000002 + 20260707020000 pinned for the old signature).
--
-- ─── XP-VALUES-AS-PARAMS PATTERN (P2, REG-48-style parity pin) ────────────
-- XP values must not live in SQL. The bonus amount and its daily cap arrive
-- as new DEFAULT-valued params:
--     p_unhinted_xp  INT DEFAULT 2    -- XP per unhinted-correct answer
--     p_unhinted_cap INT DEFAULT 30   -- daily cap for the unhinted lane
-- The TS caller passes both from packages/lib/src/xp-config.ts (companion TS
-- change, assessment-owned: add XP_RULES.unhinted_mastery_bonus = 2 and
-- XP_RULES.unhinted_mastery_daily_cap = 30, plus a parity test pinning these
-- SQL DEFAULTs — and the clamp literals below — to those constants, exactly
-- the REG-48 SQL/TS-parity pattern the quiz daily cap uses). The DEFAULTs
-- exist so legacy 9-arg callers keep working and resolve to the canonical
-- values.
--
-- P2 HARDENING — client cannot RAISE the economy: this RPC is EXECUTE-granted
-- to authenticated (the live web submit calls it directly with the user's
-- JWT), so p_unhinted_xp/p_unhinted_cap are client-suppliable via PostgREST.
-- When auth.uid() IS NOT NULL (browser-originated call) both values are
-- clamped DOWNWARD to the canonical defaults with LEAST() — a client can
-- lower its own bonus (harmless) but can never mint above 2 XP/question or
-- 30 XP/day. Service-role callers (auth.uid() IS NULL) pass unclamped values
-- from xp-config. The clamp literals (2, 30) are the same constants as the
-- param DEFAULTs, adjacent by design: if xp-config ever changes these values
-- (user approval — P2), update DEFAULTs + clamps together in one migration.
-- Parity-sweep safety: these literals appear only as DEFAULTs/LEAST bounds —
-- none of the shapes the xp-sql-literal-parity / xp-6arg-ledger sweeps match
-- (`v_xp := ... * N`, `>= 80 THEN v_xp := v_xp + N`, `= 100 THEN ... + N`,
-- `v_daily_cap INT := N`) are introduced.
--
-- ─── BONUS SEMANTICS ──────────────────────────────────────────────────────
--   * Counted during the existing second pass: responses where v_is_correct
--     AND v_hint_level = 0 (0 = explicitly reported "no hint"; NULL = not
--     reported → NO bonus; legacy clients earn nothing new, no inflation).
--   * Gated on NOT v_flagged (P3: a flagged submission earns zero, bonus
--     included) and on the count/rate being positive.
--   * Awarded via ONE award_xp_capped call: source 'unhinted_mastery'
--     (added to xp_transactions_source_check by 20260809000300),
--     daily_category 'unhinted_mastery' (its own cap lane — does NOT consume
--     the 200 XP 'quiz' cap), reference_id 'unhinted_' || quiz_session_id
--     (idempotent via the partial unique index; a replayed submission cannot
--     double-award). award_xp_capped is service_role-only, but this RPC is
--     SECURITY DEFINER, so the PERFORM executes as the function owner —
--     students still cannot call award_xp_capped directly.
--   * Error-isolated (EXCEPTION -> NOTICE, bonus := 0): the bonus lane can
--     never abort the P4 submit transaction.
--   * Return payload: two ADDITIVE keys, 'unhinted_correct' and
--     'unhinted_bonus_xp'. 'xp_earned' remains the quiz-lane capped amount,
--     unchanged — clients that ignore the new keys behave exactly as before.
--     The early-return paths (idempotent replay, zero responses) do not carry
--     the new keys; replay double-award is impossible via the ledger key.
--   * hint_level's original "telemetry only" doctrine (20260805100200) is
--     consciously superseded FOR THE BONUS LANE ONLY by the CEO-approved
--     Phase-3 design: hint_level now feeds a separate capped bonus, but still
--     feeds NO P1 score / P2 quiz-XP / P3 anti-cheat decision.
--
-- Invariants untouched (diff vs the 20260807000500 body): P1 score formula,
-- P2 quiz XP literals + daily-cap read-back, P3 all three checks, P4 single-
-- RPC atomicity, P5 grade TEXT. Deltas beyond the header list: none.
--
-- Ordering: REQUIRES 20260809000300 (award_xp_capped + 'unhinted_mastery'
-- source) and 20260809000400 (hint_level CHECK 0..5).
-- Owner: architect. Reviewers (P14): assessment (bonus economy), backend,
-- frontend (return-shape additive keys), mobile (11-param contract via
-- defaults — no client change required), testing, quality. Added: 2026-08-05.

BEGIN;

-- CREATE OR REPLACE cannot extend the parameter list (see header). Precedent:
-- 20260504100200.
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
  p_idempotency_key UUID DEFAULT NULL,   -- Phase 2.8 addition (default NULL = legacy path)
  -- Phase 3 (20260809000500): unhinted-mastery bonus economy — DEFAULTs
  -- mirror xp-config (REG-48-style parity pin; see header). Client-supplied
  -- values are clamped downward to these constants when auth.uid() is set.
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
    -- (0 = no hint .. 5). Normalize defensively via a regex guard (no
    -- per-row subtransaction): absent, non-numeric, or out-of-range values
    -- become NULL so a malformed client payload can never violate
    -- quiz_responses_hint_level_check and abort the whole submission
    -- transaction. Phase 3 (20260809000500): range widened 0..3 -> 0..5
    -- (paired with the 20260809000400 CHECK widen); hint_level = 0 on a
    -- correct answer now also feeds the capped unhinted_mastery bonus lane
    -- below — it still feeds NO P1 score / P2 quiz-XP / P3 anti-cheat
    -- decision.
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

    -- Phase 3 (20260809000500): unhinted-mastery tally. hint_level = 0 means
    -- the client EXPLICITLY reported "answered with no hint"; NULL (not
    -- reported / legacy clients) deliberately earns nothing.
    IF v_is_correct AND v_hint_level = 0 THEN
      v_unhinted_count := v_unhinted_count + 1;
    END IF;

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

    -- D7 (2026-08-07, Phase 2): wrong-answer misconception match on the TRUE
    -- ORIGINAL-space distractor index this RPC already re-derived from the
    -- server shuffle snapshot. Explicit per-iteration reset — a correct answer
    -- must never inherit the previous iteration's match.
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
    INSERT INTO quiz_responses (
      quiz_session_id, student_id, question_id, student_answer_index,
      is_correct, time_taken_seconds,
      question_number, question_text, question_type,
      shuffle_map, error_type, hint_level,
      question_version, content_hash, answer_method, confidence,
      misconception_id
    ) VALUES (
      v_quiz_session_id, p_student_id, v_question_id, v_selected_displayed,
      v_is_correct, COALESCE((r->>'time_spent')::INTEGER, 0),
      v_q_number, v_q_text, v_q_type,
      v_shuffle, v_error_type, v_hint_level,
      v_options_version_at_serve, v_integrity_hash, v_answer_method, v_confidence,
      v_misconception_id
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
  'FIX 2026-07-29 (forensic audit F1/F7/F5): Anti-Cheat Check 3 now counts '
  'served questions from quiz_session_shuffles (correctly keyed by '
  'p_session_id) instead of a nonexistent quiz_sessions.question_ids column '
  'joined on the wrong id; the daily XP cap (enforced inside the 7-arg '
  'atomic_quiz_profile_update ledger writer) is now read back and reflected '
  'in both quiz_sessions.score and the returned xp_earned/xp_capped fields. '
  'ADDITIVE 2026-08-05 (Foxy North-Star F8): each p_responses element MAY '
  'carry "hint_level"; valid values persist to quiz_responses.hint_level, '
  'invalid/absent -> NULL. '
  'ADDITIVE 2026-08-07 (Phase 2 event capture, 20260807000500): hint_level '
  'passed to update_learner_state_post_quiz; server-held snapshot version/'
  'hash persist to quiz_responses; answer_method whitelisted; confidence '
  'regex-guarded; misconception match + error-isolated lifecycle (P4, P13). '
  'ADDITIVE 2026-08-09 (Phase 3, 20260809000500): hint_level range widened '
  'to 0..5 (regex ^[0-5]$, CHECK widened by 20260809000400); NEW '
  'p_unhinted_xp/p_unhinted_cap params (DEFAULTs 2/30 mirror xp-config — '
  'REG-48-style parity pin; browser callers clamped DOWNWARD to the defaults '
  'so no client can raise its own bonus); correct answers with hint_level=0 '
  'earn a capped bonus via award_xp_capped (source/daily_category '
  'unhinted_mastery, reference_id unhinted_<session> — idempotent, separate '
  'from the 200 XP quiz cap, error-isolated, zeroed when flagged); return '
  'gains additive keys unhinted_correct + unhinted_bonus_xp.';

-- Re-establish the pinned grant posture for the NEW signature (the DROP above
-- discarded the old signature's grants; default privileges would re-grant
-- authenticated automatically, but we pin the full posture explicitly, per
-- 20260515000002 + 20260707020000).
REVOKE ALL ON FUNCTION public.submit_quiz_results_v2(UUID, UUID, TEXT, TEXT, TEXT, INTEGER, JSONB, INTEGER, UUID, INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.submit_quiz_results_v2(UUID, UUID, TEXT, TEXT, TEXT, INTEGER, JSONB, INTEGER, UUID, INTEGER, INTEGER) FROM anon;
GRANT EXECUTE ON FUNCTION public.submit_quiz_results_v2(UUID, UUID, TEXT, TEXT, TEXT, INTEGER, JSONB, INTEGER, UUID, INTEGER, INTEGER) TO authenticated, service_role;

COMMIT;
