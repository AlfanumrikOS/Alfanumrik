-- Migration: 20260802130000_check_quiz_answer_rpc.sql
-- Purpose: Screen "07 Practice" (/quiz, immediate per-question feedback) —
--          assessment-specified UX requires telling the student whether their
--          answer was right or wrong THE MOMENT they confirm it, not only at
--          final submit. Today the client cannot do this itself:
--          correct_answer_index is deliberately never sent to the browser
--          (P0 fix, migration 20260428160000 / _legacy/timestamped) — that is
--          the entire threat model start_quiz_session/submit_quiz_results_v2
--          close. This migration adds a new, narrowly-scoped, read-mostly RPC
--          that reveals ONLY the ONE question the caller asks about, from the
--          server-owned quiz_session_shuffles snapshot — never from live
--          question_bank, and never any other question in the same session.
--
-- What this migration does NOT do (explicitly, per architect review):
--   - Does NOT touch students.xp_total, student_learning_profiles,
--     bloom_progression, concept_mastery, xp_transactions, or any streak /
--     mastery state. That remains EXCLUSIVELY submit_quiz_results_v2's job,
--     called once at final submit, unchanged by this migration.
--   - Does NOT change submit_quiz_results_v2, start_quiz_session, or any
--     existing RLS policy on quiz_session_shuffles.
--   - Does NOT DROP anything.
--
-- Design decision (architect call, per the assessment spec's explicit
-- deferral): PERSIST-IMMEDIATELY. check_quiz_answer() writes the student's
-- selected_displayed_index + time_spent_seconds + answered_at onto the SAME
-- quiz_session_shuffles row the instant the student confirms an answer —
-- not just read-and-reveal. Reasoning:
--   1. Least invasive schema change: quiz_session_shuffles is ALREADY keyed
--      1:1 with (session_id, question_id) — exactly the granularity a
--      per-question response needs. A companion staging table would
--      duplicate that key and require its own RLS + indexes for zero
--      structural benefit.
--   2. Makes "progress is saved" literally true: a crash/kill/tab-close
--      between question N's confirm and the final submitQuizResults() call
--      no longer loses question N's answer — it is already durable server-
--      side. (Restoring/resuming a session from these columns is a follow-up
--      UX feature, out of scope for this migration — the durability exists
--      independent of whether anything reads it back yet.)
--   3. It does not change what grades the quiz. submit_quiz_results_v2 is
--      UNTOUCHED and still scores from the client-supplied p_responses at
--      final submit — these new columns are a side-channel for durability
--      and defense-in-depth, never a scoring input.
--   4. The alternative (pure-read, relying on the already-built-but-unused
--      `pending_writes` IndexedDB store in packages/lib/src/offline/store.ts)
--      is CLIENT-ONLY durability: it survives a tab crash but not a device
--      loss/reinstall/browser-storage-clear, and does nothing for the "server
--      is the single source of truth" posture this table already embodies
--      for every other quiz field. Persist-immediately is a strict
--      durability upgrade with a two-column, nullable, non-breaking cost.
--
-- Anti-cheat / gaming-surface analysis (architect call, per the assessment
-- spec's explicit deferral on a defensive backstop):
--   The "no retry after reveal" rule (don't let a student see is_correct,
--   then re-click a different option and call this RPC again to fish for
--   the right answer) is a FRONTEND state-machine responsibility — this RPC
--   cannot distinguish "legitimate network retry of the same click" from
--   "student trying answer B after seeing answer A was wrong", because it
--   has no notion of intent, only inputs.
--   HOWEVER: this RPC DOES defensively backstop the specific "fish for the
--   right answer" exploit, for free, using the persisted columns above.
--   Once student_selected_displayed_index is non-NULL for a
--   (session_id, question_id) pair, subsequent calls IGNORE the newly
--   supplied p_selected_displayed_index and replay the FIRST verdict
--   (idempotent replay) rather than grading the new guess. This means:
--     - A legitimate double-fire (double-tap, flaky network retry) is safe:
--       the student gets the SAME answer back, no different from a normal
--       idempotent RPC.
--     - A student (or a modified client bypassing the frontend guard)
--       calling this RPC N times with N different guesses for the SAME
--       question gets the SAME (first-guess) verdict every time — the
--       "guess again" attack surface is closed at the RPC layer, not just
--       the UI layer, even though the UI layer is still the PRIMARY and
--       expected enforcement point (this RPC's replay-lock is redundant
--       defense-in-depth, not a substitute for the frontend never allowing
--       a second confirm click on an already-answered question).
--   This backstop does not create a NEW anti-cheat gaming surface beyond
--   what assessment already flagged for the immediate-feedback screen in
--   general (a student now learns per-question correctness before the quiz
--   ends, which assessment's spec already accounts for) — P3's three
--   server-side checks (min 3s/question, not-all-same-answer, response
--   count == question count) are computed by submit_quiz_results_v2 from
--   p_responses at final submit exactly as before; this RPC changes none of
--   those inputs or thresholds.
--
-- RLS: no NEW RLS policy is needed. quiz_session_shuffles already has
-- FOUR-pattern RLS from migration 20260428160000 (student own via
-- auth_user_id, parent via guardian_student_links, teacher via
-- class_students/class_teachers, service_role bypass) and this migration
-- adds NULLABLE COLUMNS to that same table — column additions do not change
-- row visibility under Postgres RLS (RLS is row-scoped). The RPC itself is
-- SECURITY DEFINER with an inline auth.uid() ownership check (same
-- convention as start_quiz_session / submit_quiz_results_v2), so an
-- authenticated caller can only reveal/persist answers for sessions their
-- OWN student row owns.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, CHECK constraints guarded by
-- pg_constraint existence (same convention as
-- 20260722096000_exam_papers_add_grade_column.sql), CREATE OR REPLACE
-- FUNCTION, REVOKE/GRANT re-runs harmlessly.
--
-- Grant posture: matches the RCA-18 DB-function-hardening convention
-- (scripts/db-function-hardening.json / 20260707020000) for a high-risk
-- SECURITY DEFINER RPC that a student calls directly via PostgREST: PUBLIC
-- execute revoked, explicit GRANT to authenticated + service_role only.
--
-- Owner: architect (schema/RLS/security). Review chain per
-- .claude/skills/review-chains/SKILL.md "RBAC/auth" + "Anti-cheat
-- thresholds": backend, testing to review; assessment (spec author) to
-- confirm the P1-P4 boundary is respected; frontend owns wiring this into
-- the quiz page's confirmAnswer/nextQuestion state machine and enforcing
-- "no second confirm click on an already-answered question" client-side.

BEGIN;

-- ──────────────────────────────────────────────────────────────────────────
-- 1. quiz_session_shuffles — additive durability columns (nullable)
-- ──────────────────────────────────────────────────────────────────────────

ALTER TABLE public.quiz_session_shuffles
  ADD COLUMN IF NOT EXISTS student_selected_displayed_index INT,
  ADD COLUMN IF NOT EXISTS student_time_spent_seconds INT,
  ADD COLUMN IF NOT EXISTS student_answered_at TIMESTAMPTZ;

COMMENT ON COLUMN public.quiz_session_shuffles.student_selected_displayed_index IS
  'Nullable. Set by check_quiz_answer() (migration 20260802130000) the FIRST '
  'time the student confirms an answer for this (session_id, question_id) '
  'row — persist-immediately durability for the "07 Practice" immediate-'
  'feedback screen. NEVER written by submit_quiz_results_v2 and NEVER read '
  'by it for scoring: scoring still comes exclusively from the '
  'client-supplied p_responses at final submit. 0..3, same displayed-index '
  'space as shuffle_map.';

COMMENT ON COLUMN public.quiz_session_shuffles.student_time_spent_seconds IS
  'Nullable. Companion to student_selected_displayed_index — time spent on '
  'this question, as reported by the client to check_quiz_answer(). '
  'Durability/observability only; P3 anti-cheat timing still runs from the '
  'client-supplied total elapsed time at final submit, unchanged.';

COMMENT ON COLUMN public.quiz_session_shuffles.student_answered_at IS
  'Nullable. Server clock timestamp of the FIRST check_quiz_answer() call '
  'that persisted an answer for this row. NULL means the student has not '
  'yet confirmed this question (or the session predates migration '
  '20260802130000). Also doubles as the "already answered" flag that '
  'check_quiz_answer() uses to replay-lock a second call.';

DO $chk_qss_selected_idx$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
      JOIN pg_class ON pg_class.oid = pg_constraint.conrelid
     WHERE pg_constraint.conname = 'chk_qss_student_selected_idx_range'
       AND pg_class.relname = 'quiz_session_shuffles'
       AND pg_class.relnamespace = 'public'::regnamespace
  ) THEN
    ALTER TABLE public.quiz_session_shuffles
      ADD CONSTRAINT chk_qss_student_selected_idx_range
      CHECK (
        student_selected_displayed_index IS NULL
        OR student_selected_displayed_index BETWEEN 0 AND 3
      );
  END IF;
END $chk_qss_selected_idx$;

DO $chk_qss_time_spent$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
      JOIN pg_class ON pg_class.oid = pg_constraint.conrelid
     WHERE pg_constraint.conname = 'chk_qss_student_time_spent_nonneg'
       AND pg_class.relname = 'quiz_session_shuffles'
       AND pg_class.relnamespace = 'public'::regnamespace
  ) THEN
    ALTER TABLE public.quiz_session_shuffles
      ADD CONSTRAINT chk_qss_student_time_spent_nonneg
      CHECK (
        student_time_spent_seconds IS NULL
        OR student_time_spent_seconds >= 0
      );
  END IF;
END $chk_qss_time_spent$;

-- ──────────────────────────────────────────────────────────────────────────
-- 2. check_quiz_answer RPC — single-question reveal + persist-immediately
-- ──────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.check_quiz_answer(
  p_session_id UUID,
  p_question_id UUID,
  p_selected_displayed_index INT,
  p_time_spent_seconds INT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
-- SECURITY DEFINER justified: this RPC reveals a single per-question
-- correctness verdict from the server-owned quiz_session_shuffles snapshot
-- (NEVER from question_bank's live correct_answer_index) and persists the
-- student's answer immediately for crash durability. Authorization is
-- enforced inline against students.auth_user_id — mirroring the identical
-- inline-guard convention already used by start_quiz_session and
-- submit_quiz_results_v2 (migration 20260428160000).
SET search_path = public
AS $$
DECLARE
  v_row public.quiz_session_shuffles%ROWTYPE;
  v_correct_displayed INT;
  i INT;
  v_is_correct BOOLEAN;
  v_explanation TEXT;
  v_explanation_hi TEXT;
  v_already_answered BOOLEAN;
  v_effective_selected INT;
BEGIN
  IF p_selected_displayed_index IS NULL OR p_selected_displayed_index NOT BETWEEN 0 AND 3 THEN
    RAISE EXCEPTION 'invalid_displayed_index: % is out of range 0..3', p_selected_displayed_index
      USING ERRCODE = 'P0001';
  END IF;

  -- Scope strictly to ONE (session_id, question_id) row. This is the entire
  -- "never leaks other questions' answers" guarantee: the query below can
  -- only ever return this single question's snapshot, and the JSONB
  -- returned at the bottom carries only this question's fields.
  SELECT * INTO v_row
    FROM public.quiz_session_shuffles
   WHERE session_id = p_session_id AND question_id = p_question_id;

  IF v_row.question_id IS NULL THEN
    RAISE EXCEPTION
      'session_not_started: quiz_session_shuffles row missing for session_id=%, question_id=%',
      p_session_id, p_question_id
      USING ERRCODE = 'P0001';
  END IF;

  -- Ownership check: caller must own the student this snapshot belongs to.
  -- Skipped for service_role callers (auth.uid() IS NULL), matching the
  -- inline-guard convention used by every other quiz RPC in this codebase.
  IF auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.students
    WHERE id = v_row.student_id AND auth_user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Access denied: caller does not own session %', p_session_id;
  END IF;

  v_already_answered := v_row.student_selected_displayed_index IS NOT NULL;

  -- Defensive backstop (architect decision — NOT a substitute for the
  -- frontend's own "no retry after reveal" state-machine guard, which is
  -- and remains the PRIMARY enforcement point): once an answer is
  -- persisted for this (session_id, question_id) pair, this RPC IGNORES
  -- any subsequent p_selected_displayed_index and replays the FIRST
  -- verdict. Closes a "guess, get told wrong, guess again" gaming surface
  -- even if the frontend has a bug (or a modified client calls this
  -- endpoint more than once per question) — correctness can only ever be
  -- revealed against the student's ORIGINAL answer.
  IF NOT v_already_answered THEN
    UPDATE public.quiz_session_shuffles
       SET student_selected_displayed_index = p_selected_displayed_index,
           student_time_spent_seconds = GREATEST(COALESCE(p_time_spent_seconds, 0), 0),
           student_answered_at = now()
     WHERE session_id = p_session_id AND question_id = p_question_id;
    v_effective_selected := p_selected_displayed_index;
  ELSE
    v_effective_selected := v_row.student_selected_displayed_index;
  END IF;

  -- Map the snapshot's ORIGINAL correct index back into DISPLAYED-index
  -- space via shuffle_map (shuffle_map[displayed+1] = original, 1-based
  -- PL/pgSQL arrays — same convention as submit_quiz_results_v2).
  v_correct_displayed := NULL;
  IF v_row.shuffle_map IS NOT NULL AND array_length(v_row.shuffle_map, 1) = 4 THEN
    FOR i IN 1..4 LOOP
      IF v_row.shuffle_map[i] = v_row.correct_answer_index_snapshot THEN
        v_correct_displayed := i - 1;
        EXIT;
      END IF;
    END LOOP;
  END IF;
  IF v_correct_displayed IS NULL THEN
    -- Malformed/identity-shuffle fallback: same same-space assumption used
    -- elsewhere in this codebase when shuffle_map is absent/degenerate.
    v_correct_displayed := v_row.correct_answer_index_snapshot;
  END IF;

  v_is_correct := (v_correct_displayed = v_effective_selected);

  -- Explanation is read LIVE from question_bank (not snapshotted) — this
  -- matches start_quiz_session's existing behavior, which also reads
  -- explanation/explanation_hi live at session start rather than freezing
  -- it into the snapshot. Explanation text is never a scoring input, so
  -- reading the freshest copy is safe and desirable.
  SELECT explanation, explanation_hi INTO v_explanation, v_explanation_hi
    FROM public.question_bank WHERE id = p_question_id;

  RETURN jsonb_build_object(
    'question_id', p_question_id,
    'is_correct', v_is_correct,
    'correct_displayed_index', v_correct_displayed,
    'explanation', v_explanation,
    'explanation_hi', v_explanation_hi,
    'already_answered', v_already_answered
  );
END;
$$;

COMMENT ON FUNCTION public.check_quiz_answer(UUID, UUID, INT, INT) IS
  'Screen "07 Practice" immediate per-question feedback (migration '
  '20260802130000). Reveals is_correct/correct_displayed_index/explanation '
  'for EXACTLY ONE question from the server-owned quiz_session_shuffles '
  'snapshot — never from live question_bank.correct_answer_index, never '
  'leaking any other question in the same session. PERSIST-IMMEDIATELY: '
  'writes student_selected_displayed_index/student_time_spent_seconds/'
  'student_answered_at onto the same row so progress survives a crash '
  'before final submit. Does NOT touch XP, students.xp_total, '
  'student_learning_profiles, bloom_progression, or concept_mastery — '
  'those remain exclusively submit_quiz_results_v2''s job, called once, '
  'unchanged, at final submit. Idempotent/replay-locked: a second call for '
  'an already-answered question replays the FIRST verdict rather than '
  'grading a new guess (defense-in-depth only — the frontend quiz page '
  'state machine is and remains the primary enforcement point for "no '
  'retry after reveal").';

-- ──────────────────────────────────────────────────────────────────────────
-- 3. Execute grants — RCA-18 hardening posture (PUBLIC revoked, explicit
--    grant to authenticated + service_role), matching the convention set by
--    20260707020000_rca18_db_function_execute_grants.sql for high-risk
--    SECURITY DEFINER quiz RPCs a student calls directly via PostgREST.
-- ──────────────────────────────────────────────────────────────────────────

REVOKE EXECUTE ON FUNCTION public.check_quiz_answer(
  uuid,
  uuid,
  int,
  int
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.check_quiz_answer(
  uuid,
  uuid,
  int,
  int
) TO authenticated, service_role;

COMMIT;

-- End of migration: 20260802130000_check_quiz_answer_rpc.sql
-- Tables touched:    quiz_session_shuffles (3 new nullable columns + 2 CHECKs)
-- Functions added:   check_quiz_answer
-- Functions touched: none (start_quiz_session, submit_quiz_results_v2 unchanged)
-- RLS touched:       none (row-scoped policies unaffected by column additions)
