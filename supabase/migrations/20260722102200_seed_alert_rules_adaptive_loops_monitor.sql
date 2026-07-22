-- Migration: 20260722102200_seed_alert_rules_adaptive_loops_monitor.sql
-- Purpose: Wire the adaptive-loops creation-rate monitor's two anomaly signals
--          into the existing ops-alerting -> email pipeline (Master Action Plan
--          Phase 8, item 8.1).
--
-- Context: the nightly adaptive-loops monitor (/api/cron/adaptive-loops-monitor)
-- reads get_adaptive_loops_health and emits ONE ops_events row per detected
-- condition. This migration seeds the alert_rules for the two creation-rate
-- anomalies (the missed-heartbeat rule is seeded separately in
-- 20260722101500). Each rule is keyed on its own category + the shared source
-- 'cron/adaptive-loops-monitor', so evaluate_alert_rules() (which matches on
-- category AND source AND severity) targets exactly one condition per rule.
--
-- Thresholds are SOURCED from docs/runbooks/adaptive-program-rollout.md, NOT
-- invented (the monitor's _lib/evaluate-alerts.ts applies them; these rules
-- just route the resulting events):
--
--   1. Per-student ceiling violation (§5 guardrail table + §7 query 2
--      "Per-student new rows per day MUST be <= 1 ... expect: ZERO rows").
--      The arbiter guarantees <= 1 new intervention / student / night; ANY
--      breach is the runbook's "Top alert". The monitor emits a 'critical'
--      event whenever the violation count exceeds 0, so the threshold on the
--      alert-rule side is a single event.
--        category 'adaptive_ceiling_violation', severity 'critical'
--        (=> the ops_events critical-insert trigger fires this immediately).
--
--   2. Escalation storm (§5 storm list: "Escalation share > 50% of terminal
--      outcomes during a pilot"). The monitor emits an 'error' event when the
--      30d escalation share exceeds 0.50 (over a minimum sample). Error
--      severity => delivered by the */5 evaluate_alert_rules sweep, so
--      window_minutes must exceed the sweep interval (60 >> 5).
--        category 'adaptive_escalation_storm', severity 'error'.
--
-- Rule tuning (window/cooldown): the monitor emits at most one event per
-- condition per daily run. window_minutes=60 keeps the event visible to the
-- evaluator well past the */5 sweep; cooldown_minutes=1440 (> window)
-- guarantees at most one email per condition per day (a single emitted event
-- => exactly one dispatch; the next day's event arrives far beyond the
-- cooldown, so genuine day-over-day recurrences are never suppressed).
--
-- Idempotency: alert_rules.name has NO unique constraint => INSERT ... SELECT
--   ... WHERE NOT EXISTS existence guard per rule. Safe to run twice.
-- Fresh-DB guard: to_regclass checks; NOTICE + no-op when the alerting schema
--   is absent.
-- Scope: exactly TWO alert_rules inserts. NO feature_flags insert (REG-125).

DO $$
BEGIN
  IF to_regclass('public.alert_rules') IS NULL
     OR to_regclass('public.notification_channels') IS NULL THEN
    RAISE NOTICE 'seed_alert_rules_adaptive_loops_monitor: alerting tables absent - skipping (fresh-DB guard)';
    RETURN;
  END IF;

  -- 1. Per-student ceiling violation (top alert — >0 violations).
  INSERT INTO public.alert_rules (
    name, description, enabled, category, source, min_severity,
    count_threshold, window_minutes, channel_ids, cooldown_minutes
  )
  SELECT
    'Adaptive loops ceiling violation',
    'One or more students opened MORE than one new adaptive intervention in a single day (last 7 days) — the cross-loop arbiter''s <=1 new intervention / student / night ceiling (precedence A>D>C>B) is not holding. This is the runbook''s "Top alert" (docs/runbooks/adaptive-program-rollout.md §5/§7): a worker bug in arbitrateInterventions or the partial unique index. Investigate before ramping any adaptive-loop flag. Aggregate counts only in the ops_events context (no student ids, P13).',
    true,
    'adaptive_ceiling_violation',
    'cron/adaptive-loops-monitor',
    'critical',
    1,
    60,
    ARRAY[(SELECT id FROM public.notification_channels WHERE name = 'CEO email')],
    1440
  WHERE NOT EXISTS (
    SELECT 1 FROM public.alert_rules WHERE name = 'Adaptive loops ceiling violation'
  );

  -- 2. Escalation storm (> 50% of 30d terminal outcomes are escalations).
  INSERT INTO public.alert_rules (
    name, description, enabled, category, source, min_severity,
    count_threshold, window_minutes, channel_ids, cooldown_minutes
  )
  SELECT
    'Adaptive loops escalation storm',
    'More than 50% of the last 30 days of adaptive-intervention terminal outcomes were escalations (docs/runbooks/adaptive-program-rollout.md §5 storm threshold). Verify may be blind (check ff_event_bus_v1 first — §2) or the return windows / remediation content are not working (review with assessment). Aggregate ratio + counts only in the ops_events context (no student ids, P13).',
    true,
    'adaptive_escalation_storm',
    'cron/adaptive-loops-monitor',
    'error',
    1,
    60,
    ARRAY[(SELECT id FROM public.notification_channels WHERE name = 'CEO email')],
    1440
  WHERE NOT EXISTS (
    SELECT 1 FROM public.alert_rules WHERE name = 'Adaptive loops escalation storm'
  );
END $$;
