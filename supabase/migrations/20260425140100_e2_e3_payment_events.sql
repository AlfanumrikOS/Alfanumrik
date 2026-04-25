-- Migration: 20260425140100_e2_e3_payment_events.sql
-- Phase 0g wiring (Wave 2) — emits E2 payment.completed and E3
-- payment.failed from the payment_history table.
--
-- Per docs/architecture/EVENT_CATALOG.md:
--   E2 payment.completed → fires when payment_history row is inserted
--                          with status = 'captured'.
--   E3 payment.failed    → fires when payment_history row is inserted
--                          with status = 'failed' or status = 'refunded'.
--
-- The webhook route (src/app/api/payments/webhook/route.ts) is the sole
-- inserter into payment_history (P11). We anchor the trigger here rather
-- than in route code so:
--   1. The event is emitted by the database, not by Next.js — surviving
--      any process crash between INSERT and emit.
--   2. The RLS-protected webhook handler doesn't need additional logic;
--      this is a pure schema concern.
--   3. EXCEPTION-WHEN-OTHERS keeps the originating INSERT non-blocking
--      (P11: never break payment recording).

BEGIN;

CREATE OR REPLACE FUNCTION public.tg_emit_payment_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_type text;
BEGIN
  v_event_type := CASE
    WHEN NEW.status = 'captured'  THEN 'payment.completed'
    WHEN NEW.status = 'failed'    THEN 'payment.failed'
    WHEN NEW.status = 'refunded'  THEN 'payment.failed'  -- treat refund as failure for downstream consumers
    ELSE NULL
  END;

  -- Skip non-terminal statuses (pending, processing, etc.). Consumers
  -- only care about settled outcomes.
  IF v_event_type IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM public.enqueue_event(
    v_event_type,
    'payment',
    NEW.id,
    jsonb_build_object(
      'payment_history_id', NEW.id,
      'student_id', NEW.student_id,
      'razorpay_payment_id', NEW.razorpay_payment_id,
      'razorpay_order_id', NEW.razorpay_order_id,
      'plan_code', NEW.plan_code,
      'billing_cycle', NEW.billing_cycle,
      'amount', NEW.amount,
      'currency', COALESCE(NEW.currency, 'INR'),
      'status', NEW.status,
      'created_at', NEW.created_at
    )
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- P11: payment recording must NOT be blocked by outbox failure.
  RAISE WARNING 'enqueue_event failed for payment_history %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_payment_event ON public.payment_history;
CREATE TRIGGER trg_payment_event
AFTER INSERT ON public.payment_history
FOR EACH ROW
EXECUTE FUNCTION public.tg_emit_payment_event();

REVOKE EXECUTE ON FUNCTION public.tg_emit_payment_event() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tg_emit_payment_event() TO service_role;

COMMENT ON FUNCTION public.tg_emit_payment_event() IS
  'Emits E2 payment.completed (status=captured) or E3 payment.failed (status=failed/refunded) when a payment_history row is inserted. Non-blocking: outbox failure cannot roll back the webhook payment INSERT (P11).';

COMMIT;
