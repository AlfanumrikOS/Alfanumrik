-- Migration: 20260722101500_seed_alert_rule_adaptive_cron_heartbeat.sql
-- Purpose: Wire the adaptive-remediation cron MISSED-HEARTBEAT detector into
--          the existing ops-alerting -> email pipeline (Master Action Plan
--          Phase 8, item 8.2).
--
-- Context: the nightly adaptive-remediation cron worker
-- (/api/cron/adaptive-remediation) now records a job-health heartbeat on every
-- successful run (ops_events category 'job_health' source
-- 'cron/adaptive-remediation', metric ops.cron.adaptive_remediation.last_success_at
-- — item 8.2). The adaptive-loops monitor cron (/api/cron/adaptive-loops-monitor,
-- item 8.1) reads the freshest such heartbeat and, when the nightly run has not
-- succeeded in > 26h (or has NEVER recorded a success), emits ONE
-- ops_events row:
--     { category: 'adaptive_cron_stale',
--       source:   'cron/adaptive-loops-monitor',
--       severity: 'critical' }.
-- evaluate_alert_rules() only fires rules that exist in alert_rules; without
-- this seed the staleness event would be evaluated and delivered NOWHERE (the
-- same failure mode 20260713160000 closed for the rest of the pipeline). This
-- migration seeds the one missing rule.
--
-- Rule values:
--   name 'Adaptive remediation cron missed heartbeat', category
--   'adaptive_cron_stale', source 'cron/adaptive-loops-monitor',
--   min_severity 'critical' (the monitor emits critical, so the ops_events
--   critical-insert trigger fires this rule immediately), count_threshold 1
--   (a single staleness event is an incident), window_minutes 60,
--   cooldown_minutes 1440 (the monitor runs daily => at most one email per
--   missed-run day), enabled true. Channel: the 'CEO email'
--   notification_channels row (seeded by 20260713160000).
--
-- Idempotency: alert_rules.name has NO unique constraint, so
--   INSERT ... SELECT ... WHERE NOT EXISTS existence guard. Safe to run twice.
-- Fresh-DB guard: to_regclass checks on both tables; NOTICE + no-op when the
--   alerting schema is absent.
-- Scope: exactly ONE alert_rules insert. NO feature_flags insert (REG-125).

DO $$
BEGIN
  IF to_regclass('public.alert_rules') IS NULL
     OR to_regclass('public.notification_channels') IS NULL THEN
    RAISE NOTICE 'seed_alert_rule_adaptive_cron_heartbeat: alerting tables absent - skipping (fresh-DB guard)';
    RETURN;
  END IF;

  INSERT INTO public.alert_rules (
    name, description, enabled, category, source, min_severity,
    count_threshold, window_minutes, channel_ids, cooldown_minutes
  )
  SELECT
    'Adaptive remediation cron missed heartbeat',
    'The nightly adaptive-remediation cron worker (/api/cron/adaptive-remediation) has not recorded a successful run in > 26h (or has never recorded one). Raised by the adaptive-loops monitor (/api/cron/adaptive-loops-monitor) reading the ops.cron.adaptive_remediation.last_success_at heartbeat. A single event is an incident: the adaptive loops (A/B/C/D) are not being detected/verified/escalated. Check the daily-cron triggerAdaptiveRemediation step and Vercel logs for /api/cron/adaptive-remediation. Runbook: docs/runbooks/adaptive-program-rollout.md §7.',
    true,
    'adaptive_cron_stale',
    'cron/adaptive-loops-monitor',
    'critical',
    1,
    60,
    ARRAY[(SELECT id FROM public.notification_channels WHERE name = 'CEO email')],
    1440
  WHERE NOT EXISTS (
    SELECT 1 FROM public.alert_rules WHERE name = 'Adaptive remediation cron missed heartbeat'
  );
END $$;
