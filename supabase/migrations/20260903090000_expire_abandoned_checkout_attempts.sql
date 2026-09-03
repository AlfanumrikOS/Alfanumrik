-- 20260903090000_expire_abandoned_checkout_attempts.sql
--
-- P11 payment-integrity fix (2026-09-03, found while investigating a
-- broken scheduled "Payment Integrity Watchdog" for P2-5). The
-- `payments-health` cron (every 10 min) has been reporting REAL
-- `stuck_pending_payments` / `stuck_pending_subscriptions` failures
-- continuously since 2026-07-19 / 2026-08-15 respectively — 4,727
-- ops_events rows and counting, all from the SAME single abandoned
-- checkout attempt (one student started a monthly-plan subscribe flow,
-- Razorpay's authorization was never completed — razorpay_payment_id was
-- never set — and the resulting `payment_history`/`student_subscriptions`
-- rows were left in 'pending' forever). The student in question is
-- unaffected: they are already active on a different, successfully-paid
-- plan (pro_yearly) from a separate transaction.
--
-- Root cause: nothing in this codebase ever transitions an abandoned
-- 'pending' checkout attempt to a terminal state.
-- `check_expired_subscriptions` (cron/expired-subscriptions) only handles
-- ALREADY-active subscriptions lapsing (active → past_due → halted); it
-- never touches subscriptions that never activated in the first place.
-- `reconcile-payments` handles the OPPOSITE direction (a captured payment
-- whose student record wasn't updated). There is a feature flag
-- (`reconcile_stuck_subscriptions_enabled`, seeded OFF, later flipped ON
-- at 100% rollout at some point) whose own description says it "enables
-- the reconcile_stuck_subscriptions action in the payments Edge
-- Function" — but grepping the entire codebase turns up no such action
-- anywhere, in any Edge Function or app route; the flag is read by zero
-- production code. It appears the intended implementation was never
-- built. This migration is that missing implementation (as a plain
-- SECURITY DEFINER RPC + Next.js cron route, matching the established
-- check_expired_subscriptions pattern, rather than trying to resurrect
-- the orphaned flag/Edge-Function reference, which is a separate,
-- unrelated cleanup).
--
-- Design: run on a MUCH longer threshold (72h) than payments-health's own
-- 30-minute alert threshold — 30 minutes is deliberately fast so a human
-- notices a REAL pipeline failure quickly; 72 hours is far longer than
-- any legitimate Razorpay authorization/webhook round-trip should ever
-- take, so treating a row still 'pending' at that age as abandoned is
-- conservative and safe.
--   - payment_history: only rows with razorpay_payment_id IS NULL are
--     touched. That column is ONLY ever set by the verify/webhook paths
--     on an actual capture — its absence after 72h is unambiguous
--     evidence Razorpay never told us this one completed. Marked
--     'failed' (the existing status value this codebase already uses for
--     a payment that did not succeed — see payments/webhook/route.ts).
--   - student_subscriptions: Razorpay subscription objects are created
--     BEFORE the user completes authorization, so razorpay_subscription_id
--     being present does not by itself prove success — elapsed time past
--     the same conservative 72h threshold is the signal. Marked
--     'cancelled' (a value already in this table's CHECK constraint and
--     already used elsewhere in this codebase for "not going forward" —
--     e.g. payments/cancel/route.ts — and one of the terminal statuses
--     packages/lib/src/reconcile-stuck-payments.ts's guard already
--     recognizes).

CREATE OR REPLACE FUNCTION public.expire_abandoned_checkout_attempts()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_threshold CONSTANT interval := interval '72 hours';
  v_payments_expired integer := 0;
  v_subscriptions_expired integer := 0;
BEGIN
  WITH expired AS (
    UPDATE payment_history
    SET status = 'failed'
    WHERE status = 'pending'
      AND razorpay_payment_id IS NULL
      AND created_at < now() - v_threshold
    RETURNING id
  )
  SELECT count(*) INTO v_payments_expired FROM expired;

  WITH expired AS (
    UPDATE student_subscriptions
    SET status = 'cancelled'
    WHERE status = 'pending'
      AND created_at < now() - v_threshold
    RETURNING id
  )
  SELECT count(*) INTO v_subscriptions_expired FROM expired;

  RETURN jsonb_build_object(
    'payments_expired', v_payments_expired,
    'subscriptions_expired', v_subscriptions_expired,
    'checked_at', now()
  );
END;
$$;

COMMENT ON FUNCTION public.expire_abandoned_checkout_attempts() IS
  'P11: transitions checkout attempts abandoned >72h ago (never captured/activated) to a terminal status, so payments-health stops re-alerting on them forever. Called by cron/expire-abandoned-checkouts.';
