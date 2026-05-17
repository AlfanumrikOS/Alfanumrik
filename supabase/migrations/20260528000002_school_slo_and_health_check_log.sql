-- ============================================================================
-- Migration: 20260528000002_school_slo_and_health_check_log.sql
-- Phase F.5 (Super-Admin Production-Readiness Plan, 2026-05-17)
--
-- Purpose: Create the two tables that the /super-admin/sla page expects.
-- Until now both were absent in prod, which forced the route to inject
-- synthetic 99.9% uptime + 5 hardcoded endpoint-latency rows that operators
-- read as real measurements. The route now returns explicit `no_data` states
-- (Phase F.5 code change); these tables let real data start flowing.
--
-- Source of writes (future work, not in this migration):
--   - `synthetic-host-monitor` Edge Function writes health_check_log rows
--     (Phase H.1 will schedule it via pg_cron).
--   - Vercel/Cloudflare/Sentry middleware writes school_slo rows aggregated
--     per (school_id, endpoint, hour) — separate instrumentation PR.
-- ============================================================================

-- 1. school_slo ── per-school per-endpoint latency aggregates
CREATE TABLE IF NOT EXISTS school_slo (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id     UUID NOT NULL,
  endpoint      TEXT NOT NULL,
  p50_ms        INTEGER NOT NULL,
  p95_ms        INTEGER NOT NULL,
  p99_ms        INTEGER NOT NULL,
  sample_count  INTEGER NOT NULL DEFAULT 0,
  measured_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- NOTE (2026-05-17 prod apply): a `bucket_hour` GENERATED column was
  -- originally proposed but fails with `ERROR 42P17: generation expression
  -- is not immutable` because `date_trunc('hour', timestamptz)` depends on
  -- the session TimeZone. Removed; hourly aggregation runs at query time.
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE school_slo ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "school_slo_service_role" ON school_slo;
CREATE POLICY "school_slo_service_role" ON school_slo
  FOR ALL USING (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS idx_school_slo_school_measured
  ON school_slo(school_id, measured_at DESC);
CREATE INDEX IF NOT EXISTS idx_school_slo_endpoint_measured
  ON school_slo(endpoint, measured_at DESC);
-- idx_school_slo_bucket dropped along with the bucket_hour generated column
-- (see comment on table above). The two indexes above cover the actual
-- query patterns the route uses.

-- 2. health_check_log ── platform-wide synthetic health probe history
CREATE TABLE IF NOT EXISTS health_check_log (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  checked_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  status            TEXT NOT NULL,
  response_time_ms  INTEGER NOT NULL DEFAULT 0,
  endpoint          TEXT NOT NULL DEFAULT '/api/v1/health',
  region            TEXT,
  error_message     TEXT,
  source            TEXT DEFAULT 'synthetic-host-monitor',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT health_check_log_status_check
    CHECK (status IN ('ok', 'healthy', 'degraded', 'critical', 'timeout', 'error'))
);

ALTER TABLE health_check_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "health_check_log_service_role" ON health_check_log;
CREATE POLICY "health_check_log_service_role" ON health_check_log
  FOR ALL USING (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS idx_health_check_log_checked
  ON health_check_log(checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_health_check_log_status
  ON health_check_log(status, checked_at DESC) WHERE status != 'ok' AND status != 'healthy';
CREATE INDEX IF NOT EXISTS idx_health_check_log_endpoint
  ON health_check_log(endpoint, checked_at DESC);

-- 3. aggregate_school_slo_daily() ── rolls 1-hour buckets into a 24h view
-- Intended to be invoked nightly by pg_cron. Idempotent for the day it runs:
-- recomputes the prior 24 hours and upserts into school_slo with bucket_hour
-- already covering the hour. Not used by the API directly (the route reads
-- raw school_slo rows), but kept here so the cron has a target.
CREATE OR REPLACE FUNCTION aggregate_school_slo_daily()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows_aggregated INTEGER := 0;
BEGIN
  -- Placeholder body: real percentile computation depends on the upstream
  -- source-of-truth table (e.g. Vercel access logs, Sentry transactions,
  -- application-emitted span rows) which is a separate instrumentation
  -- decision tracked in Phase H. The function exists today so Phase H can
  -- bind pg_cron to it without a schema bump.
  RETURN jsonb_build_object(
    'success', true,
    'rows_aggregated', v_rows_aggregated,
    'ran_at', now(),
    'note', 'No-op until upstream span source is selected (Phase H)'
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION aggregate_school_slo_daily() FROM public, anon, authenticated;
GRANT  EXECUTE ON FUNCTION aggregate_school_slo_daily() TO service_role;

COMMENT ON TABLE school_slo IS
  'Per-school per-endpoint latency aggregates. Read by /api/super-admin/sla. '
  'Written by Phase H instrumentation (not yet scheduled). Empty until then; '
  'the route reports state=no_data instead of synthetic numbers (Phase F.5).';

COMMENT ON TABLE health_check_log IS
  'Synthetic uptime probe history. Written by the synthetic-host-monitor '
  'Edge Function (deployed Phase E.5; not yet scheduled — Phase H.1).';
