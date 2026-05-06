-- C-02: Update subscription_plans to match investor deck canonical pricing
-- Rename 'unlimited' plan to 'Family / School' and fix price from ₹1,499 → ₹1,099/month

UPDATE subscription_plans
SET
  name = 'Family / School',
  price_monthly = 1099,
  price_yearly  = 8799
WHERE plan_code = 'unlimited';

-- Verify
SELECT plan_code, name, price_monthly, price_yearly
FROM subscription_plans
ORDER BY price_monthly;
