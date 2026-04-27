-- Migration: 20260427000002_atomic_plan_change_rpc.sql
-- Purpose: Add atomic_plan_change RPC to close the P11 split-brain class
--          bug re-introduced by the super-admin bulk plan-change route.
--
-- Audit finding closed:
--   Red #3: src/app/api/super-admin/bulk-actions/plan-change/route.ts:69-94
--   performs two non-atomic UPDATEs:
--     1) UPDATE students SET subscription_plan = ...
--     2) UPDATE student_subscriptions SET plan_code = ...
--   If the second UPDATE fails (network blip, RLS denial, deadlock), the
--   two tables disagree — exactly the split-brain state P11 forbids and
--   that atomic_subscription_activation closed for the webhook path.
--
--   This RPC consolidates both writes into a single transaction guarded
--   by a per-student advisory lock so concurrent admin actions and
--   payment-webhook events cannot interleave.
--
-- Source of truth (style + lock pattern):
--   supabase/migrations/20260424120000_atomic_subscription_activation_rpc.sql
--   supabase/migrations/20260425150300_activate_with_advisory_lock.sql
--   supabase/migrations/20260425150200_atomic_downgrade_subscription_rpc.sql
--
-- Plan code allowlist:
--   The Next.js route already validates against a constant array
--   (VALID_PLANS in plan-change/route.ts). We re-validate at the DB layer
--   against subscription_plans.plan_code so that:
--     a) any direct service-role caller (cron, ops scripts) cannot bypass
--        the allowlist;
--     b) the RPC is self-contained and the validation source of truth
--        lives next to the data (subscription_plans table).
--
-- Safety:
--   - CREATE OR REPLACE FUNCTION: idempotent
--   - SECURITY DEFINER + SET search_path = public, pg_temp
--   - pg_advisory_xact_lock keyed by 'subscription:' || student_id::text
--     (same key shape as activate_subscription_locked) so the same lock
--     namespace serializes against the webhook
--   - Single transaction (function body) covers both UPDATEs
--   - service_role-only EXECUTE; authenticated/anon revoked
--   - No DROP / no ALTER on existing tables
--
-- Note on canonicalization:
--   The route has fragile string munging that maps display plan codes
--   ('basic' -> 'starter', 'premium' -> 'pro', strips '_monthly'/'_yearly')
--   for the student_subscriptions.plan_code sync. We replicate that
--   contract in the RPC so behavior matches the existing (buggy) path
--   exactly except for atomicity. If/when the canonicalization needs to
--   change, update both call sites.

BEGIN;

CREATE OR REPLACE FUNCTION public.atomic_plan_change(
  p_student_id uuid,
  p_new_plan   text,
  p_reason     text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_canonical_plan text;
  v_plan_id        uuid;
  v_old_student_plan text;
  v_old_sub_plan     text;
  v_now            timestamptz := now();
BEGIN
  -- ── 1. Argument validation ─────────────────────────────────────────
  IF p_student_id IS NULL THEN
    RAISE EXCEPTION 'p_student_id is required' USING ERRCODE = '22023';
  END IF;
  IF p_new_plan IS NULL OR length(p_new_plan) = 0 THEN
    RAISE EXCEPTION 'p_new_plan is required' USING ERRCODE = '22023';
  END IF;

  -- ── 2. Canonicalize plan_code for student_subscriptions ────────────
  -- Mirrors the route-level transform in
  -- src/app/api/super-admin/bulk-actions/plan-change/route.ts:84-89.
  v_canonical_plan := p_new_plan;
  v_canonical_plan := regexp_replace(v_canonical_plan, '_(monthly|yearly)$', '');
  IF v_canonical_plan = 'ultimate' THEN v_canonical_plan := 'unlimited'; END IF;
  IF v_canonical_plan = 'basic'    THEN v_canonical_plan := 'starter';   END IF;
  IF v_canonical_plan = 'premium'  THEN v_canonical_plan := 'pro';       END IF;

  -- ── 3. Validate canonical plan against subscription_plans ──────────
  -- 'free' is always allowed (no row required in subscription_plans).
  IF v_canonical_plan <> 'free' THEN
    SELECT id INTO v_plan_id
      FROM subscription_plans
     WHERE plan_code = v_canonical_plan
     LIMIT 1;
    IF v_plan_id IS NULL THEN
      RAISE EXCEPTION 'Plan not found in subscription_plans: % (input %)', v_canonical_plan, p_new_plan
        USING ERRCODE = '22023';
    END IF;
  END IF;

  -- ── 4. Per-student advisory lock ───────────────────────────────────
  -- Same key namespace as activate_subscription_locked /
  -- atomic_subscription_activation_locked so this RPC serializes against
  -- the payment webhook for the same student.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('subscription:' || p_student_id::text, 0)
  );

  -- ── 5. Capture prior state (for audit + return shape) ──────────────
  SELECT subscription_plan INTO v_old_student_plan
    FROM students
   WHERE id = p_student_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Student not found: %', p_student_id USING ERRCODE = 'P0002';
  END IF;

  SELECT plan_code INTO v_old_sub_plan
    FROM student_subscriptions
   WHERE student_id = p_student_id
   FOR UPDATE;
  -- v_old_sub_plan may be NULL if the student has no student_subscriptions
  -- row yet; that is acceptable, the UPDATE below will simply affect 0 rows.

  -- ── 6. Single-transaction dual write ───────────────────────────────
  UPDATE students
     SET subscription_plan = p_new_plan,
         updated_at = v_now
   WHERE id = p_student_id;

  UPDATE student_subscriptions
     SET plan_code  = v_canonical_plan,
         plan_id    = COALESCE(v_plan_id, plan_id),
         updated_at = v_now
   WHERE student_id = p_student_id;

  -- ── 7. Audit trail via domain_events outbox ────────────────────────
  -- Best-effort: if domain_events / enqueue_event are missing, swallow
  -- the failure rather than block the plan change. The split-brain
  -- prevention is the primary guarantee; the audit is secondary.
  BEGIN
    PERFORM public.enqueue_event(
      'subscription.plan_changed',
      'student',
      p_student_id,
      jsonb_build_object(
        'student_id',         p_student_id,
        'old_student_plan',   v_old_student_plan,
        'old_sub_plan_code',  v_old_sub_plan,
        'new_plan',           p_new_plan,
        'new_sub_plan_code',  v_canonical_plan,
        'reason',             p_reason,
        'changed_at',         v_now,
        'source',             'atomic_plan_change_rpc'
      )
    );
  EXCEPTION WHEN OTHERS THEN
    -- Domain event publishing is non-fatal here.
    RAISE NOTICE 'atomic_plan_change: enqueue_event failed (% / %), continuing', SQLERRM, SQLSTATE;
  END;

  RETURN jsonb_build_object(
    'success',           true,
    'student_id',        p_student_id,
    'old_student_plan',  v_old_student_plan,
    'old_sub_plan_code', v_old_sub_plan,
    'new_plan',          p_new_plan,
    'new_sub_plan_code', v_canonical_plan,
    'reason',            p_reason,
    'changed_at',        v_now
  );
END;
$function$;

COMMENT ON FUNCTION public.atomic_plan_change(uuid, text, text) IS
  'Atomic admin plan change. Updates students.subscription_plan AND student_subscriptions.plan_code in a single transaction guarded by pg_advisory_xact_lock(''subscription:''||student_id). Closes the P11 split-brain class bug re-introduced by the super-admin bulk-actions/plan-change route. service_role-only EXECUTE.';

REVOKE EXECUTE ON FUNCTION public.atomic_plan_change(uuid, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.atomic_plan_change(uuid, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.atomic_plan_change(uuid, text, text) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.atomic_plan_change(uuid, text, text) TO service_role;

COMMIT;
