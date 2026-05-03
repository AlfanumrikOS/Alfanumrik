-- Migration: 20260424120000_atomic_subscription_activation_rpc.sql
-- Purpose: Add atomic_subscription_activation RPC as the robust fallback
--          for the payment webhook's P11 split-brain risk.
--
-- Why this exists:
--   P11 (Payment Integrity) in CLAUDE.md notes a tracked risk: if the
--   primary activate_subscription RPC fails in the webhook handler, the
--   fallback path updates `students` and `student_subscriptions` as two
--   separate statements. If the second one fails, the two tables
--   disagree — a "split-brain" state where `student_subscriptions`
--   says active but `students.subscription_plan` says free (or vice
--   versa). This RPC consolidates both writes into a single atomic
--   SECURITY DEFINER function so the webhook can fall back to it
--   without risking partial state.
--
--   The webhook route (src/app/api/payments/webhook/route.ts) will be
--   updated in a follow-up to call this RPC instead of the two-statement
--   fallback. This migration only lands the RPC; route change is tracked
--   separately so it can ship behind a feature flag if needed.
--
-- Source: extracted from abandoned branch feat/performance-score-system
--   (quarantined at quarantine/feat-performance-score-system-pre-option-c-20260424).
--   The original was a modification of 20260414120000_payment_subscribe_atomic_fix.sql
--   which is already applied in prod — per migration hygiene we never edit
--   applied files, so the RPC lands as a new migration with the same semantics.
--
-- Safety:
--   - CREATE OR REPLACE FUNCTION: idempotent
--   - SECURITY DEFINER with SET search_path = public: standard pattern
--   - ON CONFLICT (student_id) DO UPDATE in student_subscriptions: idempotent on retry
--   - RAISES on missing plan instead of silently continuing

-- ────────────────────────────────────────────────────────────
-- atomic_subscription_activation — P11 split-brain fallback
-- ────────────────────────────────────────────────────────────
-- Called from webhook when activate_subscription RPC fails.
-- Atomically updates both students and student_subscriptions in a single
-- transaction to prevent split-brain state.
CREATE OR REPLACE FUNCTION public.atomic_subscription_activation(
  p_student_id uuid,
  p_plan_code text,
  p_billing_cycle text DEFAULT 'monthly',
  p_razorpay_payment_id text DEFAULT NULL,
  p_razorpay_subscription_id text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_plan_id uuid;
  v_period_end timestamptz;
  v_next_billing timestamptz;
BEGIN
  -- Resolve plan_id from plan_code (RAISE if missing — don't silently skip)
  SELECT id INTO v_plan_id FROM subscription_plans WHERE plan_code = p_plan_code LIMIT 1;
  IF v_plan_id IS NULL THEN
    RAISE EXCEPTION 'Plan not found: %', p_plan_code;
  END IF;

  -- Compute period end
  v_period_end := CASE
    WHEN p_billing_cycle = 'yearly' THEN NOW() + INTERVAL '1 year'
    ELSE NOW() + INTERVAL '1 month'
  END;

  -- Compute next billing timestamp. One-time yearly payments have no
  -- next billing; monthly recurring subscriptions (razorpay_subscription_id
  -- set) renew on the monthly anniversary.
  v_next_billing := CASE
    WHEN p_billing_cycle = 'yearly' THEN NOW() + INTERVAL '1 year'
    WHEN p_billing_cycle = 'monthly' AND p_razorpay_subscription_id IS NOT NULL THEN NOW() + INTERVAL '1 month'
    ELSE NULL
  END;

  -- 1. Upsert student_subscriptions row
  INSERT INTO student_subscriptions (
    student_id, plan_id, plan_code, status, billing_cycle,
    current_period_start, current_period_end, next_billing_at,
    razorpay_payment_id, razorpay_subscription_id,
    auto_renew, renewal_attempts, grace_period_end, ended_at,
    updated_at
  ) VALUES (
    p_student_id, v_plan_id, p_plan_code, 'active', p_billing_cycle,
    NOW(), v_period_end, v_next_billing,
    p_razorpay_payment_id, p_razorpay_subscription_id,
    CASE WHEN p_razorpay_subscription_id IS NOT NULL THEN true ELSE false END,
    0, NULL, NULL, NOW()
  )
  ON CONFLICT (student_id) DO UPDATE SET
    plan_id = v_plan_id,
    plan_code = p_plan_code,
    status = 'active',
    billing_cycle = p_billing_cycle,
    current_period_start = NOW(),
    current_period_end = v_period_end,
    next_billing_at = v_next_billing,
    razorpay_payment_id = COALESCE(p_razorpay_payment_id, student_subscriptions.razorpay_payment_id),
    razorpay_subscription_id = COALESCE(p_razorpay_subscription_id, student_subscriptions.razorpay_subscription_id),
    auto_renew = CASE WHEN p_razorpay_subscription_id IS NOT NULL THEN true ELSE false END,
    renewal_attempts = 0,
    grace_period_end = NULL,
    ended_at = NULL,
    cancelled_at = NULL,
    cancel_reason = NULL,
    updated_at = NOW();

  -- 2. Update students.subscription_plan in the same transaction
  UPDATE students SET
    subscription_plan = p_plan_code,
    updated_at = NOW()
  WHERE id = p_student_id;
END;
$function$;

COMMENT ON FUNCTION public.atomic_subscription_activation IS
  'P11 split-brain fallback. Atomically activates a subscription by upserting student_subscriptions and updating students.subscription_plan in a single transaction. Used by the payment webhook when the primary activate_subscription RPC fails.';

-- Grant execute to authenticated roles (same as activate_subscription)
GRANT EXECUTE ON FUNCTION public.atomic_subscription_activation(uuid, text, text, text, text) TO service_role;
