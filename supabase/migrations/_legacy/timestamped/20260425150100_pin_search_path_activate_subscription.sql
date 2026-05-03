-- Migration: 20260425150100_pin_search_path_activate_subscription.sql
-- Purpose: Pin search_path = public on activate_subscription to match the
--          project convention (migration 20260408000009 set this for all
--          postgres-owned SECURITY DEFINER functions). The original
--          definition in 20260328160000_recurring_billing.sql omits this.
--
-- Why this matters:
--   SECURITY DEFINER functions run with elevated privileges. Without an
--   explicit search_path, a malicious schema in front of `public` could
--   shadow a referenced table/function and execute attacker-controlled
--   code as the function owner. The atomic_subscription_activation RPC
--   (migration 20260424120000) already has SET search_path = public; this
--   migration brings activate_subscription in line.
--
-- Body identical to the canonical definition in 20260328160000 lines
-- 51-125 — only the function attributes change.

BEGIN;

CREATE OR REPLACE FUNCTION public.activate_subscription(
  p_auth_user_id uuid,
  p_plan_code text,
  p_billing_cycle text DEFAULT 'monthly',
  p_razorpay_payment_id text DEFAULT NULL,
  p_razorpay_order_id text DEFAULT NULL,
  p_razorpay_subscription_id text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_student_id UUID;
  v_plan_id UUID;
  v_period_end TIMESTAMPTZ;
  v_next_billing TIMESTAMPTZ;
BEGIN
  SELECT id INTO v_student_id FROM students WHERE auth_user_id = p_auth_user_id LIMIT 1;
  IF v_student_id IS NULL THEN
    RAISE EXCEPTION 'Student not found for auth_user_id %', p_auth_user_id;
  END IF;

  SELECT id INTO v_plan_id FROM subscription_plans WHERE plan_code = p_plan_code LIMIT 1;
  IF v_plan_id IS NULL THEN
    RAISE EXCEPTION 'Plan not found: %', p_plan_code;
  END IF;

  v_period_end := CASE
    WHEN p_billing_cycle = 'yearly' THEN NOW() + INTERVAL '1 year'
    ELSE NOW() + INTERVAL '1 month'
  END;

  v_next_billing := CASE
    WHEN p_billing_cycle = 'yearly' THEN NOW() + INTERVAL '1 year'
    WHEN p_billing_cycle = 'monthly' AND p_razorpay_subscription_id IS NOT NULL THEN NOW() + INTERVAL '1 month'
    ELSE NULL
  END;

  INSERT INTO student_subscriptions (
    student_id, plan_id, plan_code, status, billing_cycle,
    current_period_start, current_period_end, next_billing_at,
    razorpay_payment_id, razorpay_subscription_id,
    auto_renew, renewal_attempts, grace_period_end, ended_at
  ) VALUES (
    v_student_id, v_plan_id, p_plan_code, 'active', p_billing_cycle,
    NOW(), v_period_end, v_next_billing,
    p_razorpay_payment_id, p_razorpay_subscription_id,
    CASE WHEN p_razorpay_subscription_id IS NOT NULL THEN true ELSE false END,
    0, NULL, NULL
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

  UPDATE students SET subscription_plan = p_plan_code WHERE id = v_student_id;
END;
$function$;

COMMIT;
