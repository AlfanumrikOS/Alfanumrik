-- ════════════════════════════════════════════════════════════════════
-- P11 PRODUCTION HOTFIX — 2026-05-02
-- Re-create 4 missing payment-activation RPCs + 1 feature flag
-- ════════════════════════════════════════════════════════════════════
--
-- HOW TO USE THIS FILE:
--   1. Open Supabase Studio for the production project.
--   2. Open the SQL editor.
--   3. Paste this entire file.
--   4. Run.
--   5. Confirm the final output: "P11 hotfix: all 4 RPCs verified present"
--
-- This is the same SQL as
--   supabase/migrations/20260502170000_hotfix_p11_atomic_subscription_rpcs.sql
-- but kept here as a copy-paste-ready operator script. The migration file
-- in the chain will apply automatically once the schema-reproducibility
-- workstream unblocks `supabase db push`. Until then, this script is the
-- emergency apply path.
--
-- IDEMPOTENCY: Every statement uses CREATE OR REPLACE FUNCTION or an
-- existence-checked INSERT. Running this file twice is a no-op the
-- second time. Running it after the migration has been applied via
-- db push is also a no-op. Safe to retry on transient errors.
--
-- WHAT IT DOES NOT DO:
--   - No table schema changes
--   - No RLS / policy changes
--   - No DROP statements
--   - No data migration (no INSERT/COPY of student rows)
--
-- WHY THIS EXISTS:
--   The Razorpay webhook (src/app/api/payments/webhook/route.ts) calls
--   four RPCs that exist as source migrations in the repo but never
--   reached production because the migration chain has been blocked
--   behind the schema-reproducibility workstream. The production webhook
--   has been returning HTTP 503 on every successful payment for several
--   days — payments are captured by Razorpay but plan access is never
--   granted in our DB. This is a P11 (Payment Integrity) blocker.
--
-- ════════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────
-- 1. atomic_subscription_activation
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.atomic_subscription_activation(
  p_student_id uuid,
  p_plan_code text,
  p_billing_cycle text DEFAULT 'monthly',
  p_razorpay_payment_id text DEFAULT NULL,
  p_razorpay_subscription_id text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_plan_id uuid;
  v_period_end timestamptz;
  v_next_billing timestamptz;
BEGIN
  SELECT id INTO v_plan_id FROM subscription_plans WHERE plan_code = p_plan_code LIMIT 1;
  IF v_plan_id IS NULL THEN
    RAISE EXCEPTION 'Plan not found: %', p_plan_code;
  END IF;

  v_period_end := CASE
    WHEN p_billing_cycle = 'yearly' THEN NOW() + INTERVAL '1 year'
    ELSE NOW() + INTERVAL '1 month'
  END;

  v_next_billing := CASE
    WHEN p_billing_cycle = 'yearly' THEN NOW() + INTERVAL '1 year'
    WHEN p_billing_cycle = 'monthly' AND p_razorpay_subscription_id IS NOT NULL THEN NOW() + INTERVAL '1 month'
    ELSE NULL
  END;

  INSERT INTO student_subscriptions (
    student_id, plan_id, plan_code, status, billing_cycle,
    current_period_start, current_period_end, next_billing_at,
    razorpay_payment_id, razorpay_subscription_id,
    auto_renew, renewal_attempts, grace_period_end, ended_at,
    updated_at
  ) VALUES (
    p_student_id, v_plan_id, p_plan_code, 'active', p_billing_cycle,
    NOW(), v_period_end, v_next_billing,
    p_razorpay_payment_id, p_razorpay_subscription_id,
    CASE WHEN p_razorpay_subscription_id IS NOT NULL THEN true ELSE false END,
    0, NULL, NULL, NOW()
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

  UPDATE students SET
    subscription_plan = p_plan_code,
    updated_at = NOW()
  WHERE id = p_student_id;
END;
$function$;

COMMENT ON FUNCTION public.atomic_subscription_activation IS
  'P11 split-brain fallback. Atomically activates a subscription by upserting student_subscriptions and updating students.subscription_plan in a single transaction. Used by the payment webhook when the primary activate_subscription RPC fails.';

GRANT EXECUTE ON FUNCTION public.atomic_subscription_activation(uuid, text, text, text, text) TO service_role;

-- ────────────────────────────────────────────────────────────
-- 2. atomic_downgrade_subscription
-- ────────────────────────────────────────────────────────────
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

  SELECT razorpay_subscription_id INTO v_current_sub_id
  FROM student_subscriptions
  WHERE student_id = p_student_id
  FOR UPDATE;

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

-- ────────────────────────────────────────────────────────────
-- 3. activate_subscription_locked
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.activate_subscription_locked(
  p_auth_user_id uuid,
  p_plan_code text,
  p_billing_cycle text,
  p_razorpay_payment_id text,
  p_razorpay_order_id text,
  p_razorpay_subscription_id text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_student_id uuid;
BEGIN
  SELECT id INTO v_student_id FROM students WHERE auth_user_id = p_auth_user_id LIMIT 1;
  IF v_student_id IS NULL THEN
    RAISE EXCEPTION 'Student not found for auth_user_id %', p_auth_user_id;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('subscription:' || v_student_id::text, 0));

  PERFORM activate_subscription(
    p_auth_user_id,
    p_plan_code,
    p_billing_cycle,
    p_razorpay_payment_id,
    p_razorpay_order_id,
    p_razorpay_subscription_id
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.activate_subscription_locked(uuid, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.activate_subscription_locked(uuid, text, text, text, text, text) TO service_role;

-- ────────────────────────────────────────────────────────────
-- 4. atomic_subscription_activation_locked
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.atomic_subscription_activation_locked(
  p_student_id uuid,
  p_plan_code text,
  p_billing_cycle text,
  p_razorpay_payment_id text,
  p_razorpay_subscription_id text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('subscription:' || p_student_id::text, 0));

  PERFORM atomic_subscription_activation(
    p_student_id,
    p_plan_code,
    p_billing_cycle,
    p_razorpay_payment_id,
    p_razorpay_subscription_id
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.atomic_subscription_activation_locked(uuid, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.atomic_subscription_activation_locked(uuid, text, text, text, text) TO service_role;

-- ────────────────────────────────────────────────────────────
-- 5. ff_atomic_subscription_activation feature flag
-- ────────────────────────────────────────────────────────────
-- Schema note: feature_flags.flag_name has no UNIQUE constraint in
-- production, so ON CONFLICT cannot be used. Using existence check.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM feature_flags WHERE flag_name = 'ff_atomic_subscription_activation'
  ) THEN
    INSERT INTO feature_flags (flag_name, is_enabled, description)
    VALUES (
      'ff_atomic_subscription_activation',
      true,
      'Kill-switch for the Phase 0g.2 atomic_subscription_activation fallback in the Razorpay webhook. When disabled, the webhook returns 503 immediately on primary RPC failure (forcing Razorpay retries) instead of attempting the atomic fallback. Default: enabled.'
    );
  END IF;
END $$;

-- ────────────────────────────────────────────────────────────
-- 6. Verification
-- ────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'atomic_subscription_activation'
      AND pronamespace = 'public'::regnamespace
  ) THEN
    RAISE EXCEPTION 'P11 hotfix: atomic_subscription_activation not created';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'atomic_downgrade_subscription'
      AND pronamespace = 'public'::regnamespace
  ) THEN
    RAISE EXCEPTION 'P11 hotfix: atomic_downgrade_subscription not created';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'activate_subscription_locked'
      AND pronamespace = 'public'::regnamespace
  ) THEN
    RAISE EXCEPTION 'P11 hotfix: activate_subscription_locked not created';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'atomic_subscription_activation_locked'
      AND pronamespace = 'public'::regnamespace
  ) THEN
    RAISE EXCEPTION 'P11 hotfix: atomic_subscription_activation_locked not created';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM feature_flags
    WHERE flag_name = 'ff_atomic_subscription_activation'
  ) THEN
    RAISE EXCEPTION 'P11 hotfix: ff_atomic_subscription_activation flag row missing';
  END IF;

  RAISE NOTICE 'P11 hotfix: all 4 RPCs verified present';
END $$;
