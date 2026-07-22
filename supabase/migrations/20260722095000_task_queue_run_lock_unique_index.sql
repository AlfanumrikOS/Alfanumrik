-- Migration: 20260722095000_task_queue_run_lock_unique_index.sql
-- Purpose: Close the TOCTOU race in the adaptive-remediation cron worker's
--          `acquireRunLock`/`releaseRunLock` overlap guard (Master Action
--          Plan item 3.4, paired fix — architect half).
--
-- ─── Background ──────────────────────────────────────────────────────────────
-- `apps/host/src/app/api/cron/adaptive-remediation/route.ts` uses the
-- EXISTING `task_queue` table as a best-effort in-flight marker: it SELECTs
-- for a non-stale row with (queue_name = 'adaptive-remediation-run-lock',
-- status = 'processing'), and if none is found, INSERTs one. Between that
-- SELECT and the INSERT there was a genuine time-of-check/time-of-use window:
-- two truly concurrent invocations (a manual trigger racing a Vercel cron
-- retry) could both pass the SELECT and both INSERT a "processing" marker,
-- defeating the guard's whole purpose.
--
-- This migration adds a PARTIAL UNIQUE INDEX on task_queue(queue_name) WHERE
-- status = 'processing'. This is the DB-atomic half of the fix: at most one
-- 'processing' row per queue_name can ever exist, so the second concurrent
-- INSERT now fails with 23505 (unique_violation) instead of silently
-- succeeding. The paired application-layer half (backend/architect change in
-- the SAME session) makes `acquireRunLock` treat a 23505 on THIS insert as a
-- definitive "another run already holds the lock" signal — returning
-- `{ acquired: false }` — rather than the generic fail-open path used for
-- unexpected/transient errors. Neither half alone closes the race: the index
-- alone still lets the old code fail-open on ANY insert error (including
-- 23505); the code branch alone has nothing to catch without this index,
-- because task_queue previously allowed unlimited 'processing' rows for the
-- same queue_name.
--
-- ─── Why partial (not a full unique index on queue_name) ─────────────────────
-- `task_queue` is a general-purpose queue table (other queue_name values, and
-- other statuses -- 'pending', 'completed', 'failed' -- coexist for the SAME
-- queue_name over time). A full UNIQUE(queue_name) would make every row after
-- the first processing/completed/failed cycle a constraint violation. Scoping
-- the uniqueness to `WHERE status = 'processing'` means only the CONCURRENT
-- in-flight-lock property is enforced -- exactly the invariant the run-lock
-- guard needs -- while completed/failed/pending history rows for the same
-- queue_name (including past run-lock markers, once released or expired) are
-- entirely unaffected.
--
-- ─── Stale markers ────────────────────────────────────────────────────────────
-- The application already treats markers older than RUN_LOCK_STALE_MS
-- (5 minutes) as abandoned (from a crashed/timed-out run) and does not let
-- them block new runs forever -- but a stale 'processing' row is still
-- 'processing' until `releaseRunLock` deletes it (or a future clean-up job
-- reaps it). This index does not change that staleness handling; it only
-- makes the insert atomic. A genuinely stuck stale marker still requires the
-- existing self-heal path (the app's staleness check treats it as
-- non-blocking at the SELECT stage) or a manual DELETE -- this migration adds
-- no new failure mode here, since the pre-existing code already handled
-- staleness at the read side.
--
-- ─── Safety / house style ────────────────────────────────────────────────────
--   * Idempotent: CREATE UNIQUE INDEX ... IF NOT EXISTS.
--   * to_regclass fresh-DB guard: no-op cleanly if task_queue does not exist.
--   * Additive only: no DROP TABLE/COLUMN, no other DDL. RLS on task_queue is
--     unchanged (already ENABLE ROW LEVEL SECURITY + service_role-only
--     `tq_service_all` policy from the baseline -- this table has never been
--     reachable by anon/authenticated, so no new RLS pattern is required for
--     this additive index).
--   * No SECURITY DEFINER (this migration creates no functions).
--
-- ─── Reversible (manual DOWN) ────────────────────────────────────────────────
--   DROP INDEX IF EXISTS public.idx_task_queue_run_lock_processing_unique;
--
-- Owner: architect. Reviewers (P14 -- deployment config / cron correctness):
--        backend, testing.
-- Added: 2026-07-22

DO $task_queue_run_lock_index$
BEGIN
  IF to_regclass('public.task_queue') IS NULL THEN
    RAISE NOTICE 'task_queue absent; skipping run-lock unique index creation (fresh/out-of-order DB).';
    RETURN;
  END IF;

  -- Partial unique index: at most one 'processing' row per queue_name. This is
  -- what turns the second concurrent INSERT of a run-lock marker into a
  -- 23505 unique_violation instead of a second silently-successful row.
  EXECUTE '
    CREATE UNIQUE INDEX IF NOT EXISTS idx_task_queue_run_lock_processing_unique
      ON public.task_queue (queue_name)
      WHERE status = ''processing''
  ';

  EXECUTE $comment$
    COMMENT ON INDEX public.idx_task_queue_run_lock_processing_unique IS
      'Enforces at most one "processing" row per queue_name in task_queue. Closes the TOCTOU race in the adaptive-remediation cron worker''s acquireRunLock overlap guard: a concurrent second insert now fails with 23505, which acquireRunLock (apps/host/src/app/api/cron/adaptive-remediation/route.ts) treats as a clean "already running" denial rather than a generic fail-open. Added 2026-07-22 (Master Action Plan item 3.4 paired fix).'
  $comment$;

  RAISE NOTICE 'idx_task_queue_run_lock_processing_unique created/verified on task_queue(queue_name) WHERE status=processing.';
END $task_queue_run_lock_index$;

-- ─── Verify (manual check after applying) ────────────────────────────────────
-- SELECT indexname, indexdef FROM pg_indexes
--  WHERE tablename = 'task_queue' AND indexname = 'idx_task_queue_run_lock_processing_unique';
--   -- expect: one row, UNIQUE INDEX ... WHERE (status = 'processing'::text).
--
-- -- Race simulation (run in two separate sessions/transactions to confirm):
-- INSERT INTO task_queue (queue_name, status, payload)
--   VALUES ('adaptive-remediation-run-lock', 'processing', '{}'::jsonb);
--   -- session A: succeeds.
-- INSERT INTO task_queue (queue_name, status, payload)
--   VALUES ('adaptive-remediation-run-lock', 'processing', '{}'::jsonb);
--   -- session B (before A commits/deletes): expect ERROR 23505 unique_violation.
-- -- A 'pending'/'completed'/'failed' row for the SAME queue_name is unaffected:
-- INSERT INTO task_queue (queue_name, status, payload)
--   VALUES ('adaptive-remediation-run-lock', 'completed', '{}'::jsonb);
--   -- expect: succeeds even while a 'processing' row exists for the same name.
