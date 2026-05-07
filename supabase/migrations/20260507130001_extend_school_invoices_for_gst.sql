-- Migration: 20260507130001_extend_school_invoices_for_gst.sql
-- Purpose: Extend the existing school_invoices table with GST-compliance
--          fields per India CGST Rule 46 (tax invoice particulars), and
--          create the private storage bucket where PDFs land.
--
-- Phase 3-A of the May 2026 upgrade. All additions are NULLABLE — pre-flag
-- rows stay with NULL invoice_number and are treated as pre-GST-compliance
-- (grandfathered). New rows generated after `ff_gst_invoicing_v1` is ON
-- get the full GST treatment from the invoice-generator Edge Function.
--
-- This migration follows the spec's intent ("Migration: school_invoices
-- table + invoice_number_sequences ... no gaps tolerated") while being
-- safe against the existing schema where school_invoices already exists
-- with its core columns. ADD COLUMN IF NOT EXISTS guarantees idempotence.
--
-- DOWN (manual):
--   ALTER TABLE school_invoices DROP COLUMN invoice_number, DROP COLUMN ...;
--   DELETE FROM storage.buckets WHERE id = 'school-invoices';

BEGIN;

-- ── 1. New columns on school_invoices ─────────────────────────────────────

ALTER TABLE public.school_invoices
  ADD COLUMN IF NOT EXISTS invoice_number          text,           -- "ALF/2526/MH/00042"
  ADD COLUMN IF NOT EXISTS financial_year          text,           -- "2526" = FY2025-26
  ADD COLUMN IF NOT EXISTS state_code              text,           -- supplier state of issue
  ADD COLUMN IF NOT EXISTS hsn_code                text,           -- e.g. "999293"
  ADD COLUMN IF NOT EXISTS place_of_supply         text,           -- buyer state code
  ADD COLUMN IF NOT EXISTS school_gstin            text,           -- snapshot of buyer GSTIN
  ADD COLUMN IF NOT EXISTS school_legal_name       text,           -- snapshot of buyer legal name
  ADD COLUMN IF NOT EXISTS school_billing_address  text,           -- snapshot of buyer address
  ADD COLUMN IF NOT EXISTS taxable_amount_inr      numeric(12,2),  -- pre-GST subtotal
  ADD COLUMN IF NOT EXISTS gst_rate                numeric(5,2),   -- e.g. 18.00
  ADD COLUMN IF NOT EXISTS cgst_amount             numeric(12,2),
  ADD COLUMN IF NOT EXISTS sgst_amount             numeric(12,2),
  ADD COLUMN IF NOT EXISTS igst_amount             numeric(12,2);

-- A successful GST-tagged invoice is uniquely identifiable by (financial_year,
-- state_code, invoice_number). Partial unique index lets pre-GST rows (NULL
-- invoice_number) coexist.
CREATE UNIQUE INDEX IF NOT EXISTS school_invoices_gst_number_uq
  ON public.school_invoices (financial_year, state_code, invoice_number)
  WHERE invoice_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS school_invoices_school_id_idx
  ON public.school_invoices (school_id);

-- ── 2. Storage bucket for invoice PDFs ────────────────────────────────────
-- Bucket `school-invoices` is private. PDFs accessed only via short-lived
-- signed URLs from the API routes. Path convention:
--   {school_id}/{financial_year}/{invoice_number_int}.pdf

INSERT INTO storage.buckets (id, name, public)
VALUES ('school-invoices', 'school-invoices', false)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS: we leave storage.objects scoped to service_role only and
-- route every read through `/api/school-admin/invoices/[id]/pdf` (which
-- enforces school-admin authorisation and mints a signed URL). Adding a
-- school-admin SELECT policy here would require resolving school_id from
-- the storage path, which is brittle.

-- ── 3. Column-comment metadata for downstream tooling ────────────────────

COMMENT ON COLUMN public.school_invoices.invoice_number IS
  'GST-compliant sequential invoice number per (financial_year, state_code). '
  'Generated via next_invoice_number() RPC. NULL on pre-Phase-3-A rows.';
COMMENT ON COLUMN public.school_invoices.financial_year IS
  'Indian fin year, format YYZZ. e.g. "2526" for FY2025-26 (Apr 2025 - Mar 2026).';
COMMENT ON COLUMN public.school_invoices.place_of_supply IS
  'Buyer 2-letter state code per CGST Rule 46(g). Drives intra-state '
  '(CGST+SGST) vs inter-state (IGST) tax split.';

COMMIT;
