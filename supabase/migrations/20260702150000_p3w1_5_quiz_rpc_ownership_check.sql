-- Migration: 20260702150000_p3w1_5_quiz_rpc_ownership_check.sql
-- Purpose: Phase 3 Wave 1 #5 (HIGH). Close a cross-student authorization-bypass
--          gap identified by the Phase 2 security audit SD-SWEEP
--          (docs/audit/2026-07-02-validation/10-security-audit.md):
--
--   public.submit_quiz_results(p_student_id, p_subject, p_grade, ...)          [legacy v1]
--   public.atomic_quiz_profile_update(p_student_id, p_subject, p_xp,
--     p_total, p_correct, p_time_seconds)                        RETURNS jsonb [6-arg]
--   public.atomic_quiz_profile_update(p_student_id, p_subject, p_xp,
--     p_total, p_correct, p_time_seconds, p_session_id)          RETURNS void  [7-arg]
--
-- are all SECURITY DEFINER, take a caller-supplied p_student_id, have NO
-- internal ownership check, and have NEVER had EXECUTE revoked from the
-- `authenticated` role (only `anon` was revoked — see 20260515000002 line 224
-- and 20260610000000/20260623000600 lines revoking the two
-- atomic_quiz_profile_update overloads from anon). Any authenticated JWT
-- holder can therefore call these RPCs directly via PostgREST
-- (`supabase.rpc('submit_quiz_results', { p_student_id: '<victim>', ... })`)
-- with an ARBITRARY p_student_id and write quiz sessions / XP / streaks /
-- learning-profile rows onto another student's account, bypassing every
-- app-layer check.
--
-- Contrast: submit_quiz_results_v2 already carries the correct check
-- (baseline ~7629-7634):
--     IF auth.uid() IS NOT NULL AND NOT EXISTS (
--       SELECT 1 FROM students WHERE id = p_student_id AND auth_user_id = auth.uid()
--     ) THEN RAISE EXCEPTION ...
-- This migration applies the IDENTICAL pattern to the three functions above.
--
-- ─── Why "add the check" and NOT "REVOKE EXECUTE FROM authenticated" ─────────
-- The minimal-risk fix depends on who legitimately calls these RPCs today:
--   * src/lib/supabase.ts        (submitQuizResults)  — calls submit_quiz_results
--     (v1 fallback) AND atomic_quiz_profile_update WITH p_session_id (7-arg),
--     via the browser anon-key client bound to the student's own session
--     (src/lib/supabase-client.ts -> createClient(url, anon key, ...)). This
--     resolves to Postgres role `authenticated` at the DB layer.
--   * src/lib/domains/quiz.ts    (submitQuizSession) — calls submit_quiz_results
--     (Path 1) AND atomic_quiz_profile_update WITHOUT p_session_id (6-arg),
--     same browser anon-key client (imports `supabase` from '@/lib/supabase').
--   * src/lib/domains/profile.ts (updateXpAndProfile) — calls
--     atomic_quiz_profile_update WITHOUT p_session_id (6-arg), same client.
--   * src/__tests__/migrations/atomic-quiz-xp-42p10-e2e.test.ts (integration
--     lane) calls the 7-arg overload directly with a SERVICE-ROLE client
--     (the Supabase service-role secret) — auth.uid() is NULL in that context.
-- So legitimate callers span BOTH JWT-bound `authenticated` (browser) and
-- service_role (integration test / any future server-side admin path).
-- `REVOKE EXECUTE ... FROM authenticated` would break every real student's
-- quiz submission — unacceptable. Service-role bypasses GRANT/REVOKE (and
-- RLS) entirely regardless, so revoking would not even add protection there.
--
-- The `auth.uid() IS NOT NULL AND NOT EXISTS (...)` guard (identical to
-- submit_quiz_results_v2) is therefore the correct minimal-risk fix:
--   * authenticated caller, p_student_id = own student  -> check passes (no-op)
--   * authenticated caller, p_student_id = ANOTHER student -> RAISE EXCEPTION
--   * service_role caller (auth.uid() IS NULL)           -> check short-circuits,
--     skipped entirely (service role already bypasses RLS; this is purely an
--     app-level ownership assertion, not a privilege boundary)
-- This is purely ADDITIVE for every legitimate caller (they already pass their
-- own student id) and closes the exploit for every illegitimate one.
--
-- ─── Scope note: one function added beyond the two named in the ticket ──────
-- The ticket named submit_quiz_results (v1) and "the 6-argument overload of
-- atomic_quiz_profile_update". Investigation found the 7-argument overload
-- (RETURNS VOID, with p_session_id) shares the IDENTICAL defect: same missing
-- check, same SECURITY DEFINER, same caller-supplied p_student_id, same
-- EXECUTE-not-revoked-from-authenticated, and is independently reachable via
-- PostgREST with p_session_id omitted/null (it has a DEFAULT) using the exact
-- same browser JWT-bound client (src/lib/supabase.ts:566). Leaving it
-- unpatched would leave the exploit trivially reachable via the sibling
-- overload, so it is included here under the ticket's "unless it shares the
-- same defect" carve-out. Flagged explicitly for review.
--
-- Also flagged (NOT fixed here — do not silently expand scope further):
--   * atomic_quiz_profile_update(p_student_id, p_xp, p_correct, p_total)   [4-arg]
--     delegates via PERFORM into the 7-arg overload (baseline ~647-655), so it
--     is TRANSITIVELY protected by this migration (auth.uid() is a session-level
--     GUC, unaffected by the nested SECURITY DEFINER call) — no separate check
--     needed.
--   * atomic_quiz_profile_update(p_student_id, p_xp, p_correct, p_total, p_subject) [5-arg]
--     does NOT delegate (baseline ~663-714, separate body), is NOT called by any
--     current application code (no source call site matches its parameter
--     names), but IS still SECURITY DEFINER with EXECUTE un-revoked from
--     authenticated and has NO ownership check and NO daily-XP-cap enforcement.
--     This is a live but currently-orphaned attack surface — recommend a
--     follow-up ticket.
--   * submit_quiz_results_rpc / submit_quiz_results_safe — thin wrappers that
--     delegate into submit_quiz_results (v1), so they inherit this fix
--     transitively. Not redefined here.
--
-- ─── Safety ───────────────────────────────────────────────────────────────
-- * Idempotent: CREATE OR REPLACE FUNCTION, safe to re-run.
-- * No DROP of any kind.
-- * P1 (score formula), P2 (XP formula + 200 daily cap), P4 (atomic submission)
--   bodies are copied VERBATIM from the current live definitions (baseline
--   00000000000000 for submit_quiz_results; 20260610000000 for the 6-arg
--   atomic_quiz_profile_update; 20260623000600 for the 7-arg
--   atomic_quiz_profile_update, which carries the 42P10 ON CONFLICT fix). The
--   ONLY executable change in each function is the new ownership-check block
--   inserted immediately after BEGIN.
-- * SET search_path is preserved/re-asserted on every function (submit_quiz_results
--   was pinned to `public, pg_catalog` via ALTER FUNCTION in 20260516010000;
--   both atomic_quiz_profile_update overloads already carry
--   `SET search_path = public, pg_temp`).
-- * REVOKE EXECUTE ... FROM anon is re-asserted (idempotent no-op; anon was
--   already revoked by prior migrations) for defense in depth. EXECUTE is
--   intentionally LEFT GRANTED to `authenticated` (see rationale above) and is
--   irrelevant to `service_role` (bypasses GRANT/REVOKE).

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. submit_quiz_results (legacy v1) — add ownership check
-- ═══════════════════════════════════════════════════════════════════════════
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

  IF jsonb_array_length(p_responses) != v_total THEN
    v_flagged := true;
  END IF;

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

COMMENT ON FUNCTION public.submit_quiz_results(uuid, text, text, text, integer, jsonb, integer) IS
  'Legacy v1 quiz-submission RPC (mobile + web fallback). SECURITY DEFINER: needs '
  'elevated privileges to write quiz_sessions/quiz_responses/xp/student_learning_profiles '
  'in one transaction (P4). SECURITY FIX 2026-07-02 (Phase 3 Wave 1 #5): added the '
  'auth.uid()-scoped ownership check (same pattern as submit_quiz_results_v2) so an '
  'authenticated caller can no longer submit results onto an arbitrary student_id. '
  'P1/P2/P3/P4 formulas unchanged.';

REVOKE EXECUTE ON FUNCTION public.submit_quiz_results(uuid, text, text, text, integer, jsonb, integer) FROM anon;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. atomic_quiz_profile_update — 6-arg overload (RETURNS jsonb) — add check
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

  -- ── 1. Compute today's already-earned XP from quiz_sessions ────────
  SELECT COALESCE(SUM(xp_earned), 0)::INT
    INTO v_today_earned
    FROM public.quiz_sessions
   WHERE student_id = p_student_id
     AND completed_at IS NOT NULL
     AND completed_at >= CURRENT_DATE
     AND completed_at <  (CURRENT_DATE + INTERVAL '1 day');

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
  UPDATE public.students SET
    xp_total = COALESCE(xp_total, 0) + v_effective_xp,
    last_active = NOW(),
    streak_days = CASE
      WHEN last_active::date = CURRENT_DATE THEN COALESCE(streak_days, 1)
      WHEN last_active::date = CURRENT_DATE - 1 THEN COALESCE(streak_days, 0) + 1
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
  'SECURITY FIX 2026-07-02 (Phase 3 Wave 1 #5): added the auth.uid()-scoped ownership '
  'check (same pattern as submit_quiz_results_v2) so an authenticated caller can no '
  'longer write XP/profile rows onto an arbitrary student_id. P2 cap math unchanged.';

REVOKE EXECUTE ON FUNCTION public.atomic_quiz_profile_update(UUID, TEXT, INT, INT, INT, INT) FROM anon;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. atomic_quiz_profile_update — 7-arg overload (RETURNS void) — add check
--    (scope expansion beyond the ticket's literal two functions — see the
--    header comment "Scope note" above for the full justification.)
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

  -- ── Normalise subject ──────────────────────────────────────────────────────
  v_subject_clean := CASE WHEN p_subject IS NULL OR p_subject = 'unknown'
                          THEN NULL ELSE p_subject END;

  -- ── Step 1: Compute today's already-awarded quiz XP (IST date boundary) ───
  -- P2: daily quiz XP cap = 200. Uses the ledger as the authoritative source.
  SELECT COALESCE(SUM(amount), 0)
    INTO v_today_quiz_xp
  FROM public.xp_transactions
  WHERE student_id    = p_student_id
    AND daily_category = 'quiz'
    AND created_at    >= (CURRENT_DATE AT TIME ZONE 'Asia/Kolkata');

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
      -- award_xp sets last_active = now() on students, so the streak UPDATE
      -- below will read the correct last_active value.
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
  -- award_xp/direct UPDATE above set last_active = NOW() but do not compute
  -- streaks. We read the pre-NOW() last_active via a CASE on last_active::date.
  -- This UPDATE also sets last_active so it is always refreshed.
  UPDATE public.students SET
    last_active = NOW(),
    streak_days = CASE
      WHEN last_active::date = CURRENT_DATE     THEN COALESCE(streak_days, 1)
      WHEN last_active::date = CURRENT_DATE - 1 THEN COALESCE(streak_days, 0) + 1
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
  'added the auth.uid()-scoped ownership check (same pattern as '
  'submit_quiz_results_v2) so an authenticated caller can no longer write '
  'XP/profile/ledger/event rows onto an arbitrary student_id; skipped for '
  'service-role callers (auth.uid() IS NULL). SECURITY DEFINER; search_path pinned.';

REVOKE EXECUTE ON FUNCTION public.atomic_quiz_profile_update(UUID, TEXT, INT, INT, INT, INT, UUID) FROM anon;

COMMIT;

-- End of migration: 20260702150000_p3w1_5_quiz_rpc_ownership_check.sql
