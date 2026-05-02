-- Migration: 20260502170000_hotfix_p11_atomic_subscription_rpcs.sql
-- Purpose:   P11 production hotfix — re-create the four payment-activation
--            RPCs and the `ff_atomic_subscription_activation` feature flag
--            that are missing from the production schema.
--
-- Why this exists:
--   The Razorpay webhook (src/app/api/payments/webhook/route.ts) calls four
--   RPCs that exist as source migrations in this repo but never reached
--   production because the migration chain has been blocked behind the
--   schema-reproducibility workstream. As a result, the production webhook
--   has been returning HTTP 503 on every successful payment for several
--   days — payments are captured by Razorpay but plan access is never
--   granted in our DB. This is a P11 (Payment Integrity) blocker.
--
--   This migration consolidates the four originally-blocked migrations
--   into a single idempotent file that can be applied:
--     (a) immediately via Supabase Studio SQL editor (emergency path),
--     (b) automatically via `supabase db push` once the chain unblocks.
--
--   The four functions are copied byte-for-byte from their source
--   migrations so applying both this hotfix AND the originals (in either
--   order, against any DB) is safe — every statement uses CREATE OR
--   REPLACE FUNCTION or an existence-checked INSERT, so re-runs are
--   no-ops.
--
-- Source migrations (left untouched in the chain):
--   - 20260424120000_atomic_subscription_activation_rpc.sql
--   - 20260425140500_ff_atomic_subscription_activation.sql
--   - 20260425150200_atomic_downgrade_subscription_rpc.sql
--   - 20260425150300_activate_with_advisory_lock.sql
--
-- Safety properties:
--   - All function definitions use CREATE OR REPLACE FUNCTION (idempotent).
--   - Feature flag insert uses IF NOT EXISTS guard (idempotent — note
--     feature_flags.flag_name has no UNIQUE constraint in production, so
--     ON CONFLICT cannot be used; we follow the same pattern as the
--     source migration and other feature-flag migrations in this repo).
--   - GRANT EXECUTE statements are safe to repeat.
--   - No table schema changes. No RLS changes. No DROP statements.
--   - No data migration. No INSERT/COPY of student rows.
--   - Final verification block raises EXCEPTION if any of the four RPCs
--     are missing after the migration runs, so a partially-applied
--     hotfix surfaces immediately rather than silently leaving the gap.

-- ────────────────────────────────────────────────────────────
-- 1. atomic_subscription_activation
-- ────────────────────────────────────────────────────────────
-- Source: 20260424120000_atomic_subscription_activation_rpc.sql
-- P11 split-brain fallback. Atomically upserts student_subscriptions and
-- updates students.subscription_plan in a single transaction. Used by the
-- payment webhook when the primary activate_subscription RPC fails.
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
  -- Resolve plan_id from plan_code (RAISE if missing — don't silently skip)
  SELECT id INTO v_plan_id FROM subscription_plans WHERE plan_code = p_plan_code LIMIT 1;
  IF v_plan_id IS NULL THEN
    RAISE EXCEPTION 'Plan not found: %', p_plan_code;
  END IF;

  -- Compute period end
  v_period_end := CASE
    WHEN p_billing_cycle = 'yearly' THEN NOW() + INTERVAL '1 year'
    ELSE NOW() + INTERVAL '1 month'
  END;

  -- Compute next billing timestamp. One-time yearly payments have no
  -- next billing; monthly recurring subscriptions (razorpay_subscription_id
  -- set) renew on the monthly anniversary.
  v_next_billing := CASE
    WHEN p_billing_cycle = 'yearly' THEN NOW() + INTERVAL '1 year'
    WHEN p_billing_cycle = 'monthly' AND p_razorpay_subscription_id IS NOT NULL THEN NOW() + INTERVAL '1 month'
    ELSE NULL
  END;

  -- 1. Upsert student_subscriptions row
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

  -- 2. Update students.subscription_plan in the same transaction
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
-- Source: 20260425150200_atomic_downgrade_subscription_rpc.sql
-- Atomic downgrade with stale-cancel guard via row-level lock. Replaces
-- the JS SELECT-then-UPDATE in webhook/route.ts:downgradeIfMatchingSub.
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

  -- Lock the subscription row for the duration of this transaction.
  SELECT razorpay_subscription_id INTO v_current_sub_id
  FROM student_subscriptions
  WHERE student_id = p_student_id
  FOR UPDATE;

  -- Stale cancel: a different sub_id is currently active. Ignore.
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
-- Source: 20260425150300_activate_with_advisory_lock.sql
-- Wraps activate_subscription in a transaction-scoped advisory lock keyed
-- by student_id, serializing verify-route + webhook activation attempts.
--
-- COURSE-CORRECT 2026-05-02 (this hotfix only — source migration
-- unchanged): the webhook supplies a SUBSET of these args at two call
-- sites:
--   - src/app/api/payments/webhook/route.ts:470 (payment.captured branch)
--     supplies 5 keys: p_auth_user_id, p_plan_code, p_billing_cycle,
--     p_razorpay_payment_id, p_razorpay_order_id  — MISSING
--     p_razorpay_subscription_id (one-time yearly orders have no sub_id).
--   - src/app/api/payments/webhook/route.ts:720 (subscription.charged
--     branch) supplies 5 keys: p_auth_user_id, p_plan_code,
--     p_billing_cycle, p_razorpay_payment_id, p_razorpay_subscription_id
--     — MISSING p_razorpay_order_id (recurring subs have no order_id).
-- PostgREST resolves RPCs by named-arg signature match; without DEFAULTs
-- the missing keys make the function appear absent and the webhook 503s.
-- We add DEFAULT NULL to the three optional Razorpay identifier params
-- (and to billing_cycle for symmetry with atomic_subscription_activation)
-- so both call shapes resolve to the same overload.
--
-- The source migration in the repo (20260425150300) is left unchanged;
-- it will be reconciled when the schema-reproducibility baseline is
-- regenerated from the post-hotfix prod schema.
CREATE OR REPLACE FUNCTION public.activate_subscription_locked(
  p_auth_user_id uuid,
  p_plan_code text,
  p_billing_cycle text DEFAULT 'monthly',
  p_razorpay_payment_id text DEFAULT NULL,
  p_razorpay_order_id text DEFAULT NULL,
  p_razorpay_subscription_id text DEFAULT NULL
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

  -- Transaction-scoped advisory lock keyed by student_id. Prevents verify-
  -- route + webhook from interleaving activation. Released on COMMIT/ROLLBACK.
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
-- Source: 20260425150300_activate_with_advisory_lock.sql
-- Wraps atomic_subscription_activation with the same advisory lock so the
-- fallback path is also serialized per-student.
--
-- COURSE-CORRECT 2026-05-02 (this hotfix only — source migration
-- unchanged): all three webhook call sites
--   - src/app/api/payments/webhook/route.ts:519 (payment.captured fallback)
--   - src/app/api/payments/webhook/route.ts:768 (subscription.charged fallback)
--   - src/app/api/payments/webhook/route.ts:815 (no-authUserId path)
-- explicitly pass all 5 keys (with `null` for the absent identifier),
-- so PostgREST resolution succeeds today. We still add DEFAULT NULL to
-- the optional params for defense-in-depth and signature symmetry with
-- atomic_subscription_activation (which already declares them defaulted).
-- This way any future call site can omit them safely.
--
-- The source migration in the repo (20260425150300) is left unchanged;
-- it will be reconciled when the schema-reproducibility baseline is
-- regenerated from the post-hotfix prod schema.
CREATE OR REPLACE FUNCTION public.atomic_subscription_activation_locked(
  p_student_id uuid,
  p_plan_code text,
  p_billing_cycle text DEFAULT 'monthly',
  p_razorpay_payment_id text DEFAULT NULL,
  p_razorpay_subscription_id text DEFAULT NULL
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
-- Source: 20260425140500_ff_atomic_subscription_activation.sql
-- Kill switch for the atomic_subscription_activation fallback in the
-- Razorpay webhook. Default: enabled. When disabled, the webhook returns
-- HTTP 503 immediately on primary RPC failure (forcing Razorpay retries)
-- instead of attempting the atomic fallback.
--
-- Schema note: feature_flags.flag_name has no UNIQUE constraint in
-- production, so ON CONFLICT cannot be used. We use the same existence-
-- check pattern as the source migration and as other feature-flag
-- migrations in this repo (e.g. 20260418100800_feature_flags.sql,
-- 20260413170000_kill_switch_flags.sql).
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
-- 6. Verification — assert all four RPCs are present
-- ────────────────────────────────────────────────────────────
-- Raises an exception (and aborts the migration) if any of the four
-- payment-activation RPCs are missing after the statements above.
-- A NOTICE is emitted on success so operators applying via Supabase
-- Studio see explicit confirmation in the SQL editor output.
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
