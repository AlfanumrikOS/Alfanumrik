-- Scale readiness indexes for admin and operational tables
CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON admin_audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_action ON admin_audit_log (action);
CREATE INDEX IF NOT EXISTS idx_admin_audit_entity ON admin_audit_log (entity_type);

-- Re-enable RLS on admin_users (service role key now correctly configured)
ALTER TABLE admin_users ENABLE ROW LEVEL SECURITY;
