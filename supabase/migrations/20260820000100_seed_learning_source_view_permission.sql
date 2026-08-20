-- Migration: 20260820000100_seed_learning_source_view_permission.sql
-- Purpose: Seed the `learning_source.view` permission and GRANT it to the
--          `student` and `teacher` roles. Companion to the TypeScript
--          constant added in packages/lib/src/rbac.ts (LEARNING_SOURCE_VIEW).
--
-- ─── Why this migration exists ───────────────────────────────────────────────
--   Comprehensive code review 2026-08-20 (P0-1): apps/host/src/app/api/
--   learning-sources/route.ts called `authorizeRequest(request)` with NO
--   permission code at all — the comment above it claimed "the bucket's RLS
--   policies enforce per-resource access", which is false (the sibling
--   migration 20260816000001 creates zero storage.objects policies; the URL
--   is minted via supabaseAdmin, service role, bypassing RLS entirely). Any
--   authenticated caller of any role could mint a signed URL into the
--   rights-restricted curated corpus bucket.
--
--   A sibling `backend` change repoints the route to
--       authorizeRequest(request, 'learning_source.view')
--   plus a rights_status check and path validation. This migration is the DB
--   half: seed the permission code and grant it, so the fix doesn't just
--   trade "no gate" for "gate that 403s everyone" (the exact bug class the CI
--   drift guard apps/host/src/__tests__/rbac-permission-code-drift-guard.test.ts
--   exists to kill — see 'teacher.read', 'student.profile.read',
--   'student.router_access' in its history).
--
-- ─── Scope / safety contract (HARD CONSTRAINTS — mirrors 20260816000006) ─────
--   - ADDITIVE ONLY. No DROP / DELETE / UPDATE / TRUNCATE. No destructive op.
--   - NO NEW TABLES -> no new RLS policy required. Only `permissions` and
--     `role_permissions` rows are inserted through the service-role migration
--     runner, exactly as every prior RBAC seed migration. The existing
--     baseline RLS posture on permissions/roles/role_permissions is
--     unchanged.
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
--     migration 20260612123200 and the baseline. There is NO `name` column
--     and NO `category` column; categorisation is carried by `resource`
--     (here: 'learning_source').
--
-- ─── Role-grant scope (mirrors 20260620000100's content.read precedent) ──────
--   student — reads the curated corpus for self-study (the route's primary
--     caller today).
--   teacher — reads the same curated corpus to prepare lessons (mirrors the
--     content.read precedent: "content.read -> student + teacher (the
--     legitimate content readers)" in
--     20260620000100_portal_rbac_remediation_phase0_content_read_alfabot_read_messages.sql).
--   admin / super_admin — defensive explicit grant. admin holds all
--     permissions via the wildcard grant in the base RBAC seed and
--     super_admin additionally bypasses in hasPermission(), but this
--     migration runs AFTER the wildcard seed in the chain so a fresh DB
--     replay needs the explicit grant too (same defensive pattern as
--     20260816000006).
--
-- ─── CEO approval posture ────────────────────────────────────────────────────
--   `learning_source.view` is a NEW permission code and a NEW grant; per the
--   constitution ("User Approval Required For -> RBAC role or permission
--   additions"), new permission codes require user approval. This seed ships
--   as a P0 hotfix closing a live rights-bypass (P0-1, 2026-08-20 comprehensive
--   code review) alongside the route's own authorizeRequest() fix.
--
-- ─── Cache behaviour post-deploy ─────────────────────────────────────────────
--   packages/lib/src/rbac.ts caches per-user permission sets with a 5-minute
--   TTL. After this migration grants learning_source.view to student/teacher,
--   any caller with an active cached permission set picks the grant up within
--   5 minutes (or on next cache miss). No manual invalidation required.
--
-- Owner: architect.

BEGIN;

-- =============================================================================
-- 1. NEW PERMISSION CODE: learning_source.view
-- =============================================================================
INSERT INTO permissions (code, resource, action, description, is_active) VALUES
  ('learning_source.view',
   'learning_source',
   'view',
   'Mint a signed URL to read a curated learning-corpus source document (/api/learning-sources)',
   true)
ON CONFLICT (code) DO NOTHING;

-- =============================================================================
-- 2. GRANT learning_source.view -> student, teacher
-- =============================================================================
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name IN ('student', 'teacher')
  AND p.code = 'learning_source.view'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Defensive: ensure admin + super_admin also hold learning_source.view
-- explicitly. The wildcard CROSS JOIN grants in 20260612123200 ran BEFORE
-- this migration exists in the chain, so on a fresh DB they cannot have
-- picked up a code seeded here; this mirrors the defensive grant in
-- 20260816000006 / 20260620000100.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name IN ('admin', 'super_admin')
  AND p.code = 'learning_source.view'
ON CONFLICT (role_id, permission_id) DO NOTHING;

COMMIT;

-- ─── Verify (manual check after applying) ────────────────────────────────────
-- 1. Confirm the permission exists with the canonical column shape:
--    SELECT code, resource, action, is_active FROM permissions
--     WHERE code = 'learning_source.view';
--    -- expect: 1 row ('learning_source.view', 'learning_source', 'view', true)
--
-- 2. Confirm the grants exist:
--    SELECT r.name FROM role_permissions rp
--      JOIN roles r       ON r.id = rp.role_id
--      JOIN permissions p ON p.id = rp.permission_id
--     WHERE p.code = 'learning_source.view' ORDER BY r.name;
--    -- expect: admin, student, super_admin, teacher
--
-- 3. Confirm no duplicate grants (UNIQUE constraint makes this structural):
--    SELECT r.name, count(*) FROM role_permissions rp
--      JOIN roles r       ON r.id = rp.role_id
--      JOIN permissions p ON p.id = rp.permission_id
--     WHERE p.code = 'learning_source.view' GROUP BY r.name;
--    -- expect: exactly 1 per role
