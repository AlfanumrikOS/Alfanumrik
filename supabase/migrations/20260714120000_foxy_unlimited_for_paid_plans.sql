-- Migration: 20260714120000_foxy_unlimited_for_paid_plans.sql
-- Purpose:   CEO-approved product change — make Foxy chats UNLIMITED for every
--            PAID plan. Sets subscription_plans.foxy_chats_per_day = -1 (the
--            established "unlimited" sentinel: get_plan_limit() maps -1 -> 999999)
--            for the paid plan codes. The free plan keeps its finite cap.
--
-- Owner: backend.  ⚠️ ARCHITECT REVIEW REQUIRED (P11 payment-adjacent): this is a
--        data change to the paid-plan catalog (subscription_plans). It changes
--        ONLY the per-day Foxy chat entitlement — it does NOT touch pricing,
--        subscription status, payment records, or any student_subscriptions row,
--        so P11 (payment integrity: verified-payment-before-access, atomic
--        status+payment writes) is preserved. No plan-access grant flows from
--        this file; entitlement enforcement continues to run through
--        get_plan_limit() / check_and_record_usage() at request time.
--
-- Plan codes touched (paid): 'starter', 'pro', 'unlimited'.
-- Plan codes deliberately NOT touched: 'free' (keeps its finite generous cap).
--   ('competition' is not yet seeded — its CHECK-constraint activation is a
--    separate CEO-triggered migration; nothing to update here.)
--   Legacy aliases (basic/premium/ultimate) do not exist as rows —
--   chk_valid_plan_code pins plan_code to ('free','starter','pro','unlimited').
--
-- Enforcement authority (unchanged): the DB is the single source of truth.
--   get_plan_limit(student, 'foxy_chat') reads subscription_plans.foxy_chats_
--   per_day and returns 999999 when the value is -1. -1 is already a valid value
--   for this column (no CHECK constraint restricts it; the 'notes'/'ai_total'
--   tiers in get_student_usage already use -1 the same way).
--
-- Idempotency: data-driven UPDATE keyed by plan_code, guarded with
--   `IS DISTINCT FROM -1` so re-running is a true no-op (touches only rows that
--   are not already unlimited). Safe to run multiple times. No schema change.
--   NOTE: subscription_plans has no updated_at column (only created_at), so this
--   migration does not attempt to bump one.
--
-- Rollback (manual, do NOT auto-run): restore each paid plan's prior finite cap,
--   e.g. UPDATE public.subscription_plans SET foxy_chats_per_day = 30
--        WHERE plan_code = 'starter'; -- (per-plan values are prod-owned)

BEGIN;

UPDATE public.subscription_plans
   SET foxy_chats_per_day = -1
 WHERE plan_code IN ('starter', 'pro', 'unlimited')
   AND foxy_chats_per_day IS DISTINCT FROM -1;

-- Verification block — read-only, fail-soft (RAISE NOTICE / WARNING only, never
-- throws). Operators confirm the intended end-state in deploy logs.
DO $verify$
DECLARE
  v_paid_total     integer;
  v_paid_unlimited integer;
  v_free_cap       integer;
  rec              record;
BEGIN
  SELECT COUNT(*)
    INTO v_paid_total
    FROM public.subscription_plans
   WHERE plan_code IN ('starter', 'pro', 'unlimited');

  SELECT COUNT(*)
    INTO v_paid_unlimited
    FROM public.subscription_plans
   WHERE plan_code IN ('starter', 'pro', 'unlimited')
     AND foxy_chats_per_day = -1;

  RAISE NOTICE '[foxy_unlimited_paid] paid plan rows present = % ; now unlimited (-1) = %',
    v_paid_total, v_paid_unlimited;

  IF v_paid_total > 0 AND v_paid_unlimited <> v_paid_total THEN
    RAISE WARNING '[foxy_unlimited_paid] expected all % paid plan rows at foxy_chats_per_day=-1, found only %',
      v_paid_total, v_paid_unlimited;
  END IF;

  FOR rec IN
    SELECT plan_code, foxy_chats_per_day
      FROM public.subscription_plans
     WHERE plan_code IN ('free', 'starter', 'pro', 'unlimited')
     ORDER BY plan_code
  LOOP
    RAISE NOTICE '[foxy_unlimited_paid] plan_code=% foxy_chats_per_day=%',
      rec.plan_code, rec.foxy_chats_per_day;
  END LOOP;

  SELECT foxy_chats_per_day
    INTO v_free_cap
    FROM public.subscription_plans
   WHERE plan_code = 'free';

  IF v_free_cap = -1 THEN
    RAISE WARNING '[foxy_unlimited_paid] free plan is UNLIMITED (-1) — expected a finite cap; investigate';
  END IF;
END $verify$;

COMMIT;
