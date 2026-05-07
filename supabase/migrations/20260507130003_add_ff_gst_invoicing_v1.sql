-- Migration: 20260507130003_add_ff_gst_invoicing_v1.sql
-- Purpose: Seed the `ff_gst_invoicing_v1` feature flag that gates GST-PDF
--          generation for school invoices (Phase 3-A of the May 2026 upgrade).
--
-- When OFF: invoice-generator Edge Function refuses to run; existing
--           school_invoices rows stay as they are (legacy fields only).
-- When ON:  newly created school_invoices rows are eligible for GST-PDF
--           generation. The Edge Function writes invoice_number, GST fields,
--           and pdf_url. Existing pre-flag rows are NOT auto-backfilled —
--           they keep NULL invoice_number and no PDF.
--
-- Default state: OFF (is_enabled = false, rollout_percentage = 0).
-- Roll-out is per-school via target_institutions; rollout_percentage uses
-- per-user hashing of the calling super-admin / school-admin auth UUID.
--
-- Rollout strategy:
--   1. Internal pilot — flip ON for the founder's own school by id:
--        UPDATE feature_flags
--        SET is_enabled = true,
--            rollout_percentage = 100,
--            target_institutions = ARRAY['<school_uuid>']::text[],
--            updated_at = now()
--        WHERE flag_name = 'ff_gst_invoicing_v1';
--
--   2. 10% canary across paying schools:
--        UPDATE feature_flags
--        SET is_enabled = true,
--            rollout_percentage = 10,
--            target_environments = ARRAY['production']::text[],
--            target_institutions = NULL,
--            updated_at = now()
--        WHERE flag_name = 'ff_gst_invoicing_v1';
--
--   3. Full rollout:
--        UPDATE feature_flags
--        SET is_enabled = true,
--            rollout_percentage = 100,
--            target_environments = NULL,
--            updated_at = now()
--        WHERE flag_name = 'ff_gst_invoicing_v1';
--
--   4. Instant rollback:
--        UPDATE feature_flags
--        SET is_enabled = false, updated_at = now()
--        WHERE flag_name = 'ff_gst_invoicing_v1';
--
-- DOWN (manual): DELETE FROM feature_flags WHERE flag_name = 'ff_gst_invoicing_v1';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM feature_flags WHERE flag_name = 'ff_gst_invoicing_v1'
  ) THEN
    INSERT INTO feature_flags (
      flag_name,
      is_enabled,
      rollout_percentage,
      description
    )
    VALUES (
      'ff_gst_invoicing_v1',
      false,                  -- OFF by default
      0,                      -- 0% rollout
      'Gates GST-compliant PDF generation for school_invoices rows. When ON, '
      'the invoice-generator Edge Function fills invoice_number (gap-free per '
      'fin-year/state via next_invoice_number RPC), GST fields (CGST/SGST '
      'intra-state or IGST inter-state), and pdf_url. When OFF, the Edge '
      'Function returns 403 and existing legacy invoice rows are unaffected. '
      'Owner: orchestrator. Phase 3-A.'
    );
  END IF;
END $$;
