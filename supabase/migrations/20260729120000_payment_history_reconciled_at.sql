-- Migration: 20260729120000_payment_history_reconciled_at.sql
-- Purpose: C2 fix (P11) — stop /api/cron/reconcile-payments from being able
--   to re-process the same payment_history row forever. Adds a nullable
--   `reconciled_at` marker the cron stamps once it has successfully
--   reconciled a "stuck" captured payment (see cron/reconcile-payments/route.ts).
--   This is purely additive (nullable, default NULL) — no backfill, no
--   behavior change for any existing reader of payment_history.

ALTER TABLE public.payment_history
  ADD COLUMN IF NOT EXISTS reconciled_at timestamptz;

COMMENT ON COLUMN public.payment_history.reconciled_at IS
  'Set by /api/cron/reconcile-payments once a captured-but-unactivated payment has been reconciled. NULL means never reconciled (or reconciliation was never needed). Prevents the cron from re-processing the same row indefinitely, including after a later legitimate cancellation/expiry/downgrade.';

CREATE INDEX IF NOT EXISTS idx_payment_history_reconcile_scan
  ON public.payment_history (status, created_at DESC)
  WHERE reconciled_at IS NULL;
