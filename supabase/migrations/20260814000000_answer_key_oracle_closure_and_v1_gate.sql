-- Migration: 20260814000000_answer_key_oracle_closure_and_v1_gate.sql
-- Audit remediation (2026-08-14) — closes findings from the backend+DB audit:
--
--   C1 (Critical): get_question_answer_key() was an UNGUARDED SECURITY DEFINER
--      answer-key oracle granted to authenticated (20260806000004). Zero callers
--      exist anywhere in apps/packages/mobile/supabase. Revoke authenticated
--      EXECUTE; keep service_role so a future gated server path can still use it.
--   H2 (High):     get_pending_link_requests(p_student_auth_id) — SECURITY
--      DEFINER, no ownership check, re-granted to authenticated (20260707000000).
--      Add the same auth.uid() ownership guard used by submit_quiz_results_v2.
--   H3/F5 (High):  select_questions_by_irt_info_v2 returned correct_answer_index
--      to authenticated (20260809000100, SECURITY INVOKER riding the USING(true)
--      question_bank policy). Zero callers — revoke authenticated EXECUTE.
--   H1 (High):     legacy submit_quiz_results v1 RPC regrades against LIVE
--      question_bank.correct_answer_index at submit time (non-reproducible after
--      content edits). Wire the ff_v1_quiz_rpc_blocked kill switch (registered by
--      20260806000001 but never enforced): when ON, the RPC refuses to grade.
--      Default OFF → no behavior change until ops flips it after mobile is fully
--      on v2. Body preserved byte-for-byte from 20260707010000 (scoring fidelity).
--   C2 (documented residual, NOT closed here): question_bank.correct_answer_index
--      and the answer-key TEXT columns (correct_answer_text, solution_steps,
--      expected_answer) remain readable by any authenticated user via the
--      question_bank_authenticated_read USING(true) policy (20260728090000) and the
--      SECURITY DEFINER question-provider RPCs (select_quiz_questions_rag/v2), because
--      client-side P6 validation, the PYQ client-graded surface, and the legacy
--      mobile all-columns read legitimately need the key today. Closing this requires
--      the coordinated application change documented in 20260806000004 (relocate P6
--      validation server-side, serve questions via a session-gated RPC that withholds
--      the key until submission, re-point PYQ/mobile). A column-level REVOKE was
--      considered and rejected here: it is a no-op against the table-level SELECT
--      granted by baseline default privileges, and forcing column-level grants would
--      break mobile's legacy `.select()` all-columns read. Tracked as the top
--      remaining risk of this audit.
--
-- Forward-only fix; safe to apply to an existing environment (no destructive DDL).

BEGIN;

-- ──────────────────────────────────────────────────────────────────────────
-- C1: close the get_question_answer_key oracle (revoke authenticated)
-- ──────────────────────────────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.get_question_answer_key(uuid) FROM authenticated;
COMMENT ON FUNCTION public.get_question_answer_key(uuid) IS
  'Answer-key read. service_role only after 20260814000000 (was mistakenly granted '
  'to authenticated; the guard in 20260806000004 is not an authorization check).';

-- ──────────────────────────────────────────────────────────────────────────
-- H2: ownership guard on get_pending_link_requests (caller must BE the student)
-- ──────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION "public"."get_pending_link_requests"("p_student_auth_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE v_student_id UUID; v_result JSONB;
BEGIN
  -- H2 (2026-08-14): cross-user IDOR guard. The only app caller passes the
  -- signed-in student's own auth uid (packages/lib/src/supabase.ts
  -- getPendingParentLinks). auth.uid() NULL ⇒ service-role caller, allowed.
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_student_auth_id THEN
    RAISE EXCEPTION 'Access denied: caller does not own student auth %', p_student_auth_id;
  END IF;
  SELECT id INTO v_student_id FROM public.students WHERE auth_user_id = p_student_auth_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('requests', '[]'::jsonb); END IF;
  SELECT jsonb_agg(jsonb_build_object('link_id', gsl.id, 'guardian_id', gsl.guardian_id, 'guardian_name', g.name, 'guardian_email', g.email, 'relationship', g.relationship, 'requested_at', gsl.created_at)) INTO v_result FROM public.guardian_student_links gsl JOIN public.guardians g ON g.id = gsl.guardian_id WHERE gsl.student_id = v_student_id AND gsl.status = 'pending';
  RETURN jsonb_build_object('requests', COALESCE(v_result, '[]'::jsonb));
END;
$$;

-- ──────────────────────────────────────────────────────────────────────────
-- H3/F5: revoke authenticated EXECUTE on the zero-caller IRT shadow RPC
-- ──────────────────────────────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.select_questions_by_irt_info_v2(uuid, text, text, integer, integer, uuid[]) FROM authenticated;

-- ──────────────────────────────────────────────────────────────────────────
-- C2: (documented residual — no DDL here; see header comment for the coordinated
--      application change that closes the remaining question_bank key exposure)
-- ──────────────────────────────────────────────────────────────────────────

-- ──────────────────────────────────────────────────────────────────────────
-- H1: legacy v1 submit_quiz_results — ff_v1_quiz_rpc_blocked gate
-- Body preserved byte-for-byte from 20260707010000_rca_final_fixes.sql,
-- with the gate injected after the existing ownership check (no scoring change).
-- ──────────────────────────────────────────────────────────────────────────
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
  -- H1 gate (2026-08-14 audit remediation): ff_v1_quiz_rpc_blocked kill switch.
  -- When ON, refuse to grade via the legacy v1 RPC, which reads LIVE
  -- question_bank.correct_answer_index at submit time (non-reproducible after
  -- content edits). The flag is registered by migration 20260806000001 and is
  -- OFF by default, so this gate is inert until ops flips it after mobile is
  -- fully on v2. Applies to every caller (service-role included) so old APKs
  -- pinned to the v1 fallback fail predictably instead of silently re-scoring.
  IF EXISTS (
    SELECT 1 FROM public.feature_flags
    WHERE flag_name = 'ff_v1_quiz_rpc_blocked' AND is_enabled = true
  ) THEN
    RAISE EXCEPTION 'v1_quiz_rpc_blocked: legacy submit_quiz_results disabled; use submit_quiz_results_v2';
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

COMMIT;
