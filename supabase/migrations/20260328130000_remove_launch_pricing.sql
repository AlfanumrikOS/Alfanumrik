-- ============================================================
-- PRICING CLEANUP MIGRATION
-- Permanently removes old launch pricing and adds constraints
-- to ensure only canonical active pricing is used.
--
-- Current canonical prices (in INR rupees):
--   free:      ₹0/mo, ₹0/yr
--   starter:   ₹299/mo, ₹2,399/yr
--   pro:       ₹699/mo, ₹5,599/yr
--   unlimited: ₹1,499/mo, ₹11,999/yr
-- ============================================================

-- 1. Remove all old launch pricing fields
UPDATE subscription_plans SET
  launch_price = NULL,
  launch_tagline = NULL,
  launch_expires_at = NULL,
  seats_remaining = NULL,
  original_price = NULL,
  discount_pct = 0
WHERE plan_code IN ('starter', 'pro', 'unlimited');

-- 2. Ensure only valid plan codes exist and are active
-- Deactivate any rogue plan codes that aren't in the canonical set
UPDATE subscription_plans SET is_active = false
WHERE plan_code NOT IN ('free', 'starter', 'pro', 'unlimited');

-- 3. Add unique constraint on active plan codes to prevent duplicates
CREATE UNIQUE INDEX IF NOT EXISTS idx_subscription_plans_active_code
ON subscription_plans (plan_code) WHERE is_active = true;

-- 4. Add CHECK constraint: price_monthly must be non-negative
ALTER TABLE subscription_plans
  ADD CONSTRAINT chk_price_monthly_nonneg CHECK (price_monthly >= 0);

-- 5. Add CHECK constraint: price_yearly must be non-negative
ALTER TABLE subscription_plans
  ADD CONSTRAINT chk_price_yearly_nonneg CHECK (price_yearly >= 0);

-- 6. Add CHECK constraint: valid plan codes only
ALTER TABLE subscription_plans
  ADD CONSTRAINT chk_valid_plan_code CHECK (plan_code IN ('free', 'starter', 'pro', 'unlimited'));

-- 7. Add CHECK on students.subscription_plan for valid values only
-- First update any legacy values (basic→starter, premium→pro)
UPDATE students SET subscription_plan = 'starter' WHERE subscription_plan = 'basic';
UPDATE students SET subscription_plan = 'pro' WHERE subscription_plan = 'premium';
UPDATE students SET subscription_plan = 'free' WHERE subscription_plan IS NULL;

ALTER TABLE students
  DROP CONSTRAINT IF EXISTS chk_student_plan_code;
ALTER TABLE students
  ADD CONSTRAINT chk_student_plan_code CHECK (subscription_plan IN ('free', 'starter', 'pro', 'unlimited'));

-- 8. payment_history: ensure amount is always positive (stored in rupees INR)
ALTER TABLE payment_history
  ADD CONSTRAINT chk_payment_amount_positive CHECK (amount > 0);

-- 9. Deprecation comments
COMMENT ON COLUMN subscription_plans.launch_price IS 'Deprecated — no longer used.';
COMMENT ON COLUMN subscription_plans.original_price IS 'Deprecated — no longer used.';
COMMENT ON COLUMN subscription_plans.discount_pct IS 'Deprecated — no longer used.';
COMMENT ON COLUMN subscription_plans.seats_remaining IS 'Deprecated — no longer used.';
