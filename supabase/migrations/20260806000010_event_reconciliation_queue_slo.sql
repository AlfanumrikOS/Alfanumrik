-- Migration: Event reconciliation + queue health monitoring (P2-2, P2-3)
-- Audit remediation 2026-08-07 — REBUILT against real schema.
--
-- Real schema facts:
--   state_events (20260521100000:74): columns are event_id, kind,
--     actor_auth_user_id, tenant_id, idempotency_key, occurred_at, payload,
--     created_at. NO processing_status, NO event_type.
--   task_queue (baseline:14324): columns are id, queue_name, payload, status,
--     attempts, max_attempts, created_at, processing_at, completed_at, error.
--     NO student_id. Valid statuses from queue-consumer: pending|processing|
--     completed|failed|dead_letter.
--   projector_run_log does NOT exist. Removed entirely.

-- Part 1: Quiz-completed event → session reconciliation
CREATE OR REPLACE FUNCTION public.reconcile_quiz_events_to_sessions()
RETURNS TABLE(
  total_events bigint,
  matched_sessions bigint,
  unmatched_events bigint,
  event_type text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
SET statement_timeout = '30s'
AS $$
DECLARE
  v_total bigint;
  v_matched bigint;
BEGIN
  SELECT count(*) INTO v_total
  FROM public.state_events
  WHERE kind = 'learner.quiz_completed'
    AND occurred_at > now() - interval '30 days';

  SELECT count(DISTINCT se.event_id) INTO v_matched
  FROM public.state_events se
  JOIN public.quiz_sessions qs
    ON qs.created_at BETWEEN se.occurred_at - interval '1 min'
                        AND se.occurred_at + interval '5 min'
  WHERE se.kind = 'learner.quiz_completed'
    AND se.occurred_at > now() - interval '30 days';

  total_events := v_total;
  matched_sessions := v_matched;
  unmatched_events := v_total - v_matched;
  event_type := 'learner.quiz_completed';
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_quiz_events_to_sessions() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reconcile_quiz_events_to_sessions() TO service_role;

-- Part 2: Queue health view using REAL task_queue columns
CREATE OR REPLACE VIEW public.v_queue_health AS
SELECT
  queue_name,
  count(*) FILTER (WHERE status = 'pending')     AS pending,
  count(*) FILTER (WHERE status = 'processing')  AS processing,
  count(*) FILTER (WHERE status = 'completed')   AS completed,
  count(*) FILTER (WHERE status = 'failed')      AS failed,
  count(*) FILTER (WHERE status = 'dead_letter') AS dead_letter,
  count(*) AS total_non_terminal,
  COALESCE(EXTRACT(EPOCH FROM (now() - min(created_at)))::integer, 0) AS oldest_item_age_seconds
FROM public.task_queue
WHERE status IN ('pending', 'processing', 'failed', 'dead_letter')
GROUP BY queue_name;

-- Part 3: Queue SLO alert function (real columns)
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
    -- SLO: oldest pending item must be < 10 minutes old
    IF v_rec.oldest_item_age_seconds > 600 THEN
      RETURN QUERY SELECT
        v_rec.queue_name,
        'oldest_item_age',
        (v_rec.oldest_item_age_seconds / 60)::text || ' min',
        '10 min',
        CASE WHEN v_rec.oldest_item_age_seconds > 3600 THEN 'CRITICAL'
             WHEN v_rec.oldest_item_age_seconds > 1800 THEN 'HIGH'
             ELSE 'MEDIUM' END;
    END IF;

    -- SLO: dead-letter must be 0
    IF v_rec.dead_letter > 0 THEN
      RETURN QUERY SELECT
        v_rec.queue_name,
        'dead_letter_present',
        v_rec.dead_letter::text,
        '0',
        'CRITICAL';
    END IF;

    -- SLO: failure rate < 1% of non-terminal items
    IF v_rec.total_non_terminal > 100 AND
       (v_rec.failed::float / NULLIF(v_rec.total_non_terminal, 0)) > 0.01 THEN
      RETURN QUERY SELECT
        v_rec.queue_name,
        'failure_rate',
        ROUND((v_rec.failed::numeric / v_rec.total_non_terminal) * 100, 2)::text || '%',
        '1%',
        'HIGH';
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.check_queue_slos() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_queue_slos() TO service_role;
