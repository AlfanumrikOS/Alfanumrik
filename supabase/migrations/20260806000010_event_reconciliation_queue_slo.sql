-- Migration: Event reconciliation + queue SLO monitoring (P2-2, P2-3)
-- Audit remediation 2026-08-06: Adds automated reconciliation between events
-- and outcomes, plus queue-age SLO monitoring.

-- Part 1: Event-to-outcome reconciliation function
CREATE OR REPLACE FUNCTION public.reconcile_events_to_outcomes(
  p_event_type text DEFAULT NULL,
  p_min_age interval DEFAULT '1 hour',
  p_max_events integer DEFAULT 10000
) RETURNS TABLE(
  event_type text,
  total_accepted bigint,
  total_processed bigint,
  total_failed bigint,
  total_inflight bigint,
  total_missing bigint,
  reconciliation_rate numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
SET statement_timeout = '30s'
AS $$
BEGIN
  -- Reconcile state_events against their projections
  -- For quiz_completed events, check that quiz_sessions exist
  RETURN QUERY
  WITH accepted_events AS (
    SELECT
      event_type,
      count(*) AS accepted_count
    FROM public.state_events
    WHERE created_at < now() - p_min_age
      AND (p_event_type IS NULL OR event_type = p_event_type)
      AND event_type = 'learner.quiz_completed'
    GROUP BY event_type
  ),
  processed_events AS (
    SELECT
      'learner.quiz_completed' AS event_type,
      count(DISTINCT qs.id) AS session_count
    FROM public.quiz_sessions qs
    WHERE qs.created_at > now() - interval '30 days'
  ),
  failed_events AS (
    SELECT
      event_type,
      count(*) AS failed_count
    FROM public.state_events
    WHERE processing_status = 'failed'
      AND created_at < now() - p_min_age
      AND (p_event_type IS NULL OR event_type = p_event_type)
    GROUP BY event_type
  ),
  inflight_events AS (
    SELECT
      event_type,
      count(*) AS inflight_count
    FROM public.state_events
    WHERE processing_status IN ('accepted', 'processing')
      AND created_at < now() - p_min_age
      AND (p_event_type IS NULL OR event_type = p_event_type)
    GROUP BY event_type
  )
  SELECT
    ae.event_type,
    ae.accepted_count AS total_accepted,
    COALESCE(pe.session_count, 0) AS total_processed,
    COALESCE(fe.failed_count, 0) AS total_failed,
    COALESCE(ie.inflight_count, 0) AS total_inflight,
    ae.accepted_count - COALESCE(pe.session_count, 0) - COALESCE(fe.failed_count, 0) - COALESCE(ie.inflight_count, 0) AS total_missing,
    CASE WHEN ae.accepted_count > 0
      THEN ROUND((COALESCE(pe.session_count, 0)::numeric / ae.accepted_count) * 100, 2)
      ELSE 100
    END AS reconciliation_rate
  FROM accepted_events ae
  LEFT JOIN processed_events pe ON pe.event_type = ae.event_type
  LEFT JOIN failed_events fe ON fe.event_type = ae.event_type
  LEFT JOIN inflight_events ie ON ie.event_type = ae.event_type;
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_events_to_outcomes(text, interval, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reconcile_events_to_outcomes(text, interval, integer) TO service_role;

-- Part 2: Queue SLO monitoring view
CREATE OR REPLACE VIEW public.v_queue_health AS
WITH queue_stats AS (
  SELECT
    'task_queue' AS queue_name,
    count(*) AS total_pending,
    count(*) FILTER (WHERE status = 'pending') AS pending,
    count(*) FILTER (WHERE status = 'processing') AS processing,
    count(*) FILTER (WHERE status = 'failed') AS failed,
    count(*) FILTER (WHERE status = 'dead_letter') AS dead_letter,
    COALESCE(EXTRACT(EPOCH FROM (now() - MIN(created_at)))::integer, 0) AS oldest_item_age_seconds,
    COALESCE(EXTRACT(EPOCH FROM (now() - MAX(created_at)))::integer, 0) AS newest_item_age_seconds
  FROM public.task_queue
  WHERE status IN ('pending', 'processing', 'failed', 'dead_letter')
),
event_stats AS (
  SELECT
    'state_events' AS queue_name,
    count(*) AS total_pending,
    count(*) FILTER (WHERE processing_status = 'received') AS pending,
    count(*) FILTER (WHERE processing_status = 'accepted') AS processing,
    count(*) FILTER (WHERE processing_status = 'failed') AS failed,
    count(*) FILTER (WHERE processing_status = 'dead_letter') AS dead_letter,
    COALESCE(EXTRACT(EPOCH FROM (now() - MIN(created_at)))::integer, 0) AS oldest_item_age_seconds,
    COALESCE(EXTRACT(EPOCH FROM (now() - MAX(created_at)))::integer, 0) AS newest_item_age_seconds
  FROM public.state_events
  WHERE processing_status IN ('received', 'accepted', 'failed', 'dead_letter')
),
projector_stats AS (
  SELECT
    'projector' AS queue_name,
    count(*) AS total_pending,
    count(*) FILTER (WHERE status = 'pending') AS pending,
    count(*) FILTER (WHERE status = 'running') AS processing,
    count(*) FILTER (WHERE status = 'failed') AS failed,
    0 AS dead_letter,
    COALESCE(EXTRACT(EPOCH FROM (now() - MIN(created_at)))::integer, 0) AS oldest_item_age_seconds,
    COALESCE(EXTRACT(EPOCH FROM (now() - MAX(created_at)))::integer, 0) AS newest_item_age_seconds
  FROM public.projector_run_log
  WHERE status IN ('pending', 'running', 'failed')
)
SELECT * FROM queue_stats
UNION ALL SELECT * FROM event_stats
UNION ALL SELECT * FROM projector_stats;

-- Part 3: Queue SLO alert function
CREATE OR REPLACE FUNCTION public.check_queue_slos()
RETURNS TABLE(
  queue_name text,
  slo_violation text,
  current_value text,
  threshold text,
  severity text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_rec record;
BEGIN
  FOR v_rec IN SELECT * FROM public.v_queue_health LOOP
    -- SLO: oldest item must be < 10 minutes old
    IF v_rec.oldest_item_age_seconds > 600 THEN
      RETURN QUERY SELECT
        v_rec.queue_name,
        'oldest_item_age',
        (v_rec.oldest_item_age_seconds / 60)::text || ' min',
        '10 min',
        CASE WHEN v_rec.oldest_item_age_seconds > 3600 THEN 'CRITICAL'
             WHEN v_rec.oldest_item_age_seconds > 1800 THEN 'HIGH'
             ELSE 'MEDIUM'
        END;
    END IF;

    -- SLO: failed + dead_letter must be < 1% of total
    IF v_rec.total_pending > 100 AND
       (v_rec.failed + v_rec.dead_letter)::float / NULLIF(v_rec.total_pending, 0) > 0.01 THEN
      RETURN QUERY SELECT
        v_rec.queue_name,
        'failure_rate',
        ROUND(((v_rec.failed + v_rec.dead_letter)::numeric / v_rec.total_pending) * 100, 2)::text || '%',
        '1%',
        CASE WHEN v_rec.dead_letter > 0 THEN 'CRITICAL' ELSE 'HIGH' END;
    END IF;

    -- SLO: dead_letter must be 0 for any queue
    IF v_rec.dead_letter > 0 THEN
      RETURN QUERY SELECT
        v_rec.queue_name,
        'dead_letter_present',
        v_rec.dead_letter::text,
        '0',
        'CRITICAL';
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.check_queue_slos() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_queue_slos() TO service_role;
