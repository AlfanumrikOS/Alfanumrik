-- =============================================================================
-- Production RBAC System for Alfanumrik EdTech Platform
-- Migration: 20260324070000_production_rbac_system.sql
--
-- Implements a granular permissions-based RBAC layer on top of the existing
-- auth system (students, teachers, guardians with auth_user_id, 148+ RLS
-- policies, get_user_role() RPC).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. PERMISSIONS TABLE - Granular permission definitions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  resource TEXT NOT NULL,
  action TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_permissions_resource ON permissions(resource);
CREATE INDEX IF NOT EXISTS idx_permissions_code ON permissions(code);

-- ---------------------------------------------------------------------------
-- 2. ROLES TABLE - Named roles (extensible, not hardcoded)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  display_name_hi TEXT,
  description TEXT,
  hierarchy_level INTEGER DEFAULT 0,
  is_system_role BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_roles_name ON roles(name);
CREATE INDEX IF NOT EXISTS idx_roles_hierarchy ON roles(hierarchy_level);

-- ---------------------------------------------------------------------------
-- 3. ROLE_PERMISSIONS TABLE - Maps roles to permissions (M:N)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS role_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  granted_at TIMESTAMPTZ DEFAULT now(),
  granted_by UUID,
  UNIQUE(role_id, permission_id)
);

CREATE INDEX IF NOT EXISTS idx_role_permissions_role ON role_permissions(role_id);
CREATE INDEX IF NOT EXISTS idx_role_permissions_permission ON role_permissions(permission_id);

-- ---------------------------------------------------------------------------
-- 4. USER_ROLES TABLE - Maps users to roles (supports multi-role)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id UUID NOT NULL,
  role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  is_active BOOLEAN DEFAULT true,
  assigned_at TIMESTAMPTZ DEFAULT now(),
  assigned_by UUID,
  expires_at TIMESTAMPTZ,
  UNIQUE(auth_user_id, role_id)
);

CREATE INDEX IF NOT EXISTS idx_user_roles_auth_user ON user_roles(auth_user_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_role ON user_roles(role_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_active ON user_roles(auth_user_id, is_active) WHERE is_active = true;

-- ---------------------------------------------------------------------------
-- 5. AUDIT_LOGS TABLE - Comprehensive audit trail
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id UUID,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  details JSONB DEFAULT '{}',
  ip_address INET,
  user_agent TEXT,
  status TEXT DEFAULT 'success' CHECK (status IN ('success', 'failure', 'denied')),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- BRIN index for time-series queries (much more efficient than B-tree for append-only)
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs USING BRIN (created_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_auth_user ON audit_logs(auth_user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_resource ON audit_logs(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);

-- ---------------------------------------------------------------------------
-- 6. RESOURCE_ACCESS_RULES TABLE - Fine-grained resource-level access
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS resource_access_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  resource_type TEXT NOT NULL,
  ownership_check TEXT NOT NULL DEFAULT 'own',
  field_restrictions JSONB DEFAULT '[]',
  max_records_per_request INTEGER DEFAULT 100,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_resource_access_rules_role ON resource_access_rules(role_id);
CREATE INDEX IF NOT EXISTS idx_resource_access_rules_resource ON resource_access_rules(resource_type);

-- ---------------------------------------------------------------------------
-- 7. API_KEYS TABLE - Service account / API key management
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  auth_user_id UUID,
  role_id UUID REFERENCES roles(id),
  permissions JSONB DEFAULT '[]',
  rate_limit_per_minute INTEGER DEFAULT 60,
  is_active BOOLEAN DEFAULT true,
  last_used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_api_keys_auth_user ON api_keys(auth_user_id);

-- ---------------------------------------------------------------------------
-- 8. ADMIN_USERS TABLE - Platform administrators
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS admin_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id UUID NOT NULL UNIQUE,
  name TEXT NOT NULL,
  email TEXT,
  admin_level TEXT DEFAULT 'admin' CHECK (admin_level IN ('super_admin', 'admin', 'moderator')),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_users_auth_user ON admin_users(auth_user_id);
CREATE INDEX IF NOT EXISTS idx_admin_users_active ON admin_users(is_active) WHERE is_active = true;


-- ===========================================================================
-- ENABLE ROW LEVEL SECURITY ON ALL TABLES
-- ===========================================================================
ALTER TABLE permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE resource_access_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_users ENABLE ROW LEVEL SECURITY;


-- ===========================================================================
-- RLS POLICIES
-- ===========================================================================

-- ---- permissions: READ for all authenticated, WRITE for admins ----
CREATE POLICY permissions_select ON permissions
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY permissions_insert ON permissions
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IN (SELECT auth_user_id FROM admin_users WHERE is_active = true));

CREATE POLICY permissions_update ON permissions
  FOR UPDATE TO authenticated
  USING (auth.uid() IN (SELECT auth_user_id FROM admin_users WHERE is_active = true))
  WITH CHECK (auth.uid() IN (SELECT auth_user_id FROM admin_users WHERE is_active = true));

CREATE POLICY permissions_delete ON permissions
  FOR DELETE TO authenticated
  USING (auth.uid() IN (SELECT auth_user_id FROM admin_users WHERE is_active = true));

-- ---- roles: READ for all authenticated, WRITE for admins ----
CREATE POLICY roles_select ON roles
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY roles_insert ON roles
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IN (SELECT auth_user_id FROM admin_users WHERE is_active = true));

CREATE POLICY roles_update ON roles
  FOR UPDATE TO authenticated
  USING (auth.uid() IN (SELECT auth_user_id FROM admin_users WHERE is_active = true))
  WITH CHECK (auth.uid() IN (SELECT auth_user_id FROM admin_users WHERE is_active = true));

CREATE POLICY roles_delete ON roles
  FOR DELETE TO authenticated
  USING (auth.uid() IN (SELECT auth_user_id FROM admin_users WHERE is_active = true));

-- ---- role_permissions: READ for all authenticated, WRITE for admins ----
CREATE POLICY role_permissions_select ON role_permissions
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY role_permissions_insert ON role_permissions
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IN (SELECT auth_user_id FROM admin_users WHERE is_active = true));

CREATE POLICY role_permissions_update ON role_permissions
  FOR UPDATE TO authenticated
  USING (auth.uid() IN (SELECT auth_user_id FROM admin_users WHERE is_active = true))
  WITH CHECK (auth.uid() IN (SELECT auth_user_id FROM admin_users WHERE is_active = true));

CREATE POLICY role_permissions_delete ON role_permissions
  FOR DELETE TO authenticated
  USING (auth.uid() IN (SELECT auth_user_id FROM admin_users WHERE is_active = true));

-- ---- user_roles: Users read own, admins read/write all ----
CREATE POLICY user_roles_select_own ON user_roles
  FOR SELECT TO authenticated
  USING (
    auth_user_id = auth.uid()
    OR auth.uid() IN (SELECT auth_user_id FROM admin_users WHERE is_active = true)
  );

CREATE POLICY user_roles_insert ON user_roles
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IN (SELECT auth_user_id FROM admin_users WHERE is_active = true));

CREATE POLICY user_roles_update ON user_roles
  FOR UPDATE TO authenticated
  USING (auth.uid() IN (SELECT auth_user_id FROM admin_users WHERE is_active = true))
  WITH CHECK (auth.uid() IN (SELECT auth_user_id FROM admin_users WHERE is_active = true));

CREATE POLICY user_roles_delete ON user_roles
  FOR DELETE TO authenticated
  USING (auth.uid() IN (SELECT auth_user_id FROM admin_users WHERE is_active = true));

-- ---- audit_logs: Users read own, admins read all, system can insert ----
CREATE POLICY audit_logs_select ON audit_logs
  FOR SELECT TO authenticated
  USING (
    auth_user_id = auth.uid()
    OR auth.uid() IN (SELECT auth_user_id FROM admin_users WHERE is_active = true)
  );

CREATE POLICY audit_logs_insert ON audit_logs
  FOR INSERT TO authenticated
  WITH CHECK (true);

-- ---- resource_access_rules: READ for all authenticated ----
CREATE POLICY resource_access_rules_select ON resource_access_rules
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY resource_access_rules_insert ON resource_access_rules
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IN (SELECT auth_user_id FROM admin_users WHERE is_active = true));

CREATE POLICY resource_access_rules_update ON resource_access_rules
  FOR UPDATE TO authenticated
  WITH CHECK (auth.uid() IN (SELECT auth_user_id FROM admin_users WHERE is_active = true));

CREATE POLICY resource_access_rules_delete ON resource_access_rules
  FOR DELETE TO authenticated
  USING (auth.uid() IN (SELECT auth_user_id FROM admin_users WHERE is_active = true));

-- ---- api_keys: Only key owner or admin can read ----
CREATE POLICY api_keys_select ON api_keys
  FOR SELECT TO authenticated
  USING (
    auth_user_id = auth.uid()
    OR auth.uid() IN (SELECT auth_user_id FROM admin_users WHERE is_active = true)
  );

CREATE POLICY api_keys_insert ON api_keys
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IN (SELECT auth_user_id FROM admin_users WHERE is_active = true));

CREATE POLICY api_keys_update ON api_keys
  FOR UPDATE TO authenticated
  USING (
    auth_user_id = auth.uid()
    OR auth.uid() IN (SELECT auth_user_id FROM admin_users WHERE is_active = true)
  )
  WITH CHECK (
    auth_user_id = auth.uid()
    OR auth.uid() IN (SELECT auth_user_id FROM admin_users WHERE is_active = true)
  );

CREATE POLICY api_keys_delete ON api_keys
  FOR DELETE TO authenticated
  USING (auth.uid() IN (SELECT auth_user_id FROM admin_users WHERE is_active = true));

-- ---- admin_users: Only admins can access ----
CREATE POLICY admin_users_select ON admin_users
  FOR SELECT TO authenticated
  USING (auth.uid() IN (SELECT auth_user_id FROM admin_users WHERE is_active = true));

CREATE POLICY admin_users_insert ON admin_users
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IN (SELECT auth_user_id FROM admin_users WHERE is_active = true));

CREATE POLICY admin_users_update ON admin_users
  FOR UPDATE TO authenticated
  USING (auth.uid() IN (SELECT auth_user_id FROM admin_users WHERE is_active = true))
  WITH CHECK (auth.uid() IN (SELECT auth_user_id FROM admin_users WHERE is_active = true));

CREATE POLICY admin_users_delete ON admin_users
  FOR DELETE TO authenticated
  USING (auth.uid() IN (SELECT auth_user_id FROM admin_users WHERE is_active = true));


-- ===========================================================================
-- FUNCTIONS
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- check_permission: Check if user has a specific permission through their roles
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION check_permission(p_auth_user_id UUID, p_permission_code TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM user_roles ur
    JOIN role_permissions rp ON rp.role_id = ur.role_id
    JOIN permissions p ON p.id = rp.permission_id
    WHERE ur.auth_user_id = p_auth_user_id
      AND ur.is_active = true
      AND (ur.expires_at IS NULL OR ur.expires_at > now())
      AND p.code = p_permission_code
      AND p.is_active = true
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- get_user_permissions: Return all permissions for a user as JSONB
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_user_permissions(p_auth_user_id UUID)
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
      SELECT jsonb_agg(
        jsonb_build_object(
          'name', r.name,
          'display_name', r.display_name,
          'hierarchy_level', r.hierarchy_level
        )
      )
      FROM user_roles ur
      JOIN roles r ON r.id = ur.role_id
      WHERE ur.auth_user_id = p_auth_user_id
        AND ur.is_active = true
        AND (ur.expires_at IS NULL OR ur.expires_at > now())
    ), '[]'::jsonb),
    'permissions', COALESCE((
      SELECT jsonb_agg(DISTINCT p.code)
      FROM user_roles ur
      JOIN role_permissions rp ON rp.role_id = ur.role_id
      JOIN permissions p ON p.id = rp.permission_id
      WHERE ur.auth_user_id = p_auth_user_id
        AND ur.is_active = true
        AND (ur.expires_at IS NULL OR ur.expires_at > now())
        AND p.is_active = true
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

-- ---------------------------------------------------------------------------
-- log_audit: Insert an audit log entry
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION log_audit(
  p_auth_user_id UUID,
  p_action TEXT,
  p_resource_type TEXT,
  p_resource_id TEXT DEFAULT NULL,
  p_details JSONB DEFAULT '{}'::jsonb,
  p_status TEXT DEFAULT 'success'
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO audit_logs (auth_user_id, action, resource_type, resource_id, details, status)
  VALUES (p_auth_user_id, p_action, p_resource_type, p_resource_id, p_details, p_status);
END;
$$;

-- ---------------------------------------------------------------------------
-- check_resource_access: Check if user can access a specific resource
-- based on ownership rules (own, linked, assigned, any)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION check_resource_access(
  p_auth_user_id UUID,
  p_resource_type TEXT,
  p_resource_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rule RECORD;
  v_has_access BOOLEAN := false;
BEGIN
  -- Check each role the user has for matching resource access rules
  FOR v_rule IN
    SELECT rar.ownership_check
    FROM user_roles ur
    JOIN resource_access_rules rar ON rar.role_id = ur.role_id
    WHERE ur.auth_user_id = p_auth_user_id
      AND ur.is_active = true
      AND (ur.expires_at IS NULL OR ur.expires_at > now())
      AND rar.resource_type = p_resource_type
  LOOP
    -- 'any' means unrestricted access
    IF v_rule.ownership_check = 'any' THEN
      RETURN true;
    END IF;

    -- 'own' means the user owns the resource (auth_user_id matches)
    IF v_rule.ownership_check = 'own' THEN
      -- Check students table
      IF p_resource_type IN ('student', 'quiz', 'study_plan', 'report', 'image') THEN
        SELECT true INTO v_has_access
        FROM students
        WHERE auth_user_id = p_auth_user_id
          AND id = p_resource_id;
        IF v_has_access THEN RETURN true; END IF;
      END IF;
    END IF;

    -- 'linked' means parent-child relationship via guardian_student_links
    IF v_rule.ownership_check = 'linked' THEN
      SELECT true INTO v_has_access
      FROM guardian_student_links gsl
      JOIN guardians g ON g.id = gsl.guardian_id
      WHERE g.auth_user_id = p_auth_user_id
        AND gsl.student_id = p_resource_id;
      IF v_has_access THEN RETURN true; END IF;
    END IF;

    -- 'assigned' means teacher is assigned to the class the student belongs to
    IF v_rule.ownership_check = 'assigned' THEN
      SELECT true INTO v_has_access
      FROM class_teachers ct
      JOIN class_students cs ON cs.class_id = ct.class_id
      JOIN teachers t ON t.id = ct.teacher_id
      WHERE t.auth_user_id = p_auth_user_id
        AND cs.student_id = p_resource_id;
      IF v_has_access THEN RETURN true; END IF;
    END IF;
  END LOOP;

  RETURN false;
END;
$$;

-- ---------------------------------------------------------------------------
-- sync_user_roles: Trigger function that auto-creates user_roles entries
-- when a student/teacher/guardian is created. Keeps backward compatibility.
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

  -- Look up the role id
  SELECT id INTO v_role_id FROM roles WHERE name = v_role_name AND is_active = true;

  -- If role exists and user has auth_user_id, insert the mapping
  IF v_role_id IS NOT NULL AND NEW.auth_user_id IS NOT NULL THEN
    INSERT INTO user_roles (auth_user_id, role_id, is_active)
    VALUES (NEW.auth_user_id, v_role_id, true)
    ON CONFLICT (auth_user_id, role_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- Create triggers for auto-syncing user roles
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  -- Students trigger
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_sync_user_roles_students'
  ) THEN
    CREATE TRIGGER trg_sync_user_roles_students
      AFTER INSERT ON students
      FOR EACH ROW
      EXECUTE FUNCTION sync_user_roles();
  END IF;

  -- Teachers trigger
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_sync_user_roles_teachers'
  ) THEN
    CREATE TRIGGER trg_sync_user_roles_teachers
      AFTER INSERT ON teachers
      FOR EACH ROW
      EXECUTE FUNCTION sync_user_roles();
  END IF;

  -- Guardians trigger
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_sync_user_roles_guardians'
  ) THEN
    CREATE TRIGGER trg_sync_user_roles_guardians
      AFTER INSERT ON guardians
      FOR EACH ROW
      EXECUTE FUNCTION sync_user_roles();
  END IF;
END;
$$;


-- ===========================================================================
-- SEED DATA
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Seed Roles
-- ---------------------------------------------------------------------------
INSERT INTO roles (name, display_name, display_name_hi, hierarchy_level, is_system_role) VALUES
  ('student', 'Student', 'छात्र', 10, true),
  ('parent', 'Parent', 'अभिभावक', 30, true),
  ('teacher', 'Teacher', 'शिक्षक', 50, true),
  ('tutor', 'Tutor', 'ट्यूटर', 40, false),
  ('admin', 'Admin', 'एडमिन', 90, true),
  ('super_admin', 'Super Admin', 'सुपर एडमिन', 100, true)
ON CONFLICT (name) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Seed Permissions
-- ---------------------------------------------------------------------------
INSERT INTO permissions (code, resource, action, description) VALUES
  -- Student permissions
  ('study_plan.view', 'study_plan', 'view', 'View assigned study plans'),
  ('study_plan.create', 'study_plan', 'create', 'Generate new study plans'),
  ('quiz.attempt', 'quiz', 'attempt', 'Attempt quizzes and tests'),
  ('quiz.view_results', 'quiz', 'view', 'View own quiz results'),
  ('exam.view', 'exam', 'view', 'View own exam configurations'),
  ('exam.create', 'exam', 'create', 'Create exam configurations'),
  ('image.upload', 'image', 'upload', 'Upload assignment/question images'),
  ('image.view_own', 'image', 'view', 'View own uploaded images'),
  ('report.view_own', 'report', 'view', 'View own performance reports'),
  ('report.download_own', 'report', 'download', 'Download own monthly reports'),
  ('review.view', 'review', 'view', 'View spaced repetition cards'),
  ('review.practice', 'review', 'practice', 'Practice flashcards'),
  ('foxy.chat', 'foxy', 'chat', 'Chat with Foxy AI tutor'),
  ('simulation.view', 'simulation', 'view', 'View interactive simulations'),
  ('simulation.interact', 'simulation', 'interact', 'Use interactive simulations'),
  ('leaderboard.view', 'leaderboard', 'view', 'View leaderboard'),
  ('profile.view_own', 'profile', 'view', 'View own profile'),
  ('profile.update_own', 'profile', 'update', 'Update own profile'),
  ('notification.view', 'notification', 'view', 'View notifications'),
  ('notification.dismiss', 'notification', 'update', 'Dismiss notifications'),
  ('progress.view_own', 'progress', 'view', 'View own learning progress'),
  -- Parent permissions
  ('child.view_performance', 'child', 'view', 'View linked child performance'),
  ('child.view_progress', 'child', 'view_progress', 'View linked child progress'),
  ('child.download_report', 'child', 'download', 'Download child monthly report'),
  ('child.view_exams', 'child', 'view_exams', 'View child exam schedule'),
  ('child.receive_alerts', 'child', 'alerts', 'Receive alerts about child'),
  -- Teacher permissions
  ('class.manage', 'class', 'manage', 'Manage classes and enrollments'),
  ('class.view_analytics', 'class', 'analytics', 'View class analytics'),
  ('exam.assign', 'exam', 'assign', 'Assign exams to classes'),
  ('exam.create_for_class', 'exam', 'create_class', 'Create exams for class'),
  ('test.create', 'test', 'create', 'Create tests and quizzes'),
  ('test.edit', 'test', 'edit', 'Edit tests and quizzes'),
  ('student.view_uploads', 'student', 'view_uploads', 'Review student uploaded images'),
  ('student.provide_feedback', 'student', 'feedback', 'Provide feedback to students'),
  ('worksheet.create', 'worksheet', 'create', 'Create worksheets'),
  ('worksheet.assign', 'worksheet', 'assign', 'Assign worksheets'),
  ('report.view_class', 'report', 'view_class', 'View class performance reports'),
  -- Admin permissions
  ('user.manage', 'user', 'manage', 'Manage all users'),
  ('role.manage', 'role', 'manage', 'Manage roles and permissions'),
  ('permission.manage', 'permission', 'manage', 'Manage permission definitions'),
  ('system.audit', 'system', 'audit', 'View audit logs'),
  ('system.config', 'system', 'config', 'Manage system configuration'),
  ('content.manage', 'content', 'manage', 'Manage curriculum content'),
  ('analytics.global', 'analytics', 'global', 'View global platform analytics')
ON CONFLICT (code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Seed Role-Permission Mappings
-- ---------------------------------------------------------------------------

-- Student gets student permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'student' AND p.code IN (
  'study_plan.view', 'study_plan.create', 'quiz.attempt', 'quiz.view_results',
  'exam.view', 'exam.create', 'image.upload', 'image.view_own',
  'report.view_own', 'report.download_own', 'review.view', 'review.practice',
  'foxy.chat', 'simulation.view', 'simulation.interact', 'leaderboard.view',
  'profile.view_own', 'profile.update_own', 'notification.view', 'notification.dismiss',
  'progress.view_own'
)
ON CONFLICT DO NOTHING;

-- Parent gets parent + shared permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'parent' AND p.code IN (
  'child.view_performance', 'child.view_progress', 'child.download_report',
  'child.view_exams', 'child.receive_alerts',
  'profile.view_own', 'profile.update_own', 'notification.view', 'notification.dismiss'
)
ON CONFLICT DO NOTHING;

-- Teacher gets teacher + shared permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'teacher' AND p.code IN (
  'class.manage', 'class.view_analytics',
  'exam.assign', 'exam.create_for_class', 'test.create', 'test.edit',
  'student.view_uploads', 'student.provide_feedback',
  'worksheet.create', 'worksheet.assign', 'report.view_class',
  'profile.view_own', 'profile.update_own', 'notification.view', 'notification.dismiss',
  'leaderboard.view'
)
ON CONFLICT DO NOTHING;

-- Admin gets ALL permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'admin'
ON CONFLICT DO NOTHING;

-- Super Admin gets ALL permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'super_admin'
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- Seed Resource Access Rules
-- ---------------------------------------------------------------------------
INSERT INTO resource_access_rules (role_id, resource_type, ownership_check) VALUES
  ((SELECT id FROM roles WHERE name = 'student'), 'student', 'own'),
  ((SELECT id FROM roles WHERE name = 'student'), 'quiz', 'own'),
  ((SELECT id FROM roles WHERE name = 'student'), 'study_plan', 'own'),
  ((SELECT id FROM roles WHERE name = 'student'), 'report', 'own'),
  ((SELECT id FROM roles WHERE name = 'student'), 'image', 'own'),
  ((SELECT id FROM roles WHERE name = 'parent'), 'student', 'linked'),
  ((SELECT id FROM roles WHERE name = 'parent'), 'report', 'linked'),
  ((SELECT id FROM roles WHERE name = 'parent'), 'image', 'linked'),
  ((SELECT id FROM roles WHERE name = 'teacher'), 'student', 'assigned'),
  ((SELECT id FROM roles WHERE name = 'teacher'), 'class', 'assigned'),
  ((SELECT id FROM roles WHERE name = 'teacher'), 'report', 'assigned'),
  ((SELECT id FROM roles WHERE name = 'teacher'), 'image', 'assigned'),
  ((SELECT id FROM roles WHERE name = 'admin'), 'student', 'any'),
  ((SELECT id FROM roles WHERE name = 'admin'), 'report', 'any'),
  ((SELECT id FROM roles WHERE name = 'admin'), 'class', 'any');

-- ---------------------------------------------------------------------------
-- Backfill existing users into user_roles
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_student_role_id UUID;
  v_teacher_role_id UUID;
  v_parent_role_id UUID;
BEGIN
  SELECT id INTO v_student_role_id FROM roles WHERE name = 'student';
  SELECT id INTO v_teacher_role_id FROM roles WHERE name = 'teacher';
  SELECT id INTO v_parent_role_id FROM roles WHERE name = 'parent';

  -- Backfill students
  IF v_student_role_id IS NOT NULL THEN
    INSERT INTO user_roles (auth_user_id, role_id, is_active)
    SELECT DISTINCT s.auth_user_id, v_student_role_id, true
    FROM students s
    WHERE s.auth_user_id IS NOT NULL
    ON CONFLICT (auth_user_id, role_id) DO NOTHING;
  END IF;

  -- Backfill teachers
  IF v_teacher_role_id IS NOT NULL THEN
    INSERT INTO user_roles (auth_user_id, role_id, is_active)
    SELECT DISTINCT t.auth_user_id, v_teacher_role_id, true
    FROM teachers t
    WHERE t.auth_user_id IS NOT NULL
    ON CONFLICT (auth_user_id, role_id) DO NOTHING;
  END IF;

  -- Backfill guardians as parents
  IF v_parent_role_id IS NOT NULL THEN
    INSERT INTO user_roles (auth_user_id, role_id, is_active)
    SELECT DISTINCT g.auth_user_id, v_parent_role_id, true
    FROM guardians g
    WHERE g.auth_user_id IS NOT NULL
    ON CONFLICT (auth_user_id, role_id) DO NOTHING;
  END IF;
END;
$$;

-- ===========================================================================
-- GRANT EXECUTE on functions to authenticated users
-- ===========================================================================
GRANT EXECUTE ON FUNCTION check_permission(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_permissions(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION log_audit(UUID, TEXT, TEXT, TEXT, JSONB, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION check_resource_access(UUID, TEXT, UUID) TO authenticated;
