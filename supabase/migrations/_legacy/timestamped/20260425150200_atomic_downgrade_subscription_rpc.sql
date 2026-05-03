-- Migration: 20260425150200_atomic_downgrade_subscription_rpc.sql
-- Purpose: Replace the JS-side SELECT-then-UPDATE in
--          downgradeIfMatchingSub() with a single-transaction RPC that
--          takes a row-level lock on student_subscriptions.
--
-- Why:
--   The current helper (webhook/route.ts:120-167) reads the current
--   subscription row, then writes students + student_subscriptions in
--   two separate UPDATE statements. Two race windows exist:
--     1. Between the SELECT and the first UPDATE, a concurrent activation
--        can flip the sub_id, but the JS check used the stale value.
--     2. The two UPDATE statements are not atomic — the same split-brain
--        risk that motivated atomic_subscription_activation.
--
-- This RPC closes both: SELECT ... FOR UPDATE locks the row, and both
-- UPDATEs run inside the same transaction.

BEGIN;

CREATE OR REPLACE FUNCTION public.atomic_downgrade_subscription(
  p_student_id uuid,
  p_cancelled_sub_id text,
  p_new_status text
)
RETURNS TABLE(outcome text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_sub_id text;
BEGIN
  IF p_new_status NOT IN ('cancelled','expired','halted','completed') THEN
    RAISE EXCEPTION 'invalid status: %', p_new_status;
  END IF;

  -- Lock the subscription row for the duration of this transaction.
  SELECT razorpay_subscription_id INTO v_current_sub_id
  FROM student_subscriptions
  WHERE student_id = p_student_id
  FOR UPDATE;

  -- Stale cancel: a different sub_id is currently active. Ignore.
  IF v_current_sub_id IS NOT NULL AND v_current_sub_id <> p_cancelled_sub_id THEN
    RETURN QUERY SELECT 'stale_cancel_ignored'::text;
    RETURN;
  END IF;

  UPDATE students
  SET subscription_plan = 'free', updated_at = NOW()
  WHERE id = p_student_id;

  UPDATE student_subscriptions
  SET plan_code = 'free',
      status = p_new_status,
      cancelled_at = NOW(),
      updated_at = NOW()
  WHERE student_id = p_student_id;

  RETURN QUERY SELECT 'downgraded'::text;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.atomic_downgrade_subscription(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.atomic_downgrade_subscription(uuid, text, text) TO service_role;

COMMENT ON FUNCTION public.atomic_downgrade_subscription IS
  'Atomic downgrade with stale-cancel guard via row-level lock. Replaces the JS SELECT-then-UPDATE in webhook/route.ts:downgradeIfMatchingSub.';

COMMIT;
