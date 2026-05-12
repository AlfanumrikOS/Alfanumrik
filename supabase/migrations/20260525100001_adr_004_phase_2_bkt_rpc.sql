-- 20260525100001_adr_004_phase_2_bkt_rpc.sql
--
-- ADR-004 Phase 2 / PR 2 of ADR-005 — atomic RPC + BKT SQL function.
--
-- Adds:
--   1. public.bkt_update           IMMUTABLE plpgsql function. Must produce
--                                  the same numeric result as the TS
--                                  updateMasteryBKT (verified within 1e-9
--                                  in src/__tests__/migrations/bkt-sql-parity).
--
--   2. public.tutor_commit_attempt The atomic RPC. In ONE transaction:
--                                    a. take pg_advisory_xact_lock per
--                                       (student, concept)
--                                    b. read chain head's posterior →
--                                       fallback to concept_mastery.mastery_mean
--                                       → DEFAULT pInit=0.30
--                                    c. compute posterior via bkt_update
--                                    d. INSERT concept_attempts(status='answered')
--                                    e. INSERT state_events for
--                                       learner.concept_check_answered
--                                    f. return (seq, prior, posterior, event_id)
--
-- Failure in any step rolls back the whole transaction — no concept_attempts
-- row, no state_events row. The route then INSERTs a status='excluded' row
-- (outside this RPC) so the audit trail records the attempt.
--
-- Spec: docs/superpowers/specs/2026-05-12-adr-004-phase-2-bkt-projector-design.md

-- ────────────────────────────────────────────────────────────────────
-- 1. bkt_update — pure SQL mirror of updateMasteryBKT()
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.bkt_update(
  p_prior     numeric,
  p_correct   boolean,
  p_p_init    numeric DEFAULT 0.30,
  p_p_transit numeric DEFAULT 0.10,
  p_p_guess   numeric DEFAULT 0.20,
  p_p_slip    numeric DEFAULT 0.10
) RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_p         numeric;
  v_post_obs  numeric;
  v_result    numeric;
  v_epsilon   constant numeric := 1e-6;
BEGIN
  -- p_p_init exists for API symmetry with TS DEFAULT_BKT_PARAMS; the
  -- algorithm does not reference it. Reference it here to suppress
  -- unused-parameter warnings and document the intent.
  PERFORM p_p_init;

  -- Clamp prior away from {0,1} to avoid divide-by-zero at extremes.
  v_p := GREATEST(v_epsilon, LEAST(1 - v_epsilon, p_prior));

  IF p_correct THEN
    v_post_obs := (v_p * (1 - p_p_slip)) /
                  ((v_p * (1 - p_p_slip)) + ((1 - v_p) * p_p_guess));
  ELSE
    v_post_obs := (v_p * p_p_slip) /
                  ((v_p * p_p_slip) + ((1 - v_p) * (1 - p_p_guess)));
  END IF;

  v_result := v_post_obs + (1 - v_post_obs) * p_p_transit;

  RETURN GREATEST(v_epsilon, LEAST(1 - v_epsilon, v_result));
END $$;

COMMENT ON FUNCTION public.bkt_update(numeric, boolean, numeric, numeric, numeric, numeric) IS
  'Pure BKT update — must match TS updateMasteryBKT within 1e-9. '
  'Cross-runtime parity is the determinism contract: route''s optimistic '
  'compute and projector''s catch-up compute must agree.';

REVOKE ALL ON FUNCTION public.bkt_update(numeric, boolean, numeric, numeric, numeric, numeric)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bkt_update(numeric, boolean, numeric, numeric, numeric, numeric)
  TO service_role;

-- ────────────────────────────────────────────────────────────────────
-- 2. tutor_commit_attempt — atomic answer+publish under advisory lock
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tutor_commit_attempt(
  p_attempt_id        uuid,
  p_student_id        uuid,
  p_concept_id        uuid,
  p_correct           boolean,
  p_chosen_index      int,
  p_response_time_ms  int,
  p_question_id       text,
  p_subject_code      text,
  p_chapter_number    int,
  p_occurred_at       timestamptz,
  p_event_id          uuid,
  p_idempotency_key   text
) RETURNS TABLE (
  attempt_sequence       int,
  prior_mastery_mean     numeric,
  posterior_mastery_mean numeric,
  event_id               uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_prior      numeric;
  v_seq        int;
  v_posterior  numeric;
  v_auth_user  uuid;
BEGIN
  -- Per-(student, concept) advisory lock. Held until COMMIT. Concurrent
  -- answers serialize through this; out-of-order answers chain in
  -- commit order.
  PERFORM pg_advisory_xact_lock(
    hashtext(p_student_id::text || ':' || p_concept_id::text)
  );

  -- Chain head: latest answered attempt's posterior → fallback to
  -- concept_mastery.mastery_mean (Phase 0 naive value, if any) →
  -- DEFAULT_BKT_PARAMS.pInit (0.30).
  SELECT COALESCE(
    (SELECT posterior_mastery_mean
       FROM public.concept_attempts
      WHERE student_id = p_student_id
        AND concept_id = p_concept_id
        AND status = 'answered'
      ORDER BY attempt_sequence DESC
      LIMIT 1),
    (SELECT mastery_mean
       FROM public.concept_mastery
      WHERE student_id = p_student_id
        AND concept_id = p_concept_id),
    0.30
  ) INTO v_prior;

  -- Next attempt_sequence within (student, concept). Counts answered +
  -- excluded rows so excluded sequence numbers stay monotonic; chain-head
  -- reads filter on status='answered' anyway.
  SELECT COALESCE(MAX(attempt_sequence), 0) + 1
    INTO v_seq
    FROM public.concept_attempts
   WHERE student_id = p_student_id
     AND concept_id = p_concept_id;

  v_posterior := public.bkt_update(v_prior, p_correct);

  -- Resolve actor_auth_user_id for the event envelope.
  SELECT auth_user_id INTO v_auth_user
    FROM public.students
   WHERE id = p_student_id;

  IF v_auth_user IS NULL THEN
    RAISE EXCEPTION
      'tutor_commit_attempt: no student row for student_id=%, refusing to publish event without actor',
      p_student_id;
  END IF;

  -- Append the chain row.
  INSERT INTO public.concept_attempts (
    attempt_id, student_id, concept_id, attempt_sequence,
    served_at, answered_at, correct, chosen_index, response_time_ms,
    prior_mastery_mean, posterior_mastery_mean, status
  ) VALUES (
    p_attempt_id, p_student_id, p_concept_id, v_seq,
    p_occurred_at, p_occurred_at, p_correct, p_chosen_index, p_response_time_ms,
    v_prior, v_posterior, 'answered'
  );

  -- Publish in the same transaction. UNIQUE(idempotency_key) on
  -- state_events makes retries safe.
  INSERT INTO public.state_events (
    event_id, kind, actor_auth_user_id, tenant_id, idempotency_key,
    occurred_at, payload
  ) VALUES (
    p_event_id, 'learner.concept_check_answered', v_auth_user, NULL,
    p_idempotency_key, p_occurred_at,
    jsonb_build_object(
      'studentId',        p_student_id,
      'conceptId',        p_concept_id,
      'attemptId',        p_attempt_id,
      'questionId',       p_question_id,
      'correct',          p_correct,
      'chosenIndex',      p_chosen_index,
      'responseTimeMs',   p_response_time_ms,
      'occurredAt',       to_char(p_occurred_at AT TIME ZONE 'UTC',
                                  'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'attemptSequence',  v_seq,
      'priorMasteryMean', v_prior,
      'eventVersion',     1,
      'subjectCode',      p_subject_code,
      'chapterNumber',    p_chapter_number
    )
  );

  RETURN QUERY SELECT v_seq, v_prior, v_posterior, p_event_id;
END $$;

COMMENT ON FUNCTION public.tutor_commit_attempt IS
  'ADR-004 Phase 2 / ADR-005 Path C v2 — atomic answer commit. Holds '
  'pg_advisory_xact_lock per (student, concept), reads chain head, computes '
  'BKT posterior, inserts concept_attempts row + state_events row in one '
  'transaction. service_role only.';

REVOKE ALL ON FUNCTION public.tutor_commit_attempt(
  uuid, uuid, uuid, boolean, int, int, text, text, int, timestamptz, uuid, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tutor_commit_attempt(
  uuid, uuid, uuid, boolean, int, int, text, text, int, timestamptz, uuid, text
) TO service_role;
