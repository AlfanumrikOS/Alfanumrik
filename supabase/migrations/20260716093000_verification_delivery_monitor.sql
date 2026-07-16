-- Migration: 20260716093000_verification_delivery_monitor.sql
-- Purpose: silent verification-email failure monitor (CEO mandate 2026-07-16).
--
-- Failure mode: the email provider silently disables the account (Mailgun,
-- 2026-07) — signups keep getting confirmation_sent_at stamped but no email
-- ever arrives, so email_confirmed_at stays NULL and nobody notices for weeks.
--
-- Two pieces, both idempotent, no new tables (so no new RLS surface):
--   1. get_recent_signup_verification_status(): SECURITY DEFINER RPC that
--      returns TIMESTAMPS ONLY (no emails, no user ids — P13) for recent
--      EXTERNAL signups. All exclusions live here in SQL so PII never leaves
--      the database. Service-role execute only.
--   2. Seed row in alert_rules ('Verification email delivery stalled') wired
--      to the existing ops_events -> evaluate_alert_rules() ->
--      alert_dispatches -> alert-deliverer pipeline. The detector is the
--      daily-cron step `verification_delivery_checked`, which emits ONE
--      critical ops_event (category 'auth_email_delivery', source
--      'verification-delivery-monitor') per incident / streak growth; the
--      critical-insert trigger on ops_events fires the rule immediately.
--
-- Rule tuning (why window=30 / cooldown=60): the monitor emits at most one
-- event per daily-cron run. window_minutes=30 means the event is only
-- "visible" to the evaluator for 30 minutes; cooldown_minutes=60 (> window)
-- guarantees a single emitted event produces exactly ONE dispatch per channel
-- (the */5 pg_cron evaluator cannot re-fire it after the cooldown lapses
-- because the event has already left the window). Streak-growth re-alerts
-- arrive >=24h apart, far beyond the cooldown, so they are never suppressed.

-- ────────────────────────────────────────────────────────────
-- 1. Redacted signup-verification status reader
-- ────────────────────────────────────────────────────────────
-- SECURITY DEFINER justification: must read auth.users, which is not exposed
-- through PostgREST and not readable by the invoker role. Returns only three
-- timestamps per row — never email, id, phone, or metadata (P13). EXECUTE is
-- revoked from PUBLIC/anon/authenticated and granted to service_role only;
-- the sole caller is the daily-cron Edge Function (service role).
CREATE OR REPLACE FUNCTION public.get_recent_signup_verification_status(
  p_window_days int DEFAULT 14,
  p_limit int DEFAULT 50
)
RETURNS TABLE (
  created_at timestamptz,
  confirmation_sent_at timestamptz,
  email_confirmed_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT u.created_at, u.confirmation_sent_at, u.email_confirmed_at
  FROM auth.users u
  WHERE u.created_at > now() - make_interval(days => LEAST(GREATEST(p_window_days, 1), 60))
    AND u.deleted_at IS NULL
    -- External signups only:
    -- (a) internal company accounts
    AND u.email NOT ILIKE '%@alfanumrik.com'
    -- (b) test/synthetic accounts (reserved .test TLD used by seeds/E2E)
    AND u.email NOT ILIKE '%.test'
    -- (c) admin-/seed-created accounts: created with email_confirm=true, so
    --     they are auto-confirmed at creation and NO confirmation email was
    --     ever triggered (confirmation_sent_at IS NULL). Forensics 2026-07:
    --     every internal account matches this signature.
    AND NOT (u.email_confirmed_at IS NOT NULL AND u.confirmation_sent_at IS NULL)
    -- (d) invite-flow accounts (teacher invites via inviteUserByEmail) go
    --     through the invite email, not the signup-confirmation email.
    AND u.invited_at IS NULL
  ORDER BY u.created_at DESC
  LIMIT LEAST(GREATEST(p_limit, 1), 200);
$$;

COMMENT ON FUNCTION public.get_recent_signup_verification_status(int, int) IS
  'Redacted (timestamps-only, P13) verification-delivery status of recent external signups. Service-role only. Consumed by the daily-cron verification_delivery_checked step; see supabase/functions/daily-cron/verification-delivery.ts for the decision logic.';

REVOKE ALL ON FUNCTION public.get_recent_signup_verification_status(int, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_recent_signup_verification_status(int, int) FROM anon;
REVOKE ALL ON FUNCTION public.get_recent_signup_verification_status(int, int) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_recent_signup_verification_status(int, int) TO service_role;

-- ────────────────────────────────────────────────────────────
-- 2. Alert rule wired to the existing delivery pipeline
-- ────────────────────────────────────────────────────────────
-- Attaches every currently-enabled slack_webhook channel plus the 'CEO email'
-- channel (seeded by 20260713160000). COALESCE keeps the NOT NULL channel_ids
-- satisfied on fresh environments where no channel exists yet — the rule then
-- fires zero dispatches until an operator attaches a channel via
-- /super-admin/observability/channels + rules.
INSERT INTO public.alert_rules
  (name, description, enabled, category, min_severity, count_threshold, window_minutes, channel_ids, cooldown_minutes)
SELECT
  'Verification email delivery stalled',
  'The 3 most-recent external signups all have confirmation_sent_at stamped but email_confirmed_at still NULL past 24h — the Mailgun-silently-disabled failure mode of 2026-07. Raised nightly by the daily-cron verification-delivery monitor (ops_events source verification-delivery-monitor); dedup is streak-keyed in the monitor, so every dispatch is a NEW incident or a GROWING streak. Runbook: docs/runbooks/signup-flow-broken-response.md (check provider account status + send-auth-email logs first).',
  true,
  'auth_email_delivery',
  'critical',
  1,
  30,
  COALESCE(
    (
      SELECT array_agg(id)
      FROM public.notification_channels
      WHERE enabled = true
        AND (type = 'slack_webhook' OR name = 'CEO email')
    ),
    '{}'::uuid[]
  ),
  60
WHERE NOT EXISTS (
  SELECT 1 FROM public.alert_rules WHERE name = 'Verification email delivery stalled'
);
