-- Migration: 20260620000000_portal_rbac_remediation_phase0_school_manage_exams.sql
-- Purpose: PHASE 0 of the CEO-approved portal RBAC remediation.
--          (1) Seed the permission code `school.manage_exams` and GRANT it to the
--              `institution_admin` role, fixing the school-admin exams routes that
--              authorize against a code present in NO role (they 403 real users today).
--          (2) Fold every live-but-unmatrixed permission code back into the
--              conformance matrix so the RBAC posture is genuinely replayable from a
--              fresh DB (CI live-DB / new staging / DR), restoring the
--              single-source-of-truth guarantee asserted by
--              20260612123200_rbac_matrix_conformance.sql (REG-120).
--
-- ─── Why this migration exists (ground truth — confirmed against PROD) ────────
--   PROD (project shktyoxqhundlvkiwguu) was queried read-only via PostgREST with
--   the service role on 2026-06-16. Findings:
--     * `school.manage_exams` — ABSENT from the `permissions` table on prod and
--       absent from the conformance matrix migration. The four school-admin exams
--       handlers call authorizeSchoolAdmin(request, 'school.manage_exams'):
--         src/app/api/school-admin/exams/route.ts:39  (POST  create exam)
--         src/app/api/school-admin/exams/route.ts:153 (GET   list exams)
--         src/app/api/school-admin/exams/route.ts:351 (PATCH update exam)
--         src/app/api/school-admin/exams/route.ts:639 (DELETE delete exam)
--       authorizeSchoolAdmin first calls authorizeRequest(request, code) — a
--       standard RBAC check against permissions/role_permissions — so a code that
--       no role holds 403s EVERY school admin. Seeding the code + granting it to
--       institution_admin is the complete fix; the routes already reference it.
--     * `class.assign_remediation` — PRESENT on prod (granted to `teacher` via
--       20260619000150 / 20260613000004) but ABSENT from the conformance matrix.
--     * `competition.access` — PRESENT on prod (granted to `admin` + `super_admin`)
--       but has NO in-tree seed migration AND is absent from the conformance
--       matrix. On a fresh DB it would not exist at all — a reproducibility hole.
--   Items (2) and (3) are the matrix drift the remediation must close.
--
-- ─── Scope / safety contract (HARD CONSTRAINTS) ──────────────────────────────
--   - ADDITIVE ONLY. No DROP / DELETE / UPDATE / TRUNCATE. No destructive op.
--   - NO NEW TABLES -> no new RLS policy required. Only `permissions` and
--     `role_permissions` rows are inserted, through the service-role migration
--     runner, exactly as every prior RBAC seed migration does. The existing
--     baseline RLS posture on permissions/roles/role_permissions is unchanged.
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
--     description, is_active, created_at) — confirmed against prod. There is NO
--     `category` column; categorisation is carried by `resource` (here: 'school'
--     / 'class' / 'competition'), matching every existing row. is_active defaults
--     to true and is set explicitly for clarity.
--
-- ─── CEO approval posture ────────────────────────────────────────────────────
--   `school.manage_exams` is a NEW permission code and a NEW grant; per the
--   constitution RBAC permission additions require user approval — the CEO has
--   approved this Phase 0 remediation and these specific codes/matrix migrations.
--   `class.assign_remediation` and `competition.access` are NOT new authorizations:
--   they already exist and are already granted on prod (the prior CEO-approved
--   teacher/competition work). Their presence here is a CONFORMANCE re-assertion
--   so a fresh DB converges to the same posture — not an authorization expansion.
--
-- ─── NOT in scope (handled separately — DO NOT add here) ──────────────────────
--   * 20260616010000 principal-AI assistant migration — Phase 3.
--   * the get_admin_school_id() fix — Phase 3.
--   This file touches ONLY permissions/role_permissions rows.
--
-- ─── Cache behaviour post-deploy ─────────────────────────────────────────────
--   src/lib/rbac.ts caches per-user permission sets with a 5-minute TTL. After
--   this migration grants school.manage_exams to institution_admin, any school
--   admin with an active cached permission set will pick the grant up within 5
--   minutes (or on next cache miss). No manual invalidation required.
--
-- Owner: architect. Phase 0 of feat/portal-rbac-saas-remediation.

BEGIN;

-- =============================================================================
-- 1. NEW PERMISSION CODE: school.manage_exams  (the 403 fix)
-- =============================================================================
-- Grouped under the `school` resource alongside the rest of the institution_admin
-- school.* family (school.manage_branding, school.manage_modules, ...).
INSERT INTO permissions (code, resource, action, description, is_active) VALUES
  ('school.manage_exams',
   'school',
   'manage_exams',
   'Schedule, edit, and remove school-wide assessments/exams (school-admin exams console)',
   true)
ON CONFLICT (code) DO NOTHING;

-- GRANT school.manage_exams -> institution_admin (the school-admin role).
-- admin / super_admin already receive every permission via the wildcard grants
-- in 20260612123200, so this newly-seeded code is automatically covered for them
-- on any env where the matrix migration runs after this one is replayed; the
-- explicit institution_admin grant below is the one the exams routes require.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM roles r, permissions p
 WHERE r.name = 'institution_admin'
   AND p.code = 'school.manage_exams'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Defensive: ensure admin + super_admin also hold school.manage_exams explicitly,
-- so the grant is present even on an env where this file replays without the
-- wildcard matrix migration re-running afterwards.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM roles r, permissions p
 WHERE r.name IN ('admin', 'super_admin')
   AND p.code = 'school.manage_exams'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- =============================================================================
-- 2. CONFORMANCE FOLD-IN: live-but-unmatrixed codes
-- =============================================================================
-- These codes already exist + are granted on PROD but are absent from the
-- conformance matrix (20260612123200), so a FRESH DB would lack them. Re-assert
-- them here, with their exact prod definitions, so the matrix is replayable.

-- ── 2a. class.assign_remediation -> teacher ──────────────────────────────────
-- Live on prod via 20260619000150 / 20260613000004 (granted to `teacher`).
-- Definition mirrors the prod row byte-for-byte (no drift).
INSERT INTO permissions (code, resource, action, description, is_active) VALUES
  ('class.assign_remediation',
   'class',
   'assign_remediation',
   'Assign targeted remediation to a student on a weak concept (Teacher Command Center)',
   true)
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM roles r, permissions p
 WHERE r.name = 'teacher'
   AND p.code = 'class.assign_remediation'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ── 2b. competition.access -> admin, super_admin ─────────────────────────────
-- Live on prod (granted to `admin` + `super_admin`) but with NO in-tree seed
-- migration — it would be MISSING entirely on a fresh DB. Re-assert it here so
-- the matrix reproduces it. admin/super_admin also receive it via the matrix
-- wildcard grants once the code exists; the explicit grants below make this file
-- self-sufficient on replay. Definition mirrors the prod row byte-for-byte.
INSERT INTO permissions (code, resource, action, description, is_active) VALUES
  ('competition.access',
   'competition',
   'access',
   'Access JEE/NEET/Olympiad question banks and mock-test runner (requires active Competition plan)',
   true)
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM roles r, permissions p
 WHERE r.name IN ('admin', 'super_admin')
   AND p.code = 'competition.access'
ON CONFLICT (role_id, permission_id) DO NOTHING;

COMMIT;

-- ─── Verify (manual check after applying) ────────────────────────────────────
-- 1. school.manage_exams now exists and is granted to institution_admin:
--    SELECT r.name FROM role_permissions rp
--      JOIN roles r       ON r.id = rp.role_id
--      JOIN permissions p ON p.id = rp.permission_id
--     WHERE p.code = 'school.manage_exams' ORDER BY r.name;
--      -- expect: admin, institution_admin, super_admin
-- 2. The conformance-fold codes are present:
--    SELECT code FROM permissions
--     WHERE code IN ('class.assign_remediation','competition.access') ORDER BY code;
--      -- expect both rows
-- 3. class.assign_remediation -> teacher; competition.access -> admin,super_admin:
--    SELECT p.code, r.name FROM role_permissions rp
--      JOIN roles r       ON r.id = rp.role_id
--      JOIN permissions p ON p.id = rp.permission_id
--     WHERE p.code IN ('class.assign_remediation','competition.access')
--     ORDER BY p.code, r.name;
