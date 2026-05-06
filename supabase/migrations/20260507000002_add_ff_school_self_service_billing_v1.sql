-- Migration: 20260507000002_add_ff_school_self_service_billing_v1.sql
-- Purpose: Seed the `ff_school_self_service_billing_v1` feature flag that
--          gates self-service subscription purchase / change / cancel for
--          school admins (Phase 2-C of the May 2026 upgrade).
--
-- Today, /api/school-admin/subscription is GET-only — schools must contact
-- sales / super-admin to change plans or buy seats. Phase 2-C adds POST /
-- PATCH / DELETE handlers + a paired Razorpay subscription flow scoped to
-- `school_subscriptions`, gated by this flag. When OFF, the new mutation
-- handlers return 403 and the UI hides the "Change plan" / "Cancel" CTAs.
--
-- Default state: OFF (is_enabled = false, rollout_percentage = 0).
-- Per-user determinism uses the school_admin's auth UUID via hashForRollout.
--
-- Schema note: feature_flags.flag_name has no UNIQUE constraint; using
-- the established DO $$ IF NOT EXISTS pattern.
--
-- The school_subscriptions table already has all the columns this work
-- needs (razorpay_subscription_id, seats_purchased, price_per_seat_monthly,
-- status with 'cancelled' in the CHECK list, billing_cycle, period dates).
-- No DDL change; only a flag row.
--
-- Rollout strategy:
-- ─────────────────
--   1. Internal pilot (founder's own school)
--      Use target_institutions to scope the flag to a single school by id:
--        UPDATE feature_flags
--        SET is_enabled         = true,
--            rollout_percentage = 100,
--            target_institutions = ARRAY['<school_uuid>']::text[],
--            updated_at         = now()
--        WHERE flag_name = 'ff_school_self_service_billing_v1';
--
--   2. 10% canary in production (across all paying schools)
--        UPDATE feature_flags
--        SET is_enabled         = true,
--            rollout_percentage = 10,
--            target_environments = ARRAY['production']::text[],
--            target_institutions = NULL,
--            updated_at         = now()
--        WHERE flag_name = 'ff_school_self_service_billing_v1';
--
--   3. Full rollout
--        UPDATE feature_flags
--        SET is_enabled         = true,
--            rollout_percentage = 100,
--            target_environments = NULL,
--            target_roles        = NULL,
--            updated_at         = now()
--        WHERE flag_name = 'ff_school_self_service_billing_v1';
--
--   4. Instant rollback
--        UPDATE feature_flags
--        SET is_enabled = false, updated_at = now()
--        WHERE flag_name = 'ff_school_self_service_billing_v1';
--
-- DOWN (manual): DELETE FROM feature_flags WHERE flag_name = 'ff_school_self_service_billing_v1';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM feature_flags WHERE flag_name = 'ff_school_self_service_billing_v1'
  ) THEN
    INSERT INTO feature_flags (
      flag_name,
      is_enabled,
      rollout_percentage,
      description
    )
    VALUES (
      'ff_school_self_service_billing_v1',
      false,                  -- OFF by default
      0,                      -- 0% rollout
      'Gates POST/PATCH/DELETE on /api/school-admin/subscription. When ON, '
      'a school admin can change plan, buy more seats, or cancel directly '
      'from /school-admin/billing without contacting sales. The flag is '
      'evaluated per-school via target_institutions; rollout_percentage '
      'falls back to per-user hashing on the admin caller. When OFF, the '
      'mutation handlers return 403 and the UI hides the CTAs. '
      'Owner: orchestrator.'
    );
  END IF;
END $$;
