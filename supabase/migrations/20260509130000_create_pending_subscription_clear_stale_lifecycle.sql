-- Bug fix: create_pending_subscription must reset lifecycle fields on resubscribe.
--
-- Symptom (Hridaan Kaushik, 2026-05-09):
--   1. April 2 — paid for starter, sub_SYfEQHUD22BEYk, period 2026-04-02..2026-05-02.
--   2. April 7 — cancelled (auto-renew off, cancelled_at = 2026-04-07).
--   3. May 9 — clicked Subscribe → Pro (sub_SnGUcGY4LsK543, ₹699).
--   4. Billing page rendered: plan=Pro, status badge=Cancelled, billing=Auto-renew,
--      Access Until=2 May 2026 (already in the past), with a "Cancellation Scheduled"
--      banner — every field contradicting the others.
--
-- Root cause:
--   The previous create_pending_subscription used ON CONFLICT (student_id) DO UPDATE
--   that only overwrote plan_id, plan_code, status, billing_cycle, razorpay_*,
--   auto_renew, updated_at. It left these stale from the prior cancelled
--   subscription:
--     cancelled_at, cancel_reason, current_period_start, current_period_end,
--     next_billing_at, amount_paid, grace_period_end, renewal_attempts, ended_at.
--   So a brand-new pending Pro subscription inherited a cancelled_at from the
--   April starter sub and an already-expired period_end. The status API then
--   read cancelled_at != null and reported is_cancel_scheduled=true on the
--   pending row.
--
-- Fix:
--   Reset every lifecycle field to NULL/0 on the upsert path. A pending row
--   is by definition a fresh subscribe attempt — period dates, cancellation
--   markers, and renewal counters from a previous subscription must not leak.
--   activate_subscription already does this when the webhook activates; this
--   migration brings the pending path to parity.
--
-- Idempotent: CREATE OR REPLACE only.

BEGIN;

CREATE OR REPLACE FUNCTION public.create_pending_subscription(
  p_auth_user_id             uuid,
  p_email                    text,
  p_plan_code                text,
  p_billing_cycle            text,
  p_razorpay_subscription_id text,
  p_razorpay_plan_id         text,
  p_amount_inr               integer
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_student_id uuid;
  v_plan_id    uuid;
  v_existing_sub_id text;
BEGIN
  IF p_plan_code IS NULL OR p_plan_code = '' OR p_plan_code = 'free' THEN
    RAISE EXCEPTION 'Invalid plan_code for pending subscription: %', p_plan_code;
  END IF;

  IF p_razorpay_subscription_id IS NULL OR p_razorpay_subscription_id = '' THEN
    RAISE EXCEPTION 'razorpay_subscription_id is required';
  END IF;

  -- (a) Resolve student_id: auth_user_id first, email fallback.
  SELECT id INTO v_student_id
    FROM students
    WHERE auth_user_id = p_auth_user_id
    LIMIT 1;

  IF v_student_id IS NULL AND p_email IS NOT NULL AND p_email <> '' THEN
    SELECT id INTO v_student_id
      FROM students
      WHERE email = p_email
      ORDER BY created_at DESC
      LIMIT 1;

    IF v_student_id IS NOT NULL THEN
      UPDATE students SET auth_user_id = p_auth_user_id WHERE id = v_student_id;
    END IF;
  END IF;

  IF v_student_id IS NULL THEN
    RAISE EXCEPTION 'Student not found for auth_user_id % (email fallback also failed)', p_auth_user_id;
  END IF;

  SELECT id INTO v_plan_id FROM subscription_plans WHERE plan_code = p_plan_code LIMIT 1;
  IF v_plan_id IS NULL THEN
    RAISE EXCEPTION 'Plan not found: %', p_plan_code;
  END IF;

  -- (b) Free stale pending sub_id so the unique index doesn't block the upsert.
  SELECT razorpay_subscription_id INTO v_existing_sub_id
    FROM student_subscriptions
    WHERE student_id = v_student_id
    LIMIT 1;

  IF v_existing_sub_id IS NOT NULL
     AND v_existing_sub_id <> p_razorpay_subscription_id
  THEN
    UPDATE student_subscriptions
       SET razorpay_subscription_id = NULL,
           updated_at = now()
     WHERE student_id = v_student_id
       AND status = 'pending'
       AND razorpay_subscription_id = v_existing_sub_id;
  END IF;

  -- (c) Pending payment_history row.
  INSERT INTO payment_history (
    student_id, plan_code, billing_cycle, currency, amount,
    status, payment_method, notes
  ) VALUES (
    v_student_id, p_plan_code, p_billing_cycle, 'INR', p_amount_inr,
    'pending', 'razorpay',
    jsonb_build_object(
      'source',                    'subscribe',
      'razorpay_subscription_id',  p_razorpay_subscription_id,
      'razorpay_plan_id',          p_razorpay_plan_id
    )
  );

  -- (d) Upsert student_subscriptions to pending. ON CONFLICT (student_id).
  --     CRITICAL: reset every lifecycle field — a pending row is a fresh
  --     subscribe attempt and must not inherit cancelled_at / period dates /
  --     renewal counters from a previous (possibly cancelled) subscription.
  INSERT INTO student_subscriptions (
    student_id, plan_id, plan_code, status, billing_cycle,
    razorpay_subscription_id, razorpay_plan_id, auto_renew
  ) VALUES (
    v_student_id, v_plan_id, p_plan_code, 'pending', p_billing_cycle,
    p_razorpay_subscription_id, p_razorpay_plan_id, true
  )
  ON CONFLICT (student_id) DO UPDATE SET
    plan_id                  = v_plan_id,
    plan_code                = p_plan_code,
    status                   = 'pending',
    billing_cycle            = p_billing_cycle,
    razorpay_subscription_id = p_razorpay_subscription_id,
    razorpay_plan_id         = p_razorpay_plan_id,
    auto_renew               = true,
    -- Lifecycle fields cleared so the new pending row is not contaminated
    -- by stale data from the prior subscription generation.
    cancelled_at             = NULL,
    cancel_reason            = NULL,
    current_period_start     = NULL,
    current_period_end       = NULL,
    next_billing_at          = NULL,
    grace_period_end         = NULL,
    renewal_attempts         = 0,
    ended_at                 = NULL,
    -- razorpay_payment_id intentionally cleared: the prior payment_id belongs
    -- to a different (cancelled) subscription. The webhook/verify path will
    -- stamp the new payment_id when activation completes.
    razorpay_payment_id      = NULL,
    updated_at               = now();

  RETURN v_student_id;
END;
$function$;

COMMIT;
