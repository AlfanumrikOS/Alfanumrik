-- Migration: 20260722101000_adaptive_loops_health_rpc.sql
-- Purpose: Aggregate-only health reader for the adaptive loops (A/B/C/D)
--          creation-rate + escalation + heartbeat monitoring surface
--          (Master Action Plan Phase 8, item 8.1 — the monitoring gate that
--          MUST exist before any adaptive-loop flag is flipped in production).
--
-- Before this, the operational health of adaptive_interventions was only
-- checkable via the ad-hoc SQL in docs/runbooks/adaptive-program-rollout.md §7
-- that a human ran by hand. This RPC packages those exact queries into one
-- SECURITY DEFINER reader that BOTH the nightly monitor cron
-- (/api/cron/adaptive-loops-monitor) and the super-admin dashboard API
-- (/api/super-admin/adaptive-loops) call, so the on-screen numbers and the
-- alert-firing numbers are derived from a single source of truth.
--
-- P13 — AGGREGATE ONLY. This function returns COUNTS and RATIOS only. It never
-- returns a student_id, auth_user_id, subject/chapter target, or any other
-- row-identifying or PII-shaped value (same posture as
-- get_recent_signup_verification_status in 20260716093000 and the Pulse
-- school-lens: the cross-role data boundary lives in SQL so PII never leaves
-- the database). The ceiling-violation signal is a COUNT of offending
-- (student, day) pairs and a COUNT of distinct students — never the ids.
--
-- No new table (so no new RLS surface). CREATE OR REPLACE + explicit GRANT ⇒
-- idempotent and safe to run twice.
--
-- Thresholds/windows sourced (NOT invented) from
-- docs/runbooks/adaptive-program-rollout.md:
--   * Per-student daily ceiling = 1 new intervention / student / day (§5 table,
--     §7 query "Per-student new rows per day MUST be <= 1"). ANY (student, day)
--     with count > 1 is a violation. Ceiling lookback = 7 days (§7 uses
--     "interval '7 days'").
--   * Escalation share = escalated terminal outcomes / all terminal outcomes
--     over the last 30 days (§7 "Terminal outcomes + escalation split ...
--     last 30 days"); the storm threshold of > 50% lives in the caller (§5
--     "Escalation share > 50% of terminal outcomes during a pilot"), not here —
--     this reader just reports the ratio.

CREATE OR REPLACE FUNCTION public.get_adaptive_loops_health(
  p_window_hours int DEFAULT 24,
  p_storm_days int DEFAULT 30
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH win AS (
    SELECT
      GREATEST(LEAST(p_window_hours, 168), 1) AS wh,   -- clamp 1h..7d
      GREATEST(LEAST(p_storm_days, 90), 1)   AS sd     -- clamp 1d..90d
  ),
  -- Daily NEW-intervention volume by loop over the rolling window (anti-storm
  -- primary signal — runbook §7 query 1). Loop D (blocked_prerequisite) is a
  -- first-class column because it shares this substrate (item 8.5).
  new_by_signal AS (
    SELECT ai.trigger_signal, count(*)::int AS n
    FROM public.adaptive_interventions ai, win
    WHERE ai.created_at >= now() - make_interval(hours => win.wh)
    GROUP BY ai.trigger_signal
  ),
  -- Per-student ceiling breaches over the last 7 days (runbook §7 query 2 —
  -- "expect: ZERO rows"). One row per offending (student, day). Aggregated to
  -- counts below; the student_id NEVER leaves this CTE.
  ceiling AS (
    SELECT ai.student_id, date_trunc('day', ai.created_at) AS d
    FROM public.adaptive_interventions ai
    WHERE ai.created_at >= now() - interval '7 days'
    GROUP BY ai.student_id, date_trunc('day', ai.created_at)
    HAVING count(*) > 1
  ),
  -- Terminal outcomes over the storm window (runbook §7 query 3). Escalation
  -- share = 'escalated' / all non-active terminal rows.
  terminal AS (
    SELECT ai.status, count(*)::int AS n
    FROM public.adaptive_interventions ai, win
    WHERE ai.resolved_at >= now() - make_interval(days => win.sd)
      AND ai.status <> 'active'
    GROUP BY ai.status
  ),
  -- Freshest successful-run heartbeat written by the adaptive-remediation cron
  -- (item 8.2). NULL when the job has never recorded one.
  heartbeat AS (
    SELECT max(oe.occurred_at) AS last_success_at
    FROM public.ops_events oe
    WHERE oe.category = 'job_health'
      AND oe.source = 'cron/adaptive-remediation'
  )
  SELECT jsonb_build_object(
    'window_hours', (SELECT wh FROM win),
    'storm_days',   (SELECT sd FROM win),
    'daily_new_by_signal', jsonb_build_object(
      'mastery_cliff',         COALESCE((SELECT n FROM new_by_signal WHERE trigger_signal = 'mastery_cliff'), 0),
      'inactivity',            COALESCE((SELECT n FROM new_by_signal WHERE trigger_signal = 'inactivity'), 0),
      'at_risk_concentration', COALESCE((SELECT n FROM new_by_signal WHERE trigger_signal = 'at_risk_concentration'), 0),
      'blocked_prerequisite',  COALESCE((SELECT n FROM new_by_signal WHERE trigger_signal = 'blocked_prerequisite'), 0)
    ),
    'daily_new_total',            COALESCE((SELECT sum(n)::int FROM new_by_signal), 0),
    'ceiling_violation_count',    (SELECT count(*)::int FROM ceiling),
    'ceiling_violation_students', (SELECT count(DISTINCT student_id)::int FROM ceiling),
    'terminal_total',             COALESCE((SELECT sum(n)::int FROM terminal), 0),
    'escalation_total',           COALESCE((SELECT n FROM terminal WHERE status = 'escalated'), 0),
    'escalation_share',
      CASE
        WHEN COALESCE((SELECT sum(n) FROM terminal), 0) = 0 THEN 0
        ELSE round(
          COALESCE((SELECT n FROM terminal WHERE status = 'escalated'), 0)::numeric
            / (SELECT sum(n) FROM terminal),
          4)
      END,
    'last_success_at', (SELECT last_success_at FROM heartbeat),
    'hours_since_last_success',
      CASE
        WHEN (SELECT last_success_at FROM heartbeat) IS NULL THEN NULL
        ELSE round(
          (EXTRACT(EPOCH FROM (now() - (SELECT last_success_at FROM heartbeat))) / 3600.0)::numeric,
          2)
      END,
    'generated_at', now()
  );
$$;

COMMENT ON FUNCTION public.get_adaptive_loops_health(int, int) IS
  'Aggregate-only (P13: counts/ratios only, no student ids) health of the adaptive loops A/B/C/D: daily-new by trigger_signal, per-student ceiling-violation counts (>1/student/day over 7d), 30d escalation share, and the adaptive-remediation cron last-success heartbeat. Service-role only. Callers: /api/cron/adaptive-loops-monitor and /api/super-admin/adaptive-loops. Master Action Plan item 8.1.';

-- Service-role only (same lockdown as get_recent_signup_verification_status).
-- The two callers both use the service-role admin client.
REVOKE ALL ON FUNCTION public.get_adaptive_loops_health(int, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_adaptive_loops_health(int, int) FROM anon;
REVOKE ALL ON FUNCTION public.get_adaptive_loops_health(int, int) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_adaptive_loops_health(int, int) TO service_role;
