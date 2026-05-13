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
-- Verified pre-existing on production (per migration history). Staging
-- does NOT currently have pg_cron installed — enabling it requires
-- operator action in Supabase dashboard → Database → Extensions. Until
-- then, the migration's contents below are wrapped in a guard that
-- skips cleanly on environments without pg_cron, so the rest of the
-- migration pipeline can proceed. The projector-runner itself is
-- dormant on staging regardless (ff_projector_runner_v1 default OFF),
-- so skipping the cron schedule has no behavioural impact there.
--
-- The cron job hits the Edge Function once per minute. The function honors
-- ff_projector_runner_v1 internally — when OFF it returns {skipped:true}
-- without touching cursors. The cadence is therefore safe to leave on
-- even when the substrate is dormant.

DO $migration_body$
DECLARE
  v_jobid bigint;
BEGIN
  -- Environment guard: pg_cron must be installed for cron.job /
  -- cron.unschedule / cron.schedule to resolve. On environments where
  -- the extension hasn't been enabled (currently: staging), skip with
  -- a NOTICE so `supabase db push` can proceed past this migration
  -- instead of failing with `relation "cron.job" does not exist`.
  -- On prod the extension is installed, the IF passes, and the
  -- original schedule/unschedule logic runs unchanged.
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE
      'pg_cron extension not installed; skipping projector-runner cron schedule. '
      'Enable via Supabase dashboard -> Database -> Extensions to activate the '
      '1-minute projector-runner tick. (Likely staging/dev environment.)';
    RETURN;
  END IF;

  -- Idempotent guard: drop any existing job with this name (including a
  -- manually-scheduled one) so the migration can re-apply cleanly.
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'projector-runner-tick';
  IF v_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(v_jobid);
  END IF;

  PERFORM cron.schedule(
    job_name := 'projector-runner-tick',
    schedule := '*/1 * * * *',  -- every minute
    command  := $cron_cmd$
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
    $cron_cmd$
  );
END $migration_body$;
