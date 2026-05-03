-- Migration: 20260409000005_add_diagnostic_permissions.sql
-- Purpose: Seed diagnostic.attempt and diagnostic.complete permissions for the
--          student role, enabling authorizeRequest() enforcement on the
--          /api/diagnostic/start and /api/diagnostic/complete routes.
--
-- Role assignment:
--   student    — both permissions granted explicitly below
--   admin      — already holds ALL permissions via wildcard grant in
--                20260324070000_production_rbac_system.sql; no change needed
--   super_admin — already holds ALL permissions + runtime bypass in hasPermission();
--                no change needed

-- ─── 1. Insert permission definitions (idempotent via ON CONFLICT DO NOTHING) ─

INSERT INTO permissions (code, resource, action, description) VALUES
  ('diagnostic.attempt',
   'diagnostic',
   'attempt',
   'Start a new diagnostic assessment session (POST /api/diagnostic/start)'),
  ('diagnostic.complete',
   'diagnostic',
   'complete',
   'Submit responses and complete a diagnostic session (POST /api/diagnostic/complete)')
ON CONFLICT (code) DO NOTHING;

-- ─── 2. Grant both permissions to the student role ────────────────────────────

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'student'
  AND p.code IN ('diagnostic.attempt', 'diagnostic.complete')
ON CONFLICT DO NOTHING;

-- ─── 3. Backfill: admin and super_admin already receive ALL permissions via ───
--        the wildcard INSERT in the base RBAC migration.  Re-run that pattern
--        here to ensure these new permissions are covered even if the base
--        migration ran before this one (e.g. in a fresh restore from backup).

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name IN ('admin', 'super_admin')
  AND p.code IN ('diagnostic.attempt', 'diagnostic.complete')
ON CONFLICT DO NOTHING;

-- ─── Verify (manual check after applying) ────────────────────────────────────
-- SELECT r.name AS role, p.code AS permission
--   FROM role_permissions rp
--   JOIN roles r ON r.id = rp.role_id
--   JOIN permissions p ON p.id = rp.permission_id
--  WHERE p.code IN ('diagnostic.attempt', 'diagnostic.complete')
--  ORDER BY r.name, p.code;
--
-- Expected: 6 rows — student/admin/super_admin × 2 permissions each.
