-- Migration: 20260722102100_seed_alert_rule_synthesis_delivery_failure.sql
-- Purpose: Phase 8 item 8.4 — wire the nightly Monthly-Synthesis WhatsApp
--          delivery monitor into the existing ops-alerting -> email pipeline.
--
-- Context: Monthly Synthesis (ff_pedagogy_v2_monthly_synthesis, still OFF)
-- delivers a Claude-authored parent summary via the whatsapp-notify
-- 'monthly_synthesis' template. Meta-side template approval is async — until
-- approved, EVERY WhatsApp Cloud API call fails and the run status becomes
-- 'failed'. Today there is NO aggregation/alerting on that, so a silent
-- template-approval failure could mean 100% delivery failure undetected.
--
-- The nightly monitor route
-- (apps/host/src/app/api/cron/synthesis-delivery-monitor/route.ts) computes,
-- over a trailing 24h window:
--     failure_rate_pct = failed / (sent + failed) * 100
-- and emits ONE ops_events row when BOTH:
--     failure_rate_pct > 20   AND   (sent + failed) >= 5
--   { category: 'notifications', source: 'cron/synthesis-delivery-monitor',
--     severity: 'critical' }
-- The >20% / >=5-attempts threshold lives in the CRON (so the alert can be a
-- simple one-event-is-an-incident rule); this migration seeds the matching
-- rule so evaluate_alert_rules() (pg_cron, */5) actually delivers it.
--
-- Rule values (same shape as the flag-posture-drift and verification-delivery
-- CEO-email rules):
--   name 'Monthly synthesis delivery failing', category 'notifications',
--   source 'cron/synthesis-delivery-monitor', min_severity 'critical',
--   count_threshold 1 (a single breach event is an incident — the >20%/>=5
--   gate already lives in the monitor), window_minutes 60,
--   cooldown_minutes 720 (nightly monitor => at most ~1 email per episode/12h),
--   enabled true.
--
-- Channel: the 'CEO email' notification_channels row (UNIQUE name; seeded by
--   20260713160000_wire_ops_alerting_to_email.sql).
--
-- Idempotency: alert_rules.name has NO unique constraint, so ON CONFLICT is
--   unavailable -> INSERT ... SELECT ... WHERE NOT EXISTS existence guard.
-- Fresh-DB guard: to_regclass checks on both tables; NOTICE + no-op when the
--   alerting schema is absent.
-- Scope: exactly ONE alert_rules insert. NO feature_flags insert (REG-125
--   scanner note), no other writes.

DO $$
BEGIN
  IF to_regclass('public.alert_rules') IS NULL
     OR to_regclass('public.notification_channels') IS NULL THEN
    RAISE NOTICE 'seed_alert_rule_synthesis_delivery_failure: alerting tables absent - skipping (fresh-DB guard)';
    RETURN;
  END IF;

  INSERT INTO public.alert_rules (
    name, description, enabled, category, source, min_severity,
    count_threshold, window_minutes, channel_ids, cooldown_minutes
  )
  SELECT
    'Monthly synthesis delivery failing',
    'Nightly Monthly-Synthesis WhatsApp delivery monitor (/api/cron/synthesis-delivery-monitor) found failure_rate_pct > 20% over the last 24h with >= 5 delivery attempts — the silent Meta-template-approval-failure mode (until the monthly_synthesis template is approved, every send fails and the run status becomes ''failed''). A single breach event is an incident. Investigate: whatsapp-notify logs + the monthly_synthesis WhatsApp template approval status in Meta, then the synthesis-health dashboard (/super-admin/synthesis-health).',
    true,                                 -- enabled: ON
    'notifications',                      -- category: matches the monitor logOpsEvent
    'cron/synthesis-delivery-monitor',    -- source: exact-match in evaluate_alert_rules()
    'critical',                           -- min_severity
    1,                                    -- count_threshold: one breach event = incident
    60,                                   -- window_minutes
    ARRAY[(SELECT id FROM public.notification_channels WHERE name = 'CEO email')],
    720                                   -- cooldown_minutes: 12h (nightly monitor)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.alert_rules WHERE name = 'Monthly synthesis delivery failing'
  );
END $$;
