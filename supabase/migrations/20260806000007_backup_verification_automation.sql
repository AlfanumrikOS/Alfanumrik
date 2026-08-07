-- Migration: Backup verification automation (P1-8)
-- Audit remediation 2026-08-07 — REBUILT against real schema.
--
-- Real schema facts (baseline 00000000000000):
--   backup_status (line 9978): backup_type CHECK allows database|storage|full|manual
--     (line 9991); status CHECK allows success|failed|in_progress|unknown|unverified
--     (line 9992).
--   state_events (20260521100000:74): columns are event_id, kind,
--     actor_auth_user_id, tenant_id, idempotency_key, occurred_at, payload,
--     created_at — NOT event_type/payload.

-- Part 1: Automate backup status verification
CREATE OR REPLACE FUNCTION public.verify_and_log_backup_status()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_latest_backup timestamptz;
  v_size_bytes bigint;
  v_status text;
BEGIN
  -- Check for recent successful backup records (Supabase-managed).
  -- backup_status.status CHECK allows only success|failed|in_progress|unknown|unverified.
  SELECT MAX(completed_at), MAX(size_bytes) INTO v_latest_backup, v_size_bytes
  FROM public.backup_status
  WHERE status = 'success';

  -- Map freshness to the allowed CHECK values.
  IF v_latest_backup IS NULL THEN
    v_status := 'unknown';
  ELSIF v_latest_backup < now() - interval '25 hours' THEN
    v_status := 'unverified';   -- backup exists but is stale → needs manual verify
  ELSE
    v_status := 'success';
  END IF;

  -- Record verification result using only CHECK-compliant values.
  INSERT INTO public.backup_status (
    backup_type, status, provider, coverage, size_bytes,
    started_at, completed_at, verified_at, notes
  ) VALUES (
    'manual',           -- CHECK allows database|storage|full|manual
    v_status,           -- CHECK allows success|failed|in_progress|unknown|unverified
    'supabase',
    'full_project',
    v_size_bytes,
    v_latest_backup,
    v_latest_backup,
    now(),
    CASE v_status
      WHEN 'success' THEN 'Automated verification: latest backup within 24h window'
      WHEN 'unverified' THEN 'ALERT: last backup older than 25h — check Supabase dashboard'
      ELSE 'No backup record found — backup may be disabled'
    END
  );

  -- Alert on unhealthy status via state_events (real columns, verified).
  -- NOTE: state_events.actor_auth_user_id is NOT NULL (20260521100000:77).
  -- Use a reserved system actor UUID (00000000-0000-0000-0000-000000000000)
  -- for automated/background events that have no human actor.
  IF v_status <> 'success' THEN
    INSERT INTO public.state_events (
      event_id, kind, actor_auth_user_id, idempotency_key, occurred_at, payload
    ) VALUES (
      gen_random_uuid(),
      'system.backup_verification_failed',
      '00000000-0000-0000-0000-000000000000',
      'backup-verify-' || now()::text,
      now(),
      jsonb_build_object(
        'status', v_status,
        'latest_backup', v_latest_backup,
        'checked_at', now(),
        'severity', CASE v_status WHEN 'unknown' THEN 'CRITICAL' ELSE 'HIGH' END
      )
    );
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.verify_and_log_backup_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.verify_and_log_backup_status() TO service_role;

-- Part 2: Restore drill tracking table (self-contained, safe)
CREATE TABLE IF NOT EXISTS public.restore_drill_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  drill_type text NOT NULL CHECK (drill_type IN (
    'full_restore', 'pitr_restore', 'partial_restore', 'object_restore'
  )),
  drill_date timestamptz DEFAULT now(),
  initiated_by text NOT NULL,
  approval_ref text,
  source_backup_id uuid REFERENCES public.backup_status(id),
  target_environment text NOT NULL,
  scope text NOT NULL,
  start_time timestamptz NOT NULL,
  end_time timestamptz,
  rpo_achieved interval,         -- Actual data loss (expected - actual)
  rto_achieved interval,         -- Actual recovery time
  row_counts_verified boolean DEFAULT false,
  constraint_integrity_verified boolean DEFAULT false,
  rls_grants_verified boolean DEFAULT false,
  auth_synthetics_verified boolean DEFAULT false,
  event_watermarks_verified boolean DEFAULT false,
  application_synthetics_verified boolean DEFAULT false,
  learner_state_reconstructed boolean DEFAULT false,
  deleted_data_controls_verified boolean DEFAULT false,
  result text NOT NULL CHECK (result IN (
    'success', 'partial_success', 'failed', 'aborted'
  )),
  issues_found text[],
  corrective_actions text[],
  report_link text,
  next_scheduled_drill timestamptz,
  notes text
);

ALTER TABLE public.restore_drill_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access restore_drill_log"
  ON public.restore_drill_log FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated can read drill log"
  ON public.restore_drill_log FOR SELECT
  TO authenticated
  USING (true);

-- Part 3: RPO/RTO SLO monitoring view (uses CHECK-compliant 'success', not 'healthy')
CREATE OR REPLACE VIEW public.v_backup_health_summary AS
SELECT
  (SELECT status FROM public.backup_status ORDER BY completed_at DESC NULLS LAST LIMIT 1) AS latest_backup_status,
  (SELECT completed_at FROM public.backup_status WHERE status = 'success' ORDER BY completed_at DESC LIMIT 1) AS last_healthy_backup,
  (SELECT count(*) FROM public.backup_status WHERE status = 'success' AND completed_at > now() - interval '7 days') AS backups_last_7d,
  (SELECT count(*) FROM public.restore_drill_log WHERE drill_date > now() - interval '90 days') AS drills_last_quarter,
  (SELECT result FROM public.restore_drill_log ORDER BY drill_date DESC LIMIT 1) AS last_drill_result,
  (SELECT drill_date FROM public.restore_drill_log ORDER BY drill_date DESC LIMIT 1) AS last_drill_date,
  (SELECT CASE WHEN count(*) = 0 THEN 'OVERDUE'
                WHEN max(drill_date) < now() - interval '90 days' THEN 'OVERDUE'
                ELSE 'on_track' END
   FROM public.restore_drill_log
   WHERE drill_date > now() - interval '90 days') AS drill_cadence_status;

-- Part 4: Daily health check function (callable from Vercel cron)
CREATE OR REPLACE FUNCTION public.run_daily_backup_health_check()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_result jsonb;
BEGIN
  -- Run verification
  PERFORM public.verify_and_log_backup_status();

  -- Build health summary
  SELECT jsonb_build_object(
    'checked_at', now(),
    'backup_status', latest_backup_status,
    'last_healthy', last_healthy_backup,
    'backups_7d', backups_last_7d,
    'last_drill', last_drill_result,
    'drill_cadence', drill_cadence_status
  ) INTO v_result
  FROM public.v_backup_health_summary;

  -- Execute data quality checks (from P1-7 migration) — best-effort.
  BEGIN
    INSERT INTO public.data_quality_check_results (check_name, result, detail, severity)
    SELECT check_name, result, detail, severity
    FROM public.run_data_quality_checks();
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  -- Record table row count baselines
  INSERT INTO public.table_row_count_baselines (table_name, row_count)
  SELECT
    c.relname::text,
    c.reltuples::bigint
  FROM pg_class c
  JOIN pg_namespace n ON c.relnamespace = n.oid
  WHERE n.nspname = 'public'
    AND c.relkind = 'r'
    AND c.reltuples > 0
    AND c.relname NOT LIKE 'pg_%'
    AND c.relname NOT LIKE '_prisma_%'
  ORDER BY c.reltuples DESC
  LIMIT 50;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.run_daily_backup_health_check() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.run_daily_backup_health_check() TO service_role;
