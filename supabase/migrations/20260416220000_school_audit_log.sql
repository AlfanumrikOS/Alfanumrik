-- Migration: 20260416220000_school_audit_log.sql
-- Purpose: Create school_audit_log table for B2B compliance audit trail.
--          Every school admin action is logged with actor, action, resource,
--          metadata, and IP address. Used by the audit log viewer API.

-- ============================================================================
-- 1. school_audit_log
-- ============================================================================
CREATE TABLE IF NOT EXISTS school_audit_log (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id      UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  actor_id       UUID NOT NULL REFERENCES auth.users(id),
  action         TEXT NOT NULL,
  resource_type  TEXT,
  resource_id    TEXT,
  metadata       JSONB NOT NULL DEFAULT '{}',
  ip_address     TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS (mandatory for every new table — P8)
ALTER TABLE school_audit_log ENABLE ROW LEVEL SECURITY;

-- Service role bypass (API routes use service role via getSupabaseAdmin)
CREATE POLICY "school_audit_log_service_role" ON school_audit_log
  FOR ALL USING (auth.role() = 'service_role');

-- School admins can read audit logs for their own school
CREATE POLICY "school_audit_log_school_admin_select" ON school_audit_log
  FOR SELECT TO authenticated
  USING (
    school_id = get_admin_school_id()
  );

-- NOTE: No student/parent/teacher policies — audit logs are admin-only.
-- Students, parents, and teachers do not need to view school admin audit logs.
-- Admin service role (getSupabaseAdmin) handles all INSERT operations.

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_school_audit_log_school_created
  ON school_audit_log (school_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_school_audit_log_school_action
  ON school_audit_log (school_id, action, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_school_audit_log_actor
  ON school_audit_log (actor_id, created_at DESC);
