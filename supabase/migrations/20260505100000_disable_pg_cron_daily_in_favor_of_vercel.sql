-- Migration: 20260505100000_disable_pg_cron_daily_in_favor_of_vercel.sql
-- Purpose: Disable the pg_cron-scheduled daily-cron job ('alfanumrik-daily-cron')
--          so that the Vercel Cron entry at /api/cron/daily-cron (02:30 UTC) is
--          the canonical runner.
--
-- Per launch-readiness D6: Vercel cron is canonical for daily-cron because:
--   1. Visibility — Vercel exposes per-invocation logs in the dashboard;
--      pg_cron requires a manual SQL query against cron.job_run_details.
--   2. Flag rollback — env-var driven CRON_SECRET can be rotated from Vercel
--      without a database migration.
--   3. Duplicate prevention — running both pg_cron (18:30 UTC) AND Vercel cron
--      (02:30 UTC) produced duplicate parent_digest notifications because the
--      Edge Function previously had no idempotency guard on `notifications`
--      insert. Idempotency was added in this same release wave; disabling
--      pg_cron removes the second runner entirely.
--
-- Scope: This migration ONLY unschedules 'alfanumrik-daily-cron'. It does NOT
--        drop the pg_cron extension and does NOT touch any other cron jobs
--        (e.g., other domain-specific schedulers).
--
-- Idempotent: WHERE EXISTS check before unscheduling — safe to run twice.
--
-- Verification on prod (run as service_role):
--   SELECT jobid, jobname, schedule, active FROM cron.job
--    WHERE jobname = 'alfanumrik-daily-cron';
--   -- Expected: 0 rows after this migration is applied.
--
-- Rollback: re-apply 20260404000002_pg_cron_daily.sql (kept under
--           supabase/migrations/_legacy/timestamped/) to restore the schedule.

DO $$
BEGIN
  -- Only attempt unschedule if the pg_cron extension is installed AND the
  -- job actually exists. This keeps the migration safe on dev/CI projects
  -- that never installed pg_cron.
  IF EXISTS (
    SELECT 1
      FROM pg_extension
     WHERE extname = 'pg_cron'
  ) AND EXISTS (
    SELECT 1
      FROM cron.job
     WHERE jobname = 'alfanumrik-daily-cron'
  ) THEN
    PERFORM cron.unschedule('alfanumrik-daily-cron');
    RAISE NOTICE 'Unscheduled pg_cron job: alfanumrik-daily-cron (Vercel cron is now canonical)';
  ELSE
    RAISE NOTICE 'pg_cron job alfanumrik-daily-cron not present — nothing to unschedule';
  END IF;
END $$;
