-- =============================================================================
-- RBAC Phase 2A: Tenant-Scoped Schema
-- Migration: 20260417200000_rbac_phase2a_tenant_scoped_schema.sql
--
-- Adds school_id to all RBAC tables, creates school_memberships (if needed),
-- school_rbac_config and permission_ceilings tables, updates
-- get_user_permissions RPC, and adds clone_platform_rbac_for_school RPC.
--
-- Depends on: 20260417100000_rbac_phase1_security_hardening.sql
-- =============================================================================


-- ===========================================================================
-- SECTION 0: PREREQUISITE — school_memberships table
-- ===========================================================================
-- The RLS policies in Sections 2-3 depend on school_memberships to check
-- whether the authenticated user belongs to a school.  This table may not
-- exist yet, so create it idempotently.

CREATE TABLE IF NOT EXISTS school_memberships (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id  UUID NOT NULL,
  school_id     UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  role          TEXT DEFAULT 'member',
  is_active     BOOLEAN NOT NULL DEFAULT true,
  joined_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(auth_user_id, school_id)
);

ALTER TABLE school_memberships ENABLE ROW LEVEL SECURITY;

-- Users can read their own memberships
CREATE POLICY IF NOT EXISTS school_memberships_select_own ON school_memberships
  FOR SELECT TO authenticated
  USING (auth_user_id = auth.uid());

-- Admins can read all memberships
CREATE POLICY IF NOT EXISTS school_memberships_select_admin ON school_memberships
  FOR SELECT TO authenticated
  USING (auth.uid() IN (SELECT au.auth_user_id FROM admin_users au WHERE au.is_active = true));

-- Service role full access
CREATE POLICY IF NOT EXISTS school_memberships_service ON school_memberships
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_school_memberships_auth_user
  ON school_memberships (auth_user_id);

CREATE INDEX IF NOT EXISTS idx_school_memberships_school
  ON school_memberships (school_id);

CREATE INDEX IF NOT EXISTS idx_school_memberships_active
  ON school_memberships (auth_user_id, school_id) WHERE is_active = true;


-- ===========================================================================
-- SECTION 1: ADD school_id TO RBAC TABLES
-- ===========================================================================
-- NULL = platform-level default; non-NULL = school-specific override.

-- ---- roles: add school_id + source_role_id + is_customizable ----
ALTER TABLE roles ADD COLUMN IF NOT EXISTS school_id UUID REFERENCES schools(id) ON DELETE CASCADE;
ALTER TABLE roles ADD COLUMN IF NOT EXISTS source_role_id UUID REFERENCES roles(id);
ALTER TABLE roles ADD COLUMN IF NOT EXISTS is_customizable BOOLEAN DEFAULT true;

-- Drop the old unique constraint on name, replace with partial unique indexes.
-- The old constraint name is 'roles_name_key' (auto-generated from UNIQUE on name).
DO $$ BEGIN
  ALTER TABLE roles DROP CONSTRAINT IF EXISTS roles_name_key;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

-- Platform roles (school_id IS NULL) must have unique names
CREATE UNIQUE INDEX IF NOT EXISTS idx_roles_name_platform
  ON roles (name) WHERE school_id IS NULL;

-- School-scoped roles must have unique names within their school
CREATE UNIQUE INDEX IF NOT EXISTS idx_roles_name_school
  ON roles (school_id, name) WHERE school_id IS NOT NULL;

-- Lookup index for school-scoped role queries
CREATE INDEX IF NOT EXISTS idx_roles_school
  ON roles (school_id) WHERE school_id IS NOT NULL;


-- ---- permissions: add school_id + namespace ----
ALTER TABLE permissions ADD COLUMN IF NOT EXISTS school_id UUID REFERENCES schools(id) ON DELETE CASCADE;
ALTER TABLE permissions ADD COLUMN IF NOT EXISTS namespace TEXT DEFAULT 'platform';

CREATE INDEX IF NOT EXISTS idx_permissions_school
  ON permissions (school_id) WHERE school_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_permissions_namespace
  ON permissions (namespace);


-- ---- role_permissions: add school_id ----
ALTER TABLE role_permissions ADD COLUMN IF NOT EXISTS school_id UUID REFERENCES schools(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_role_permissions_school
  ON role_permissions (school_id) WHERE school_id IS NOT NULL;


-- ---- user_roles: add school_id ----
ALTER TABLE user_roles ADD COLUMN IF NOT EXISTS school_id UUID REFERENCES schools(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_user_roles_school
  ON user_roles (school_id) WHERE school_id IS NOT NULL;

-- Drop old unique constraint, replace with partial unique indexes.
-- The old constraint name is 'user_roles_auth_user_id_role_id_key'.
DO $$ BEGIN
  ALTER TABLE user_roles DROP CONSTRAINT IF EXISTS user_roles_auth_user_id_role_id_key;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

-- Platform-level user-role assignments (school_id IS NULL)
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_roles_unique_platform
  ON user_roles (auth_user_id, role_id) WHERE school_id IS NULL;

-- School-scoped user-role assignments
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_roles_unique_school
  ON user_roles (auth_user_id, role_id, school_id) WHERE school_id IS NOT NULL;


-- ---- resource_access_rules: add school_id ----
ALTER TABLE resource_access_rules ADD COLUMN IF NOT EXISTS school_id UUID REFERENCES schools(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_resource_access_rules_school
  ON resource_access_rules (school_id) WHERE school_id IS NOT NULL;


-- ---------------------------------------------------------------------------
-- Update sync_user_roles() trigger function to handle the new partial indexes.
-- The ON CONFLICT (auth_user_id, role_id) target worked with the old table-level
-- unique constraint. Now that we replaced it with partial unique indexes we
-- must use the partial index directly.
-- SECURITY DEFINER — this trigger runs on INSERT to students/teachers/guardians
-- and must insert into user_roles regardless of the caller's RLS context.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION sync_user_roles()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role_name TEXT;
  v_role_id UUID;
BEGIN
  -- Determine role based on which table triggered this
  CASE TG_TABLE_NAME
    WHEN 'students' THEN v_role_name := 'student';
    WHEN 'teachers' THEN v_role_name := 'teacher';
    WHEN 'guardians' THEN v_role_name := 'parent';
    ELSE RETURN NEW;
  END CASE;

  -- Look up the platform role id (school_id IS NULL)
  SELECT id INTO v_role_id
  FROM roles
  WHERE name = v_role_name
    AND school_id IS NULL
    AND is_active = true;

  -- If role exists and user has auth_user_id, insert the mapping
  -- Uses the idx_user_roles_unique_platform partial index for conflict detection
  IF v_role_id IS NOT NULL AND NEW.auth_user_id IS NOT NULL THEN
    INSERT INTO user_roles (auth_user_id, role_id, school_id, is_active)
    VALUES (NEW.auth_user_id, v_role_id, NULL, true)
    ON CONFLICT (auth_user_id, role_id) WHERE school_id IS NULL
    DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;


-- ===========================================================================
-- SECTION 2: SCHOOL RBAC CONFIG — per-school RBAC settings
-- ===========================================================================

CREATE TABLE IF NOT EXISTS school_rbac_config (
  school_id                UUID PRIMARY KEY REFERENCES schools(id) ON DELETE CASCADE,
  allow_custom_roles       BOOLEAN NOT NULL DEFAULT true,
  max_custom_roles         INT NOT NULL DEFAULT 10,
  allow_custom_permissions BOOLEAN NOT NULL DEFAULT false,
  max_hierarchy_level      INT NOT NULL DEFAULT 70,
  delegation_enabled       BOOLEAN NOT NULL DEFAULT true,
  max_delegation_depth     INT NOT NULL DEFAULT 2,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE school_rbac_config ENABLE ROW LEVEL SECURITY;

-- Service role can manage all configs
CREATE POLICY school_rbac_config_service ON school_rbac_config
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- Authenticated users can read their school's config
CREATE POLICY school_rbac_config_read ON school_rbac_config
  FOR SELECT TO authenticated
  USING (
    school_id IN (
      SELECT sm.school_id FROM school_memberships sm
      WHERE sm.auth_user_id = auth.uid() AND sm.is_active = true
    )
    OR auth.uid() IN (SELECT au.auth_user_id FROM admin_users au WHERE au.is_active = true)
  );

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_school_rbac_config_updated_at()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_school_rbac_config_updated_at ON school_rbac_config;
CREATE TRIGGER trg_school_rbac_config_updated_at
  BEFORE UPDATE ON school_rbac_config
  FOR EACH ROW EXECUTE FUNCTION update_school_rbac_config_updated_at();


-- ===========================================================================
-- SECTION 3: PERMISSION CEILINGS — what a school is allowed to grant
-- ===========================================================================

CREATE TABLE IF NOT EXISTS permission_ceilings (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id     UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  is_grantable  BOOLEAN NOT NULL DEFAULT true,
  max_scope     JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(school_id, permission_id)
);

CREATE INDEX IF NOT EXISTS idx_permission_ceilings_school
  ON permission_ceilings (school_id);

ALTER TABLE permission_ceilings ENABLE ROW LEVEL SECURITY;

-- Service role can manage all ceilings
CREATE POLICY permission_ceilings_service ON permission_ceilings
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- Authenticated users can read their school's ceilings
CREATE POLICY permission_ceilings_read ON permission_ceilings
  FOR SELECT TO authenticated
  USING (
    school_id IN (
      SELECT sm.school_id FROM school_memberships sm
      WHERE sm.auth_user_id = auth.uid() AND sm.is_active = true
    )
    OR auth.uid() IN (SELECT au.auth_user_id FROM admin_users au WHERE au.is_active = true)
  );


-- ===========================================================================
-- SECTION 4: UPDATED get_user_permissions RPC
-- ===========================================================================
-- Now accepts optional p_school_id.  When provided:
--   - Fetches school-scoped roles (user_roles WHERE school_id = p_school_id)
--   - Merges with platform roles (user_roles WHERE school_id IS NULL)
--   - Returns union of permissions from both sets
-- When p_school_id is NULL (default): identical to original behavior.
--
-- SECURITY DEFINER — the original function was SECURITY DEFINER.  Retained so
-- that the caller does not need direct SELECT on user_roles/role_permissions/
-- permissions, which are gated by RLS policies.
-- ---------------------------------------------------------------------------

-- Drop the old single-parameter overload.  Without this, calling
-- get_user_permissions('uuid') would be ambiguous between the old (UUID)
-- signature and the new (UUID, UUID DEFAULT NULL) signature.
DROP FUNCTION IF EXISTS get_user_permissions(UUID);

CREATE OR REPLACE FUNCTION get_user_permissions(
  p_auth_user_id UUID,
  p_school_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'roles', COALESCE((
      SELECT jsonb_agg(DISTINCT
        jsonb_build_object(
          'name', r.name,
          'display_name', r.display_name,
          'hierarchy_level', r.hierarchy_level,
          'school_id', ur.school_id
        )
      )
      FROM user_roles ur
      JOIN roles r ON r.id = ur.role_id AND r.is_active = true
      WHERE ur.auth_user_id = p_auth_user_id
        AND ur.is_active = true
        AND (ur.expires_at IS NULL OR ur.expires_at > now())
        AND (
          -- Platform roles (always included)
          ur.school_id IS NULL
          -- School-scoped roles (only when a specific school is requested)
          OR (p_school_id IS NOT NULL AND ur.school_id = p_school_id)
          -- NULL p_school_id means "all schools" (backward compatible)
          OR p_school_id IS NULL
        )
    ), '[]'::jsonb),

    'permissions', COALESCE((
      SELECT jsonb_agg(DISTINCT p.code)
      FROM user_roles ur
      JOIN roles r ON r.id = ur.role_id AND r.is_active = true
      JOIN role_permissions rp ON rp.role_id = ur.role_id
        AND (rp.school_id IS NULL OR rp.school_id = ur.school_id)
      JOIN permissions p ON p.id = rp.permission_id AND p.is_active = true
      WHERE ur.auth_user_id = p_auth_user_id
        AND ur.is_active = true
        AND (ur.expires_at IS NULL OR ur.expires_at > now())
        AND (
          ur.school_id IS NULL
          OR (p_school_id IS NOT NULL AND ur.school_id = p_school_id)
          OR p_school_id IS NULL
        )
    ), '[]'::jsonb),

    'school_id', to_jsonb(p_school_id)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

-- Grant execute: overloaded signature (2 params) replaces the old 1-param version.
-- PostgreSQL CREATE OR REPLACE keeps existing grants when the parameter list changes
-- only if both old and new share the same name+schema.  The old signature had 1 param;
-- this new one has 2 (second with DEFAULT).  PostgreSQL treats this as the same function
-- when the name matches and the first param type matches, so existing grants carry over.
-- Re-grant to be safe.
GRANT EXECUTE ON FUNCTION get_user_permissions(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_permissions(UUID, UUID) TO service_role;


-- ===========================================================================
-- SECTION 5: SCHOOL ONBOARDING — clone_platform_rbac_for_school RPC
-- ===========================================================================
-- Called when a new school is created.  Copies platform roles and
-- role_permissions into school-scoped rows, seeds permission_ceilings,
-- and optionally assigns institution_admin to the school admin user.
--
-- SECURITY DEFINER — must insert into roles, role_permissions,
-- permission_ceilings, user_roles, and school_rbac_config regardless of the
-- caller's RLS context.  Expected to be called from server-side code
-- (supabase-admin / service role) during school onboarding.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION clone_platform_rbac_for_school(
  p_school_id UUID,
  p_admin_user_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_roles_cloned  INT := 0;
  v_perms_cloned  INT := 0;
  v_role_record   RECORD;
  v_new_role_id   UUID;
  v_rp_count      INT;
BEGIN
  -- 1. Create school_rbac_config with defaults
  INSERT INTO school_rbac_config (school_id)
  VALUES (p_school_id)
  ON CONFLICT (school_id) DO NOTHING;

  -- 2. Clone customizable platform roles (school_id IS NULL, is_customizable = true)
  --    Never clone platform admin roles (super_admin, admin).
  FOR v_role_record IN
    SELECT id, name, display_name, display_name_hi, description, hierarchy_level
    FROM roles
    WHERE school_id IS NULL
      AND is_active = true
      AND is_customizable = true
      AND name NOT IN ('super_admin', 'admin')
  LOOP
    INSERT INTO roles (
      name, display_name, display_name_hi, description,
      hierarchy_level, is_system_role, is_active,
      school_id, source_role_id, is_customizable
    ) VALUES (
      v_role_record.name,
      v_role_record.display_name,
      v_role_record.display_name_hi,
      v_role_record.description,
      v_role_record.hierarchy_level,
      false,   -- School-cloned roles are not system roles
      true,
      p_school_id,
      v_role_record.id,   -- Track source for upgrade sync
      true
    )
    ON CONFLICT DO NOTHING
    RETURNING id INTO v_new_role_id;

    IF v_new_role_id IS NOT NULL THEN
      v_roles_cloned := v_roles_cloned + 1;

      -- Clone role_permissions for this role
      INSERT INTO role_permissions (role_id, permission_id, school_id, granted_by)
      SELECT v_new_role_id, rp.permission_id, p_school_id, p_admin_user_id
      FROM role_permissions rp
      WHERE rp.role_id = v_role_record.id
        AND rp.school_id IS NULL;  -- Only clone platform-level grants

      GET DIAGNOSTICS v_rp_count = ROW_COUNT;
      v_perms_cloned := v_perms_cloned + v_rp_count;
    END IF;
  END LOOP;

  -- 3. Seed permission ceilings: all platform permissions are grantable
  --    EXCEPT system.* and analytics.* (platform-only capabilities).
  INSERT INTO permission_ceilings (school_id, permission_id, is_grantable)
  SELECT p_school_id, p.id, true
  FROM permissions p
  WHERE p.school_id IS NULL
    AND p.is_active = true
    AND p.code NOT LIKE 'system.%'
    AND p.code NOT LIKE 'analytics.%'
  ON CONFLICT (school_id, permission_id) DO NOTHING;

  -- 4. If admin user provided, assign institution_admin role (school-scoped)
  IF p_admin_user_id IS NOT NULL THEN
    INSERT INTO user_roles (auth_user_id, role_id, school_id, is_active)
    SELECT p_admin_user_id, r.id, p_school_id, true
    FROM roles r
    WHERE r.name = 'institution_admin'
      AND r.school_id = p_school_id
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'school_id', p_school_id,
    'roles_cloned', v_roles_cloned,
    'permissions_cloned', v_perms_cloned
  );
END;
$$;

GRANT EXECUTE ON FUNCTION clone_platform_rbac_for_school(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION clone_platform_rbac_for_school(UUID, UUID) TO service_role;
