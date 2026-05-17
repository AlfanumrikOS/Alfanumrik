-- ============================================================================
-- Migration: 20260528000007_admin_login_attempts.sql
-- Phase G.7 (Super-Admin Production-Readiness Plan, 2026-05-17)
--
-- Purpose: per-email login-attempt counter for super-admin brute-force lockout.
-- The Phase G.7 server-action login route writes one row per attempt and
-- queries the 15-minute window to decide whether to allow the next try.
--
-- Schema deliberately minimal — the goal is "5 failures in 15 min = lockout"
-- not full per-IP audit. The audit story is covered by audit_logs (Phase G.4)
-- which gets a row for every admin login attempt regardless of outcome.
-- ============================================================================

CREATE TABLE IF NOT EXISTS admin_login_attempts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email        TEXT NOT NULL,
  ip_address   TEXT NULL,
  user_agent   TEXT NULL,
  succeeded    BOOLEAN NOT NULL DEFAULT false,
  failure_code TEXT NULL,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE admin_login_attempts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_login_attempts_service_role" ON admin_login_attempts;
CREATE POLICY "admin_login_attempts_service_role" ON admin_login_attempts
  FOR ALL USING (auth.role() = 'service_role');

-- Hot index: the lockout check selects the last 15 minutes for a given
-- email. Partial index keeps it small (only retains the recent window
-- effectively since older rows are pruned by the cleanup function below).
CREATE INDEX IF NOT EXISTS idx_admin_login_attempts_email_recent
  ON admin_login_attempts(email, attempted_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_login_attempts_ip_recent
  ON admin_login_attempts(ip_address, attempted_at DESC) WHERE ip_address IS NOT NULL;

-- 30-day retention. Older rows are not load-bearing for the lockout; they
-- live in audit_logs for forensic queries.
CREATE OR REPLACE FUNCTION prune_admin_login_attempts()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted INTEGER;
BEGIN
  WITH deleted AS (
    DELETE FROM admin_login_attempts
      WHERE attempted_at < (now() - interval '30 days')
      RETURNING id
  )
  SELECT count(*) INTO v_deleted FROM deleted;
  RETURN v_deleted;
END;
$$;

REVOKE EXECUTE ON FUNCTION prune_admin_login_attempts() FROM public, anon, authenticated;
GRANT  EXECUTE ON FUNCTION prune_admin_login_attempts() TO service_role;

COMMENT ON TABLE admin_login_attempts IS
  'Per-email/IP login attempt counter for super-admin brute-force lockout. '
  '5 failures in 15 minutes for the same email = lockout until the window expires.';
