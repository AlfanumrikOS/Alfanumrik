-- ============================================================================
-- Migration: 20260402120000_demo_accounts_onboarding_state.sql
-- Purpose: Fix R14 — ensure all active demo accounts have onboarding_state rows.
-- Context: Demo accounts were created (via 20260402110000) without corresponding
--          onboarding_state entries, causing inconsistency when code assumes every
--          auth user has an onboarding_state row.
-- Idempotency: Uses INSERT ... ON CONFLICT (auth_user_id) DO NOTHING so this
--              migration is safe to re-run.
-- ============================================================================

-- 1. Backfill onboarding_state for active demo accounts that lack it
INSERT INTO onboarding_state (auth_user_id, intended_role, step, completed_at)
SELECT
  da.auth_user_id,
  da.role,
  'completed',
  da.created_at
FROM demo_accounts da
WHERE da.is_active = true
  AND NOT EXISTS (
    SELECT 1 FROM onboarding_state os WHERE os.auth_user_id = da.auth_user_id
  )
ON CONFLICT (auth_user_id) DO NOTHING;

-- 2. Log the backfill to the audit trail
INSERT INTO auth_audit_log (auth_user_id, event_type, metadata)
SELECT
  da.auth_user_id,
  'bootstrap_idempotent',
  jsonb_build_object(
    'action', 'demo_onboarding_backfill',
    'role', da.role,
    'migration', '20260402120000'
  )
FROM demo_accounts da
WHERE da.is_active = true;
