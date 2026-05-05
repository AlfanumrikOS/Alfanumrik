-- Migration: 20260505110000_atomic_cancel_subscription_rpc.sql
-- Purpose:   P11 fix — close split-brain risk in /api/payments/cancel.
--
-- Why this exists:
--   The cancel route (src/app/api/payments/cancel/route.ts) currently issues
--   two separate UPDATE statements when handling an immediate cancellation:
--     1. UPDATE student_subscriptions SET status='cancelled', ...
--     2. UPDATE students SET subscription_plan='free' WHERE id=...
--   If the second UPDATE fails (network blip, lock contention, transient
--   503), the student keeps their PAID plan_code on `students.subscription_plan`
--   even though `student_subscriptions.status` says cancelled. This is the
--   exact split-brain risk that motivated `atomic_subscription_activation`
--   on the activation side and `atomic_downgrade_subscription` on the
--   webhook-side downgrade. The cancel route was missed.
--
--   `atomic_downgrade_subscription` cannot be reused as-is because:
--     - It has a stale-cancel guard keyed on `razorpay_subscription_id`
--       that returns 'stale_cancel_ignored' when the live sub_id differs
--       from the one being cancelled. For a USER-initiated immediate
--       cancel from the cancel route, we always want to honor the cancel
--       even if the row was just re-activated by a renewal.
--     - It hard-codes `cancel_reason` to NULL and does not record the
--       optional reason the user provided.
--     - It does not write the `cancel_reason`, `ended_at`, or `auto_renew=false`
--       fields that the cancel route currently sets.
--
--   This RPC is a thin sibling — single transaction across both tables,
--   row-level lock to serialize against any concurrent webhook write,
--   honors the user-supplied reason, and accepts both "immediate" and
--   "schedule for end-of-cycle" shapes via p_immediate.
--
-- Safety:
--   - CREATE OR REPLACE FUNCTION (idempotent).
--   - SECURITY DEFINER with `SET search_path = public` (standard pattern,
--     mirrors atomic_subscription_activation / atomic_downgrade_subscription).
--   - SELECT ... FOR UPDATE locks the student_subscriptions row for the
--     transaction so a webhook downgrade landing mid-cancel cannot
--     interleave its UPDATEs with ours.
--   - Both UPDATEs run inside the same implicit transaction. If the
--     second one fails, the first is rolled back automatically. The
--     caller (cancel route) sees a single error and surfaces 500/503.
--   - REVOKE EXECUTE FROM PUBLIC then GRANT to service_role only.
--   - No table schema changes. No data backfill.

BEGIN;

CREATE OR REPLACE FUNCTION public.atomic_cancel_subscription(
  p_student_id uuid,
  p_immediate boolean DEFAULT false,
  p_reason text DEFAULT NULL
)
RETURNS TABLE(outcome text, plan_code_before text, status_before text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status_before text;
  v_plan_code_before text;
  v_now timestamptz := NOW();
BEGIN
  -- Lock the subscription row for the duration of this transaction.
  -- This serializes us against:
  --   - concurrent webhook downgrade (atomic_downgrade_subscription)
  --   - concurrent renewal write (activate_subscription_locked)
  -- Both of those acquire either FOR UPDATE on the same row or the
  -- pg_advisory_xact_lock keyed by student_id, so they will queue.
  SELECT status, plan_code
  INTO v_status_before, v_plan_code_before
  FROM student_subscriptions
  WHERE student_id = p_student_id
  FOR UPDATE;

  IF v_status_before IS NULL THEN
    -- No subscription row at all. Nothing to cancel; report no-op.
    RETURN QUERY SELECT 'no_subscription'::text, NULL::text, NULL::text;
    RETURN;
  END IF;

  -- Already terminal; idempotent no-op.
  IF v_status_before IN ('cancelled', 'expired', 'halted') THEN
    RETURN QUERY SELECT 'already_terminal'::text, v_plan_code_before, v_status_before;
    RETURN;
  END IF;

  -- Free plan; nothing to do.
  IF v_plan_code_before = 'free' THEN
    RETURN QUERY SELECT 'free_plan'::text, v_plan_code_before, v_status_before;
    RETURN;
  END IF;

  IF p_immediate THEN
    -- 1. Mark subscription cancelled and ended now.
    UPDATE student_subscriptions
    SET status = 'cancelled',
        auto_renew = false,
        cancelled_at = v_now,
        cancel_reason = p_reason,
        ended_at = v_now,
        updated_at = v_now
    WHERE student_id = p_student_id;

    -- 2. Downgrade the student's effective plan_code to free in the SAME
    --    transaction. If this UPDATE fails, the cancel above is rolled
    --    back automatically — no split-brain.
    UPDATE students
    SET subscription_plan = 'free',
        updated_at = v_now
    WHERE id = p_student_id;

    RETURN QUERY SELECT 'cancelled_immediate'::text, v_plan_code_before, v_status_before;
    RETURN;
  END IF;

  -- End-of-cycle cancel: keep access until current_period_end. Only flip
  -- auto_renew off and record the cancel intent. Status remains 'active'
  -- (or whatever it was) until the period actually ends — that flip is
  -- handled by the daily-cron expiry sweep / Razorpay subscription.cancelled
  -- webhook when it lands. We do NOT touch students.subscription_plan
  -- because the user still has paid access until period end.
  UPDATE student_subscriptions
  SET auto_renew = false,
      cancelled_at = v_now,
      cancel_reason = p_reason,
      updated_at = v_now
  WHERE student_id = p_student_id;

  RETURN QUERY SELECT 'cancel_scheduled'::text, v_plan_code_before, v_status_before;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.atomic_cancel_subscription(uuid, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.atomic_cancel_subscription(uuid, boolean, text) TO service_role;

COMMENT ON FUNCTION public.atomic_cancel_subscription IS
  'P11 fix — atomic user-initiated subscription cancel. Single transaction across student_subscriptions + students with row-level lock. Replaces the two-statement UPDATE pair in src/app/api/payments/cancel/route.ts. Returns outcome=cancelled_immediate|cancel_scheduled|already_terminal|free_plan|no_subscription so the route can shape its response without re-reading.';

-- ────────────────────────────────────────────────────────────
-- Verification — assert RPC is present
-- ────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'atomic_cancel_subscription'
      AND pronamespace = 'public'::regnamespace
  ) THEN
    RAISE EXCEPTION 'P11 fix: atomic_cancel_subscription not created';
  END IF;
  RAISE NOTICE 'P11 fix: atomic_cancel_subscription verified present';
END $$;

COMMIT;
