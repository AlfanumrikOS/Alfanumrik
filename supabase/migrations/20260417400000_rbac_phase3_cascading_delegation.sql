-- =============================================================================
-- RBAC Phase 3: Cascading Delegation Authority
-- Migration: 20260417400000_rbac_phase3_cascading_delegation.sql
--
-- Sections:
--   1. delegation_authority  — controls what each role can do at each hierarchy level
--   2. delegation_approvals  — approval queue for operations requiring sign-off
--   3. cascade_authority_revocation RPC — cascading revoke when a granter loses access
--   4. Seed platform delegation authority defaults
--
-- Depends on:
--   20260417200000_rbac_phase2a_tenant_scoped_schema.sql (school_id on roles, school_memberships)
--   20260417300000_rbac_phase2b_temporary_access.sql (delegation_tokens, role_elevations)
-- =============================================================================


-- ===========================================================================
-- SECTION 1: delegation_authority TABLE
-- ===========================================================================
-- Controls what each role can do at each level of the hierarchy.
-- school_id IS NULL = platform-wide rule; non-NULL = school-specific override.

CREATE TABLE IF NOT EXISTS delegation_authority (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id             UUID REFERENCES schools(id) ON DELETE CASCADE,
  granter_role_id       UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  action                TEXT NOT NULL CHECK (action IN (
                          'assign_role', 'revoke_role', 'elevate',
                          'delegate', 'create_role', 'modify_role_permissions'
                        )),
  target_max_hierarchy  INT,
  target_role_ids       UUID[],
  target_permissions    TEXT[],
  requires_reason       BOOLEAN NOT NULL DEFAULT false,
  requires_approval     BOOLEAN NOT NULL DEFAULT false,
  max_duration_hours    INT,
  is_active             BOOLEAN NOT NULL DEFAULT true,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_delegation_authority_granter
  ON delegation_authority (granter_role_id);

CREATE INDEX IF NOT EXISTS idx_delegation_authority_school
  ON delegation_authority (school_id) WHERE school_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_delegation_authority_granter_action
  ON delegation_authority (granter_role_id, action);

-- RLS
ALTER TABLE delegation_authority ENABLE ROW LEVEL SECURITY;

-- Service role: full access
CREATE POLICY delegation_authority_service ON delegation_authority
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- Authenticated: can read platform rules (school_id IS NULL),
-- or rules for schools they belong to, or if admin
CREATE POLICY delegation_authority_select_authenticated ON delegation_authority
  FOR SELECT TO authenticated
  USING (
    school_id IS NULL
    OR school_id IN (
      SELECT sm.school_id FROM school_memberships sm
      WHERE sm.auth_user_id = auth.uid() AND sm.is_active = true
    )
    OR auth.uid() IN (SELECT au.auth_user_id FROM admin_users au WHERE au.is_active = true)
  );


-- ===========================================================================
-- SECTION 2: delegation_approvals TABLE
-- ===========================================================================
-- Approval queue for operations that require higher-authority sign-off.

CREATE TABLE IF NOT EXISTS delegation_approvals (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id         UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  requested_by      UUID NOT NULL,
  action            TEXT NOT NULL,
  target_user_id    UUID,
  target_role_id    UUID,
  payload           JSONB NOT NULL DEFAULT '{}'::jsonb,
  status            TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
  decided_by        UUID,
  decision_reason   TEXT,
  decided_at        TIMESTAMPTZ,
  expires_at        TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '72 hours'),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_delegation_approvals_school_pending
  ON delegation_approvals (school_id, status) WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_delegation_approvals_requested_by
  ON delegation_approvals (requested_by);

CREATE INDEX IF NOT EXISTS idx_delegation_approvals_decided_by
  ON delegation_approvals (decided_by) WHERE decided_by IS NOT NULL;

-- RLS
ALTER TABLE delegation_approvals ENABLE ROW LEVEL SECURITY;

-- Service role: full access
CREATE POLICY delegation_approvals_service ON delegation_approvals
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- Authenticated: can read own requests, or requests in their school, or if admin
CREATE POLICY delegation_approvals_select_authenticated ON delegation_approvals
  FOR SELECT TO authenticated
  USING (
    requested_by = auth.uid()
    OR school_id IN (
      SELECT sm.school_id FROM school_memberships sm
      WHERE sm.auth_user_id = auth.uid() AND sm.is_active = true
    )
    OR auth.uid() IN (SELECT au.auth_user_id FROM admin_users au WHERE au.is_active = true)
  );

-- Authenticated: can insert their own requests
CREATE POLICY delegation_approvals_insert_authenticated ON delegation_approvals
  FOR INSERT TO authenticated
  WITH CHECK (requested_by = auth.uid());

-- Authenticated: admins/school members can update (approve/reject)
CREATE POLICY delegation_approvals_update_authenticated ON delegation_approvals
  FOR UPDATE TO authenticated
  USING (
    school_id IN (
      SELECT sm.school_id FROM school_memberships sm
      WHERE sm.auth_user_id = auth.uid() AND sm.is_active = true
    )
    OR auth.uid() IN (SELECT au.auth_user_id FROM admin_users au WHERE au.is_active = true)
  )
  WITH CHECK (
    school_id IN (
      SELECT sm.school_id FROM school_memberships sm
      WHERE sm.auth_user_id = auth.uid() AND sm.is_active = true
    )
    OR auth.uid() IN (SELECT au.auth_user_id FROM admin_users au WHERE au.is_active = true)
  );


-- ===========================================================================
-- SECTION 3: cascade_authority_revocation RPC
-- ===========================================================================
-- When a user's authority is revoked from a school, this function cascades
-- the revocation to everything they granted: role assignments, delegation
-- tokens, role elevations, and pending approvals.
--
-- SECURITY DEFINER — must update user_roles, delegation_tokens,
-- role_elevations, and delegation_approvals regardless of caller's RLS
-- context. Expected to be called from server-side code (supabase-admin /
-- service role) during authority revocation flows.

CREATE OR REPLACE FUNCTION cascade_authority_revocation(
  p_user_id   UUID,
  p_school_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_roles_revoked       INT := 0;
  v_tokens_revoked      INT := 0;
  v_elevations_revoked  INT := 0;
  v_approvals_expired   INT := 0;
  v_affected_user_ids   UUID[];
  v_role_affected       UUID[];
  v_token_affected      UUID[];
  v_elevation_affected  UUID[];
BEGIN
  -- Step 1: Soft-revoke all role assignments this user granted in this school
  WITH revoked AS (
    UPDATE user_roles
    SET is_active = false
    WHERE assigned_by = p_user_id
      AND school_id = p_school_id
      AND is_active = true
    RETURNING auth_user_id
  )
  SELECT COUNT(*)::INT, COALESCE(array_agg(DISTINCT auth_user_id), '{}')
  INTO v_roles_revoked, v_role_affected
  FROM revoked;

  -- Step 2: Revoke all active delegation tokens this user granted in this school
  WITH revoked AS (
    UPDATE delegation_tokens
    SET status = 'revoked',
        revoked_at = now(),
        revoked_by = p_user_id,
        updated_at = now()
    WHERE granter_user_id = p_user_id
      AND school_id = p_school_id
      AND status = 'active'
    RETURNING grantee_user_id
  )
  SELECT COUNT(*)::INT, COALESCE(array_agg(DISTINCT grantee_user_id) FILTER (WHERE grantee_user_id IS NOT NULL), '{}')
  INTO v_tokens_revoked, v_token_affected
  FROM revoked;

  -- Step 3: Revoke all active role elevations this user granted in this school
  WITH revoked AS (
    UPDATE role_elevations
    SET status = 'revoked',
        revoked_at = now(),
        revoked_by = p_user_id,
        updated_at = now()
    WHERE granted_by = p_user_id
      AND school_id = p_school_id
      AND status = 'active'
    RETURNING user_id
  )
  SELECT COUNT(*)::INT, COALESCE(array_agg(DISTINCT user_id), '{}')
  INTO v_elevations_revoked, v_elevation_affected
  FROM revoked;

  -- Step 4: Expire all pending approval requests from this user in this school
  WITH expired AS (
    UPDATE delegation_approvals
    SET status = 'expired'
    WHERE requested_by = p_user_id
      AND school_id = p_school_id
      AND status = 'pending'
    RETURNING id
  )
  SELECT COUNT(*)::INT INTO v_approvals_expired FROM expired;

  -- Step 5: Collect all unique affected user IDs
  SELECT COALESCE(
    array_agg(DISTINCT uid) FILTER (WHERE uid IS NOT NULL),
    '{}'
  )
  INTO v_affected_user_ids
  FROM unnest(v_role_affected || v_token_affected || v_elevation_affected) AS uid;

  -- Step 6: Return summary
  RETURN jsonb_build_object(
    'roles_revoked',      v_roles_revoked,
    'tokens_revoked',     v_tokens_revoked,
    'elevations_revoked', v_elevations_revoked,
    'approvals_expired',  v_approvals_expired,
    'affected_user_ids',  to_jsonb(v_affected_user_ids)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION cascade_authority_revocation(UUID, UUID) TO service_role;


-- ===========================================================================
-- SECTION 4: Seed platform delegation authority defaults
-- ===========================================================================
-- Platform-level rules (school_id IS NULL) that define what each role can
-- do by default. Schools can override with school-scoped rows.

DO $$
DECLARE
  v_super_admin_id UUID;
  v_admin_id       UUID;
  v_inst_admin_id  UUID;
  v_teacher_id     UUID;
  v_content_mgr_id UUID;
  v_finance_id     UUID;
  v_support_id     UUID;
BEGIN
  -- Look up platform role IDs (school_id IS NULL)
  SELECT id INTO v_super_admin_id FROM roles WHERE name = 'super_admin' AND school_id IS NULL;
  SELECT id INTO v_admin_id       FROM roles WHERE name = 'admin'       AND school_id IS NULL;
  SELECT id INTO v_inst_admin_id  FROM roles WHERE name = 'institution_admin' AND school_id IS NULL;
  SELECT id INTO v_teacher_id     FROM roles WHERE name = 'teacher'     AND school_id IS NULL;
  SELECT id INTO v_content_mgr_id FROM roles WHERE name = 'content_manager'  AND school_id IS NULL;
  SELECT id INTO v_finance_id     FROM roles WHERE name = 'finance'     AND school_id IS NULL;
  SELECT id INTO v_support_id     FROM roles WHERE name = 'support'     AND school_id IS NULL;

  -- Guard: only insert if we found the roles
  IF v_super_admin_id IS NULL OR v_admin_id IS NULL THEN
    RAISE NOTICE 'Skipping delegation_authority seed: required roles not found';
    RETURN;
  END IF;

  -- ---- super_admin authorities ----
  INSERT INTO delegation_authority (school_id, granter_role_id, action, target_max_hierarchy, max_duration_hours, requires_reason, requires_approval) VALUES
    (NULL, v_super_admin_id, 'assign_role',              100, NULL, false, false),
    (NULL, v_super_admin_id, 'revoke_role',              100, NULL, false, false),
    (NULL, v_super_admin_id, 'create_role',              100, NULL, false, false),
    (NULL, v_super_admin_id, 'modify_role_permissions',  100, NULL, false, false),
    (NULL, v_super_admin_id, 'elevate',                   90, NULL, false, false)
  ON CONFLICT DO NOTHING;

  -- ---- admin authorities ----
  INSERT INTO delegation_authority (school_id, granter_role_id, action, target_max_hierarchy, max_duration_hours, requires_reason, requires_approval) VALUES
    (NULL, v_admin_id, 'assign_role',  80, NULL, false, false),
    (NULL, v_admin_id, 'revoke_role',  80, NULL, false, false),
    (NULL, v_admin_id, 'elevate',      70,  168, false, false)
  ON CONFLICT DO NOTHING;

  -- ---- institution_admin authorities ----
  IF v_inst_admin_id IS NOT NULL THEN
    INSERT INTO delegation_authority (school_id, granter_role_id, action, target_max_hierarchy, max_duration_hours, requires_reason, requires_approval) VALUES
      (NULL, v_inst_admin_id, 'assign_role',             69, NULL, true, false),
      (NULL, v_inst_admin_id, 'revoke_role',             69, NULL, true, false),
      (NULL, v_inst_admin_id, 'create_role',             65, NULL, true, true),
      (NULL, v_inst_admin_id, 'modify_role_permissions', 69, NULL, true, false),
      (NULL, v_inst_admin_id, 'elevate',                 65,   48, true, false)
    ON CONFLICT DO NOTHING;
  END IF;

  -- ---- teacher: delegate only ----
  IF v_teacher_id IS NOT NULL THEN
    INSERT INTO delegation_authority (school_id, granter_role_id, action, target_max_hierarchy, max_duration_hours, requires_reason, requires_approval) VALUES
      (NULL, v_teacher_id, 'delegate', NULL, 168, false, false)
    ON CONFLICT DO NOTHING;
  END IF;

  -- ---- content_manager: delegate only ----
  IF v_content_mgr_id IS NOT NULL THEN
    INSERT INTO delegation_authority (school_id, granter_role_id, action, target_max_hierarchy, max_duration_hours, requires_reason, requires_approval) VALUES
      (NULL, v_content_mgr_id, 'delegate', NULL, 168, false, false)
    ON CONFLICT DO NOTHING;
  END IF;

  -- ---- finance: delegate, max 24 hours ----
  IF v_finance_id IS NOT NULL THEN
    INSERT INTO delegation_authority (school_id, granter_role_id, action, target_max_hierarchy, max_duration_hours, requires_reason, requires_approval) VALUES
      (NULL, v_finance_id, 'delegate', NULL, 24, false, false)
    ON CONFLICT DO NOTHING;
  END IF;

  -- ---- support: delegate, max 7 days ----
  IF v_support_id IS NOT NULL THEN
    INSERT INTO delegation_authority (school_id, granter_role_id, action, target_max_hierarchy, max_duration_hours, requires_reason, requires_approval) VALUES
      (NULL, v_support_id, 'delegate', NULL, 168, false, false)
    ON CONFLICT DO NOTHING;
  END IF;
END;
$$;
