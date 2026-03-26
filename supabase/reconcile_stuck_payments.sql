-- ============================================================================
-- Payment Reconciliation Query
--
-- Purpose: Find "stuck" payments where payment_history shows status='captured'
-- but the student's subscription_plan does not match the paid plan_code.
--
-- This can happen when:
--   1. The activate_subscription RPC fails silently
--   2. The direct UPDATE fallback also fails (RLS issue, constraint, etc.)
--   3. A webhook and verify route race, and neither completes the update
--   4. The student record's auth_user_id was stale at activation time
--
-- Usage: Run manually in Supabase SQL Editor (admin access required).
--        Review results, then fix with the UPDATE statement below.
-- ============================================================================

-- Step 1: Find stuck payments (captured but plan not reflected on student)
SELECT
    ph.id                   AS payment_id,
    ph.student_id,
    ph.plan_code            AS paid_plan,
    ph.billing_cycle,
    ph.razorpay_payment_id,
    ph.razorpay_order_id,
    ph.amount,
    ph.status               AS payment_status,
    ph.created_at           AS payment_date,
    s.subscription_plan     AS current_plan,
    s.subscription_expiry,
    s.auth_user_id,
    s.email                 AS student_email,
    s.name                  AS student_name
FROM payment_history ph
JOIN students s ON s.id = ph.student_id
WHERE ph.status = 'captured'
  AND (
      s.subscription_plan IS NULL
      OR s.subscription_plan = 'free'
      OR s.subscription_plan != ph.plan_code
  )
ORDER BY ph.created_at DESC;

-- Step 2 (manual, after reviewing Step 1 results):
-- Fix stuck payments by updating the student's subscription_plan.
-- Uncomment and run ONLY after verifying the results above.
--
-- UPDATE students s
-- SET subscription_plan = ph.plan_code,
--     subscription_expiry = ph.created_at + INTERVAL '1 month' *
--         CASE WHEN ph.billing_cycle = 'yearly' THEN 12 ELSE 1 END,
--     updated_at = now()
-- FROM payment_history ph
-- WHERE ph.student_id = s.id
--   AND ph.status = 'captured'
--   AND (s.subscription_plan IS NULL OR s.subscription_plan = 'free' OR s.subscription_plan != ph.plan_code)
--   AND ph.created_at = (
--       SELECT MAX(ph2.created_at)
--       FROM payment_history ph2
--       WHERE ph2.student_id = s.id AND ph2.status = 'captured'
--   );
