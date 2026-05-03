-- ============================================================
-- RECURRING BILLING MIGRATION
-- Adds subscription lifecycle, billing events, and grace period
-- support for Razorpay Subscriptions API integration.
-- ============================================================

-- 1. Add recurring billing columns to student_subscriptions
ALTER TABLE student_subscriptions
  ADD COLUMN IF NOT EXISTS next_billing_at timestamptz,
  ADD COLUMN IF NOT EXISTS grace_period_end timestamptz,
  ADD COLUMN IF NOT EXISTS renewal_attempts integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ended_at timestamptz,
  ADD COLUMN IF NOT EXISTS pause_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS razorpay_plan_id text;

-- 2. Update status CHECK constraint to include new lifecycle states
ALTER TABLE student_subscriptions DROP CONSTRAINT IF EXISTS chk_subscription_status;
ALTER TABLE student_subscriptions ADD CONSTRAINT chk_subscription_status
  CHECK (status IN ('pending', 'active', 'past_due', 'halted', 'paused', 'cancelled', 'expired', 'completed'));

-- Migrate any existing non-matching statuses
UPDATE student_subscriptions SET status = 'active' WHERE status NOT IN ('pending', 'active', 'past_due', 'halted', 'paused', 'cancelled', 'expired', 'completed');

-- 3. Create subscription_events table for audit trail
CREATE TABLE IF NOT EXISTS subscription_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  subscription_id uuid REFERENCES student_subscriptions(id),
  event_type text NOT NULL,
  razorpay_event_id text,
  razorpay_payment_id text,
  razorpay_subscription_id text,
  plan_code text,
  amount_inr integer, -- always in rupees
  status_before text,
  status_after text,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sub_events_student ON subscription_events(student_id);
CREATE INDEX IF NOT EXISTS idx_sub_events_subscription ON subscription_events(subscription_id);
CREATE INDEX IF NOT EXISTS idx_sub_events_razorpay ON subscription_events(razorpay_event_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sub_events_idempotent ON subscription_events(razorpay_event_id) WHERE razorpay_event_id IS NOT NULL;

-- 4. Add razorpay_plan_id_monthly column to subscription_plans for recurring plan IDs
ALTER TABLE subscription_plans
  ADD COLUMN IF NOT EXISTS razorpay_plan_id_monthly text;

-- 5. Create or replace the activate_subscription RPC to support recurring
CREATE OR REPLACE FUNCTION public.activate_subscription(
  p_auth_user_id uuid,
  p_plan_code text,
  p_billing_cycle text DEFAULT 'monthly',
  p_razorpay_payment_id text DEFAULT NULL,
  p_razorpay_order_id text DEFAULT NULL,
  p_razorpay_subscription_id text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $function$
DECLARE
  v_student_id UUID;
  v_plan_id UUID;
  v_period_end TIMESTAMPTZ;
  v_next_billing TIMESTAMPTZ;
BEGIN
  -- Get student ID
  SELECT id INTO v_student_id FROM students WHERE auth_user_id = p_auth_user_id LIMIT 1;
  IF v_student_id IS NULL THEN
    RAISE EXCEPTION 'Student not found for auth_user_id %', p_auth_user_id;
  END IF;

  -- Get plan ID
  SELECT id INTO v_plan_id FROM subscription_plans WHERE plan_code = p_plan_code LIMIT 1;
  IF v_plan_id IS NULL THEN
    RAISE EXCEPTION 'Plan not found: %', p_plan_code;
  END IF;

  -- Calculate period end and next billing
  v_period_end := CASE
    WHEN p_billing_cycle = 'yearly' THEN NOW() + INTERVAL '1 year'
    ELSE NOW() + INTERVAL '1 month'
  END;

  v_next_billing := CASE
    WHEN p_billing_cycle = 'yearly' THEN NOW() + INTERVAL '1 year'
    WHEN p_billing_cycle = 'monthly' AND p_razorpay_subscription_id IS NOT NULL THEN NOW() + INTERVAL '1 month'
    ELSE NULL -- one-time yearly has no next billing
  END;

  -- Upsert subscription record
  INSERT INTO student_subscriptions (
    student_id, plan_id, plan_code, status, billing_cycle,
    current_period_start, current_period_end, next_billing_at,
    razorpay_payment_id, razorpay_subscription_id,
    auto_renew, renewal_attempts, grace_period_end, ended_at
  ) VALUES (
    v_student_id, v_plan_id, p_plan_code, 'active', p_billing_cycle,
    NOW(), v_period_end, v_next_billing,
    p_razorpay_payment_id, p_razorpay_subscription_id,
    CASE WHEN p_razorpay_subscription_id IS NOT NULL THEN true ELSE false END,
    0, NULL, NULL
  )
  ON CONFLICT (student_id) DO UPDATE SET
    plan_id = v_plan_id,
    plan_code = p_plan_code,
    status = 'active',
    billing_cycle = p_billing_cycle,
    current_period_start = NOW(),
    current_period_end = v_period_end,
    next_billing_at = v_next_billing,
    razorpay_payment_id = COALESCE(p_razorpay_payment_id, student_subscriptions.razorpay_payment_id),
    razorpay_subscription_id = COALESCE(p_razorpay_subscription_id, student_subscriptions.razorpay_subscription_id),
    auto_renew = CASE WHEN p_razorpay_subscription_id IS NOT NULL THEN true ELSE false END,
    renewal_attempts = 0,
    grace_period_end = NULL,
    ended_at = NULL,
    cancelled_at = NULL,
    cancel_reason = NULL,
    updated_at = NOW();

  -- Also update the students table
  UPDATE students SET subscription_plan = p_plan_code WHERE id = v_student_id;
END;
$function$;

-- 6. Function to check entitlement with grace period
CREATE OR REPLACE FUNCTION public.check_entitlement(p_student_id uuid)
RETURNS TABLE(
  has_access boolean,
  plan_code text,
  status text,
  grace_remaining interval,
  period_end timestamptz
) LANGUAGE plpgsql STABLE SECURITY DEFINER AS $function$
BEGIN
  RETURN QUERY
  SELECT
    -- Student has access if: active, or past_due within grace period
    CASE
      WHEN ss.status = 'active' THEN true
      WHEN ss.status = 'past_due' AND ss.grace_period_end IS NOT NULL AND NOW() < ss.grace_period_end THEN true
      WHEN ss.status = 'cancelled' AND ss.current_period_end IS NOT NULL AND NOW() < ss.current_period_end THEN true
      ELSE false
    END AS has_access,
    ss.plan_code,
    ss.status,
    CASE
      WHEN ss.grace_period_end IS NOT NULL AND NOW() < ss.grace_period_end
        THEN ss.grace_period_end - NOW()
      ELSE NULL
    END AS grace_remaining,
    ss.current_period_end AS period_end
  FROM student_subscriptions ss
  WHERE ss.student_id = p_student_id;
END;
$function$;

-- 7. Function to handle subscription renewal from webhook
CREATE OR REPLACE FUNCTION public.renew_subscription(
  p_student_id uuid,
  p_razorpay_payment_id text,
  p_amount_inr integer
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $function$
BEGIN
  UPDATE student_subscriptions SET
    status = 'active',
    current_period_start = NOW(),
    current_period_end = NOW() + INTERVAL '1 month',
    next_billing_at = NOW() + INTERVAL '1 month',
    razorpay_payment_id = p_razorpay_payment_id,
    amount_paid = p_amount_inr,
    renewal_attempts = 0,
    grace_period_end = NULL,
    updated_at = NOW()
  WHERE student_id = p_student_id
    AND status IN ('active', 'past_due');
END;
$function$;

-- 8. Function to mark subscription as past_due with grace period
CREATE OR REPLACE FUNCTION public.mark_subscription_past_due(
  p_student_id uuid,
  p_grace_days integer DEFAULT 3
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $function$
BEGIN
  UPDATE student_subscriptions SET
    status = 'past_due',
    renewal_attempts = renewal_attempts + 1,
    grace_period_end = COALESCE(grace_period_end, NOW() + (p_grace_days || ' days')::interval),
    updated_at = NOW()
  WHERE student_id = p_student_id
    AND status IN ('active', 'past_due');
END;
$function$;

-- 9. Function to halt subscription after grace period exhausted
CREATE OR REPLACE FUNCTION public.halt_subscription(
  p_student_id uuid
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $function$
BEGIN
  UPDATE student_subscriptions SET
    status = 'halted',
    auto_renew = false,
    ended_at = NOW(),
    updated_at = NOW()
  WHERE student_id = p_student_id
    AND status IN ('past_due', 'active');

  -- Downgrade student to free
  UPDATE students SET subscription_plan = 'free'
  WHERE id = p_student_id;
END;
$function$;

-- 10. RLS for subscription_events
ALTER TABLE subscription_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY sub_events_own_read ON subscription_events
  FOR SELECT USING (student_id = get_my_student_id());

CREATE POLICY sub_events_service_write ON subscription_events
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 11. Drop redundant index
DROP INDEX IF EXISTS idx_subs_student;

-- 12. Add index for grace period expiry checks
CREATE INDEX IF NOT EXISTS idx_subs_grace ON student_subscriptions(grace_period_end)
  WHERE status = 'past_due' AND grace_period_end IS NOT NULL;

-- 13. Add index for upcoming renewals
CREATE INDEX IF NOT EXISTS idx_subs_next_billing ON student_subscriptions(next_billing_at)
  WHERE status = 'active' AND auto_renew = true;
