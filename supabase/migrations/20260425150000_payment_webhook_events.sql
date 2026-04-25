-- Migration: 20260425150000_payment_webhook_events.sql
-- Purpose: Event-level idempotency for the Razorpay webhook handler.
--
-- Why this exists:
--   The webhook route currently dedupes via payment_history.razorpay_payment_id.
--   That works for payment.captured / payment.failed but NOT for re-fired
--   subscription.cancelled / subscription.pending / subscription.expired
--   events that carry no payment entity. A re-fire could double-process
--   downgrades or status flips.
--
--   This table records every webhook event by its Razorpay-assigned
--   account_id + event_id. The route inserts on receipt; ON CONFLICT
--   means duplicate → ACK and skip. Race-safe by relying on the unique
--   constraint, not a SELECT-then-INSERT.
--
-- Safety:
--   - CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS
--   - RLS enabled, service-role-only access (matches domain_events pattern)
--   - SECURITY DEFINER RPC pinned to search_path = public

BEGIN;

CREATE TABLE IF NOT EXISTS public.payment_webhook_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  razorpay_account_id text NOT NULL,
  razorpay_event_id   text NOT NULL,
  event_type      text NOT NULL,
  raw_payload     jsonb NOT NULL DEFAULT '{}'::jsonb,
  received_at     timestamptz NOT NULL DEFAULT now(),
  processed_at    timestamptz,
  outcome         text CHECK (outcome IN ('ack','dedupe','activated','downgraded','failed','unresolved') OR outcome IS NULL),
  CONSTRAINT payment_webhook_events_unique_event UNIQUE (razorpay_account_id, razorpay_event_id)
);

COMMENT ON TABLE public.payment_webhook_events IS
  'Event-level idempotency for Razorpay webhook. Unique on (account_id, event_id); ON CONFLICT means duplicate event delivery.';

CREATE INDEX IF NOT EXISTS idx_payment_webhook_events_received
  ON public.payment_webhook_events (received_at DESC);

CREATE INDEX IF NOT EXISTS idx_payment_webhook_events_event_type
  ON public.payment_webhook_events (event_type, received_at DESC);

ALTER TABLE public.payment_webhook_events ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.payment_webhook_events TO service_role;
REVOKE ALL ON public.payment_webhook_events FROM authenticated;
REVOKE ALL ON public.payment_webhook_events FROM anon;

-- RPC: insert and return is_new=true; on conflict return is_new=false.
CREATE OR REPLACE FUNCTION public.record_webhook_event(
  p_account_id text,
  p_event_id   text,
  p_event_type text,
  p_raw_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS TABLE(is_new boolean, id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_account_id IS NULL OR length(p_account_id) = 0 THEN
    RAISE EXCEPTION 'account_id required';
  END IF;
  IF p_event_id IS NULL OR length(p_event_id) = 0 THEN
    RAISE EXCEPTION 'event_id required';
  END IF;

  INSERT INTO public.payment_webhook_events (razorpay_account_id, razorpay_event_id, event_type, raw_payload)
  VALUES (p_account_id, p_event_id, p_event_type, COALESCE(p_raw_payload, '{}'::jsonb))
  ON CONFLICT (razorpay_account_id, razorpay_event_id) DO NOTHING
  RETURNING payment_webhook_events.id INTO v_id;

  IF v_id IS NULL THEN
    -- Conflict path: fetch existing row id, return is_new=false.
    SELECT pwe.id INTO v_id
    FROM public.payment_webhook_events pwe
    WHERE pwe.razorpay_account_id = p_account_id
      AND pwe.razorpay_event_id = p_event_id;
    RETURN QUERY SELECT false AS is_new, v_id AS id;
  ELSE
    RETURN QUERY SELECT true AS is_new, v_id AS id;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.record_webhook_event(text, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_webhook_event(text, text, text, jsonb) TO service_role;

-- RPC: mark a webhook event as processed with outcome.
CREATE OR REPLACE FUNCTION public.mark_webhook_event_processed(
  p_id uuid,
  p_outcome text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_outcome NOT IN ('ack','dedupe','activated','downgraded','failed','unresolved') THEN
    RAISE EXCEPTION 'invalid outcome: %', p_outcome;
  END IF;
  UPDATE public.payment_webhook_events
  SET processed_at = now(), outcome = p_outcome
  WHERE id = p_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.mark_webhook_event_processed(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_webhook_event_processed(uuid, text) TO service_role;

COMMIT;
