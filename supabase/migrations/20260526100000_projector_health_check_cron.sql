-- 20260526100000_projector_health_check_cron.sql
-- Purpose: schedule the projector-health-check Edge Function via pg_cron.
--
-- See docs/architecture/SLO.md "Projector lag" row for the threshold this
-- function enforces (warn ≥ 5s, critical ≥ 30s).
-- See supabase/functions/projector-health-check/index.ts for the function.
-- See docs/runbooks/projector-failure.md for the operator response.
--
-- Requires ONE new Vault secret to be created BEFORE this migration applies:
--   SELECT vault.create_secret(
--     'https://<project-ref>.supabase.co/functions/v1/projector-health-check',
--     'projector_health_check_url',
--     'URL of the projector-health-check Edge Function called by pg_cron'
--   );
--
-- Reuses the existing `projector_runner_service_role_key` Vault secret
-- created by 20260524110002_projector_runner_cron.sql — both functions are
-- service-role-callable; the JWT is the same.
--
-- Cadence: every 2 minutes. The projector-runner ticks every 1 minute;
-- checking lag at 2x runner cadence captures sustained degradation in one
-- paging window without doubling cron load.
--
-- pg_cron extension guard: matches the pattern from PR #756 follow-up at
-- commit 55d5d6ba. On environments where pg_cron is not installed (staging
-- as of 2026-05-16 per docs/architecture/EXCEPTIONS.md), the migration
-- skips with a NOTICE so `supabase db push` proceeds. The Edge Function
-- itself is harmless when not scheduled — it can be invoked manually from
-- the Supabase dashboard for ad-hoc checks.

DO $migration_body$
DECLARE
  v_jobid bigint;
  v_url   text;
BEGIN
  -- Environment guard: skip cleanly if pg_cron is not installed.
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE
      'pg_cron extension not installed; skipping projector-health-check cron '
      'schedule. Enable via Supabase dashboard -> Database -> Extensions to '
      'activate the 2-minute health-check tick. (Likely staging/dev '
      'environment.) The Edge Function itself is still deployable and can be '
      'invoked manually for spot checks.';
    RETURN;
  END IF;

  -- Secret-availability guard: refuse to schedule a job that would just
  -- fail-loop until operator action. If the URL secret has not been
  -- created, leave a NOTICE and exit; the operator can re-run this
  -- migration after `vault.create_secret(...)`.
  SELECT decrypted_secret INTO v_url
  FROM vault.decrypted_secrets
  WHERE name = 'projector_health_check_url'
  LIMIT 1;

  IF v_url IS NULL THEN
    RAISE NOTICE
      'Vault secret "projector_health_check_url" not found. Create it via '
      'SELECT vault.create_secret(<https://<ref>.supabase.co/functions/v1/'
      'projector-health-check>, ''projector_health_check_url'', ...) and '
      're-apply this migration (idempotent).';
    RETURN;
  END IF;

  -- Idempotent guard: drop any existing job with this name so re-applying
  -- the migration replaces a stale schedule cleanly.
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'projector-health-check-tick';
  IF v_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(v_jobid);
  END IF;

  PERFORM cron.schedule(
    job_name := 'projector-health-check-tick',
    schedule := '*/2 * * * *',  -- every 2 minutes
    command  := $cron_cmd$
      SELECT net.http_post(
        url := (SELECT decrypted_secret FROM vault.decrypted_secrets
                WHERE name = 'projector_health_check_url' LIMIT 1),
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || (
            SELECT decrypted_secret FROM vault.decrypted_secrets
            WHERE name = 'projector_runner_service_role_key' LIMIT 1
          ),
          'Content-Type', 'application/json'
        ),
        body := jsonb_build_object('source', 'pg_cron'),
        timeout_milliseconds := 15000
      );
    $cron_cmd$
  );
END $migration_body$;
