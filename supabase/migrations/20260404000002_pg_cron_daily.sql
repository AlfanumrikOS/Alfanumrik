-- Migration: 20260404000002_pg_cron_daily.sql
--
-- Schedules the daily-cron Supabase Edge Function via pg_cron + pg_net.
--
-- The daily-cron function (supabase/functions/daily-cron/index.ts) handles:
--   1. Streak resets for students who missed yesterday
--   2. Leaderboard recalculation (XP ranking per grade)
--   3. Parent digest notifications
--   4. Task queue cleanup
--
-- Schedule: 18:30 UTC = 00:00 IST (midnight India Standard Time, UTC+5:30)
--
-- Prerequisites:
--   1. pg_cron  — available on Supabase Pro/Team plans
--   2. pg_net   — available on all Supabase plans (enabled by default)
--   3. Set the cron secret in the database:
--        ALTER DATABASE postgres SET app.cron_secret = 'your-cron-secret';
--      This value must match CRON_SECRET in the Edge Function env vars.
--
-- To verify the job is scheduled:
--   SELECT * FROM cron.job WHERE jobname = 'alfanumrik-daily-cron';
--
-- To manually trigger (test):
--   SELECT cron.run_job('alfanumrik-daily-cron');

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Remove existing job to avoid duplicates on re-run
SELECT cron.unschedule('alfanumrik-daily-cron')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'alfanumrik-daily-cron'
);

SELECT cron.schedule(
  'alfanumrik-daily-cron',
  '30 18 * * *', -- 18:30 UTC = midnight IST
  $$
  SELECT net.http_post(
    url      := 'https://shktyoxqhundlvkiwguu.supabase.co/functions/v1/daily-cron',
    headers  := jsonb_build_object(
                  'Content-Type',   'application/json',
                  'x-cron-secret',  current_setting('app.cron_secret', true)
                ),
    body     := '{}'::jsonb
  ) AS request_id;
  $$
);
