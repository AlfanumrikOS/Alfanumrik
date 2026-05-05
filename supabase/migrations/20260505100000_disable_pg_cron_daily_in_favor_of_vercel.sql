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
-- pg_cron is NOT installed (staging, dev, fresh DR projects).
--
-- Hotfix history (2026-05-05):
--   v1: parser failed on cron.job ref when pg_cron not installed (SQLSTATE 42P01)
--   v2: Win-1252 em-dash bytes 0x97 broke UTF-8 (SQLSTATE 22021)
--   v3: my Python heredoc doubled all single quotes ('' instead of ') -> syntax error
--   v4 (this): final fix - manually verified single-quote SQL string literals.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      EXECUTE 'SELECT cron.unschedule(' || quote_literal('alfanumrik-daily-cron') || ')';
      RAISE NOTICE 'Unscheduled pg_cron job: alfanumrik-daily-cron (Vercel cron is now canonical)';
    EXCEPTION
      WHEN OTHERS THEN
        RAISE NOTICE 'pg_cron unschedule no-op (job may not exist): %', SQLERRM;
    END;
  ELSE
    RAISE NOTICE 'pg_cron extension not installed - nothing to unschedule (safe no-op on staging/dev)';
  END IF;
END $$;
