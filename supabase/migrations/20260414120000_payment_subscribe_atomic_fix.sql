-- P8: index + RPC only, no RLS change to existing tables.
-- Purpose: fix P11-violating bug in monthly-subscription flow.
--   Defect A — subscribe route put user_id in notes but webhook reads student_id.
--   Defect B — no DB row written when Razorpay sub created, so webhook fallback
--              lookup on student_subscriptions.razorpay_subscription_id returned 0 rows.
--
-- This migration provides:
--   1. Partial unique index on student_subscriptions.razorpay_subscription_id
--      so the webhook can reliably resolve a student from a sub_id.
--   2. SECURITY DEFINER RPC create_pending_subscription(...) that atomically
--      (a) resolves student_id, (b) frees stale pending sub_ids, (c) inserts
--      payment_history pending row, (d) upserts student_subscriptions pending row.
--   3. GRANT EXECUTE to service_role only — this RPC is called from the
--      Next.js server with the service key and never from client code.
--
-- Idempotent: uses CREATE UNIQUE INDEX IF NOT EXISTS and CREATE OR REPLACE FUNCTION.
-- No DROP, no ALTER on existing columns.

BEGIN;

-- ────────────────────────────────────────────────────────────
-- C1: Partial unique index on razorpay_subscription_id
-- ────────────────────────────────────────────────────────────
-- Guarantees one student per live Razorpay subscription_id.
-- Partial (WHERE ... IS NOT NULL) so multiple rows can have NULL.
CREATE UNIQUE INDEX IF NOT EXISTS idx_student_subs_rz_sub_id
  ON student_subscriptions(razorpay_subscription_id)
  WHERE razorpay_subscription_id IS NOT NULL;

-- ────────────────────────────────────────────────────────────
-- C4: create_pending_subscription RPC (atomic pending-row write)
-- ────────────────────────────────────────────────────────────
-- Called from /api/payments/subscribe AFTER Razorpay subscription is created.
-- Writes a pending payment_history row + upserts student_subscriptions to
-- pending status with razorpay_subscription_id persisted. This is what
-- lets the webhook resolve the student later.
--
-- SECURITY DEFINER: this function needs to write to student_subscriptions
-- and payment_history which are RLS-protected. It is only called from the
-- server (Next.js API route with service_role key). Granted to service_role only.
CREATE OR REPLACE FUNCTION public.create_pending_subscription(
  p_auth_user_id           uuid,
  p_email                  text,
  p_plan_code              text,
  p_billing_cycle          text,
  p_razorpay_subscription_id text,
  p_razorpay_plan_id       text,
  p_amount_inr             integer
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_student_id uuid;
  v_plan_id    uuid;
  v_existing_sub_id text;
BEGIN
  IF p_plan_code IS NULL OR p_plan_code = '' OR p_plan_code = 'free' THEN
    RAISE EXCEPTION 'Invalid plan_code for pending subscription: %', p_plan_code;
  END IF;

  IF p_razorpay_subscription_id IS NULL OR p_razorpay_subscription_id = '' THEN
    RAISE EXCEPTION 'razorpay_subscription_id is required';
  END IF;

  -- (a) Resolve student_id: auth_user_id first, email fallback (mirrors verify route).
  SELECT id INTO v_student_id
    FROM students
    WHERE auth_user_id = p_auth_user_id
    LIMIT 1;

  IF v_student_id IS NULL AND p_email IS NOT NULL AND p_email <> '' THEN
    SELECT id INTO v_student_id
      FROM students
      WHERE email = p_email
      ORDER BY created_at DESC
      LIMIT 1;

    IF v_student_id IS NOT NULL THEN
      -- Heal stale auth_user_id so future lookups use the fast path.
      UPDATE students SET auth_user_id = p_auth_user_id WHERE id = v_student_id;
    END IF;
  END IF;

  IF v_student_id IS NULL THEN
    RAISE EXCEPTION 'Student not found for auth_user_id % (email fallback also failed)', p_auth_user_id;
  END IF;

  -- Resolve plan_id (canonical plan_code must already have been applied by caller).
  SELECT id INTO v_plan_id FROM subscription_plans WHERE plan_code = p_plan_code LIMIT 1;
  IF v_plan_id IS NULL THEN
    RAISE EXCEPTION 'Plan not found: %', p_plan_code;
  END IF;

  -- (b) If this student has an existing pending row with a DIFFERENT sub_id,
  -- null out the stale sub_id so the unique index doesn't block our upsert
  -- and the new sub_id can be claimed. We only clear when status='pending'
  -- to avoid clobbering active/cancelled subscriptions.
  SELECT razorpay_subscription_id INTO v_existing_sub_id
    FROM student_subscriptions
    WHERE student_id = v_student_id
    LIMIT 1;

  IF v_existing_sub_id IS NOT NULL
     AND v_existing_sub_id <> p_razorpay_subscription_id
  THEN
    UPDATE student_subscriptions
       SET razorpay_subscription_id = NULL,
           updated_at = now()
     WHERE student_id = v_student_id
       AND status = 'pending'
       AND razorpay_subscription_id = v_existing_sub_id;
  END IF;

  -- (c) Record a pending payment_history row. amount stored in rupees (INR).
  -- Currency is explicitly 'INR' per payment library contract.
  INSERT INTO payment_history (
    student_id,
    plan_code,
    billing_cycle,
    currency,
    amount,
    status,
    payment_method,
    notes
  ) VALUES (
    v_student_id,
    p_plan_code,
    p_billing_cycle,
    'INR',
    p_amount_inr,
    'pending',
    'razorpay',
    jsonb_build_object(
      'source',                    'subscribe',
      'razorpay_subscription_id',  p_razorpay_subscription_id,
      'razorpay_plan_id',          p_razorpay_plan_id
    )
  );

  -- (d) Upsert student_subscriptions to pending.
  -- Keep ON CONFLICT (student_id) — per architect C1, NOT on razorpay_subscription_id.
  INSERT INTO student_subscriptions (
    student_id, plan_id, plan_code, status, billing_cycle,
    razorpay_subscription_id, razorpay_plan_id, auto_renew
  ) VALUES (
    v_student_id, v_plan_id, p_plan_code, 'pending', p_billing_cycle,
    p_razorpay_subscription_id, p_razorpay_plan_id, true
  )
  ON CONFLICT (student_id) DO UPDATE SET
    plan_id                   = v_plan_id,
    plan_code                 = p_plan_code,
    status                    = 'pending',
    billing_cycle             = p_billing_cycle,
    razorpay_subscription_id  = p_razorpay_subscription_id,
    razorpay_plan_id          = p_razorpay_plan_id,
    auto_renew                = true,
    updated_at                = now();

  RETURN v_student_id;
END;
$function$;

COMMENT ON FUNCTION public.create_pending_subscription IS
  'Atomic pending-row writer for subscribe route. Writes payment_history + student_subscriptions in one txn. Server-only (service_role).';

-- Revoke from public, then grant narrowly.
REVOKE ALL ON FUNCTION public.create_pending_subscription(uuid, text, text, text, text, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_pending_subscription(uuid, text, text, text, text, text, integer) FROM anon;
REVOKE ALL ON FUNCTION public.create_pending_subscription(uuid, text, text, text, text, text, integer) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.create_pending_subscription(uuid, text, text, text, text, text, integer) TO service_role;

-- ────────────────────────────────────────────────────────────
-- C6: Feature flag seed — reconcile_stuck_subscriptions_enabled
-- ────────────────────────────────────────────────────────────
-- Default: false. Ops flips to true via super-admin console to enable the
-- reconcile job (Edge Function action `reconcile_stuck_subscriptions`).
-- Idempotent: existence check, no ON CONFLICT (flag_name has no UNIQUE).
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM feature_flags WHERE flag_name = 'reconcile_stuck_subscriptions_enabled'
  ) THEN
    INSERT INTO feature_flags (flag_name, is_enabled, description)
    VALUES (
      'reconcile_stuck_subscriptions_enabled',
      false,
      'When true, the payments Edge Function reconcile_stuck_subscriptions action sweeps Razorpay subscriptions and backfills missing student_subscriptions rows. Off by default; flip on only after ops has verified drift metrics.'
    );
  END IF;
END $$;

COMMIT;
