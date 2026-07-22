-- Migration: 20260722097100_submit_mock_test_attempt_snapshot_scoring.sql
-- Purpose:    Phase 2.2 remediation, item 5 of the "Alfanumrik Student
--             Portal — Master Action Plan" (assessment-authored spec).
--             Extends `public.submit_mock_test_attempt` with an optional
--             trailing `p_attempt_id` parameter so cbse_board dynamic
--             attempts (started via the new `start_mock_test_attempt` RPC,
--             companion migration 20260722097000) are scored against their
--             OWN `mock_test_attempts.question_snapshot` row in place,
--             instead of the `WHERE id = v_q_id AND exam_paper_id =
--             p_paper_id` join — that join finds nothing for dynamically-
--             assembled questions, which are pulled from the general
--             question_bank pool and are never linked via exam_paper_id.
--
-- Backward compatibility (P4, P11 — this is a scoring/atomicity-adjacent
--   change, handled with care):
--   - ARCHITECT CORRECTION (2026-07-22 review): the version of this
--     migration as originally authored by backend claimed "adding
--     p_attempt_id as a NEW trailing parameter with DEFAULT NULL ... the
--     function OID is preserved." That claim is FALSE and has been fixed
--     below. Per the CREATE FUNCTION documentation: "It is not possible to
--     change ... argument types of a function [via CREATE OR REPLACE] —
--     if you tried, you would actually be creating a new, distinct
--     function." A function's identity in Postgres is
--     (schema, name, input-argument-TYPE-LIST); appending a 6th parameter
--     changes the type-list length from 5 to 6, which is a DIFFERENT
--     signature/OID, not a replacement of the original. Left as
--     originally authored, this migration would NOT have replaced the
--     PR-6 function at all — it would have silently created a SECOND,
--     independent overload alongside the untouched original 5-arg
--     function, leaving two live copies of the (currently byte-identical,
--     but now independently driftable) legacy path in the catalog
--     forever, and making any FUTURE caller that omits the p_attempt_id
--     key entirely (rather than passing null) resolve to whichever
--     overload Postgres/PostgREST happens to pick.
--   - FIX: this migration now explicitly `DROP FUNCTION IF EXISTS`s the
--     original 5-arg signature immediately before `CREATE OR REPLACE
--     FUNCTION` with the 6-arg signature (see below), so exactly ONE
--     `submit_mock_test_attempt` function object exists after this
--     migration runs. Every caller — whether it supplies p_attempt_id
--     explicitly (as this repo's only caller,
--     apps/host/src/app/api/exams/papers/[id]/submit/route.ts, always
--     does, even as null) or omits it entirely — now resolves to the SAME
--     single function body, with p_attempt_id correctly defaulting to
--     NULL when omitted. This still satisfies P4/P11's "no split-brain,
--     single atomic RPC" requirement, and now ALSO guarantees there is
--     no dead/duplicate legacy-path body to fall out of sync.
--   - With the drop-then-recreate fix in place: ALL existing callers that
--     invoke with the original 5 named arguments (every static
--     JEE/NEET/Olympiad paper, and the one pre-existing hand-authored
--     cbse_board sample paper — now deactivated, see
--     20260722097200_deactivate_legacy_cbse_multisubject_sample_paper.sql)
--     get p_attempt_id = NULL and fall through to the EXACT unmodified
--     legacy branch (byte-identical logic to
--     20260520000008_mock_test_attempts.sql's version) — they INSERT a
--     brand-new attempt row and resolve questions live via the
--     exam_paper_id join, exactly as before.
--   - The new branch only activates when p_attempt_id IS NOT NULL AND the
--     referenced row is student-owned, status='in_progress', AND its
--     question_snapshot is non-null. Any other combination (wrong owner,
--     already-submitted, no snapshot) raises rather than silently
--     mis-scoring.
--   - Still a single SECURITY DEFINER plpgsql transaction (P4): the new
--     branch does one UPDATE of the existing attempt row instead of one
--     INSERT of a new row, but both are one round-trip inside the same
--     function invocation.
--   - No negative marking for cbse_board dynamic attempts (spec, verbatim:
--     "marks_wrong = 0 always") — this matches the seeded exam_papers rows'
--     marking_scheme = {"correct": null, "wrong": 0, "unanswered": 0} from
--     20260722096200.
--   - max_score is hardcoded to 80 for a successfully-scored dynamic
--     attempt (spec: "always exactly 80 when successfully assembled,
--     never a partial sum") rather than re-summed from the snapshot, since
--     the all-or-nothing gate in start_mock_test_attempt already guarantees
--     the exact 20/6/7/3/3-question, 1/2/3/5/4-mark composition that sums
--     to 80.
--
-- Predecessors: 20260520000008 (PR-6, original function), 20260722097000
--   (start_mock_test_attempt, the RPC that populates question_snapshot).
--
-- Does NOT touch: mock_test_attempts / mock_test_responses schema, RLS,
--   indexes. Does NOT change any behavior for non-cbse_board or legacy
--   cbse_board (no question_snapshot) submissions.
--
-- Idempotent: DROP FUNCTION IF EXISTS is a no-op once the 5-arg overload
--   is gone; CREATE OR REPLACE FUNCTION on the 6-arg signature is
--   idempotent thereafter; GRANT is idempotent; verification block is
--   read-only.
--
-- Owner: backend (Master Action Plan Phase 2.2). Reviewers per P14:
--   assessment (XP-bracket parity + no-negative-marking rule),
--   architect (SECURITY DEFINER posture unchanged), testing (unit
--   coverage for the new branch + backward-compat regression on the
--   legacy branch), frontend (attempt_id forwarding contract, already
--   implemented in packages/ui/src/exams/useMockTestState.ts).
--
-- Rollback (manual, requires user approval per CLAUDE.md):
--   Because this migration now DROPs the original 5-arg signature before
--   creating the 6-arg one (see architect correction above), a full
--   rollback is a two-step drop-and-recreate, not a single CREATE OR
--   REPLACE:
--     DROP FUNCTION IF EXISTS public.submit_mock_test_attempt(uuid, uuid, jsonb, integer, jsonb, uuid);
--     -- then re-apply 20260520000008_mock_test_attempts.sql's original
--     -- CREATE OR REPLACE FUNCTION statement verbatim to restore the
--     -- 5-arg-only function.

BEGIN;

-- Drop the original 5-arg overload before creating the 6-arg version so
-- exactly one `submit_mock_test_attempt` function object exists (see
-- "ARCHITECT CORRECTION" above — CREATE OR REPLACE cannot itself change
-- an argument-type list; leaving this out would silently create a second,
-- independent overload rather than replacing the original).
DROP FUNCTION IF EXISTS public.submit_mock_test_attempt(uuid, uuid, jsonb, integer, jsonb);

CREATE OR REPLACE FUNCTION public.submit_mock_test_attempt(
  p_student_id          uuid,
  p_paper_id            uuid,
  p_responses           jsonb,
  p_time_taken_seconds  integer,
  p_client_metadata     jsonb DEFAULT NULL,
  p_attempt_id          uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
-- SECURITY DEFINER justification (architect, unchanged posture from PR-6 /
-- 20260520000008): this RPC must (a) INSERT/UPDATE mock_test_attempts and
-- mock_test_responses rows for the target student even when the caller is
-- an admin acting on that student's behalf (student RLS write policies are
-- `student_id = auth.uid()`-scoped and would reject an admin-driven write
-- under SECURITY INVOKER), and (b) UPDATE question_bank IRT counters
-- (times_shown/times_correct/times_wrong/irt_response_count/last_served_at)
-- on every submission, which `authenticated` has no UPDATE grant for
-- (students only ever get to SELECT question_bank). The function's own
-- explicit authorization check (caller = p_student_id OR service_role OR
-- active admin_users) is the compensating control that stands in for the
-- RLS check DEFINER bypasses; SET search_path pins it against search-path
-- hijacking.
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_uid        uuid       := auth.uid();
  v_caller_role       text       := COALESCE(auth.jwt() ->> 'role', '');
  v_is_admin          boolean    := false;
  v_paper             record;
  v_default_correct   numeric    := 4.00;
  v_max_score         numeric(8,2);
  v_attempt_id        uuid;
  v_total_q           integer;
  v_attempted         integer    := 0;
  v_correct           integer    := 0;
  v_wrong             integer    := 0;
  v_skipped           integer    := 0;
  v_raw_score         numeric(8,2) := 0;
  v_score_percent     numeric(5,2) := 0;
  v_xp_earned         integer    := 0;
  v_submitted_at      timestamptz := now();
  v_elem              jsonb;
  v_q_id              uuid;
  v_q                 record;
  v_resp_idx          integer;
  v_is_correct        boolean;
  v_marks_awarded     numeric(5,2);
  v_q_time            integer;
  v_marked_for_review boolean;
  v_q_number          integer    := 0;
  v_inserted_id       uuid;

  -- Snapshot-scoring path (cbse_board dynamic attempts) additions.
  v_existing          record;
  v_paper_family      text;
  v_snap_marks        numeric;
BEGIN
  -- (a) Authorization — unchanged.
  IF v_caller_role <> 'service_role' THEN
    IF v_caller_uid IS NULL THEN
      RAISE EXCEPTION 'submit_mock_test_attempt: not authenticated' USING ERRCODE = '42501';
    END IF;
    SELECT EXISTS (
      SELECT 1 FROM public.admin_users au
       WHERE au.auth_user_id = v_caller_uid
         AND au.is_active = true
         AND au.admin_level IN ('admin', 'super_admin')
    ) INTO v_is_admin;
    IF v_caller_uid <> p_student_id AND NOT v_is_admin THEN
      RAISE EXCEPTION 'submit_mock_test_attempt: caller % may not submit for student %',
        v_caller_uid, p_student_id USING ERRCODE = '42501';
    END IF;
  END IF;

  -- ==========================================================================
  -- (a2) Snapshot-scoring branch — cbse_board dynamic attempts only.
  -- ==========================================================================
  IF p_attempt_id IS NOT NULL THEN
    SELECT id, student_id, exam_paper_id, status, question_snapshot
      INTO v_existing
      FROM public.mock_test_attempts
     WHERE id = p_attempt_id
       AND student_id = p_student_id
       AND status = 'in_progress';

    IF v_existing.id IS NULL THEN
      RAISE EXCEPTION 'submit_mock_test_attempt: attempt % not found, not owned by student %, or not in_progress',
        p_attempt_id, p_student_id USING ERRCODE = '22023';
    END IF;

    SELECT exam_family INTO v_paper_family
      FROM public.exam_papers WHERE id = v_existing.exam_paper_id;

    IF v_paper_family = 'cbse_board' AND v_existing.question_snapshot IS NOT NULL THEN
      -- max_score is always exactly 80 for a successfully-assembled
      -- cbse_board dynamic attempt (spec) — never a partial sum.
      v_max_score := 80.00;
      v_total_q   := jsonb_array_length(v_existing.question_snapshot);

      IF p_responses IS NOT NULL AND jsonb_typeof(p_responses) = 'array' THEN
        FOR v_elem IN SELECT * FROM jsonb_array_elements(p_responses)
        LOOP
          v_q_id := NULLIF(v_elem ->> 'question_id', '')::uuid;
          IF v_q_id IS NULL THEN
            CONTINUE;
          END IF;

          -- marks_correct for this question = the snapshot's OWN `marks`
          -- entry (section-weighted: 1/2/3/5/4), NOT question_bank.marks_correct.
          SELECT (s ->> 'marks')::numeric INTO v_snap_marks
            FROM jsonb_array_elements(v_existing.question_snapshot) AS s
           WHERE (s ->> 'question_id')::uuid = v_q_id
           LIMIT 1;

          IF v_snap_marks IS NULL THEN
            CONTINUE;   -- question not part of this attempt's snapshot — skip
          END IF;

          SELECT id, correct_answer_index INTO v_q
            FROM public.question_bank WHERE id = v_q_id;

          v_resp_idx := NULLIF(v_elem ->> 'response_index', '')::integer;
          v_q_time   := NULLIF(v_elem ->> 'time_taken_seconds', '')::integer;
          v_marked_for_review := COALESCE((v_elem ->> 'marked_for_review')::boolean, false);

          IF v_resp_idx IS NULL THEN
            v_is_correct := NULL;
            v_marks_awarded := 0;
          ELSIF v_q.correct_answer_index IS NOT NULL
                AND v_resp_idx = v_q.correct_answer_index THEN
            v_is_correct := true;
            v_marks_awarded := v_snap_marks;
          ELSE
            -- No negative marking for cbse_board dynamic attempts (spec,
            -- verbatim: "marks_wrong = 0 always").
            v_is_correct := false;
            v_marks_awarded := 0;
          END IF;

          v_inserted_id := NULL;
          INSERT INTO public.mock_test_responses (
            attempt_id, question_id, question_number, response_index,
            is_correct, marks_awarded, time_taken_seconds, marked_for_review
          ) VALUES (
            p_attempt_id, v_q_id, v_q_number + 1, v_resp_idx,
            v_is_correct, v_marks_awarded, v_q_time, v_marked_for_review
          )
          ON CONFLICT (attempt_id, question_id) DO NOTHING
          RETURNING id INTO v_inserted_id;

          IF v_inserted_id IS NULL THEN
            CONTINUE;   -- duplicate question in payload — skip counter mutation
          END IF;

          v_q_number := v_q_number + 1;
          v_raw_score := v_raw_score + v_marks_awarded;
          IF v_is_correct IS TRUE THEN
            v_correct := v_correct + 1;  v_attempted := v_attempted + 1;
          ELSIF v_is_correct IS FALSE THEN
            v_wrong := v_wrong + 1;      v_attempted := v_attempted + 1;
          END IF;

          -- IRT counters: NEVER irt_a or irt_b (cron's job, REG-44).
          UPDATE public.question_bank qb
             SET times_shown        = COALESCE(qb.times_shown, 0) + 1,
                 times_correct      = COALESCE(qb.times_correct, 0)
                                    + CASE WHEN v_is_correct IS TRUE THEN 1 ELSE 0 END,
                 times_wrong        = COALESCE(qb.times_wrong, 0)
                                    + CASE WHEN v_is_correct IS FALSE THEN 1 ELSE 0 END,
                 irt_response_count = COALESCE(qb.irt_response_count, 0) + 1,
                 last_served_at     = now()
           WHERE qb.id = v_q_id;
        END LOOP;
      END IF;

      IF v_attempted > v_total_q THEN
        v_total_q := v_attempted;
      END IF;
      v_skipped := GREATEST(0, v_total_q - v_attempted);

      IF v_max_score > 0 THEN
        v_score_percent := LEAST(100, GREATEST(0, ROUND((v_raw_score / v_max_score) * 100, 2)));
      ELSE
        v_score_percent := 0;
      END IF;

      v_xp_earned := CASE
        WHEN v_score_percent >= 90 THEN 100
        WHEN v_score_percent >= 70 THEN 60
        WHEN v_score_percent >= 40 THEN 30
        ELSE 10
      END;

      UPDATE public.mock_test_attempts
         SET status             = 'submitted',
             submitted_at       = v_submitted_at,
             time_taken_seconds = p_time_taken_seconds,
             total_questions    = v_total_q,
             attempted_count    = v_attempted,
             correct_count      = v_correct,
             wrong_count        = v_wrong,
             skipped_count      = v_skipped,
             raw_score          = v_raw_score,
             max_score          = v_max_score,
             score_percent      = v_score_percent,
             xp_earned          = v_xp_earned,
             client_metadata    = COALESCE(p_client_metadata, client_metadata)
       WHERE id = p_attempt_id;

      RETURN jsonb_build_object(
        'attempt_id',         p_attempt_id,
        'paper_id',           v_existing.exam_paper_id,
        'total_questions',    v_total_q,
        'attempted_count',    v_attempted,
        'correct_count',      v_correct,
        'wrong_count',        v_wrong,
        'skipped_count',      v_skipped,
        'raw_score',          v_raw_score,
        'max_score',          v_max_score,
        'score_percent',      v_score_percent,
        'xp_earned',          v_xp_earned,
        'submitted_at',       v_submitted_at,
        'time_taken_seconds', p_time_taken_seconds
      );
    END IF;
    -- else: p_attempt_id resolved to a real in_progress row that is NOT a
    -- cbse_board-with-snapshot attempt (should not normally occur — only
    -- start_mock_test_attempt populates question_snapshot, and only for
    -- cbse_board papers). Fall through to the legacy path below, which
    -- will INSERT a distinct new attempt row for this submission; the
    -- stale in_progress row is left as-is (matches PR-6's pre-existing
    -- "abandoned in_progress attempts are not auto-expired here" posture).
  END IF;

  -- ==========================================================================
  -- (b)-(g) Legacy path — byte-identical to 20260520000008, unchanged.
  -- ==========================================================================

  -- (b) Load paper
  SELECT id, total_questions, marking_scheme INTO v_paper
    FROM public.exam_papers WHERE id = p_paper_id AND is_active = true;
  IF v_paper.id IS NULL THEN
    RAISE EXCEPTION 'submit_mock_test_attempt: exam_paper % not found or inactive', p_paper_id
      USING ERRCODE = '22023';
  END IF;
  v_total_q := COALESCE(v_paper.total_questions, 0);
  IF v_total_q <= 0 THEN
    RAISE EXCEPTION 'submit_mock_test_attempt: exam_paper % invalid total_questions=%', p_paper_id, v_total_q
      USING ERRCODE = '22023';
  END IF;

  -- (c) v_max_score: SUM(marks_correct), fallback total_q * scheme.correct or 4.00
  SELECT COALESCE(SUM(COALESCE(qb.marks_correct, 0)), 0) INTO v_max_score
    FROM public.question_bank qb WHERE qb.exam_paper_id = p_paper_id;
  IF v_max_score IS NULL OR v_max_score <= 0 THEN
    v_max_score := (v_total_q::numeric)
                 * COALESCE(NULLIF(v_paper.marking_scheme ->> 'correct', '')::numeric,
                            v_default_correct);
  END IF;

  -- Reset accumulators (may have been touched only if p_attempt_id
  -- resolved but fell through — none of the above legacy variables were
  -- mutated in that case, so this reset is a no-op defensive safeguard).
  v_attempted := 0; v_correct := 0; v_wrong := 0; v_skipped := 0;
  v_raw_score := 0; v_score_percent := 0; v_xp_earned := 0; v_q_number := 0;

  -- (d) INSERT attempt header. Counters are placeholders; step (f) sets finals.
  INSERT INTO public.mock_test_attempts (
    student_id, exam_paper_id, started_at, submitted_at, status,
    time_taken_seconds, total_questions, attempted_count, correct_count,
    wrong_count, skipped_count, raw_score, max_score, score_percent,
    xp_earned, client_metadata
  ) VALUES (
    p_student_id, p_paper_id,
    v_submitted_at - make_interval(secs => COALESCE(p_time_taken_seconds, 0)),
    v_submitted_at, 'submitted',
    p_time_taken_seconds, v_total_q, 0, 0,
    0, v_total_q, 0, v_max_score, 0,
    0, p_client_metadata
  )
  RETURNING id INTO v_attempt_id;

  -- (e) Fan out responses + IRT counter updates
  IF p_responses IS NOT NULL AND jsonb_typeof(p_responses) = 'array' THEN
    FOR v_elem IN SELECT * FROM jsonb_array_elements(p_responses)
    LOOP
      v_q_id := NULLIF(v_elem ->> 'question_id', '')::uuid;
      IF v_q_id IS NULL THEN
        CONTINUE;   -- defensive: skip malformed row
      END IF;

      -- Scope to this paper. Mismatched paper = skip silently (UI bug; the
      -- client_metadata audit trail supports investigation).
      SELECT id, correct_answer_index, marks_correct, marks_wrong
        INTO v_q
        FROM public.question_bank
       WHERE id = v_q_id
         AND exam_paper_id = p_paper_id;

      IF v_q.id IS NULL THEN
        CONTINUE;
      END IF;

      v_resp_idx := NULLIF(v_elem ->> 'response_index', '')::integer;
      v_q_time   := NULLIF(v_elem ->> 'time_taken_seconds', '')::integer;
      v_marked_for_review := COALESCE((v_elem ->> 'marked_for_review')::boolean, false);

      IF v_resp_idx IS NULL THEN
        v_is_correct := NULL;
        v_marks_awarded := 0;
      ELSIF v_q.correct_answer_index IS NOT NULL
            AND v_resp_idx = v_q.correct_answer_index THEN
        v_is_correct := true;
        v_marks_awarded := COALESCE(v_q.marks_correct, 1.00);
      ELSE
        v_is_correct := false;
        v_marks_awarded := COALESCE(v_q.marks_wrong, 0.00);
      END IF;

      -- INSERT first; only on a new row do we bump counters + IRT stats.
      -- The (attempt_id,question_id) UNIQUE catches duplicate payload entries
      -- (e.g. retried submit) so counters stay consistent with the persisted
      -- responses and the chk_mta_count_consistency CHECK holds in step (f).
      v_inserted_id := NULL;
      INSERT INTO public.mock_test_responses (
        attempt_id, question_id, question_number, response_index,
        is_correct, marks_awarded, time_taken_seconds, marked_for_review
      ) VALUES (
        v_attempt_id, v_q_id, v_q_number + 1, v_resp_idx,
        v_is_correct, v_marks_awarded, v_q_time, v_marked_for_review
      )
      ON CONFLICT (attempt_id, question_id) DO NOTHING
      RETURNING id INTO v_inserted_id;

      IF v_inserted_id IS NULL THEN
        CONTINUE;   -- duplicate question in payload — skip counter mutation
      END IF;

      v_q_number := v_q_number + 1;
      v_raw_score := v_raw_score + v_marks_awarded;
      IF v_is_correct IS TRUE THEN
        v_correct := v_correct + 1;  v_attempted := v_attempted + 1;
      ELSIF v_is_correct IS FALSE THEN
        v_wrong := v_wrong + 1;      v_attempted := v_attempted + 1;
      END IF;

      -- IRT counters: NEVER irt_a or irt_b (cron's job, REG-44).
      UPDATE public.question_bank qb
         SET times_shown        = COALESCE(qb.times_shown, 0) + 1,
             times_correct      = COALESCE(qb.times_correct, 0)
                                + CASE WHEN v_is_correct IS TRUE THEN 1 ELSE 0 END,
             times_wrong        = COALESCE(qb.times_wrong, 0)
                                + CASE WHEN v_is_correct IS FALSE THEN 1 ELSE 0 END,
             irt_response_count = COALESCE(qb.irt_response_count, 0) + 1,
             last_served_at     = now()
       WHERE qb.id = v_q_id;
    END LOOP;
  END IF;

  -- (f) Aggregate UPDATE; clamp score_percent to [0,100]; bracket XP.
  -- If v_attempted exceeds the snapshot (drift: question_bank rows > paper.total_questions),
  -- widen v_total_q to match so chk_mta_count_consistency holds.
  IF v_attempted > v_total_q THEN
    v_total_q := v_attempted;
  END IF;
  v_skipped := GREATEST(0, v_total_q - v_attempted);

  IF v_max_score > 0 THEN
    v_score_percent := LEAST(100, GREATEST(0, ROUND((v_raw_score / v_max_score) * 100, 2)));
  ELSE
    v_score_percent := 0;
  END IF;

  v_xp_earned := CASE
    WHEN v_score_percent >= 90 THEN 100
    WHEN v_score_percent >= 70 THEN 60
    WHEN v_score_percent >= 40 THEN 30
    ELSE 10
  END;

  UPDATE public.mock_test_attempts
     SET total_questions = v_total_q,
         attempted_count = v_attempted,
         correct_count   = v_correct,
         wrong_count     = v_wrong,
         skipped_count   = v_skipped,
         raw_score       = v_raw_score,
         score_percent   = v_score_percent,
         xp_earned       = v_xp_earned
   WHERE id = v_attempt_id;

  -- (g) Return result
  RETURN jsonb_build_object(
    'attempt_id',         v_attempt_id,
    'paper_id',           p_paper_id,
    'total_questions',    v_total_q,
    'attempted_count',    v_attempted,
    'correct_count',      v_correct,
    'wrong_count',        v_wrong,
    'skipped_count',      v_skipped,
    'raw_score',          v_raw_score,
    'max_score',          v_max_score,
    'score_percent',      v_score_percent,
    'xp_earned',          v_xp_earned,
    'submitted_at',       v_submitted_at,
    'time_taken_seconds', p_time_taken_seconds
  );
END;
$$;

COMMENT ON FUNCTION public.submit_mock_test_attempt(uuid, uuid, jsonb, integer, jsonb, uuid) IS
  'PR-6 (2026-05-20) + Phase 2.2 snapshot-scoring extension (2026-07-22). Atomic mock-test submission RPC. When p_attempt_id is provided AND resolves to a student-owned in_progress row on a cbse_board paper with a non-null question_snapshot, scores in place against that snapshot (marks_correct = snapshot marks, marks_wrong = 0 always, max_score = 80 always) instead of the legacy exam_paper_id join. All other calls (p_attempt_id NULL, or resolving to a non-snapshot row) run the byte-identical legacy path from 20260520000008: INSERT a new attempt row, resolve questions live via exam_paper_id. SECURITY DEFINER: caller must equal p_student_id OR be service_role OR be active admin_users (admin/super_admin). Single atomic transaction (P4).';

GRANT EXECUTE ON FUNCTION public.submit_mock_test_attempt(uuid, uuid, jsonb, integer, jsonb, uuid)
  TO authenticated, service_role;

-- ============================================================================
-- Verification block — read-only sanity checks
-- ============================================================================

DO $verify$
DECLARE
  v_rpc_args_count integer;
BEGIN
  SELECT COALESCE(MAX(pronargs), 0) INTO v_rpc_args_count
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'submit_mock_test_attempt';

  RAISE NOTICE '[p2.2-item5] submit_mock_test_attempt arg count = % (expect 6)', v_rpc_args_count;

  IF v_rpc_args_count <> 6 THEN
    RAISE WARNING '[p2.2-item5] migration did NOT land cleanly — see flags above';
  ELSE
    RAISE NOTICE '[p2.2-item5] MIGRATION COMPLETE — submit_mock_test_attempt snapshot-scoring branch installed';
  END IF;
END $verify$;

COMMIT;
