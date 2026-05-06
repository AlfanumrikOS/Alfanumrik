-- Migration: 20260507000003_atomic_school_plan_change_rpc.sql
-- Purpose: Add atomic_school_plan_change RPC. Mirrors the student-side
--          atomic_plan_change RPC (_legacy/timestamped/20260427000002_atomic_plan_change_rpc.sql)
--          but for school_subscriptions. Closes the same P11 split-brain
--          class on the school billing path that PR #549/#555 left open
--          (PATCH on /api/school-admin/subscription updates the DB row
--          directly with two non-locked statements).
--
-- Atomicity guarantee:
--   - Single transaction (function body)
--   - pg_advisory_xact_lock keyed by 'school_subscription:' || school_id::text
--     so concurrent admin PATCH and Razorpay-webhook events for the same
--     school serialise.
--   - SECURITY DEFINER, search_path locked, service_role-only EXECUTE.
--
-- What this RPC does NOT do:
--   - Does not call Razorpay. The route layer handles Razorpay coordination
--     (see /api/school-admin/subscription PATCH for the policy: seat-only
--     changes call POST /subscriptions/{id}/update with the new quantity;
--     plan swaps are DB-only with a documented note since Razorpay does
--     not support atomic plan_id change on a running subscription).
--
-- Plan code allowlist:
--   Re-validates p_new_plan against subscription_plans.plan_code.
--   'free' is rejected for schools (free is a B2C plan only).
--   Accepted: 'starter', 'pro', 'unlimited' (validated via DB lookup,
--   not a hard-coded constant — keeps source of truth next to the data).

BEGIN;

CREATE OR REPLACE FUNCTION public.atomic_school_plan_change(
  p_school_id   uuid,
  p_new_plan    text DEFAULT NULL,
  p_new_seats   integer DEFAULT NULL,
  p_reason      text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_canonical_plan   text;
  v_plan_id          uuid;
  v_old_plan         text;
  v_old_seats        integer;
  v_old_billing      text;
  v_seats_active     integer;
  v_now              timestamptz := now();
BEGIN
  -- ── 1. Argument validation ─────────────────────────────────────────
  IF p_school_id IS NULL THEN
    RAISE EXCEPTION 'p_school_id is required' USING ERRCODE = '22023';
  END IF;
  IF p_new_plan IS NULL AND p_new_seats IS NULL THEN
    RAISE EXCEPTION 'must provide p_new_plan or p_new_seats' USING ERRCODE = '22023';
  END IF;
  IF p_new_seats IS NOT NULL AND (p_new_seats < 1 OR p_new_seats > 5000) THEN
    RAISE EXCEPTION 'p_new_seats must be 1..5000 (got %)', p_new_seats USING ERRCODE = '22023';
  END IF;

  -- ── 2. Canonicalize plan_code (mirrors the student-side RPC) ───────
  IF p_new_plan IS NOT NULL THEN
    v_canonical_plan := p_new_plan;
    v_canonical_plan := regexp_replace(v_canonical_plan, '_(monthly|yearly)$', '');
    IF v_canonical_plan = 'ultimate' THEN v_canonical_plan := 'unlimited'; END IF;
    IF v_canonical_plan = 'basic'    THEN v_canonical_plan := 'starter';   END IF;
    IF v_canonical_plan = 'premium'  THEN v_canonical_plan := 'pro';       END IF;

    -- 'free' is rejected for schools (B2C-only plan).
    IF v_canonical_plan = 'free' THEN
      RAISE EXCEPTION 'free plan is not valid for schools' USING ERRCODE = '22023';
    END IF;

    -- Validate against subscription_plans
    SELECT id INTO v_plan_id
      FROM subscription_plans
     WHERE plan_code = v_canonical_plan
       AND is_active = true
     LIMIT 1;
    IF v_plan_id IS NULL THEN
      RAISE EXCEPTION 'Plan not found or inactive in subscription_plans: % (input %)',
        v_canonical_plan, p_new_plan USING ERRCODE = '22023';
    END IF;
  END IF;

  -- ── 3. Per-school advisory lock ────────────────────────────────────
  -- Different namespace from the student lock so a school PATCH does
  -- NOT block a concurrent student plan-change (different rows entirely).
  PERFORM pg_advisory_xact_lock(
    hashtextextended('school_subscription:' || p_school_id::text, 0)
  );

  -- ── 4. Capture prior state under FOR UPDATE ────────────────────────
  SELECT plan, seats_purchased, billing_cycle
    INTO v_old_plan, v_old_seats, v_old_billing
    FROM school_subscriptions
   WHERE school_id = p_school_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No subscription for school_id %', p_school_id USING ERRCODE = 'P0002';
  END IF;

  -- ── 5. Seat-cap server-side guard ──────────────────────────────────
  -- The route already checks this, but a service-role caller (cron, ops
  -- script) could reach the RPC directly. Match the canonical definition
  -- used everywhere else: COUNT(students WHERE school_id = X AND is_active = true).
  IF p_new_seats IS NOT NULL THEN
    SELECT COUNT(*) INTO v_seats_active
      FROM students
     WHERE school_id = p_school_id
       AND is_active = true;

    IF p_new_seats < v_seats_active THEN
      RAISE EXCEPTION 'Cannot reduce seats to % below active student count %',
        p_new_seats, v_seats_active USING ERRCODE = '22023';
    END IF;
  END IF;

  -- ── 6. Single-transaction update ───────────────────────────────────
  UPDATE school_subscriptions
     SET plan            = COALESCE(v_canonical_plan, plan),
         seats_purchased = COALESCE(p_new_seats, seats_purchased),
         updated_at      = v_now
   WHERE school_id = p_school_id;

  -- ── 7. Audit trail via domain_events outbox (best-effort) ──────────
  BEGIN
    PERFORM public.enqueue_event(
      'school_subscription.plan_changed',
      'school',
      p_school_id,
      jsonb_build_object(
        'school_id',     p_school_id,
        'old_plan',      v_old_plan,
        'new_plan',      v_canonical_plan,
        'old_seats',     v_old_seats,
        'new_seats',     p_new_seats,
        'billing_cycle', v_old_billing,
        'reason',        p_reason,
        'changed_at',    v_now,
        'source',        'atomic_school_plan_change_rpc'
      )
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'atomic_school_plan_change: enqueue_event failed (% / %), continuing',
      SQLERRM, SQLSTATE;
  END;

  RETURN jsonb_build_object(
    'success',       true,
    'school_id',     p_school_id,
    'old_plan',      v_old_plan,
    'new_plan',      v_canonical_plan,
    'old_seats',     v_old_seats,
    'new_seats',     p_new_seats,
    'billing_cycle', v_old_billing,
    'reason',        p_reason,
    'changed_at',    v_now
  );
END;
$function$;

COMMENT ON FUNCTION public.atomic_school_plan_change(uuid, text, integer, text) IS
  'Atomic school subscription plan/seat change. Updates school_subscriptions in a single transaction guarded by pg_advisory_xact_lock(''school_subscription:''||school_id). Mirrors student-side atomic_plan_change for the school billing path (PR #549/#555). service_role-only EXECUTE; route layer handles Razorpay coordination separately.';

REVOKE EXECUTE ON FUNCTION public.atomic_school_plan_change(uuid, text, integer, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.atomic_school_plan_change(uuid, text, integer, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.atomic_school_plan_change(uuid, text, integer, text) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.atomic_school_plan_change(uuid, text, integer, text) TO service_role;

COMMIT;
