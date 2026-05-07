-- Migration: 20260507140000_payment_reconciliation_queue.sql
-- Purpose: Capture offline school payments (PO / bank transfer / cheque /
--          UPI offline) so they can be approved by a second super-admin and
--          atomically applied to the linked school_invoices + school_
--          subscriptions rows. Phase 3-B of the May 2026 upgrade.
--
-- Context: Phase 2-C ships card-pay self-service for schools (Razorpay
--          subscriptions). Phase 3-A adds GST-compliant invoice PDFs.
--          Some schools (govt-aided, large chains) cannot pay by card and
--          require a PO / bank transfer flow with paper receipts. P3-B
--          gives the CS team a queue UI: submit the receipt, second admin
--          approves, system marks the invoice paid and extends the school's
--          subscription period.
--
-- Two-person rule: the same admin cannot both submit and approve. Enforced
-- at the row level via CHECK; defense-in-depth in the API route.
--
-- DOWN (manual):
--   DROP TABLE public.payment_reconciliation_queue;
--   DELETE FROM storage.buckets WHERE id = 'payment-receipts';

BEGIN;

-- ── 1. Table ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.payment_reconciliation_queue (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id            uuid        NOT NULL REFERENCES public.school_invoices(id) ON DELETE RESTRICT,
  school_id             uuid        NOT NULL REFERENCES public.schools(id) ON DELETE RESTRICT,

  expected_amount_inr   numeric(12,2) NOT NULL,
  received_amount_inr   numeric(12,2) NOT NULL,
  payment_method        text        NOT NULL,
  reference_number      text        NOT NULL,    -- UTR / cheque number / PO number
  receipt_document_url  text,                    -- private storage path

  submitted_by_user_id  uuid        NOT NULL,    -- references auth.users implicitly
  submitted_at          timestamptz NOT NULL DEFAULT now(),

  approved_by_user_id   uuid,
  approved_at           timestamptz,

  rejected_by_user_id   uuid,
  rejected_at           timestamptz,
  rejection_reason      text,

  status                text        NOT NULL DEFAULT 'pending',

  notes                 text,

  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT prq_status_valid CHECK (status IN ('pending','approved','reconciled','rejected')),
  CONSTRAINT prq_method_valid CHECK (payment_method IN ('po','bank_transfer','cheque','upi_offline')),
  CONSTRAINT prq_amounts_positive CHECK (expected_amount_inr > 0 AND received_amount_inr > 0),
  -- Two-person rule: same user cannot submit and approve the same row.
  CONSTRAINT prq_two_person_rule CHECK (
    approved_by_user_id IS NULL
    OR submitted_by_user_id <> approved_by_user_id
  ),
  -- Approval timestamp consistency
  CONSTRAINT prq_approved_pair CHECK (
    (approved_by_user_id IS NULL AND approved_at IS NULL)
    OR (approved_by_user_id IS NOT NULL AND approved_at IS NOT NULL)
  ),
  -- Rejection timestamp consistency
  CONSTRAINT prq_rejected_pair CHECK (
    (rejected_by_user_id IS NULL AND rejected_at IS NULL)
    OR (rejected_by_user_id IS NOT NULL AND rejected_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS prq_invoice_id_idx       ON public.payment_reconciliation_queue (invoice_id);
CREATE INDEX IF NOT EXISTS prq_school_id_idx        ON public.payment_reconciliation_queue (school_id);
CREATE INDEX IF NOT EXISTS prq_status_submitted_idx ON public.payment_reconciliation_queue (status, submitted_at DESC);

-- One pending reconciliation per invoice — prevents two CS admins from
-- racing on the same invoice.
CREATE UNIQUE INDEX IF NOT EXISTS prq_unique_pending_per_invoice
  ON public.payment_reconciliation_queue (invoice_id)
  WHERE status = 'pending';

-- ── 2. RLS — super-admin only via service_role ────────────────────────────

ALTER TABLE public.payment_reconciliation_queue ENABLE ROW LEVEL SECURITY;

-- No policies for authenticated/anon roles. service_role bypasses RLS;
-- super-admin API routes use service_role via authorizeAdmin -> getSupabaseAdmin.
-- School admins must NOT see this table — offline reconciliation is an
-- internal CS workflow, not a school-facing surface.

COMMENT ON TABLE public.payment_reconciliation_queue IS
  'Offline payment receipts (PO / bank / cheque / offline UPI) submitted by '
  'one super-admin and approved by a second. On approval, reconcile_payment() '
  'RPC marks the invoice paid and extends the school_subscription period. '
  'CS internal queue — NOT exposed to school admins. Phase 3-B.';

-- ── 3. Storage bucket for receipt documents ──────────────────────────────

INSERT INTO storage.buckets (id, name, public)
VALUES ('payment-receipts', 'payment-receipts', false)
ON CONFLICT (id) DO NOTHING;

-- service_role-only access; receipts read via signed URL minted by the
-- super-admin reconciliation routes.

-- ── 4. updated_at trigger ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.prq_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS prq_updated_at_trg ON public.payment_reconciliation_queue;
CREATE TRIGGER prq_updated_at_trg
  BEFORE UPDATE ON public.payment_reconciliation_queue
  FOR EACH ROW EXECUTE FUNCTION public.prq_set_updated_at();

COMMIT;
