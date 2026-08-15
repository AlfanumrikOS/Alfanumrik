-- Migration: 20260816000006_seed_student_router_access_permission.sql
-- Purpose: Seed the `student.router_access` permission and GRANT it to the
--          `student` role. Companion to the TypeScript constant added in
--          packages/lib/src/rbac.ts (STUDENT_ROUTER_ACCESS).
--
-- ─── Why this migration exists ───────────────────────────────────────────────
--   apps/host/src/app/api/student-router/route.ts authorizes via:
--       authorizeRequest(request, 'student.router_access')
--   A permission code granted to NO role 403s EVERY non-super-admin caller —
--   the exact bug class the CI drift guard
--   (apps/host/src/__tests__/rbac-permission-code-drift-guard.test.ts) exists
--   to kill (see 'teacher.read', 'student.profile.read' in its history).
--   Seeding the code + granting it to `student` is the complete fix. The
--   route's internal logic (ALLOWED_TARGETS validation) is the inner gate;
--   this permission is the outer gate only.
--
-- ─── Scope / safety contract (HARD CONSTRAINTS — mirrors 20260612123200) ─────
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
--     canonical pattern in 20260612123200_rbac_matrix_conformance.sql. If a
--     referenced role/permission is absent on a partially-seeded DB the join
--     yields zero rows (a silent no-op).
--   - COLUMN SHAPE. The `permissions` table is (id, code, resource, action,
--     description, is_active, created_at) — per the canonical registry
--     migration 20260612123200 (permissions seed, line ~102) and the baseline.
--     There is NO `name` column and NO `category` column; categorisation is
--     carried by `resource` (here: 'student').
--
-- ─── CEO approval posture ────────────────────────────────────────────────────
--   `student.router_access` is a NEW permission code and a NEW grant; per the
--   constitution, RBAC permission additions require user approval. This seed
--   ships as part of the CEO-directed student-router work (2026-08-15 batch,
--   same change set as the /api/student-router route itself).
--
-- ─── Cache behaviour post-deploy ─────────────────────────────────────────────
--   packages/lib/src/rbac.ts caches per-user permission sets with a 5-minute
--   TTL. After this migration grants student.router_access to the student
--   role, any student with an active cached permission set picks the grant up
--   within 5 minutes (or on next cache miss). No manual invalidation required.
--
-- Owner: architect.

BEGIN;

-- =============================================================================
-- 1. NEW PERMISSION CODE: student.router_access
-- =============================================================================
-- Grouped under the `student` resource alongside the existing student.* family
-- (student.view_uploads, student.provide_feedback).
INSERT INTO permissions (code, resource, action, description, is_active) VALUES
  ('student.router_access',
   'student',
   'router_access',
   'Access the gated deep-link router for student session continuity (/api/student-router)',
   true)
ON CONFLICT (code) DO NOTHING;

-- =============================================================================
-- 2. GRANT student.router_access -> student
-- =============================================================================
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r CROSS JOIN permissions p
WHERE r.name = 'student' AND p.code IN ('student.router_access')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Defensive: ensure admin + super_admin also hold student.router_access
-- explicitly. The wildcard CROSS JOIN grants in 20260612123200 ran BEFORE this
-- migration exists in the chain, so on a fresh DB they cannot have picked up a
-- code seeded here; this mirrors the defensive grant in 20260620000500.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r CROSS JOIN permissions p
WHERE r.name IN ('admin', 'super_admin') AND p.code IN ('student.router_access')
ON CONFLICT (role_id, permission_id) DO NOTHING;

COMMIT;

-- ─── Verify (manual check after applying) ────────────────────────────────────
-- 1. Confirm the permission exists with the canonical column shape:
--    SELECT code, resource, action, is_active FROM permissions
--     WHERE code = 'student.router_access';
--    -- expect: 1 row ('student.router_access', 'student', 'router_access', true)
--
-- 2. Confirm the grants exist:
--    SELECT r.name FROM role_permissions rp
--      JOIN roles r       ON r.id = rp.role_id
--      JOIN permissions p ON p.id = rp.permission_id
--     WHERE p.code = 'student.router_access' ORDER BY r.name;
--    -- expect: admin, student, super_admin
--
-- 3. Confirm no duplicate grants (UNIQUE constraint makes this structural):
--    SELECT r.name, count(*) FROM role_permissions rp
--      JOIN roles r       ON r.id = rp.role_id
--      JOIN permissions p ON p.id = rp.permission_id
--     WHERE p.code = 'student.router_access' GROUP BY r.name;
--    -- expect: exactly 1 per role
