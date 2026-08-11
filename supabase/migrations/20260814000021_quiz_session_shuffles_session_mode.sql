-- Migration: 20260814000021_quiz_session_shuffles_session_mode.sql
-- Purpose: Record WHICH INSTRUMENT a quiz session is, so a resumed session can
--          never silently change instrument mid-attempt.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- THE DEFECT THIS EXISTS TO CLOSE (Phase 4 assessment review, 2026-08-11)
-- ─────────────────────────────────────────────────────────────────────────────
-- `/quiz` runs three instruments off one runtime, selected by `?mode=`:
--   practice   — untimed, per-question support
--   cognitive  — untimed, default
--   exam       — TIMED, with an auto-submit on expiry
--
-- The mode lived ONLY in React state, derived from the URL at mount. It was
-- persisted nowhere. The Phase 4 resume deep link is `/quiz?session=<uuid>` and
-- carries NO `mode`, so a resumed attempt always mounted with the DEFAULT
-- (`cognitive`). The page carried a `if (quizMode === 'exam') setQuizMode(
-- 'cognitive')` line that was intended as the safeguard, but on a fresh
-- `/quiz?session=<uuid>` load `quizMode` is ALREADY the default — the branch
-- could never fire. Net effect: a timed exam attempt resumed as an untimed one
-- and was written to `quiz_sessions` as though it were the same instrument.
--
-- Worse, the system could not even DETECT the swap after the fact, because
-- nothing on the row said what the attempt had been. That is what this column
-- fixes: it makes the instrument a durable, server-held fact.
--
-- The product decision (assessment's ruling) is that an `exam` session is NOT
-- resumable at all — a timed test is taken in one sitting. Resuming it correctly
-- would require SERVER-COMPUTED remaining time (never client state), which is a
-- separate piece of work. Until then the honest behaviour is to refuse, and to
-- refuse EARLY: `resolveResumableQuiz` (packages/lib/src/state/student-state-
-- builder.ts) suppresses the `/today` "Continue where you stopped" card for an
-- exam session, and the resume route returns `exam_not_resumable`. Never promise
-- what you will refuse.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY THIS TABLE AND THIS SHAPE
-- ─────────────────────────────────────────────────────────────────────────────
-- `quiz_session_shuffles` is the ONLY table written at quiz-session start —
-- `start_quiz_session` writes no `quiz_sessions` row (the row is INSERTed for
-- the first time by `submit_quiz_results_v2`, already `is_completed = true`).
-- So the session-start substrate is this table or nothing.
--
-- The value is stamped per row (denormalised across a session's rows) rather
-- than in a new one-row-per-session table because:
--   * a new table needs its own RLS + policies + an extra read on the resume
--     hot path, for a single nullable text value;
--   * the writer already exists. `POST /api/quiz/session/[sessionId]/progress`
--     persists each confirmed answer with a first-write-wins UPDATE on exactly
--     these rows. The mode rides that SAME statement, which makes it
--     ATOMIC WITH THE FIRST PERSISTED ANSWER. That matters: a session is only
--     resumable once it has ≥ 1 persisted answer, so there is no window in
--     which a session is resumable but its instrument is unknown. A separate
--     writer would have introduced exactly that window as a new failure mode.
--
-- FAIL-CLOSED READ CONTRACT. A NULL `session_mode` on a session that has
-- answers means an unrecognised/older writer produced it, and we cannot prove
-- it was not a timed attempt. The resume path therefore refuses (`mode_unknown`)
-- rather than assuming `cognitive`. This mirrors the `ff_quiz_v2` interlock's
-- fail-closed posture on the same route. It costs nothing in production today:
-- Phase 4 resume has not shipped, so no resumable session predates this column.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- INVARIANTS
-- ─────────────────────────────────────────────────────────────────────────────
-- P1/P2/P4: this column is NEVER read by `submit_quiz_results_v2`,
--   `atomic_quiz_profile_update`, `check_quiz_answer`, or `start_quiz_session`.
--   No function body is changed by this migration. Scoring, XP and the atomic
--   submission path are bit-for-bit unchanged. It is a session-metadata
--   side-channel, exactly like the three durability columns from 20260802130000.
-- P8: no new table, so no new RLS surface. The three existing SELECT policies on
--   `quiz_session_shuffles` are untouched and already scope every row.
-- P13: the value is one of three fixed lowercase tokens. It is not, and cannot
--   become, student-identifying data.
--
-- COLUMN ACL — READ THIS. Migration 20260814000020 revoked the table-level grant
-- on `quiz_session_shuffles` from `authenticated` and re-granted SELECT
-- COLUMN-WISE from a literal allowlist, deliberately so that a future column
-- fails CLOSED. `session_mode` is therefore NOT readable by `authenticated`
-- until granted here — and it MUST be, because
-- `packages/lib/src/state/student-state-builder.ts` reads this table under the
-- CALLER's role to decide whether to offer the `/today` resume card. Step 3
-- below is that grant, and step 4 asserts both halves (readable by
-- `authenticated`, and the answer key still is not).
--
-- IDEMPOTENT: ADD COLUMN IF NOT EXISTS, a guarded ADD CONSTRAINT, and
-- GRANT/COMMENT are all replay-safe. No DROP, no data rewrite, no RLS change.

BEGIN;

-- ──────────────────────────────────────────────────────────────────────────
-- 1. The column. Nullable by construction: existing rows predate the writer
--    and must not be retro-labelled with a guess.
-- ──────────────────────────────────────────────────────────────────────────
ALTER TABLE public.quiz_session_shuffles
  ADD COLUMN IF NOT EXISTS session_mode TEXT;

-- ──────────────────────────────────────────────────────────────────────────
-- 2. Closed vocabulary. The three instruments `/quiz` can run, and nothing
--    else. NULL stays legal (= "not recorded"), and the read path treats NULL
--    as not-resumable rather than as a default.
-- ──────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'quiz_session_shuffles_session_mode_check'
      AND conrelid = 'public.quiz_session_shuffles'::regclass
  ) THEN
    ALTER TABLE public.quiz_session_shuffles
      ADD CONSTRAINT quiz_session_shuffles_session_mode_check
      CHECK (session_mode IS NULL OR session_mode IN ('practice', 'cognitive', 'exam'));
  END IF;
END
$$;

-- ──────────────────────────────────────────────────────────────────────────
-- 3. Column-level SELECT for `authenticated` (see the ACL note above).
--    Additive to the allowlist established by 20260814000020 — it grants this
--    ONE new non-key column and touches no other privilege.
-- ──────────────────────────────────────────────────────────────────────────
GRANT SELECT (session_mode) ON TABLE public.quiz_session_shuffles TO authenticated;

-- ──────────────────────────────────────────────────────────────────────────
-- 4. Self-verifying post-conditions. A failure rolls the whole transaction
--    back rather than leaving a half-applied ACL.
-- ──────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  -- 4a. The column exists and the CHECK is in place.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'quiz_session_shuffles'
      AND column_name = 'session_mode'
  ) THEN
    RAISE EXCEPTION 'POST-CONDITION FAILED: quiz_session_shuffles.session_mode was not created';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'quiz_session_shuffles_session_mode_check'
      AND conrelid = 'public.quiz_session_shuffles'::regclass
  ) THEN
    RAISE EXCEPTION 'POST-CONDITION FAILED: the session_mode CHECK constraint is missing — an arbitrary string could be stored as an instrument';
  END IF;

  -- 4b. The /today resume-card read path (student-state-builder, caller role)
  --     must be able to see it, or the exam suppression silently never fires.
  IF NOT has_column_privilege('authenticated', 'public.quiz_session_shuffles', 'session_mode', 'SELECT') THEN
    RAISE EXCEPTION 'POST-CONDITION FAILED: authenticated cannot SELECT quiz_session_shuffles.session_mode — the /today exam-resume suppression would fail open';
  END IF;

  -- 4c. Service-role (the resume route, the graders, the forensic view) too.
  IF NOT has_column_privilege('service_role', 'public.quiz_session_shuffles', 'session_mode', 'SELECT') THEN
    RAISE EXCEPTION 'POST-CONDITION FAILED: service_role cannot SELECT quiz_session_shuffles.session_mode';
  END IF;

  -- 4d. REGRESSION GUARD for 20260814000020: adding a column must not have
  --     reopened the answer key. If a future hand re-adds a table-level GRANT
  --     while editing this file, this fires.
  IF has_column_privilege('authenticated', 'public.quiz_session_shuffles', 'correct_answer_index_snapshot', 'SELECT')
     OR has_column_privilege('authenticated', 'public.quiz_session_shuffles', 'integrity_hash', 'SELECT') THEN
    RAISE EXCEPTION 'POST-CONDITION FAILED: authenticated regained SELECT on the answer key — migration 20260814000020 has been undone';
  END IF;

  -- 4e. anon still holds nothing.
  IF has_column_privilege('anon', 'public.quiz_session_shuffles', 'session_mode', 'SELECT') THEN
    RAISE EXCEPTION 'POST-CONDITION FAILED: anon gained SELECT on quiz_session_shuffles.session_mode';
  END IF;
END
$$;

-- ──────────────────────────────────────────────────────────────────────────
-- 5. Record the contract on the column itself.
-- ──────────────────────────────────────────────────────────────────────────
COMMENT ON COLUMN public.quiz_session_shuffles.session_mode IS
  'Which instrument this quiz session is: practice | cognitive | exam. Stamped '
  'first-write-wins by POST /api/quiz/session/[sessionId]/progress, in the SAME '
  'UPDATE statement that persists the first confirmed answer — so a session can '
  'never be resumable with an unknown instrument. NULL means "not recorded"; the '
  'resume path treats NULL as NOT resumable (mode_unknown) rather than assuming '
  'a default. An exam session is never resumable at all (exam_not_resumable): a '
  'timed test is taken in one sitting, and resuming one correctly needs '
  'SERVER-computed remaining time, never client state. NEVER read by '
  'submit_quiz_results_v2 / atomic_quiz_profile_update / check_quiz_answer — '
  'this is session metadata, not a scoring input (P1/P2/P4).';

COMMIT;

-- Rollback (compensating, if ever needed — reintroduces the silent instrument
-- swap on resume, do not run casually):
--   ALTER TABLE public.quiz_session_shuffles
--     DROP CONSTRAINT IF EXISTS quiz_session_shuffles_session_mode_check;
--   ALTER TABLE public.quiz_session_shuffles DROP COLUMN IF EXISTS session_mode;
--
-- Tables touched:    public.quiz_session_shuffles (1 additive nullable column,
--                    1 CHECK, 1 column-level GRANT, 1 COMMENT)
-- Columns dropped:   none
-- Functions changed: none
-- RLS policies:      unchanged
