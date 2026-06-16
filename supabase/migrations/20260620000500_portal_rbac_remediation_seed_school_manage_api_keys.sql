-- Migration: 20260620000500_portal_rbac_remediation_seed_school_manage_api_keys.sql
-- Purpose: FIX A (P0) of the portal RBAC SaaS remediation FIX PASS.
--          Seed the permission code `school.manage_api_keys` and GRANT it to the
--          `institution_admin` role (+ defensive admin/super_admin), fixing the
--          school-admin API-keys routes that authorize against a code held by NO
--          role when the school-admin RBAC flag resolves to the `off` branch.
--
-- ─── Why this migration exists ───────────────────────────────────────────────
--   src/app/api/school-admin/api-keys/route.ts (GET/POST/DELETE) authorizes via:
--       authorizeSchoolAdmin(request,
--         await schoolAdminPermissionCode({
--           off: 'school.manage_api_keys', on: 'institution.manage' }))
--   With ff_school_admin_rbac ON the `on` code (`institution.manage`) resolves and
--   is already granted. BUT when the flag is OFF / scoped, the `off` code
--   `school.manage_api_keys` resolves — and that code is granted to NO role, so
--   authorizeSchoolAdmin -> authorizeRequest(request, 'school.manage_api_keys')
--   403s EVERY school admin on all three verbs. The routes already reference the
--   code; seeding it + granting it to institution_admin is the complete fix.
--   This mirrors the identical Phase 0 fix shipped for `school.manage_exams`
--   (20260620000000) — same root cause (live route, code in no role).
--
-- ─── Scope / safety contract (HARD CONSTRAINTS — mirrors 20260620000000) ──────
--   - ADDITIVE ONLY. No DROP / DELETE / UPDATE / TRUNCATE. No destructive op.
--   - NO NEW TABLES -> no new RLS policy required. Only `permissions` and
--     `role_permissions` rows are inserted through the service-role migration
--     runner, exactly as every prior RBAC seed migration. The existing baseline
--     RLS posture on permissions/roles/role_permissions is unchanged.
--   - IDEMPOTENT / re-runnable. Every INSERT is guarded:
--       * permissions      -> ON CONFLICT (code) DO NOTHING
--                             (UNIQUE constraint permissions_code_key).
--       * role_permissions -> ON CONFLICT (role_id, permission_id) DO NOTHING
--                             (UNIQUE constraint
--                              role_permissions_role_id_permission_id_key).
--     Safe to replay on PROD, main-staging, CI live-DB, and fresh DBs.
--   - RESOLVE BY NAME / CODE, NEVER BY HARDCODED UUID. Every grant is a
--     roles x permissions SELECT-join keyed on r.name / p.code, mirroring the
--     established seed pattern. If a referenced role/permission is absent on a
--     partially-seeded DB the join yields zero rows (a silent no-op).
--   - COLUMN SHAPE. The `permissions` table is (id, code, resource, action,
--     description, is_active, created_at) — confirmed against the baseline
--     (00000000000000_baseline_from_prod.sql). There is NO `category` column;
--     categorisation is carried by `resource` (here: 'school'), matching every
--     existing school.* row and 20260620000000's shape.
--
-- ─── CEO approval posture ────────────────────────────────────────────────────
--   `school.manage_api_keys` is a NEW permission code and a NEW grant; per the
--   constitution RBAC permission additions require user approval — this is part
--   of the CEO-approved portal RBAC remediation FIX PASS (same authority as the
--   sibling `school.manage_exams` seed in 20260620000000).
--
-- ─── Cache behaviour post-deploy ─────────────────────────────────────────────
--   src/lib/rbac.ts caches per-user permission sets with a 5-minute TTL. After
--   this migration grants school.manage_api_keys to institution_admin, any school
--   admin with an active cached permission set picks the grant up within 5 minutes
--   (or on next cache miss). No manual invalidation required.
--
-- Owner: architect. Portal RBAC SaaS remediation FIX PASS — FIX A.

BEGIN;

-- =============================================================================
-- 1. NEW PERMISSION CODE: school.manage_api_keys  (the 403 fix)
-- =============================================================================
-- Grouped under the `school` resource alongside the rest of the institution_admin
-- school.* family (school.manage_exams, school.manage_branding, ...).
INSERT INTO permissions (code, resource, action, description, is_active) VALUES
  ('school.manage_api_keys',
   'school',
   'manage_api_keys',
   'Generate, list, and revoke school-scoped API keys (school-admin API keys console)',
   true)
ON CONFLICT (code) DO NOTHING;

-- GRANT school.manage_api_keys -> institution_admin (the school-admin role).
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM roles r, permissions p
 WHERE r.name = 'institution_admin'
   AND p.code = 'school.manage_api_keys'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Defensive: ensure admin + super_admin also hold school.manage_api_keys
-- explicitly, so the grant is present even on an env where this file replays
-- without the wildcard matrix migration re-running afterwards.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM roles r, permissions p
 WHERE r.name IN ('admin', 'super_admin')
   AND p.code = 'school.manage_api_keys'
ON CONFLICT (role_id, permission_id) DO NOTHING;

COMMIT;

-- ─── Verify (manual check after applying) ────────────────────────────────────
-- school.manage_api_keys now exists and is granted to institution_admin:
--   SELECT r.name FROM role_permissions rp
--     JOIN roles r       ON r.id = rp.role_id
--     JOIN permissions p ON p.id = rp.permission_id
--    WHERE p.code = 'school.manage_api_keys' ORDER BY r.name;
--     -- expect: admin, institution_admin, super_admin
