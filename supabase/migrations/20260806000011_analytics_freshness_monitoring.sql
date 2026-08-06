-- Migration: Analytics freshness monitoring (P2-4)
-- Audit remediation 2026-08-06: Adds freshness tracking to dashboards and
-- automated stale-data detection for analytics consumers.

-- Table: Track freshness of analytical data sources
CREATE TABLE IF NOT EXISTS public.analytics_freshness_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_name text NOT NULL,             -- e.g., 'EIC_school_health_daily', 'mv_leaderboard'
  source_type text NOT NULL CHECK (source_type IN (
    'materialized_view', 'table', 'aggregation_job', 'dashboard_query'
  )),
  last_refreshed_at timestamptz,
  latest_source_watermark timestamptz,   -- Latest data point included in source
  row_count bigint,
  freshness_slo interval DEFAULT '24 hours',
  is_stale boolean GENERATED ALWAYS AS (
    last_refreshed_at IS NULL OR
    last_refreshed_at < now() - freshness_slo
  ) STORED,
  checked_at timestamptz DEFAULT now(),
  notes text
);

ALTER TABLE public.analytics_freshness_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access analytics_freshness_log"
  ON public.analytics_freshness_log FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated can read freshness log"
  ON public.analytics_freshness_log FOR SELECT
  TO authenticated
  USING (true);

-- Index for stale source detection
CREATE INDEX IF NOT EXISTS idx_freshness_stale
  ON public.analytics_freshness_log (source_name, checked_at DESC)
  WHERE is_stale = true;

-- Function: Record freshness check for a named source
CREATE OR REPLACE FUNCTION public.record_analytics_freshness(
  p_source_name text,
  p_source_type text,
  p_last_refreshed timestamptz DEFAULT NULL,
  p_row_count bigint DEFAULT NULL,
  p_freshness_slo interval DEFAULT '24 hours'
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  INSERT INTO public.analytics_freshness_log (
    source_name, source_type, last_refreshed_at,
    row_count, freshness_slo, checked_at
  ) VALUES (
    p_source_name, p_source_type, p_last_refreshed,
    p_row_count, p_freshness_slo, now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_analytics_freshness(text, text, timestamptz, bigint, interval) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_analytics_freshness(text, text, timestamptz, bigint, interval) TO service_role;

-- View: Current freshness status for all tracked sources
CREATE OR REPLACE VIEW public.v_analytics_freshness_status AS
SELECT DISTINCT ON (source_name)
  source_name,
  source_type,
  last_refreshed_at,
  row_count,
  freshness_slo,
  is_stale,
  checked_at,
  CASE
    WHEN is_stale AND checked_at > now() - interval '1 hour' THEN 'STALE'
    WHEN is_stale THEN 'STALE_UNCONFIRMED'
    WHEN last_refreshed_at IS NULL THEN 'UNKNOWN'
    ELSE 'FRESH'
  END AS freshness_status
FROM public.analytics_freshness_log
ORDER BY source_name, checked_at DESC;

-- Function: Auto-detect stale dashboards and emit alerts
CREATE OR REPLACE FUNCTION public.detect_stale_analytics()
RETURNS TABLE(
  source_name text,
  freshness_status text,
  hours_stale numeric
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT
    source_name,
    freshness_status,
    ROUND(EXTRACT(EPOCH FROM (now() - last_refreshed_at)) / 3600, 1) AS hours_stale
  FROM public.v_analytics_freshness_status
  WHERE freshness_status IN ('STALE', 'STALE_UNCONFIRMED')
  ORDER BY hours_stale DESC;
$$;

REVOKE ALL ON FUNCTION public.detect_stale_analytics() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.detect_stale_analytics() TO service_role;
