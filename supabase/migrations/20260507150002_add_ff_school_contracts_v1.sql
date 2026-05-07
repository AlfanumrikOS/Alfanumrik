-- Migration: 20260507150002_add_ff_school_contracts_v1.sql
-- Purpose: Seed the `ff_school_contracts_v1` feature flag that gates the
--          school_contracts API surface (Phase 3-C of the May 2026 upgrade).
--
-- When OFF: /api/super-admin/contracts and the school-admin contracts
--           viewer return 403; existing rows in school_contracts (if any
--           manually inserted) are unaffected.
-- When ON:  super-admin can create draft contracts, sign them (attach PDF),
--           renew (chain a new contract from a previous), cancel; school
--           admins (RLS-scoped) can SELECT their own school's contracts to
--           download the signed PDF.
--
-- Default state: OFF (is_enabled = false, rollout_percentage = 0).
-- Roll-out is environment-scoped (CS workflow, no per-school surface).
--
-- DOWN (manual): DELETE FROM feature_flags WHERE flag_name = 'ff_school_contracts_v1';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM feature_flags WHERE flag_name = 'ff_school_contracts_v1'
  ) THEN
    INSERT INTO feature_flags (
      flag_name,
      is_enabled,
      rollout_percentage,
      description
    )
    VALUES (
      'ff_school_contracts_v1',
      false,
      0,
      'Gates the school_contracts API surface: super-admin draft/sign/renew/'
      'cancel routes plus the school-admin RLS-scoped read-only viewer. When '
      'OFF, all routes return 403 and existing rows are dormant. When ON, '
      'CS team manages contracts as standalone signed artefacts (distinct '
      'from school_subscriptions which is the Razorpay subscription state '
      'and from school_invoices which is the billing event log). '
      'Owner: orchestrator. Phase 3-C.'
    );
  END IF;
END $$;
