-- Migration: 20260505100000_disable_pg_cron_daily_in_favor_of_vercel.sql
-- Purpose: Disable the pg_cron-scheduled daily-cron job (alfanumrik-daily-cron)
--          so that the Vercel Cron entry at /api/cron/daily-cron (02:30 UTC) is
--          the canonical runner.
--
-- Per launch-readiness D6: Vercel cron is canonical for daily-cron because:
--   1. Visibility - Vercel exposes per-invocation logs in the dashboard.
--   2. Flag rollback - env-var driven CRON_SECRET can be rotated from Vercel.
--   3. Duplicate prevention - running both pg_cron AND Vercel cron produced
--      duplicate parent_digest notifications.
--
-- Scope: ONLY unschedules alfanumrik-daily-cron. Does NOT drop pg_cron extension
--        and does NOT touch any other cron jobs.
--
-- Idempotent + cron-schema-safe: Uses dynamic SQL via EXECUTE so the parser
-- does not try to resolve cron.job at parse time. Safe on environments where
-- pg_cron is NOT installed (staging, dev, fresh DR projects). Hotfix
-- 2026-05-05 after staging sync failed with SQLSTATE 42P01 on cron.job.
--
-- Verification on prod (run as service_role, only meaningful where pg_cron
-- is installed):
--   SELECT jobid, jobname, schedule, active FROM cron.job
--    WHERE jobname = ''alfanumrik-daily-cron'';
--   -- Expected: 0 rows after this migration is applied.
--
-- Rollback: re-apply 20260404000002_pg_cron_daily.sql (kept under
--           supabase/migrations/_legacy/timestamped/) to restore the schedule.

DO $$
BEGIN
  -- Outer guard: skip everything if pg_cron extension is not installed.
  -- pg_extension exists in every postgres so this query is always safe.
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = ''pg_cron'') THEN
    -- pg_cron IS installed. Use dynamic SQL so the parser does not try to
    -- resolve cron.job at function-create time on environments where the
    -- cron schema does not exist (e.g. staging projects that never enabled
    -- pg_cron). EXCEPTION block catches the case where the job itself does
    -- not exist (cron.unschedule raises in that case).
    BEGIN
      EXECUTE ''SELECT cron.unschedule(alfanumrik-daily-cron)'';
      RAISE NOTICE ''Unscheduled pg_cron job: alfanumrik-daily-cron (Vercel cron is now canonical)'';
    EXCEPTION
      WHEN OTHERS THEN
        -- Job may not exist OR cron schema may have been removed since the
        -- outer pg_extension check. Both are acceptable: idempotent no-op.
        RAISE NOTICE ''pg_cron unschedule no-op (job may not exist): %'', SQLERRM;
    END;
  ELSE
    RAISE NOTICE ''pg_cron extension not installed - nothing to unschedule (safe no-op on staging/dev)'';
  END IF;
END $$;
