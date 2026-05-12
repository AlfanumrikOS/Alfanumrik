-- 20260524110002_projector_runner_cron.sql
-- Purpose: schedule the projector-runner Edge Function via pg_cron.
-- Requires:
--   * pg_cron + pg_net extensions enabled on the project.
--   * GUCs set out-of-band:
--       ALTER DATABASE postgres SET app.projector_runner_url = '<edge fn URL>';
--       ALTER DATABASE postgres SET app.service_role_key     = '<service-role JWT>';
--     (Set via Supabase Vault before applying this migration.)
--
-- The job hits the Edge Function once per minute. The function honors
-- ff_projector_runner_v1 internally — when OFF it returns {skipped:true}
-- without touching cursors. The cron job's cadence is therefore safe to
-- leave on even when the substrate is dormant.

-- Idempotent guard: drop any existing job with this name so the migration
-- can re-apply cleanly.
DO $$
DECLARE
  v_jobid bigint;
BEGIN
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'projector-runner-tick';
  IF v_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(v_jobid);
  END IF;
END $$;

SELECT cron.schedule(
  job_name := 'projector-runner-tick',
  schedule := '*/1 * * * *',  -- every minute
  command  := $$
    SELECT net.http_post(
      url := current_setting('app.projector_runner_url'),
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || current_setting('app.service_role_key'),
        'Content-Type', 'application/json'
      ),
      body := jsonb_build_object('source', 'pg_cron'),
      timeout_milliseconds := 30000
    );
  $$
);
