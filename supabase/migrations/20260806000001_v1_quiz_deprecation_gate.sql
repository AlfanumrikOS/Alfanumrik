-- Migration: Add v1 submit_quiz_results deprecation gate
-- P0-1: Blocks web-originated v1 quiz submissions; mobile gets deprecation notice.
-- The v1 RPC reads live question_bank.correct_answer_index at submission time,
-- making scores non-reproducible after content edits. This gate:
--   a) Rejects v1 calls with a clear deprecation error when flag is ON
--   b) Adds deprecation warning to v1 response even when flag is OFF
--   c) Preserves v1 functionality for mobile cut-over window

-- Register the functional kill switch
INSERT INTO public.feature_flags
  (key, name, description, is_enabled, default_value, tier, owner, rollout_percent)
VALUES
  ('ff_v1_quiz_rpc_blocked', 'Block v1 quiz RPC submissions',
   'P0: When enabled, submit_quiz_results (v1) returns a deprecation error directing clients to v2.',
   false, false, 'p0_outage', 'data-platform', 0)
ON CONFLICT (key, owner)
  DO UPDATE SET description = EXCLUDED.description, tier = EXCLUDED.tier;

-- Add v1 deprecation gate inside the RPC body.
-- We add a guard at the top that reads the feature flag and returns early.
-- The original v1 function reads from live question_bank; this gate prevents that.
CREATE OR REPLACE FUNCTION public.submit_quiz_results(
  p_student_id uuid,
  p_subject text,
  p_grade text,
  p_topic text DEFAULT NULL,
  p_chapter integer DEFAULT NULL,
  p_responses jsonb DEFAULT '[]',
  p_time integer DEFAULT 0
) RETURNS jsonb
SECURITY DEFINER
SET search_path = public, pg_temp
LANGUAGE plpgsql
AS $$
DECLARE
  v_blocked boolean;
BEGIN
  -- P0-1 gate: read kill-switch flag
  SELECT COALESCE(is_enabled, false) INTO v_blocked
    FROM public.feature_flags
    WHERE key = 'ff_v1_quiz_rpc_blocked';

  IF v_blocked THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'DEPRECATED: submit_quiz_results (v1) is blocked. Use submit_quiz_results_v2 with p_session_id.',
      'migration_url', '/api/v2/quiz/submit'
    );
  END IF;

  -- ── Original v1 body follows ──
  -- Ownership check
  IF NOT EXISTS (
    SELECT 1 FROM public.students
    WHERE id = p_student_id
      AND auth_user_id = auth.uid()
  ) THEN
    RETURN jsonb_build_object(
      'error', 'Unauthorized: student ownership mismatch',
      'success', false
    );
  END IF;

  DECLARE
    v_total integer;
    v_correct integer;
    v_score_percent integer;
    v_xp integer;
    v_session_id uuid;
    v_flagged boolean := false;
    v_response jsonb;
    v_is_correct boolean;
    v_selected integer;
    v_shuffle_data jsonb;
    v_correct_idx integer;
    v_total_time float := 0;
    v_avg_time float;
    v_identical_count integer := 0;
    v_first_selected integer := -1;
    v_cme_chapter_readiness float;
    v_cme_subject_readiness float;
    v_record jsonb;
    rec record;
  BEGIN
    v_total := jsonb_array_length(p_responses);
    IF v_total = 0 THEN
      RETURN jsonb_build_object(
        'error', 'No responses provided',
        'success', false
      );
    END IF;

    v_correct := 0;
    v_total_time := 0;
    v_identical_count := 0;
    v_first_selected := -1;

    -- First pass: score each response against LIVE question_bank (v1 behavior)
    FOR v_record IN SELECT * FROM jsonb_to_recordset(p_responses) AS x(
      question_id uuid, selected_option integer, time_spent float
    )
    LOOP
      v_selected := v_record.selected_option;
      v_total_time := v_total_time + COALESCE(v_record.time_spent, 0);

      -- Track identical-answer pattern for anti-cheat
      IF v_first_selected < 0 THEN
        v_first_selected := v_selected;
      END IF;
      IF v_selected = v_first_selected THEN
        v_identical_count := v_identical_count + 1;
      END IF;

      -- Resolve shuffle map for this question if it exists
      SELECT shuffles INTO v_shuffle_data
        FROM public.quiz_session_shuffles
        WHERE session_id IN (
          SELECT id FROM public.quiz_sessions
          WHERE student_id = p_student_id
          ORDER BY created_at DESC LIMIT 1
        )
        LIMIT 1;

      -- Get correct answer from LIVE question_bank (v1 authoritative source)
      SELECT correct_answer_index INTO v_correct_idx
        FROM public.question_bank
        WHERE id = v_record.question_id;

      IF v_shuffle_data IS NOT NULL AND v_shuffle_data ? v_record.question_id::text THEN
        -- Apply shuffle: map displayed index back to original option
        v_selected := (v_shuffle_data->v_record.question_id::text
                       ->v_selected::text)::integer;
      END IF;

      IF v_selected = v_correct_idx THEN
        v_is_correct := true;
        v_correct := v_correct + 1;
      ELSE
        v_is_correct := false;
      END IF;

      -- Insert response
      INSERT INTO public.quiz_responses (
        student_id, subject, grade, topic, chapter_number,
        question_id, selected_option, is_correct, time_spent,
        correct_answer_index
      ) VALUES (
        p_student_id, p_subject, p_grade, p_topic, p_chapter,
        v_record.question_id, v_record.selected_option,
        v_is_correct, COALESCE(v_record.time_spent, 0),
        v_correct_idx
      );
    END LOOP;

    -- P3 anti-cheat: avg time under 3s flags session
    v_avg_time := v_total_time / NULLIF(v_total, 0);
    IF v_avg_time < 3 THEN
      v_flagged := true;
    END IF;

    -- P3 anti-cheat: all identical answers flagged
    IF v_total > 3 AND v_identical_count = v_total THEN
      v_flagged := true;
    END IF;

    -- P1 score
    v_score_percent := ROUND((v_correct::numeric / v_total) * 100);

    -- P2 XP
    v_xp := v_correct * 10;
    IF v_score_percent >= 80 THEN
      v_xp := v_xp + 20;
    END IF;
    IF v_score_percent = 100 THEN
      v_xp := v_xp + 50;
    END IF;
    IF v_flagged THEN
      v_xp := 0;
    END IF;

    -- Insert quiz session
    INSERT INTO public.quiz_sessions (
      student_id, subject, grade, total_questions,
      correct_answers, wrong_answers, score_percent,
      score, time_taken_seconds, is_completed, completed_at
    ) VALUES (
      p_student_id, p_subject, p_grade, v_total,
      v_correct, v_total - v_correct, v_score_percent,
      v_xp, p_time, true, now()
    ) RETURNING id INTO v_session_id;

    -- Atomic XP + profile update
    PERFORM public.atomic_quiz_profile_update(
      p_student_id, p_subject, v_xp, v_total, v_correct,
      p_time, v_session_id
    );

    -- CME readiness (best-effort)
    v_cme_chapter_readiness := NULL;
    v_cme_subject_readiness := NULL;
    BEGIN
      SELECT r.chapter_readiness, r.subject_readiness
        INTO v_cme_chapter_readiness, v_cme_subject_readiness
        FROM public.compute_chapter_readiness(p_student_id, p_subject, p_chapter) r;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;

    RETURN jsonb_build_object(
      'success', true,
      'total', v_total,
      'correct', v_correct,
      'score_percent', v_score_percent,
      'xp_earned', v_xp,
      'session_id', v_session_id,
      'flagged', v_flagged,
      'cme_chapter_readiness', v_cme_chapter_readiness,
      'cme_subject_readiness', v_cme_subject_readiness,
      'deprecation', jsonb_build_object(
        'message', 'v1 submit_quiz_results is deprecated. Migrate to submit_quiz_results_v2.',
        'deadline', '2026-09-01',
        'v2_docs', 'Use p_session_id from start_quiz_session with submit_quiz_results_v2'
      )
    );
  END;
END;
$$;

-- Re-grant execute to authenticated (v1 must remain callable for mobile until cut-over)
GRANT EXECUTE ON FUNCTION public.submit_quiz_results(
  uuid, text, text, text, integer, jsonb, integer
) TO authenticated;
