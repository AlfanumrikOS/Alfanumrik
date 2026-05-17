-- 20260528000008_synthetic_host_monitor_cron.sql
-- Phase H.1 (Super-Admin Production-Readiness Plan, 2026-05-17)
--
-- Purpose: schedule the synthetic-host-monitor Edge Function via pg_cron.
-- The function was deployed in Phase E.5 but never scheduled — per memory
-- `project_prod_readiness_phase_e_complete.md` open follow-up. Until this
-- cron runs, the per-school white-label health column shows 'na' for every
-- school with a custom domain (the source `synthetic_monitor_results` table
-- stays empty).
--
-- Cadence: every 5 minutes. Each tick HEAD-checks every active school's
-- custom_domain and writes a synthetic_monitor_results row.
--
-- Requires ONE Vault secret to be created BEFORE this migration applies:
--   SELECT vault.create_secret(
--     'https://<project-ref>.supabase.co/functions/v1/synthetic-host-monitor',
--     'synthetic_host_monitor_url',
--     'URL of the synthetic-host-monitor Edge Function called by pg_cron'
--   );
--
-- Reuses the existing `projector_runner_service_role_key` Vault secret —
-- both functions are service-role-callable.
--
-- pg_cron + Vault guards mirror 20260526100000 — silently SKIP with a
-- NOTICE on environments without pg_cron or the Vault secret, so
-- `supabase db push` proceeds. Operator re-runs after `vault.create_secret`.

DO $migration_body$
DECLARE
  v_jobid bigint;
  v_url   text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE
      'pg_cron not installed; skipping synthetic-host-monitor schedule. '
      'Enable via Supabase dashboard -> Database -> Extensions. The Edge '
      'Function itself is still deployable; invoke manually for spot checks.';
    RETURN;
  END IF;

  SELECT decrypted_secret INTO v_url
  FROM vault.decrypted_secrets
  WHERE name = 'synthetic_host_monitor_url'
  LIMIT 1;

  IF v_url IS NULL THEN
    RAISE NOTICE
      'Vault secret "synthetic_host_monitor_url" not found. Create it via '
      'SELECT vault.create_secret(<https://<ref>.supabase.co/functions/v1/'
      'synthetic-host-monitor>, ''synthetic_host_monitor_url'', ...) and '
      're-apply this migration (idempotent).';
    RETURN;
  END IF;

  -- Idempotent re-schedule
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'synthetic-host-monitor-tick';
  IF v_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(v_jobid);
  END IF;

  PERFORM cron.schedule(
    job_name := 'synthetic-host-monitor-tick',
    schedule := '*/5 * * * *',  -- every 5 minutes
    command  := $cron_cmd$
      SELECT net.http_post(
        url := (SELECT decrypted_secret FROM vault.decrypted_secrets
                WHERE name = 'synthetic_host_monitor_url' LIMIT 1),
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || (
            SELECT decrypted_secret FROM vault.decrypted_secrets
            WHERE name = 'projector_runner_service_role_key' LIMIT 1
          ),
          'Content-Type', 'application/json'
        ),
        body := jsonb_build_object('source', 'pg_cron'),
        timeout_milliseconds := 60000  -- 60s — synthetic HEADs N schools
      );
    $cron_cmd$
  );
END $migration_body$;
