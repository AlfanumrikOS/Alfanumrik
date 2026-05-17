-- ============================================================================
-- Migration: 20260528000006_audit_logs_admin_actor_type.sql
-- Phase G.4 (Super-Admin Production-Readiness Plan, 2026-05-17)
--
-- Purpose: make `audit_logs` the canonical destination for admin actions
-- by adding the columns admin events need (actor_type, before_state,
-- after_state). Keeps `admin_audit_log` table untouched as a backwards-
-- compat surface — application code starts dual-writing (audit_logs first,
-- admin_audit_log best-effort) so SIEM/queries can switch to audit_logs
-- without breaking the existing /super-admin/logs UI.
--
-- DDL is idempotent and additive — every column is nullable / defaulted.
-- A follow-up Phase H migration will (1) backfill audit_logs from
-- admin_audit_log historical rows, (2) optionally drop admin_audit_log
-- once all consumers have switched.
-- ============================================================================

ALTER TABLE audit_logs
  ADD COLUMN IF NOT EXISTS actor_type   TEXT NOT NULL DEFAULT 'user',
  ADD COLUMN IF NOT EXISTS before_state JSONB NULL,
  ADD COLUMN IF NOT EXISTS after_state  JSONB NULL,
  ADD COLUMN IF NOT EXISTS admin_level  TEXT NULL;

-- Permissive check on actor_type so future actor classes (service, cron,
-- system) can be added without a schema bump.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'audit_logs_actor_type_check'
      AND conrelid = 'audit_logs'::regclass
  ) THEN
    EXECUTE 'ALTER TABLE audit_logs DROP CONSTRAINT audit_logs_actor_type_check';
  END IF;
END $$;

ALTER TABLE audit_logs
  ADD CONSTRAINT audit_logs_actor_type_check
  CHECK (actor_type IN ('user', 'admin', 'service', 'system', 'cron'));

CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_type_created
  ON audit_logs(actor_type, created_at DESC) WHERE actor_type != 'user';

CREATE INDEX IF NOT EXISTS idx_audit_logs_admin_action
  ON audit_logs(action, created_at DESC) WHERE actor_type = 'admin';

CREATE INDEX IF NOT EXISTS idx_audit_logs_resource
  ON audit_logs(resource_type, resource_id, created_at DESC);

COMMENT ON COLUMN audit_logs.actor_type IS
  'Who performed the action. ''user'' for end-user activity, ''admin'' for '
  '/super-admin/* writes (Phase G.4, 2026-05-17), ''service'' for service-role '
  'helpers, ''cron'' for scheduled jobs, ''system'' for triggers.';

COMMENT ON COLUMN audit_logs.before_state IS
  'JSONB snapshot of relevant fields BEFORE the action. Optional. '
  'Populated by mutation routes that want to support diff-based forensics.';

COMMENT ON COLUMN audit_logs.after_state IS
  'JSONB snapshot of relevant fields AFTER the action. Optional.';

COMMENT ON COLUMN audit_logs.admin_level IS
  'For actor_type=''admin'': the caller''s admin_level at action time. Lets '
  'us query "what did all super-admins do in the last 24h" without joining '
  'admin_users (whose level can change).';
