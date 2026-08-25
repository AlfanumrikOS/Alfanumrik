-- Migration: 20260825140000_repoint_unlimited_to_canonical_price_plans.sql
-- Purpose: Stop the Family / School tier billing 36% more than it advertises
--          (launch-blocker P0-3).
--
-- ── THE DEFECT ─────────────────────────────────────────────────────────────
-- `subscription_plans` advertises the Family / School ('unlimited') tier at
-- ₹1,099/month and ₹8,799/year. The Razorpay plan objects it points at charge
-- ₹1,499 and ₹11,999 — verified live against the Razorpay API on 2026-08-25:
--
--   plan_SWj4nmErRIbd02  Alfanumrik Unlimited Monthly  monthly  ₹1499   (stale)
--   plan_Sb0bD6umoH12gf  Alfanumrik Unlimited Yearly   yearly   ₹11999  (stale)
--
-- A customer sees ₹1,099, subscribes, and is charged ₹1,499 — a ₹400/month
-- (+36%) overcharge. Starter and Pro were checked at the same time and match
-- their DB prices exactly (₹299/₹2,399 and ₹699/₹5,599); only this tier drifted.
--
-- ── WHY IT DRIFTED ─────────────────────────────────────────────────────────
-- All six Razorpay plans were created in two batches — monthly 2026-03-28
-- 17:20, yearly 2026-04-08 13:04 — when Unlimited really was ₹1,499/₹11,999.
-- Migration 20260505155126_fix_pricing_family_school_plan.sql then lowered the
-- DB to the canonical figure, stating the intent outright:
--
--   "C-02: Update subscription_plans to match investor deck canonical pricing"
--   "fix price from ₹1,499 → ₹1,099/month"
--
-- Razorpay plan objects are IMMUTABLE: `amount` cannot be edited after
-- creation. So the DB moved to the canonical price and Razorpay could not
-- follow, and nothing reconciled the two for ~3.5 months. ₹1,099/₹8,799 is the
-- intended price; the gateway was simply stale.
--
-- ── THE FIX ────────────────────────────────────────────────────────────────
-- Two NEW Razorpay plan objects were created 2026-08-25 at the canonical
-- price, and this migration repoints the tier at them:
--
--   plan_TTwIYZZCrQ9qko  Alfanumrik Family / School Monthly  monthly  ₹1099
--   plan_TTwIu9uauBUUfq  Alfanumrik Family / School Yearly   yearly   ₹8799
--
-- Both read back from GET /v1/plans at the stated period and amount before
-- this migration was written.
--
-- ── BLAST RADIUS: NONE ─────────────────────────────────────────────────────
-- No subscriber migration is required, and no refund is owed. Measured before
-- the change:
--   student_subscriptions WHERE plan_code = 'unlimited'  -> 24 rows
--     of which is_demo                                   -> 21
--     SUM(amount_paid)                                   -> ₹0
--   payment_history                                      -> 5 rows, ₹2,295 total,
--                                                           none against this tier
-- Nobody was ever charged the wrong amount. This was a latent defect that
-- would have fired on the first real Family / School purchase.
--
-- The two stale plan objects are deliberately NOT touched. Razorpay plans
-- cannot be deleted, only unreferenced — after this migration nothing in the
-- schema points at them. Do not reuse them.
--
-- Idempotent: a plain UPDATE keyed on plan_code, safe to re-run.
-- Rollback: set the two columns back to plan_SWj4nmErRIbd02 (monthly) and
-- plan_Sb0bD6umoH12gf (yearly) — which restores the overcharge, so only do
-- this to reproduce the incident.
--
-- Verification after apply:
--   select plan_code, price_monthly, price_yearly,
--          razorpay_plan_id_monthly, razorpay_plan_id
--   from public.subscription_plans where plan_code = 'unlimited';
--   -- expect 1099 | 8799 | plan_TTwIYZZCrQ9qko | plan_TTwIu9uauBUUfq

update public.subscription_plans
set
  razorpay_plan_id_monthly = 'plan_TTwIYZZCrQ9qko',
  razorpay_plan_id         = 'plan_TTwIu9uauBUUfq'
where plan_code = 'unlimited';

-- Fail loudly if the tier is missing or the prices are not the canonical ones.
-- A silent no-op here would leave the overcharge live while the migration
-- reported success.
do $$
declare
  v_monthly integer;
  v_yearly  integer;
  v_rzp_m   text;
  v_rzp_y   text;
begin
  select price_monthly, price_yearly, razorpay_plan_id_monthly, razorpay_plan_id
    into v_monthly, v_yearly, v_rzp_m, v_rzp_y
  from public.subscription_plans
  where plan_code = 'unlimited';

  if not found then
    raise exception 'subscription_plans has no row for plan_code=unlimited';
  end if;

  if v_monthly <> 1099 or v_yearly <> 8799 then
    raise exception
      'Family / School price is % / %, expected the canonical 1099 / 8799. '
      'The Razorpay plans repointed here charge 1099/8799, so a different DB '
      'price would reintroduce the mismatch this migration exists to remove.',
      v_monthly, v_yearly;
  end if;

  if v_rzp_m is distinct from 'plan_TTwIYZZCrQ9qko'
     or v_rzp_y is distinct from 'plan_TTwIu9uauBUUfq' then
    raise exception 'repoint did not take: monthly=% yearly=%', v_rzp_m, v_rzp_y;
  end if;
end $$;
