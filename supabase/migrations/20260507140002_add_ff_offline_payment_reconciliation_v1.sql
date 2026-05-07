-- Migration: 20260507140002_add_ff_offline_payment_reconciliation_v1.sql
-- Purpose: Seed the `ff_offline_payment_reconciliation_v1` feature flag that
--          gates the CS-only offline-payment-reconciliation queue (Phase 3-B
--          of the May 2026 upgrade).
--
-- When OFF: /api/super-admin/reconciliation routes return 403; the CS team
--           continues handling offline payments manually outside the system.
-- When ON:  the routes accept submissions, enforce the two-person approval
--           rule, and on approval call reconcile_payment() to mark the
--           invoice paid and extend the school's subscription period.
--
-- Default state: OFF (is_enabled = false, rollout_percentage = 0).
-- This flag is environment-scoped, not per-school: turning it on enables
-- the queue for ALL super-admins. There is no school-side surface, so
-- target_institutions is not used.
--
-- Rollout strategy:
--   1. Internal pilot — flip ON in production for the CS team to start
--      using the queue:
--        UPDATE feature_flags
--        SET is_enabled         = true,
--            rollout_percentage = 100,
--            target_environments = ARRAY['production']::text[],
--            updated_at         = now()
--        WHERE flag_name = 'ff_offline_payment_reconciliation_v1';
--
--   2. Full rollout (drops the env scope; staging gets it too):
--        UPDATE feature_flags
--        SET is_enabled         = true,
--            rollout_percentage = 100,
--            target_environments = NULL,
--            updated_at         = now()
--        WHERE flag_name = 'ff_offline_payment_reconciliation_v1';
--
--   3. Instant rollback:
--        UPDATE feature_flags
--        SET is_enabled = false, updated_at = now()
--        WHERE flag_name = 'ff_offline_payment_reconciliation_v1';
--
-- DOWN (manual): DELETE FROM feature_flags WHERE flag_name = 'ff_offline_payment_reconciliation_v1';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM feature_flags WHERE flag_name = 'ff_offline_payment_reconciliation_v1'
  ) THEN
    INSERT INTO feature_flags (
      flag_name,
      is_enabled,
      rollout_percentage,
      description
    )
    VALUES (
      'ff_offline_payment_reconciliation_v1',
      false,                  -- OFF by default
      0,                      -- 0% rollout
      'Gates CS-only offline payment reconciliation queue under '
      '/api/super-admin/reconciliation. When ON, super-admins can submit '
      'PO / bank-transfer / cheque receipts; a SECOND super-admin must '
      'approve before the system marks the invoice paid and extends the '
      'school subscription period via reconcile_payment() RPC. When OFF, '
      'the routes return 403. Two-person rule enforced by CHECK constraint '
      'on payment_reconciliation_queue + by the API route. Owner: '
      'orchestrator. Phase 3-B.'
    );
  END IF;
END $$;
