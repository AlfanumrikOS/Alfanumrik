-- Migration: 20260505130000_pre_debit_notice_events.sql
-- Purpose: Add RBI-mandated pre-debit notification audit trail to subscription_events.
--
-- Wave 2 D7.3 — RBI e-mandate compliance.
-- RBI's e-mandate framework (effective Oct 2021, tightened Sep 2022) requires
-- every recurring auto-debit on a card / UPI / net-banking mandate to be
-- preceded by a pre-debit notification sent to the customer at least 24 hours
-- before the charge. Without this, the auto-charge is non-compliant and
-- Razorpay can be penalised. We track every notice (and every send-failure)
-- in subscription_events so the super-admin Marking Integrity / Payment Ops
-- dashboard can prove compliance per charge.
--
-- The subscription_events table already exists (baseline) — event_type is
-- TEXT (not an enum), so no enum-extension is required. We document the new
-- values, add a partial unique index keyed on metadata->>'idempotency_key'
-- so the cron + Edge Function pair cannot double-emit notices for the same
-- upcoming charge across worker instances, and add helper indexes for the
-- two queries the cron runs every 6 hours.
--
-- Idempotency contract:
--   metadata->>'idempotency_key' = 'pre_debit_<subscription_id>_<charge_iso_date>'
--   The partial unique index makes a duplicate insert fail with 23505 which
--   the Edge Function maps to a 200 no-op (notice already sent).

-- ─── Document new event_type values ──────────────────────────────────────────
-- subscription_events.event_type is free-form TEXT. The values we now emit:
--   'pre_debit_notice_sent'    — notice successfully delivered to customer
--   'pre_debit_notice_failed'  — 3 retries exhausted; auto-charge MUST be skipped
-- (Existing values: 'subscription.activated', 'subscription.charged', etc.)

COMMENT ON COLUMN "public"."subscription_events"."event_type" IS
  'Razorpay webhook event type or internal event. Includes pre_debit_notice_sent and pre_debit_notice_failed for RBI e-mandate compliance audit trail.';

-- ─── Idempotency: unique key per upcoming charge ─────────────────────────────
-- Partial unique index on the metadata idempotency_key for pre-debit events
-- only. This guarantees that across 4 cron-runs/day per subscription, exactly
-- one 'pre_debit_notice_sent' row is written per (subscription_id, charge_date).
-- We deliberately scope to pre-debit event_types so unrelated subscription
-- events (with no idempotency_key) are not affected.

CREATE UNIQUE INDEX IF NOT EXISTS "idx_sub_events_pre_debit_idempotency"
  ON "public"."subscription_events" ((metadata ->> 'idempotency_key'))
  WHERE event_type IN ('pre_debit_notice_sent', 'pre_debit_notice_failed')
    AND metadata ? 'idempotency_key';

-- ─── Cron query helper: last pre-debit notice per subscription ───────────────
-- The cron's "has-this-charge-already-been-noticed" lookup filters by
-- subscription_id + event_type + metadata->>'charge_date_iso'. This index
-- keeps that lookup index-only on the hot path.

CREATE INDEX IF NOT EXISTS "idx_sub_events_pre_debit_lookup"
  ON "public"."subscription_events" (subscription_id, event_type, created_at DESC)
  WHERE event_type IN ('pre_debit_notice_sent', 'pre_debit_notice_failed');

-- ─── RLS: subscription_events is service-role only for write, student-self for read ──
-- The baseline migration already ENABLEs RLS on subscription_events. We add
-- a defensive policy here in case the baseline missed it. This is idempotent.

ALTER TABLE "public"."subscription_events" ENABLE ROW LEVEL SECURITY;

-- Service role bypasses RLS automatically. We only add policies for end-user
-- read so a parent or student can see their own pre-debit notice history in
-- the billing UI (FYI, "you were notified at X").

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'subscription_events'
      AND policyname = 'subscription_events_student_select'
  ) THEN
    CREATE POLICY "subscription_events_student_select"
      ON "public"."subscription_events"
      FOR SELECT
      USING (
        student_id IN (
          SELECT id FROM students WHERE auth_user_id = auth.uid()
        )
      );
  END IF;
END $$;

-- ─── Sanity check: no destructive operations in this migration ───────────────
-- This migration only ADDs indexes, comments, and an additive RLS policy.
-- No DROP, no ALTER COLUMN. Safe to re-run.
