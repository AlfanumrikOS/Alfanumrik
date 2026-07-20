-- Migration: 20260720140000_seed_alert_rule_flag_posture_drift.sql
-- Purpose: Wire the nightly flag-posture drift canary into the existing
--          ops-alerting -> email pipeline (ops review condition 1 on the
--          canary PR).
--
-- Context - 2026-07-20 console bulk-enable incident:
--   An operator bulk-enable in the flags console re-armed 49 of the 52
--   CEO-approved forced-OFF flags at rollout 100 (restored by
--   20260720130000_restore_approved_flag_posture.sql; approved posture from
--   20260720110000_feature_flags_data_repair_ceo_approved.sql). The nightly
--   canary route (apps/host/src/app/api/cron/flag-posture-canary/route.ts)
--   now detects any recurrence and emits an ops_events row on drift:
--     { category: 'deploy', source: 'cron/flag-posture-canary',
--       severity: 'error' }.
--   But evaluate_alert_rules() (pg_cron, */5) only fires rules that exist in
--   alert_rules - without this row the drift event would be evaluated and
--   delivered NOWHERE (the exact failure mode 20260713160000 closed for the
--   rest of the pipeline). This migration seeds the one missing rule.
--
-- Rule values (per ops review condition 1):
--   name 'Flag posture drift', category 'deploy',
--   source 'cron/flag-posture-canary', min_severity 'error',
--   count_threshold 1 (a single drift event is an incident - no
--   sustained-count requirement), window_minutes 60,
--   cooldown_minutes 720 (nightly canary => at most ~1 email per drift
--   episode per 12h), enabled true.
--
-- Channel discovery: identical to the CEO-email rules in
--   20260713160000_wire_ops_alerting_to_email.sql - the 'CEO email'
--   notification_channels row (UNIQUE name; seeded there, so it exists on any
--   environment that has applied the earlier migration).
--
-- Idempotency: alert_rules.name has NO unique constraint (verified in
--   20260617000000_seed_payment_failed_webhook_alert_rule.sql), so
--   ON CONFLICT is unavailable -> INSERT ... SELECT ... WHERE NOT EXISTS
--   existence guard. Safe to run twice.
-- Fresh-DB guard: to_regclass checks on both tables; NOTICE + no-op when the
--   alerting schema is absent.
-- Scope: exactly ONE alert_rules insert. NO other inserts or updates.
--   (Note for the REG-125 scanner: this file touches alert_rules only -
--   it contains no feature_flags insert.)

DO $$
BEGIN
  IF to_regclass('public.alert_rules') IS NULL
     OR to_regclass('public.notification_channels') IS NULL THEN
    RAISE NOTICE 'seed_alert_rule_flag_posture_drift: alerting tables absent - skipping (fresh-DB guard)';
    RETURN;
  END IF;

  INSERT INTO public.alert_rules (
    name, description, enabled, category, source, min_severity,
    count_threshold, window_minutes, channel_ids, cooldown_minutes
  )
  SELECT
    'Flag posture drift',
    'Nightly flag-posture canary (/api/cron/flag-posture-canary) detected deviation from the CEO-approved feature-flag posture (20260720110000/20260720130000) - the 2026-07-20 console bulk-enable failure mode. A single event is an incident. Investigate the drifted flags in the ops_events context, then re-apply the approved posture (see 20260720130000_restore_approved_flag_posture.sql).',
    true,                        -- enabled: ON per ops review condition 1
    'deploy',                    -- category: matches the canary logOpsEvent
    'cron/flag-posture-canary',  -- source: exact-match in evaluate_alert_rules()
    'error',                     -- min_severity: counts error AND critical
    1,                           -- count_threshold: one drift event = incident
    60,                          -- window_minutes
    ARRAY[(SELECT id FROM public.notification_channels WHERE name = 'CEO email')],
    720                          -- cooldown_minutes: 12h (nightly canary)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.alert_rules WHERE name = 'Flag posture drift'
  );
END $$;
