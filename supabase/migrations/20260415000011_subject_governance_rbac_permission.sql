-- Migration: 20260415000011_subject_governance_rbac_permission.sql
-- Purpose: Seed the new `super_admin.subjects.manage` RBAC permission and grant
--          it to the `super_admin` role.  Part of Phase E of the Subject
--          Governance initiative.
--
-- ─── Why this is a separate, deferred migration ──────────────────────────────
-- Phase E added 5 super-admin subject-governance UI pages and 7 API routes:
--   GET/POST   src/app/api/super-admin/subjects/route.ts
--   GET/PATCH  src/app/api/super-admin/subjects/[code]/route.ts
--   GET/PUT    src/app/api/super-admin/subjects/grade-map/route.ts
--   GET/PUT    src/app/api/super-admin/subjects/plan-access/route.ts
--   GET        src/app/api/super-admin/subjects/violations/route.ts
--   GET/PATCH  src/app/api/super-admin/students/[id]/subjects/route.ts
--
-- Those routes currently authenticate via `authorizeAdmin(request)` (the
-- existing session-based super-admin pattern).  The Phase E plan specified a
-- dedicated, fine-grained permission `super_admin.subjects.manage` so that
-- subject-governance access could eventually be delegated to a non-root admin
-- without handing over full super-admin rights.
--
-- Per `.claude/CLAUDE.md` ("User Approval Required For → RBAC role or
-- permission additions"), new permission codes must be approved by the user
-- before seeding.  This migration is therefore staged as a file on disk but
-- NOT yet applied.  It is safe to apply any time — the INSERTs are idempotent
-- via ON CONFLICT DO NOTHING and no existing rows are modified.
--
-- ─── After applying, the 7 API routes above must be updated ──────────────────
-- Replace:
--     const authCheck = await authorizeAdmin(request);
--     if (!authCheck.authorized) return authCheck.response;
-- with:
--     const auth = await authorizeRequest(request, 'super_admin.subjects.manage');
--     if (!auth.authorized) return auth.errorResponse!;
-- to actually gate enforcement on the new permission.  Until both the migration
-- is applied AND the routes are refactored, behaviour is unchanged.
--
-- Role assignment:
--   super_admin — granted explicitly below (plus the runtime wildcard bypass
--                 in hasPermission() already covers it)
--   admin       — already holds ALL permissions via the wildcard grant in
--                 20260324070000_production_rbac_system.sql; included below
--                 defensively so a fresh restore from backup still mirrors
--                 production intent
--   all other roles — no grant (subject governance is super-admin only)

BEGIN;

-- ─── 1. Insert permission definition (idempotent) ────────────────────────────

INSERT INTO permissions (code, resource, action, description) VALUES
  ('super_admin.subjects.manage',
   'super_admin_subjects',
   'manage',
   'Manage CBSE subject catalogue, grade-subject mappings, plan access rules, policy violations, and per-student subject overrides via the super-admin subject-governance console (Phase E).')
ON CONFLICT (code) DO NOTHING;

-- ─── 2. Grant the permission to super_admin (and admin, defensively) ─────────

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM roles r, permissions p
 WHERE r.name IN ('super_admin', 'admin')
   AND p.code = 'super_admin.subjects.manage'
ON CONFLICT DO NOTHING;

COMMIT;

-- ─── Verify (manual check after applying) ────────────────────────────────────
-- SELECT r.name AS role, p.code AS permission
--   FROM role_permissions rp
--   JOIN roles r ON r.id = rp.role_id
--   JOIN permissions p ON p.id = rp.permission_id
--  WHERE p.code = 'super_admin.subjects.manage'
--  ORDER BY r.name;
--
-- Expected: 2 rows — admin and super_admin.