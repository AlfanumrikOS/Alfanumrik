-- 20260729120100_reschedule_alert_deliverer_cron_auth.sql
-- Purpose: H1 fix (P11-adjacent). The alert-deliverer Edge Function
-- (supabase/functions/alert-deliverer/index.ts) previously accepted a bare,
-- client-controlled `x-cron-source: pg_cron` header with NO secret check as
-- one of its auth paths. That bypass has been removed from the function's
-- source in the same change; the function now authenticates exclusively via
-- verifyInternalCronRequest() (the shared, fail-closed internal-cron
-- contract — CRON_SECRET fast path via the `x-cron-secret` HEADER, then a
-- signed-internal-caller fallback).
--
-- The live `ops-alert-deliverer` pg_cron job was originally scheduled by the
-- now-archived supabase/migrations/_legacy/timestamped/20260413120000_
-- observability_console_1b.sql, which sends ONLY
-- `Authorization: Bearer <app.cron_secret>` — no `x-cron-secret` header.
-- verifyInternalCronRequest()'s CRON_SECRET fast path reads `x-cron-secret`
-- specifically (not the Authorization bearer value), so without this
-- reschedule the H1 auth-mechanism swap would silently break the ONLY live
-- caller of alert-deliverer and turn off ops alert delivery entirely.
--
-- This migration re-schedules the SAME job name (`ops-alert-deliverer`,
-- idempotent unschedule + reschedule) with the CURRENT platform convention
-- used by every other pg_cron-invoked Edge Function added since (see
-- 20260527000007_data_erasure_cron.sql, 20260528000008_synthetic_host_
-- monitor_cron.sql): both `Authorization: Bearer <service-role JWT>` (so
-- verifyInternalCronRequest's bearer-token check also has a valid fallback)
-- AND `x-cron-secret: <cron_secret>` (the fast path this function actually
-- takes), both read from the existing shared Vault secrets.
--
-- No new Vault secrets required — reuses `projector_runner_service_role_key`
-- and `cron_secret`, already created for other platform cron jobs.

DO $migration_body$
DECLARE
  v_jobid       bigint;
  v_service_key text;
  v_cron_secret text;
BEGIN
  -- Environment guard: skip cleanly if pg_cron is not installed.
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE
      'pg_cron extension not installed; skipping ops-alert-deliverer cron '
      'reschedule. (Likely staging/dev environment — no live pg_cron job to '
      'fix there.)';
    RETURN;
  END IF;

  SELECT decrypted_secret INTO v_service_key
  FROM vault.decrypted_secrets
  WHERE name = 'projector_runner_service_role_key'
  LIMIT 1;

  SELECT decrypted_secret INTO v_cron_secret
  FROM vault.decrypted_secrets
  WHERE name = 'cron_secret'
  LIMIT 1;

  IF v_service_key IS NULL OR v_cron_secret IS NULL THEN
    RAISE NOTICE
      'Vault secret "projector_runner_service_role_key" or "cron_secret" not '
      'found. These shared secrets are required for the reschedule. Confirm '
      'they exist in Vault, then re-apply this migration (idempotent).';
    RETURN;
  END IF;

  -- Idempotent guard: drop the existing job (created by the archived legacy
  -- migration, or a prior run of this one) before rescheduling.
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'ops-alert-deliverer';
  IF v_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(v_jobid);
  END IF;

  PERFORM cron.schedule(
    job_name := 'ops-alert-deliverer',
    schedule := '* * * * *',  -- unchanged cadence: every 1 minute
    command  := $cron_cmd$
      SELECT net.http_post(
        url := current_setting('app.supabase_url', true) || '/functions/v1/alert-deliverer',
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || (
            SELECT decrypted_secret FROM vault.decrypted_secrets
            WHERE name = 'projector_runner_service_role_key' LIMIT 1
          ),
          'x-cron-secret', (
            SELECT decrypted_secret FROM vault.decrypted_secrets
            WHERE name = 'cron_secret' LIMIT 1
          ),
          'Content-Type', 'application/json'
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 30000
      );
    $cron_cmd$
  );
END $migration_body$;
