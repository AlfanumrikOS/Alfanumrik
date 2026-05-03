-- Observability Console — Cut 1a
-- Adds ops_events append-only log, v_ops_timeline union view,
-- cleanup_ops_events retention function, and nightly pg_cron schedule.
-- Strictly additive: no existing table or function is modified.

BEGIN;

-- Required extensions (safe to run if already enabled).
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- ────────────────────────────────────────────────────────────
-- ops_events: the core append-only event log
-- ────────────────────────────────────────────────────────────
CREATE TABLE ops_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at     timestamptz NOT NULL,
  recorded_at     timestamptz NOT NULL DEFAULT now(),
  category        text NOT NULL,
  source          text NOT NULL,
  severity        text NOT NULL
    CHECK (severity IN ('info','warning','error','critical')),
  subject_type    text,
  subject_id      text,
  message         text NOT NULL,
  context         jsonb NOT NULL DEFAULT '{}'::jsonb,
  request_id      text,
  environment     text NOT NULL
);

COMMENT ON TABLE ops_events IS
  'Append-only operational event log. Written by logOpsEvent helpers. Read by super-admin observability UI.';

CREATE INDEX ops_events_occurred_at_idx
  ON ops_events (occurred_at DESC);

CREATE INDEX ops_events_category_time_idx
  ON ops_events (category, occurred_at DESC);

CREATE INDEX ops_events_severity_time_idx
  ON ops_events (severity, occurred_at DESC)
  WHERE severity IN ('error','critical');

CREATE INDEX ops_events_subject_idx
  ON ops_events (subject_type, subject_id, occurred_at DESC)
  WHERE subject_id IS NOT NULL;

CREATE INDEX ops_events_request_id_idx
  ON ops_events (request_id)
  WHERE request_id IS NOT NULL;

CREATE INDEX ops_events_context_gin_idx
  ON ops_events USING gin (context);

CREATE INDEX ops_events_rollable_idx
  ON ops_events (severity, occurred_at)
  WHERE severity IN ('info','warning');

ALTER TABLE ops_events ENABLE ROW LEVEL SECURITY;

-- Client code is never allowed to read or write this table directly.
-- Writers use service role (bypasses RLS). Readers use admin API routes.
CREATE POLICY "ops_events_no_client_access"
  ON ops_events
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

-- ────────────────────────────────────────────────────────────
-- v_ops_timeline: unified timeline view (events + admin audit)
-- ────────────────────────────────────────────────────────────
-- NOTE: admin_audit_log has no top-level admin_email column.
-- The email is stored in details->>'admin_email' (see admin-auth.ts
-- logAdminActionToSupabase and logAdminAction insert calls).
CREATE VIEW v_ops_timeline AS
SELECT
  id,
  occurred_at,
  category,
  source,
  severity,
  subject_type,
  subject_id,
  message,
  context,
  request_id,
  environment
FROM ops_events
UNION ALL
SELECT
  id,
  created_at                                            AS occurred_at,
  'admin_action'                                        AS category,
  COALESCE(details->>'admin_email', 'unknown')          AS source,
  'info'                                                AS severity,
  entity_type                                           AS subject_type,
  entity_id                                             AS subject_id,
  action                                                AS message,
  COALESCE(details, '{}'::jsonb)                        AS context,
  NULL                                                  AS request_id,
  'production'                                          AS environment
FROM admin_audit_log;

COMMENT ON VIEW v_ops_timeline IS
  'Unified timeline across ops_events and admin_audit_log. Read-only. Used by super-admin observability API.';

-- ────────────────────────────────────────────────────────────
-- cleanup_ops_events: tiered retention
-- info:     30 days
-- warning:  90 days
-- error:    forever (never deleted)
-- critical: forever (never deleted)
-- alert_dispatches with status='sent': 180 days (table exists in Cut 1b;
--   the DELETE is guarded by to_regclass so this function is safe to run
--   after 1a and before 1b).
-- ────────────────────────────────────────────────────────────
-- SECURITY DEFINER justification: cleanup_ops_events must delete rows
-- from ops_events (which has RLS denying all client access) and
-- optionally from alert_dispatches. Only pg_cron can invoke this
-- function; it runs as the DB owner. SECURITY DEFINER ensures the
-- function executes with the privileges of the defining role (superuser)
-- regardless of the caller context.
CREATE OR REPLACE FUNCTION cleanup_ops_events()
RETURNS TABLE (
  deleted_info       bigint,
  deleted_warning    bigint,
  deleted_dispatches bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_info     bigint := 0;
  v_warning  bigint := 0;
  v_dispatch bigint := 0;
BEGIN
  WITH d AS (
    DELETE FROM ops_events
     WHERE severity = 'info'
       AND occurred_at < now() - interval '30 days'
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_info FROM d;

  WITH d AS (
    DELETE FROM ops_events
     WHERE severity = 'warning'
       AND occurred_at < now() - interval '90 days'
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_warning FROM d;

  -- alert_dispatches may not exist yet (Cut 1b adds it).
  IF to_regclass('public.alert_dispatches') IS NOT NULL THEN
    EXECUTE $sql$
      WITH d AS (
        DELETE FROM alert_dispatches
         WHERE status = 'sent'
           AND fired_at < now() - interval '180 days'
        RETURNING 1
      )
      SELECT COUNT(*) FROM d
    $sql$ INTO v_dispatch;
  END IF;

  INSERT INTO ops_events (
    occurred_at, category, source, severity, message, context, environment
  ) VALUES (
    now(),
    'health',
    'cleanup-job',
    'info',
    'ops_events retention cleanup',
    jsonb_build_object(
      'deleted_info',       v_info,
      'deleted_warning',    v_warning,
      'deleted_dispatches', v_dispatch
    ),
    COALESCE(current_setting('app.environment', true), 'production')
  );

  RETURN QUERY SELECT v_info, v_warning, v_dispatch;
END;
$$;

COMMENT ON FUNCTION cleanup_ops_events() IS
  'Tiered retention cleanup. NEVER touches error/critical rows. Self-instruments one info event per run.';

-- ────────────────────────────────────────────────────────────
-- pg_cron: nightly cleanup at 03:30 UTC (09:00 IST)
-- ────────────────────────────────────────────────────────────
SELECT cron.schedule(
  'ops-events-cleanup',
  '30 3 * * *',
  $$ SELECT public.cleanup_ops_events(); $$
);

COMMIT;