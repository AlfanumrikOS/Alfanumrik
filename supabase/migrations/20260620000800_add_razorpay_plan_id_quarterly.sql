-- Migration: 20260620000800_add_razorpay_plan_id_quarterly.sql
-- Purpose: Add a per-plan quarterly Razorpay Plan ID column for quarterly school billing.
--
-- Additive, idempotent, replayable. No RLS change (existing table), no CHECK change,
-- no data change, no DROP. Mirrors the existing razorpay_plan_id_monthly naming.
--
-- NOTE: The optional 'comp' subscription-status CHECK widening is intentionally NOT
-- included here. Per the demo-account design, comp/demo accounts in v1 use
-- status='active' + is_demo=true + razorpay_subscription_id IS NULL, so no status
-- enum widening is required.

ALTER TABLE public.subscription_plans
  ADD COLUMN IF NOT EXISTS razorpay_plan_id_quarterly text;

COMMENT ON COLUMN public.subscription_plans.razorpay_plan_id_quarterly IS
  'Razorpay Plan ID for the quarterly recurring plan (Razorpay period=monthly, interval=3). Nullable; mirrors razorpay_plan_id_monthly.';
