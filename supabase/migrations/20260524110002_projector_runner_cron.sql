-- 20260524110002_projector_runner_cron.sql
-- Purpose: schedule the projector-runner Edge Function via pg_cron.
--
-- Requires Vault secrets to be created BEFORE this migration applies:
--   SELECT vault.create_secret(
--     'https://<project-ref>.supabase.co/functions/v1/projector-runner',
--     'projector_runner_url',
--     'URL of the projector-runner Edge Function called by pg_cron'
--   );
--   SELECT vault.create_secret(
--     '<service-role JWT from Supabase Dashboard → Project Settings → API>',
--     'projector_runner_service_role_key',
--     'Bearer token (service-role JWT) for projector-runner Edge Function'
--   );
--
-- Why Vault rather than ALTER DATABASE … SET app.*: the managed Supabase
-- `postgres` role lacks superuser privilege, so `ALTER DATABASE postgres
-- SET app.projector_runner_url = '…'` is rejected with SQLSTATE 42501
-- ("permission denied to set parameter"). Vault is the Supabase-intended
-- pattern for cron-accessible secrets — encrypted at rest with the
-- project's key, readable by the cron worker via `vault.decrypted_secrets`.
--
-- Pre-requisites: pg_cron + pg_net extensions enabled on the project.
-- Both verified pre-existing on production (per migration history).
--
-- The cron job hits the Edge Function once per minute. The function honors
-- ff_projector_runner_v1 internally — when OFF it returns {skipped:true}
-- without touching cursors. The cadence is therefore safe to leave on
-- even when the substrate is dormant.

-- Idempotent guard: drop any existing job with this name (including a
-- manually-scheduled one) so the migration can re-apply cleanly.
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
      url := (SELECT decrypted_secret FROM vault.decrypted_secrets
              WHERE name = 'projector_runner_url' LIMIT 1),
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || (
          SELECT decrypted_secret FROM vault.decrypted_secrets
          WHERE name = 'projector_runner_service_role_key' LIMIT 1
        ),
        'Content-Type', 'application/json'
      ),
      body := jsonb_build_object('source', 'pg_cron'),
      timeout_milliseconds := 30000
    );
  $$
);
