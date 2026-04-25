-- Migration: 20260425140500_ff_atomic_subscription_activation.sql
-- Phase 0g.2 — adds the `ff_atomic_subscription_activation` kill-switch
-- feature flag the plan required. Default: enabled (true).
--
-- When enabled (default):
--   The webhook fallback path calls atomic_subscription_activation when
--   the primary activate_subscription RPC fails (Phase 0g.2 behavior).
--
-- When disabled:
--   The webhook returns HTTP 503 immediately on primary RPC failure,
--   skipping the atomic fallback entirely. Razorpay retries the webhook.
--   Use this kill switch ONLY if atomic_subscription_activation itself
--   develops a bug that activates the wrong plan or corrupts state —
--   in that scenario, returning 503 is preferable to writing the wrong
--   thing.
--
-- Routing the flag check from src/app/api/payments/webhook/route.ts
-- happens in the same PR that adds this migration.

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM feature_flags WHERE flag_name = 'ff_atomic_subscription_activation'
  ) THEN
    INSERT INTO feature_flags (flag_name, is_enabled, description)
    VALUES (
      'ff_atomic_subscription_activation',
      true,
      'Kill-switch for the Phase 0g.2 atomic_subscription_activation fallback in the Razorpay webhook. When disabled, the webhook returns 503 immediately on primary RPC failure (forcing Razorpay retries) instead of attempting the atomic fallback. Default: enabled.'
    );
  END IF;
END $$;
