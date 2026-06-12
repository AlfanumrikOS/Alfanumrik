-- Migration: 20260617000000_seed_payment_failed_webhook_alert_rule.sql
-- Purpose: Seed an error-severity payment alert rule so failed/unresolved
--          payment-webhook PROCESSING trips an alert.
--
-- Phase 5 finding (c) — gap closed:
--   The webhook timing emit in src/app/api/payments/webhook/route.ts logs an
--   ops_events row via logOpsEvent({ category: 'payment',
--   severity: 'error' (on failed|unresolved outcomes) else 'info',
--   source: 'webhook/route.ts', message: 'payment.webhook_processed', ... }).
--   The only seeded payment rule today ('Payment webhook integrity', seeded in
--   _legacy/timestamped/20260413120000_observability_console_1b.sql) uses
--   min_severity='critical', which matches invalid-signature events ONLY.
--   Because severity_rank('error')=3 < severity_rank('critical')=4, the
--   evaluate_alert_rules() matcher never counts error-severity processing
--   failures against that rule — so processing-failure rate is unalerted.
--   This migration adds a distinct rule that matches the error-severity
--   processing-failure events.
--
-- Rule model note:
--   evaluate_alert_rules() is a COUNT-over-WINDOW matcher (count of matching
--   ops_events within window_minutes >= count_threshold). It cannot express a
--   percentage/rate (e.g. ">5% failure rate"). We therefore use a sane absolute
--   count for low launch volume: 3 error-severity payment events within 15 min.
--
-- Ships DISABLED by design:
--   enabled=false with empty channel_ids, consistent with the three rules
--   seeded in 20260413120000. The operator enables the rule and attaches a
--   notification channel at launch (already tracked in LAUNCH_CHECKLIST.md).
--   Do NOT enable here.
--
-- No new table -> no new RLS. alert_rules already has RLS (admin-only;
-- service-role bypass) from the schema migration.
--
-- Idempotency:
--   alert_rules.name has NO UNIQUE constraint (verified against the schema in
--   20260413120000_observability_console_1b.sql — only notification_channels.name
--   is UNIQUE). ON CONFLICT (name) is therefore NOT available, so the insert is
--   guarded with INSERT ... SELECT ... WHERE NOT EXISTS. Safe to run twice and
--   safe on an env where it already ran.

BEGIN;

INSERT INTO alert_rules (
  name, description, enabled, category, min_severity,
  count_threshold, window_minutes, channel_ids, cooldown_minutes
)
SELECT
  'Payment webhook processing failures',
  'Fires when payment.webhook_processed emits failed/unresolved outcomes (severity=error) repeatedly — processing failures distinct from invalid-signature (which the critical rule covers).',
  false,        -- enabled: disabled by design; operator enables + attaches channel at launch
  'payment',    -- category: matches logOpsEvent category
  'error',      -- min_severity: counts error AND critical (severity_rank>=3); the dedicated rule scopes the gap to processing-failure outcomes
  3,            -- count_threshold: absolute count (rate not expressible); sane for low launch volume
  15,           -- window_minutes
  '{}',         -- channel_ids: empty; operator attaches at launch
  15            -- cooldown_minutes
WHERE NOT EXISTS (
  SELECT 1 FROM alert_rules WHERE name = 'Payment webhook processing failures'
);

COMMIT;
