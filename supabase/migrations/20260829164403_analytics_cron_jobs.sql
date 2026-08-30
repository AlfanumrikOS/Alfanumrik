-- Reconstructed from production ledger (supabase_migrations.schema_migrations).
-- Originally applied out-of-band 2026-08-29; committed to restore parity.
-- Content verified byte-identical to stored statements. Do not re-run
-- against production — already applied at version 20260829164403.

DO $migration_body$
DECLARE
  v_jobid bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE
      'pg_cron extension not installed; skipping analytics cron schedule. '
      'Enable via Supabase dashboard → Database → Extensions to activate '
      'nightly materialized view refresh.';
    RETURN;
  END IF;

  -- 1. Student daily summary refresh (22:30 UTC = 04:00 IST)
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'analytics-refresh-student-daily';
  IF v_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(v_jobid);
  END IF;

  PERFORM cron.schedule(
    job_name := 'analytics-refresh-student-daily',
    schedule := '30 22 * * *',
    command  := 'REFRESH MATERIALIZED VIEW CONCURRENTLY analytics.student_daily_summary;'
  );

  -- 2. Class activity summary refresh (22:50 UTC = 04:20 IST)
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'analytics-refresh-class-daily';
  IF v_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(v_jobid);
  END IF;

  PERFORM cron.schedule(
    job_name := 'analytics-refresh-class-daily',
    schedule := '50 22 * * *',
    command  := 'REFRESH MATERIALIZED VIEW CONCURRENTLY analytics.class_activity_summary;'
  );

  -- 3. School activity summary refresh (23:10 UTC = 04:40 IST)
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'analytics-refresh-school-daily';
  IF v_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(v_jobid);
  END IF;

  PERFORM cron.schedule(
    job_name := 'analytics-refresh-school-daily',
    schedule := '10 23 * * *',
    command  := 'REFRESH MATERIALIZED VIEW CONCURRENTLY analytics.school_activity_summary;'
  );

  -- 4. Retention cleanup: telemetry tables (21:30 UTC = 03:00 IST)
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'analytics-retention-cleanup';
  IF v_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(v_jobid);
  END IF;

  PERFORM cron.schedule(
    job_name := 'analytics-retention-cleanup',
    schedule := '30 21 * * *',
    command  := $cron_cmd$
      DELETE FROM public.product_events
        WHERE created_at < NOW() - INTERVAL '90 days'
        AND ctid IN (
          SELECT ctid FROM public.product_events
          WHERE created_at < NOW() - INTERVAL '90 days'
          LIMIT 10000
        );
      DELETE FROM public.engagement_events
        WHERE created_at < NOW() - INTERVAL '90 days'
        AND ctid IN (
          SELECT ctid FROM public.engagement_events
          WHERE created_at < NOW() - INTERVAL '90 days'
          LIMIT 10000
        );
      DELETE FROM public.analytics_events
        WHERE created_at < NOW() - INTERVAL '90 days'
        AND ctid IN (
          SELECT ctid FROM public.analytics_events
          WHERE created_at < NOW() - INTERVAL '90 days'
          LIMIT 10000
        );
    $cron_cmd$
  );

END;
$migration_body$;