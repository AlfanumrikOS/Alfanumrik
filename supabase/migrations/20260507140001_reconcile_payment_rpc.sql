-- Migration: 20260507140001_reconcile_payment_rpc.sql
-- Purpose: Atomic application of an approved offline payment to the linked
--          school_invoices + school_subscriptions rows. Phase 3-B.
--
-- Atomicity guarantee:
--   - Single transaction (function body)
--   - pg_advisory_xact_lock keyed by 'school_subscription:' || school_id::text
--     so concurrent webhook events (online subscription charges) and
--     reconciliation approvals for the same school serialise. Same lock
--     pattern as atomic_school_plan_change (PR #555 / 20260507000003).
--   - SECURITY DEFINER, search_path locked, service_role-only EXECUTE.
--
-- What this RPC does:
--   1. Lock and re-read the reconciliation row; require status = 'approved'.
--      (The /approve API route flips status from 'pending' -> 'approved'
--       before calling this RPC.)
--   2. Defense-in-depth: re-check submitted_by_user_id != approved_by_user_id.
--   3. Lock and re-read the linked invoice; require status NOT IN ('paid','cancelled').
--   4. Update invoice: status = 'paid', updated_at = now(). Record the
--      reconciliation reference on the row for traceability.
--   5. Extend the school_subscription period by the appropriate cycle
--      (monthly +1 month / quarterly +3 months / yearly +1 year). If
--      current_period_end is in the past or NULL, base on now().
--      Status flipped to 'active' if it was 'past_due' or 'cancelled' (which
--      can happen if the school previously lapsed and is now paying for
--      reinstatement).
--   6. Mark reconciliation row status = 'reconciled'.
--
-- DOWN (manual):
--   DROP FUNCTION public.reconcile_payment(uuid);

BEGIN;

CREATE OR REPLACE FUNCTION public.reconcile_payment(
  p_reconciliation_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_recon            public.payment_reconciliation_queue%ROWTYPE;
  v_invoice_status   text;
  v_invoice_amount   numeric;
  v_school_id        uuid;
  v_lock             bigint;
  v_billing_cycle    text;
  v_old_period_end   timestamptz;
  v_new_period_end   timestamptz;
  v_subscription_id  uuid;
  v_now              timestamptz := now();
BEGIN
  -- ── 1. Argument validation ─────────────────────────────────────────────
  IF p_reconciliation_id IS NULL THEN
    RAISE EXCEPTION 'p_reconciliation_id is required' USING ERRCODE = '22023';
  END IF;

  -- ── 2. Lock & read reconciliation row ──────────────────────────────────
  SELECT * INTO v_recon
  FROM public.payment_reconciliation_queue
  WHERE id = p_reconciliation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'reconciliation row % not found', p_reconciliation_id USING ERRCODE = 'P0002';
  END IF;
  IF v_recon.status <> 'approved' THEN
    RAISE EXCEPTION 'reconciliation row % is %, expected approved',
      p_reconciliation_id, v_recon.status USING ERRCODE = '22023';
  END IF;
  IF v_recon.approved_by_user_id IS NULL THEN
    RAISE EXCEPTION 'reconciliation row % has no approver recorded', p_reconciliation_id USING ERRCODE = '22023';
  END IF;
  IF v_recon.submitted_by_user_id = v_recon.approved_by_user_id THEN
    -- Defense in depth — should already be blocked by CHECK constraint.
    RAISE EXCEPTION 'two-person rule violated: submitter % equals approver',
      v_recon.submitted_by_user_id USING ERRCODE = '22023';
  END IF;

  v_school_id := v_recon.school_id;

  -- ── 3. Advisory lock on this school's subscription path ───────────────
  v_lock := ('x' || substr(md5('school_subscription:' || v_school_id::text), 1, 16))::bit(64)::bigint;
  PERFORM pg_advisory_xact_lock(v_lock);

  -- ── 4. Lock & re-read invoice ──────────────────────────────────────────
  SELECT status, amount_inr INTO v_invoice_status, v_invoice_amount
  FROM public.school_invoices
  WHERE id = v_recon.invoice_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invoice % not found', v_recon.invoice_id USING ERRCODE = 'P0002';
  END IF;
  IF v_invoice_status IN ('paid','cancelled') THEN
    RAISE EXCEPTION 'invoice % is %, cannot reconcile',
      v_recon.invoice_id, v_invoice_status USING ERRCODE = '22023';
  END IF;

  -- ── 5. Mark invoice paid ───────────────────────────────────────────────
  UPDATE public.school_invoices
  SET status     = 'paid',
      updated_at = v_now
  WHERE id = v_recon.invoice_id;

  -- ── 6. Find subscription for this school ──────────────────────────────
  SELECT id, billing_cycle, current_period_end
  INTO v_subscription_id, v_billing_cycle, v_old_period_end
  FROM public.school_subscriptions
  WHERE school_id = v_school_id
  ORDER BY created_at DESC NULLS LAST
  LIMIT 1
  FOR UPDATE;

  IF v_subscription_id IS NOT NULL THEN
    -- ── 7. Extend period ────────────────────────────────────────────────
    -- Base = max(current_period_end, now()) so a lapsed school's reinstatement
    -- starts the new term from today, not from a stale past timestamp.
    DECLARE
      v_base timestamptz;
    BEGIN
      v_base := GREATEST(COALESCE(v_old_period_end, v_now), v_now);
      v_new_period_end := CASE
        WHEN v_billing_cycle = 'monthly'   THEN v_base + interval '1 month'
        WHEN v_billing_cycle = 'quarterly' THEN v_base + interval '3 months'
        WHEN v_billing_cycle = 'yearly'    THEN v_base + interval '1 year'
        ELSE v_base + interval '1 month'  -- fallback: monthly
      END;

      UPDATE public.school_subscriptions
      SET current_period_end = v_new_period_end,
          status             = CASE
                                 WHEN status IN ('past_due','cancelled') THEN 'active'
                                 ELSE status
                               END,
          updated_at         = v_now
      WHERE id = v_subscription_id;
    END;
  END IF;

  -- ── 8. Mark reconciliation reconciled ─────────────────────────────────
  UPDATE public.payment_reconciliation_queue
  SET status     = 'reconciled',
      updated_at = v_now
  WHERE id = p_reconciliation_id;

  -- ── 9. Return state for the caller's audit log ───────────────────────
  RETURN jsonb_build_object(
    'reconciliation_id', p_reconciliation_id,
    'invoice_id',        v_recon.invoice_id,
    'school_id',         v_school_id,
    'subscription_id',   v_subscription_id,
    'period_old',        v_old_period_end,
    'period_new',        v_new_period_end,
    'received_amount',   v_recon.received_amount_inr,
    'reconciled_at',     v_now
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.reconcile_payment(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reconcile_payment(uuid) TO service_role;

COMMENT ON FUNCTION public.reconcile_payment(uuid) IS
  'Atomically apply an approved offline payment: marks invoice paid + '
  'extends school_subscription period + marks reconciliation reconciled. '
  'Advisory-locked on school_id, mirrors atomic_school_plan_change pattern. '
  'Service-role only. Phase 3-B.';

COMMIT;
