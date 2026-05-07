-- Migration: 20260507150000_school_contracts.sql
-- Purpose: Capture explicit signed contract documents per school, chained
--          across renewals via previous_contract_id. Phase 3-C of the May
--          2026 upgrade.
--
-- Why a contract row separate from the school_subscriptions / school_invoices
-- rows P2-C and P3-A already create:
--   - Some schools (especially government-aided and large private chains)
--     require an explicit signed contract document for board approval and
--     audit trail, separate from the receipt/invoice.
--   - Renewal automation needs a single artefact to anchor T-minus reminder
--     dates against. Subscriptions roll forward; contracts are explicit.
--
-- Two-row constraint per school: at most one ACTIVE contract at a time.
-- New contracts can exist as 'draft' or 'expiring' alongside an active one.
-- The previous_contract_id field chains renewals chronologically.
--
-- DOWN (manual):
--   DROP TABLE public.school_contracts;
--   DELETE FROM storage.buckets WHERE id = 'school-contracts';

BEGIN;

-- ── 1. Table ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.school_contracts (
  id                          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id                   uuid        NOT NULL REFERENCES public.schools(id) ON DELETE RESTRICT,
  previous_contract_id        uuid        REFERENCES public.school_contracts(id) ON DELETE SET NULL,

  -- Human-readable identifier
  contract_number             text        NOT NULL,

  -- Term
  start_date                  date        NOT NULL,
  end_date                    date        NOT NULL,
  billing_cycle               text        NOT NULL,
  seats_purchased             integer     NOT NULL,
  value_inr                   numeric(12,2) NOT NULL,

  -- Signed PDF storage path (private bucket)
  pdf_url                     text,

  -- Sign metadata
  signed_at                   timestamptz,
  signed_by_school_user_id    uuid,
  signed_by_internal_user_id  uuid,

  -- Status machine
  status                      text        NOT NULL DEFAULT 'draft',

  -- Reminder bookkeeping (idempotent multi-checkpoint sender). Stores the
  -- t_minus integers already sent: e.g. ARRAY[60,30,15] means T-60, T-30
  -- and T-15 emails went out; T-7 / T-1 still pending.
  reminders_sent              integer[]   NOT NULL DEFAULT ARRAY[]::integer[],

  notes                       text,

  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT contracts_status_valid CHECK (status IN ('draft','active','expiring','expired','cancelled','renewed')),
  CONSTRAINT contracts_billing_cycle_valid CHECK (billing_cycle IN ('monthly','quarterly','annual','custom')),
  CONSTRAINT contracts_dates_valid CHECK (end_date > start_date),
  CONSTRAINT contracts_seats_positive CHECK (seats_purchased > 0),
  CONSTRAINT contracts_value_positive CHECK (value_inr > 0),
  -- Sign metadata consistency: signed_at and at least one signer must agree
  CONSTRAINT contracts_signed_consistency CHECK (
    (signed_at IS NULL AND signed_by_school_user_id IS NULL AND signed_by_internal_user_id IS NULL)
    OR (signed_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS contracts_school_id_idx       ON public.school_contracts (school_id);
CREATE INDEX IF NOT EXISTS contracts_status_endd_idx     ON public.school_contracts (status, end_date);
CREATE INDEX IF NOT EXISTS contracts_previous_idx        ON public.school_contracts (previous_contract_id) WHERE previous_contract_id IS NOT NULL;

-- One active contract per school at any time. Allow multiple draft/expiring/
-- expired/cancelled rows (they're history or pending paper).
CREATE UNIQUE INDEX IF NOT EXISTS contracts_unique_active_per_school
  ON public.school_contracts (school_id)
  WHERE status = 'active';

-- ── 2. RLS ────────────────────────────────────────────────────────────────

ALTER TABLE public.school_contracts ENABLE ROW LEVEL SECURITY;

-- Super-admin sees all (service_role bypass; routes use authorizeAdmin).
-- School admin can SELECT their own school's contracts (read-only). Mutations
-- are super-admin-only because contract creation/signing is a CS process.
CREATE POLICY "school_admin_can_read_own_contracts"
  ON public.school_contracts
  FOR SELECT
  TO authenticated
  USING (
    school_id IN (
      SELECT school_id FROM public.school_admins
      WHERE auth_user_id = auth.uid()
    )
  );

-- ── 3. Storage bucket for signed contract PDFs ──────────────────────────

INSERT INTO storage.buckets (id, name, public)
VALUES ('school-contracts', 'school-contracts', false)
ON CONFLICT (id) DO NOTHING;

-- Private; signed URLs minted by API routes for downloads.

-- ── 4. updated_at trigger ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.school_contracts_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS school_contracts_updated_at_trg ON public.school_contracts;
CREATE TRIGGER school_contracts_updated_at_trg
  BEFORE UPDATE ON public.school_contracts
  FOR EACH ROW EXECUTE FUNCTION public.school_contracts_set_updated_at();

COMMENT ON TABLE public.school_contracts IS
  'Explicit signed contract documents per school, chained via previous_'
  'contract_id for renewal history. Distinct from school_subscriptions '
  '(which represents the current Razorpay subscription state) and from '
  'school_invoices (which represents billing events). Phase 3-C.';

COMMIT;
