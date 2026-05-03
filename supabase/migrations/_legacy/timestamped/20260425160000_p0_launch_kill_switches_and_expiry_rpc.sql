-- Migration: 20260425160000_p0_launch_kill_switches_and_expiry_rpc.sql
-- Purpose: P0-E launch hardening — seed two global kill-switch feature flags
--          and add the check_expired_subscriptions RPC that the new cron route
--          calls every 6 hours.
--
-- Companion to (does not modify):
--   - 20260425140500_ff_atomic_subscription_activation.sql  (already default true)
--   - 20260328160000_recurring_billing.sql                  (mark_subscription_past_due / halt_subscription)
--
-- This migration is fully idempotent. Re-running it is safe.

-- ──────────────────────────────────────────────────────────────────────
-- Part 1 — Global kill-switch feature flags
--
-- These are the two emergency switches the founder/ops team can flip from
-- the super-admin console to instantly stop a class of traffic if a
-- regression hits production.
--
-- DEFAULT for both is `true` (subsystem enabled). Flipping to `false`
-- causes the relevant API routes to return HTTP 503 with Retry-After.
--
-- Re-uses the existing `feature_flags` table schema. flag_name is NOT
-- unique-constrained in this codebase (see comment in
-- 20260413170000_kill_switch_flags.sql), so we use IF NOT EXISTS guards
-- the same way every other kill-switch migration does.
-- ──────────────────────────────────────────────────────────────────────

DO $$ BEGIN

  -- razorpay_payments — master toggle for ALL payment-processing code paths.
  -- When disabled, src/app/api/payments/webhook + verify routes return 503
  -- with Retry-After=60 instead of attempting any DB work.
  --
  -- Use case: a Razorpay regression or fraud alert where you want to stop
  -- accepting webhook events platform-wide while you investigate. Razorpay
  -- will retry 5xx responses with backoff so no events are lost.
  IF NOT EXISTS (SELECT 1 FROM feature_flags WHERE flag_name = 'razorpay_payments') THEN
    INSERT INTO feature_flags (flag_name, is_enabled, description)
    VALUES (
      'razorpay_payments',
      true,
      'Global kill switch for Razorpay payment processing. When disabled, '
      || 'the webhook and verify routes return HTTP 503 with Retry-After=60. '
      || 'Default: enabled. Flip OFF only during a payment incident — Razorpay '
      || 'will retry webhooks with backoff so events are not lost.'
    );
  END IF;

  -- ai_usage_global — master toggle for ALL Claude API spend.
  -- When disabled, the foxy/ncert-solver/quiz-gen/scan-solve routes return
  -- HTTP 503 with Retry-After=60 BEFORE making any LLM call.
  --
  -- Use case: a runaway prompt injection, hot-fixing the system prompt, or
  -- circuit-breaker on an upstream API outage. Lets ops cut Claude spend
  -- in seconds without redeploying.
  IF NOT EXISTS (SELECT 1 FROM feature_flags WHERE flag_name = 'ai_usage_global') THEN
    INSERT INTO feature_flags (flag_name, is_enabled, description)
    VALUES (
      'ai_usage_global',
      true,
      'Global kill switch for ALL AI/LLM calls (foxy-tutor, ncert-solver, '
      || 'quiz-generator, scan-solve). When disabled, AI routes return HTTP '
      || '503 with Retry-After=60 BEFORE making any Claude call. Default: '
      || 'enabled. Flip OFF during an AI incident or to halt spend.'
    );
  END IF;

  -- Belt-and-braces: confirm ff_atomic_subscription_activation is enabled.
  -- The migration that created it (20260425140500) already inserts with
  -- is_enabled=true, but the architect launch checklist requires us to
  -- assert the default explicitly here. We only update if the row exists
  -- AND is currently false (i.e., we never *create* it from this migration
  -- — that's the prior migration's job).
  UPDATE feature_flags
     SET is_enabled  = true,
         updated_at  = COALESCE(updated_at, now())
   WHERE flag_name   = 'ff_atomic_subscription_activation'
     AND is_enabled IS DISTINCT FROM true;

END $$;


-- ──────────────────────────────────────────────────────────────────────
-- Part 2 — check_expired_subscriptions RPC
--
-- Called every 6 hours by /api/cron/expired-subscriptions. Two
-- responsibilities:
--   1. Find active subscriptions whose current_period_end has elapsed and
--      where Razorpay never sent a charge or expired event (lost webhook,
--      dropped network). Mark them past_due with a 3-day grace period.
--   2. Find past_due subscriptions whose grace_period_end has elapsed and
--      halt them (downgrade access).
--
-- The RPC delegates to existing per-row helpers from
-- 20260328160000_recurring_billing.sql (mark_subscription_past_due,
-- halt_subscription) so we do NOT alter any existing RPC body — the
-- launch task constraints forbid that.
--
-- Returns a single-row JSONB so the cron route can log the outcome.
-- ──────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.check_expired_subscriptions()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_marked_past_due int := 0;
  v_halted          int := 0;
  v_now             timestamptz := now();
  v_row             record;
BEGIN
  -- Step 1: active rows whose period elapsed → mark past_due (3-day grace).
  -- We loop so we can use the existing mark_subscription_past_due RPC,
  -- which sets renewal_attempts and grace_period_end correctly.
  FOR v_row IN
    SELECT student_id
      FROM student_subscriptions
     WHERE status = 'active'
       AND current_period_end IS NOT NULL
       AND current_period_end < v_now
  LOOP
    PERFORM public.mark_subscription_past_due(v_row.student_id, 3);
    v_marked_past_due := v_marked_past_due + 1;
  END LOOP;

  -- Step 2: past_due rows whose grace expired → halt + downgrade access.
  FOR v_row IN
    SELECT student_id
      FROM student_subscriptions
     WHERE status = 'past_due'
       AND grace_period_end IS NOT NULL
       AND grace_period_end < v_now
  LOOP
    PERFORM public.halt_subscription(v_row.student_id);
    v_halted := v_halted + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'marked_past_due', v_marked_past_due,
    'halted',          v_halted,
    'checked_at',      v_now
  );
END;
$$;

-- SECURITY DEFINER justification:
--   This RPC is only invoked by the /api/cron/expired-subscriptions route,
--   which runs under SUPABASE_SERVICE_ROLE_KEY (already bypasses RLS).
--   The DEFINER attribute is therefore not adding privilege — it just
--   keeps the call signature consistent with mark_subscription_past_due
--   and halt_subscription, both of which are SECURITY DEFINER. The
--   `search_path = public` lock-in matches the project's
--   security-search-path migration pattern (see e.g.
--   20260307110804_fix_security_function_search_paths.sql).

REVOKE ALL ON FUNCTION public.check_expired_subscriptions() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_expired_subscriptions() TO service_role;

COMMENT ON FUNCTION public.check_expired_subscriptions() IS
  'Cron-only RPC called every 6h by /api/cron/expired-subscriptions. '
  'Marks active-but-elapsed subs as past_due (3-day grace) and halts '
  'past_due-but-grace-expired subs. Idempotent.';
