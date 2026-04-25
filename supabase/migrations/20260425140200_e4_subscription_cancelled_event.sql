-- Migration: 20260425140200_e4_subscription_cancelled_event.sql
-- Phase 0g wiring (Wave 2) — emits E4 subscription.cancelled when a
-- student_subscriptions row transitions to a terminal-end status.
--
-- Per docs/architecture/EVENT_CATALOG.md:
--   E4 subscription.cancelled → fires on UPDATE when status transitions
--                                to one of: cancelled / expired / completed.
--
-- The plan groups all three terminal states under E4 because consumers
-- (notifications, parent dashboard, churn analytics) treat them
-- identically: the student no longer has paid access from this date.
--
-- Anchor: AFTER UPDATE on student_subscriptions WHERE OLD.status was
-- active/past_due/halted/pending and NEW.status is cancelled/expired/completed.
-- We compare OLD vs NEW so re-runs of the same status (idempotent webhook
-- replays) do not re-emit the event.

BEGIN;

CREATE OR REPLACE FUNCTION public.tg_emit_subscription_cancelled()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_terminal_states text[] := ARRAY['cancelled', 'expired', 'completed'];
BEGIN
  -- Only fire on actual transition INTO a terminal state.
  IF NEW.status IS NULL OR NOT (NEW.status = ANY(v_terminal_states)) THEN
    RETURN NEW;
  END IF;
  IF OLD.status IS NOT NULL AND OLD.status = ANY(v_terminal_states) THEN
    -- Already terminal — webhook replay or idempotent re-process.
    RETURN NEW;
  END IF;

  PERFORM public.enqueue_event(
    'subscription.cancelled',
    'student_subscription',
    NEW.id,
    jsonb_build_object(
      'subscription_id', NEW.id,
      'student_id', NEW.student_id,
      'plan_code', NEW.plan_code,
      'previous_status', OLD.status,
      'new_status', NEW.status,
      'cancelled_at', COALESCE(NEW.cancelled_at, NEW.updated_at),
      'cancel_reason', NEW.cancel_reason,
      'razorpay_subscription_id', NEW.razorpay_subscription_id
    )
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- P11: subscription state UPDATEs must NOT be blocked by outbox failure.
  RAISE WARNING 'enqueue_event failed for student_subscriptions %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_subscription_cancelled ON public.student_subscriptions;
CREATE TRIGGER trg_subscription_cancelled
AFTER UPDATE ON public.student_subscriptions
FOR EACH ROW
WHEN (OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION public.tg_emit_subscription_cancelled();

REVOKE EXECUTE ON FUNCTION public.tg_emit_subscription_cancelled() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tg_emit_subscription_cancelled() TO service_role;

COMMENT ON FUNCTION public.tg_emit_subscription_cancelled() IS
  'Emits E4 subscription.cancelled when student_subscriptions transitions into a terminal status (cancelled/expired/completed). Non-blocking: outbox failure cannot roll back webhook UPDATE (P11). Idempotent replays do not re-emit.';

COMMIT;
