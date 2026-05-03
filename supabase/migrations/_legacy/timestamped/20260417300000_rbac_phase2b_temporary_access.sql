-- =============================================================================
-- RBAC Phase 2B: Temporary Access — Role Elevations, Impersonation, Delegation
-- Migration: 20260417300000_rbac_phase2b_temporary_access.sql
--
-- Creates three tables for temporary access patterns:
--   1. role_elevations      — time-bound role grants with audit trail
--   2. impersonation_sessions — admin view-as-user with action limits
--   3. delegation_tokens     — permission delegation via hashed tokens
--
-- Also creates expire_temporary_access() function for cron-based cleanup.
--
-- Depends on: 20260417200000_rbac_phase2a_tenant_scoped_schema.sql
-- =============================================================================


-- ===========================================================================
-- TABLE 1: role_elevations
-- ===========================================================================
-- Time-bound role elevation (e.g., teacher temporarily elevated to admin).
-- All elevations have a mandatory expiry and audit trail.

CREATE TABLE IF NOT EXISTS role_elevations (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL,
  school_id           UUID REFERENCES schools(id) ON DELETE CASCADE,
  elevated_role_id    UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  original_roles      JSONB DEFAULT '[]'::jsonb,
  granted_by          UUID NOT NULL,
  reason              TEXT NOT NULL,
  starts_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at          TIMESTAMPTZ NOT NULL,
  max_duration_hours  INT NOT NULL DEFAULT 48,
  revoked_at          TIMESTAMPTZ,
  revoked_by          UUID,
  status              TEXT NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'expired', 'revoked')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_role_elevations_user_active
  ON role_elevations (user_id) WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_role_elevations_school
  ON role_elevations (school_id);

CREATE INDEX IF NOT EXISTS idx_role_elevations_expires_active
  ON role_elevations (expires_at) WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_role_elevations_granted_by
  ON role_elevations (granted_by);

-- RLS
ALTER TABLE role_elevations ENABLE ROW LEVEL SECURITY;

-- Service role: full access
CREATE POLICY role_elevations_service ON role_elevations
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- Authenticated: can see own elevations, or elevations they granted, or if admin
CREATE POLICY role_elevations_select_authenticated ON role_elevations
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR granted_by = auth.uid()
    OR auth.uid() IN (SELECT au.auth_user_id FROM admin_users au WHERE au.is_active = true)
  );

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_role_elevations_updated_at()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_role_elevations_updated_at ON role_elevations;
CREATE TRIGGER trg_role_elevations_updated_at
  BEFORE UPDATE ON role_elevations
  FOR EACH ROW EXECUTE FUNCTION update_role_elevations_updated_at();


-- ===========================================================================
-- TABLE 2: impersonation_sessions
-- ===========================================================================
-- Admin view-as-user sessions with strict time limits and action counting.
-- Default expiry is 30 minutes; max allowed is 60 minutes.

CREATE TABLE IF NOT EXISTS impersonation_sessions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id       UUID NOT NULL,
  target_user_id      UUID NOT NULL,
  school_id           UUID REFERENCES schools(id) ON DELETE CASCADE,
  reason              TEXT NOT NULL,
  permissions_granted TEXT[] NOT NULL DEFAULT '{read}',
  started_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at          TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '30 minutes'),
  ended_at            TIMESTAMPTZ,
  ended_reason        TEXT CHECK (ended_reason IN (NULL, 'manual', 'expired', 'anomaly_auto_terminate')),
  action_count        INT NOT NULL DEFAULT 0,
  status              TEXT NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'ended', 'expired', 'terminated')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_impersonation_admin_active
  ON impersonation_sessions (admin_user_id, status) WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_impersonation_target_active
  ON impersonation_sessions (target_user_id) WHERE status = 'active';

-- RLS
ALTER TABLE impersonation_sessions ENABLE ROW LEVEL SECURITY;

-- Service role: full access
CREATE POLICY impersonation_sessions_service ON impersonation_sessions
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- Authenticated: can see sessions where they are admin or target, or if admin
CREATE POLICY impersonation_sessions_select_authenticated ON impersonation_sessions
  FOR SELECT TO authenticated
  USING (
    admin_user_id = auth.uid()
    OR target_user_id = auth.uid()
    OR auth.uid() IN (SELECT au.auth_user_id FROM admin_users au WHERE au.is_active = true)
  );

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_impersonation_sessions_updated_at()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_impersonation_sessions_updated_at ON impersonation_sessions;
CREATE TRIGGER trg_impersonation_sessions_updated_at
  BEFORE UPDATE ON impersonation_sessions
  FOR EACH ROW EXECUTE FUNCTION update_impersonation_sessions_updated_at();


-- ===========================================================================
-- TABLE 3: delegation_tokens
-- ===========================================================================
-- Permission delegation via hashed tokens. Supports use-count limits,
-- expiry, and cascading revocation (verified at validation time).

CREATE TABLE IF NOT EXISTS delegation_tokens (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash          TEXT NOT NULL UNIQUE,
  granter_user_id     UUID NOT NULL,
  grantee_user_id     UUID,
  school_id           UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  permissions         TEXT[] NOT NULL,
  resource_scope      JSONB,
  max_uses            INT,
  use_count           INT NOT NULL DEFAULT 0,
  expires_at          TIMESTAMPTZ NOT NULL,
  revoked_at          TIMESTAMPTZ,
  revoked_by          UUID,
  status              TEXT NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'expired', 'revoked', 'exhausted')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_delegation_tokens_hash_active
  ON delegation_tokens (token_hash) WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_delegation_tokens_granter_active
  ON delegation_tokens (granter_user_id) WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_delegation_tokens_school
  ON delegation_tokens (school_id);

-- RLS
ALTER TABLE delegation_tokens ENABLE ROW LEVEL SECURITY;

-- Service role: full access
CREATE POLICY delegation_tokens_service ON delegation_tokens
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- Authenticated: can see tokens they granted/received, or if admin
CREATE POLICY delegation_tokens_select_authenticated ON delegation_tokens
  FOR SELECT TO authenticated
  USING (
    granter_user_id = auth.uid()
    OR grantee_user_id = auth.uid()
    OR auth.uid() IN (SELECT au.auth_user_id FROM admin_users au WHERE au.is_active = true)
  );

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_delegation_tokens_updated_at()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_delegation_tokens_updated_at ON delegation_tokens;
CREATE TRIGGER trg_delegation_tokens_updated_at
  BEFORE UPDATE ON delegation_tokens
  FOR EACH ROW EXECUTE FUNCTION update_delegation_tokens_updated_at();


-- ===========================================================================
-- FUNCTION: expire_temporary_access()
-- ===========================================================================
-- Called by daily-cron to expire stale active records across all 3 tables.
-- Returns JSONB with counts of updated rows per table.
-- SECURITY DEFINER so the cron can update rows regardless of RLS.

CREATE OR REPLACE FUNCTION expire_temporary_access()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_elevations_expired  INT := 0;
  v_sessions_expired    INT := 0;
  v_tokens_expired      INT := 0;
BEGIN
  -- Expire role elevations past their expires_at
  UPDATE role_elevations
  SET status = 'expired', updated_at = now()
  WHERE status = 'active'
    AND expires_at <= now();
  GET DIAGNOSTICS v_elevations_expired = ROW_COUNT;

  -- Expire impersonation sessions past their expires_at
  UPDATE impersonation_sessions
  SET status = 'expired', ended_at = now(), ended_reason = 'expired', updated_at = now()
  WHERE status = 'active'
    AND expires_at <= now();
  GET DIAGNOSTICS v_sessions_expired = ROW_COUNT;

  -- Expire delegation tokens past their expires_at
  UPDATE delegation_tokens
  SET status = 'expired', updated_at = now()
  WHERE status = 'active'
    AND expires_at <= now();
  GET DIAGNOSTICS v_tokens_expired = ROW_COUNT;

  RETURN jsonb_build_object(
    'elevations_expired', v_elevations_expired,
    'sessions_expired', v_sessions_expired,
    'tokens_expired', v_tokens_expired,
    'executed_at', now()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION expire_temporary_access() TO service_role;
