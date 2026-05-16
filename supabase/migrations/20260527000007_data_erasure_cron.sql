-- 20260527000007_data_erasure_cron.sql
-- Purpose: schedule the data-erasure-purger Edge Function via pg_cron.
--
-- Phase D.3 (DPDP §15). Pairs with the data_erasure_requests table created
-- in 20260527000006_data_erasure_requests.sql and the Edge Function at
-- supabase/functions/data-erasure-purger/index.ts.
--
-- Requires ONE new Vault secret to be created BEFORE this migration applies:
--   SELECT vault.create_secret(
--     'https://<project-ref>.supabase.co/functions/v1/data-erasure-purger',
--     'data_erasure_purger_url',
--     'URL of the data-erasure-purger Edge Function called by pg_cron'
--   );
--
-- Reuses the existing `projector_runner_service_role_key` Vault secret
-- created by 20260524110002_projector_runner_cron.sql — both functions are
-- service-role-callable; the JWT is the same.
--
-- Cadence: every 6 hours (`0 */6 * * *`). DPDP §15 + per-school-backup-restore
-- §7 give us 30 days to complete erasure; the 7-day grace + a 6h cron tick
-- leave a 22-day safety margin even if a single tick is missed. We deliberately
-- do NOT run more often — each tick scans the table, processes overdue rows,
-- and the underlying cascade DELETEs are expensive. 6h is the sweet spot.
--
-- pg_cron extension guard: matches the pattern from PR #756 follow-up at
-- commit 55d5d6ba. On environments where pg_cron is not installed (staging as
-- of 2026-05-16 per docs/architecture/EXCEPTIONS.md), the migration skips
-- with a NOTICE so `supabase db push` proceeds. The Edge Function itself is
-- harmless when not scheduled — it can be invoked manually from the Supabase
-- dashboard for ad-hoc purges.

DO $migration_body$
DECLARE
  v_jobid bigint;
  v_url   text;
BEGIN
  -- Environment guard: skip cleanly if pg_cron is not installed.
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE
      'pg_cron extension not installed; skipping data-erasure-purger cron '
      'schedule. Enable via Supabase dashboard -> Database -> Extensions to '
      'activate the 6-hour purger tick. (Likely staging/dev environment.) '
      'The Edge Function itself is still deployable and can be invoked '
      'manually for spot purges.';
    RETURN;
  END IF;

  -- Secret-availability guard: refuse to schedule a job that would just
  -- fail-loop until operator action. If the URL secret has not been
  -- created, leave a NOTICE and exit; the operator can re-run this
  -- migration after `vault.create_secret(...)`.
  SELECT decrypted_secret INTO v_url
  FROM vault.decrypted_secrets
  WHERE name = 'data_erasure_purger_url'
  LIMIT 1;

  IF v_url IS NULL THEN
    RAISE NOTICE
      'Vault secret "data_erasure_purger_url" not found. Create it via '
      'SELECT vault.create_secret(<https://<ref>.supabase.co/functions/v1/'
      'data-erasure-purger>, ''data_erasure_purger_url'', ...) and '
      're-apply this migration (idempotent).';
    RETURN;
  END IF;

  -- Idempotent guard: drop any existing job with this name so re-applying
  -- the migration replaces a stale schedule cleanly.
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'data-erasure-purger-tick';
  IF v_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(v_jobid);
  END IF;

  PERFORM cron.schedule(
    job_name := 'data-erasure-purger-tick',
    schedule := '0 */6 * * *',  -- every 6 hours, at minute 0
    command  := $cron_cmd$
      SELECT net.http_post(
        url := (SELECT decrypted_secret FROM vault.decrypted_secrets
                WHERE name = 'data_erasure_purger_url' LIMIT 1),
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || (
            SELECT decrypted_secret FROM vault.decrypted_secrets
            WHERE name = 'projector_runner_service_role_key' LIMIT 1
          ),
          'Content-Type', 'application/json'
        ),
        body := jsonb_build_object('source', 'pg_cron'),
        -- Cascade DELETEs across 12 tables can run long. 60s ceiling so a
        -- single problematic row doesn't wedge the cron worker indefinitely.
        timeout_milliseconds := 60000
      );
    $cron_cmd$
  );
END $migration_body$;
