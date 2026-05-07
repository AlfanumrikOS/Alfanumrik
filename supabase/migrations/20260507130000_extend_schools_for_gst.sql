-- Migration: 20260507130000_extend_schools_for_gst.sql
-- Purpose: Add GST-billing fields to the schools table so invoice generation
--          (Phase 3-A) can read authoritative legal-name / GSTIN / billing
--          address from one place instead of asking at invoice-creation time.
--
-- Phase 3-A of the May 2026 upgrade. All additions are NULLABLE so the
-- migration is non-blocking on a live table; rows with NULL values fall back
-- to schools.name and schools.address inside the invoice generator.
--
-- DOWN (manual):
--   ALTER TABLE schools DROP COLUMN gstin, DROP COLUMN legal_name, DROP COLUMN billing_address;

BEGIN;

ALTER TABLE public.schools
  ADD COLUMN IF NOT EXISTS gstin             text,
  ADD COLUMN IF NOT EXISTS legal_name        text,
  ADD COLUMN IF NOT EXISTS billing_address   text;

COMMENT ON COLUMN public.schools.gstin IS
  'Buyer-side GSTIN (15-char India GST registration number). NULL means '
  'unregistered school; the invoice still issues, marked "GSTIN: Unregistered".';
COMMENT ON COLUMN public.schools.legal_name IS
  'Registered legal entity name for the bill-to block. Defaults to schools.name '
  'when NULL. Distinct because some schools trade under a brand name but invoice '
  'under a society / trust legal entity.';
COMMENT ON COLUMN public.schools.billing_address IS
  'Multi-line billing address for the bill-to block. Defaults to schools.address '
  'when NULL.';

COMMIT;
