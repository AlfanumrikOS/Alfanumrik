-- Migration: 20260418120000_super_admin_access_permission_seed.sql
-- Purpose: Seed the `super_admin.access` permission required by the 5 super-admin
--          grounding API routes (health, coverage, verification-queue, traces,
--          ai-issues) and grant it to the super_admin role.
--
-- Why this migration exists:
--   Batch 3C introduced API routes that call `authorizeRequest(req, 'super_admin.access')`
--   but the permission row itself was never seeded. Without this migration, all 5
--   routes return 403 in production even for super_admin users (the RBAC layer can't
--   resolve the permission code to any role).
--
-- Idempotency: both inserts use ON CONFLICT DO NOTHING — safe to re-run.
--
-- Role assignment matrix:
--   super_admin  — granted explicitly below
--   admin        — already holds ALL permissions via wildcard grant in base
--                  RBAC migration (20260324070000_production_rbac_system.sql)
--   institution_admin, teacher, parent, student — NOT granted (intentional)

-- ─── 1. Insert permission definition ─────────────────────────────────────────

INSERT INTO permissions (code, resource, action, description, is_active) VALUES
  ('super_admin.access',
   'super_admin',
   'access',
   'Access the super-admin panel and super-admin API routes (platform-level observability, RBAC, grounding, CMS, billing, etc.)',
   true)
ON CONFLICT (code) DO NOTHING;

-- ─── 2. Grant to super_admin role ────────────────────────────────────────────

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'super_admin'
  AND p.code = 'super_admin.access'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ─── 3. Backfill admin wildcard (safe if base migration already ran) ─────────
-- Mirrors the pattern in 20260409000005_add_diagnostic_permissions.sql

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'admin'
  AND p.code = 'super_admin.access'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ─── Verification query (manual check after applying) ────────────────────────
-- SELECT r.name AS role, p.code AS permission
--   FROM role_permissions rp
--   JOIN roles r ON r.id = rp.role_id
--   JOIN permissions p ON p.id = rp.permission_id
--  WHERE p.code = 'super_admin.access'
--  ORDER BY r.name;
--
-- Expected: 2 rows — admin, super_admin.
