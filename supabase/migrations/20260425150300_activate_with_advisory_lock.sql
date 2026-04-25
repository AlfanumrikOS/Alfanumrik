-- Migration: 20260425150300_activate_with_advisory_lock.sql
-- Purpose: Serialize concurrent activation attempts for the same student
--          (verify route + webhook). Wraps activate_subscription in a
--          transaction-scoped advisory lock keyed by student_id.

BEGIN;

CREATE OR REPLACE FUNCTION public.activate_subscription_locked(
  p_auth_user_id uuid,
  p_plan_code text,
  p_billing_cycle text,
  p_razorpay_payment_id text,
  p_razorpay_order_id text,
  p_razorpay_subscription_id text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_student_id uuid;
BEGIN
  SELECT id INTO v_student_id FROM students WHERE auth_user_id = p_auth_user_id LIMIT 1;
  IF v_student_id IS NULL THEN
    RAISE EXCEPTION 'Student not found for auth_user_id %', p_auth_user_id;
  END IF;

  -- Transaction-scoped advisory lock keyed by student_id. Prevents verify-
  -- route + webhook from interleaving activation. Released on COMMIT/ROLLBACK.
  PERFORM pg_advisory_xact_lock(hashtextextended('subscription:' || v_student_id::text, 0));

  PERFORM activate_subscription(
    p_auth_user_id,
    p_plan_code,
    p_billing_cycle,
    p_razorpay_payment_id,
    p_razorpay_order_id,
    p_razorpay_subscription_id
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.activate_subscription_locked(uuid, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.activate_subscription_locked(uuid, text, text, text, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.atomic_subscription_activation_locked(
  p_student_id uuid,
  p_plan_code text,
  p_billing_cycle text,
  p_razorpay_payment_id text,
  p_razorpay_subscription_id text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('subscription:' || p_student_id::text, 0));

  PERFORM atomic_subscription_activation(
    p_student_id,
    p_plan_code,
    p_billing_cycle,
    p_razorpay_payment_id,
    p_razorpay_subscription_id
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.atomic_subscription_activation_locked(uuid, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.atomic_subscription_activation_locked(uuid, text, text, text, text) TO service_role;

COMMIT;
