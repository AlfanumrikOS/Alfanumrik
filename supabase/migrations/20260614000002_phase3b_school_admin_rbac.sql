-- Migration: 20260614000002_phase3b_school_admin_rbac.sql
-- Purpose: Phase 3B (School Command Center) Wave C — the RBAC depth layer.
--          Seeds FOUR new institution.* permission codes and FORMALIZES
--          institution.manage_students, then grants the full Wave-C superset to
--          the `institution_admin` RBAC role so authorizeRequest() passes for
--          every code a school admin can possibly need. The per-school-admin-role
--          NARROWING (principal vs vice_principal vs academic_coordinator vs
--          institution_admin) happens IN CODE in src/lib/school-admin-auth.ts via
--          the SCHOOL_ADMIN_ROLE_CAPABILITIES map, gated behind the
--          `ff_school_admin_rbac` feature flag (default OFF). This migration only
--          establishes the SUPERSET grant at the RBAC layer.
--
-- ─── Why a code-side narrowing (not 4 RBAC roles) ────────────────────────────
-- All four school_admins.role values (principal / vice_principal /
-- academic_coordinator / institution_admin) resolve to the SINGLE
-- `institution_admin` RBAC role in user_roles. The AFTER INSERT trigger
-- sync_school_admin_role() (see 20260603140000_fix_sync_school_admin_role_trigger.sql)
-- maps every school_admins INSERT to user_roles(role='institution_admin'),
-- regardless of the school_admins.role text. So authorizeRequest() can only ever
-- see the institution_admin RBAC role's permission set — it cannot distinguish a
-- principal from an academic_coordinator. Wave C therefore keeps a SINGLE RBAC
-- role (no new top-level roles — that would require user approval and a wider
-- blast radius) and layers the matrix narrowing in code, keyed on the
-- school_admins.role field already fetched by authorizeSchoolAdmin. This keeps
-- the 6 platform roles untouched (CEO constraint) and the narrowing O(1).
--
-- ─── CEO-APPROVED permission additions (2026-06-08, Wave C) ───────────────────
-- Per `.claude/CLAUDE.md` ("User Approval Required For → RBAC role or permission
-- additions"), new permission codes require user approval. The CEO approved the
-- exact role→permission matrix on 2026-06-08 (Wave C). New codes seeded here:
--   institution.export_reports — export school reports (CSV/PDF, board/parent-ready)
--   institution.manage_billing — manage school subscription / billing / plan change
--   institution.view_billing   — view school subscription / seat usage / invoices
--   institution.manage_staff   — assign / revoke school-admin roles within the school
-- FORMALIZED (already a row on PROD via the legacy seed
-- 20260327210000_extended_rbac_roles.sql; re-asserted here so a fresh DB — CI
-- live-DB, new staging, DR — also has it, since that legacy file lives under
-- supabase/migrations/_legacy/ and is NOT applied on fresh projects):
--   institution.manage_students — add / remove / manage students in the institution
--
-- ─── Scope / safety contract ─────────────────────────────────────────────────
--   - ADDITIVE: only INSERTs into permissions + role_permissions. No new tables,
--     no schema mutation, no DROP, no UPDATE/DELETE. RLS: N/A — no new tables, so
--     no new policy is required (permissions / role_permissions keep their
--     existing baseline RLS posture; this migration only inserts rows through the
--     service-role migration runner).
--   - IDEMPOTENT: every INSERT uses ON CONFLICT DO NOTHING. Safe to replay.
--   - SELF-CONTAINED: references only `permissions`, `role_permissions`, and
--     `roles` — all present in 00000000000000_baseline_from_prod.sql
--     (permissions: lines 12670-12678; role_permissions: 13263-13269;
--     roles: 13272-13283). NO forward-reference to supabase/migrations/_legacy/.
--     Replays clean on a fresh Preview branch and is a no-op on PROD for codes
--     that already exist there.
--   - The grant join keys off roles.name = 'institution_admin'. That role row is
--     seeded by the legacy migration 20260327210000_extended_rbac_roles.sql on
--     PROD. On a fresh DB where that row is absent, the SELECT-join simply
--     produces zero grant rows (no error) — exactly mirroring how the in-tree
--     root migration 20260507110000_add_school_manage_modules_permission.sql
--     already grants to institution_admin. No regression vs the established
--     pattern.
--
-- ─── Pattern provenance ──────────────────────────────────────────────────────
-- Mirrors the proven, applied-to-prod seed pattern of:
--   - 20260507110000_add_school_manage_modules_permission.sql (in-tree root)
--   - _legacy/timestamped/20260416200100_school_admin_extra_permissions.sql
--   - _legacy/timestamped/20260327210000_extended_rbac_roles.sql
-- Two steps, both idempotent: (1) INSERT permission rows ON CONFLICT (code) DO
-- NOTHING; (2) grant to institution_admin via roles×permissions SELECT-join ON
-- CONFLICT DO NOTHING.
--
-- ─── Reversible ──────────────────────────────────────────────────────────────
--   DELETE FROM role_permissions WHERE permission_id IN (
--     SELECT id FROM permissions WHERE code IN (
--       'institution.export_reports','institution.manage_billing',
--       'institution.view_billing','institution.manage_staff'));
--   DELETE FROM permissions WHERE code IN (
--     'institution.export_reports','institution.manage_billing',
--     'institution.view_billing','institution.manage_staff');
--   (institution.manage_students is NOT dropped on rollback — it predates Wave C.)

BEGIN;

-- ─── 1. Insert permission definitions (idempotent) ───────────────────────────
-- The 4 NEW Wave-C codes, plus institution.manage_students re-asserted so fresh
-- DBs have it (no-op on PROD where the legacy seed already inserted it).

INSERT INTO permissions (code, resource, action, description, is_active) VALUES
  ('institution.export_reports',
   'institution', 'export_reports',
   'Export school reports (mastery / Bloom / performance) as board- or parent-ready CSV/PDF',
   true),
  ('institution.manage_billing',
   'institution', 'manage_billing',
   'Manage the school subscription, plan changes, and billing',
   true),
  ('institution.view_billing',
   'institution', 'view_billing',
   'View the school subscription, seat usage, and invoices',
   true),
  ('institution.manage_staff',
   'institution', 'manage_staff',
   'Assign and revoke school-admin roles (principal / vice_principal / academic_coordinator / institution_admin) within the school',
   true),
  ('institution.manage_students',
   'institution', 'manage_students',
   'Add, remove, and manage students within the institution',
   true)
ON CONFLICT (code) DO NOTHING;

-- ─── 2. Grant the Wave-C SUPERSET to institution_admin (idempotent) ──────────
-- authorizeRequest() must PASS for every code a school admin can possibly hold;
-- the per-role narrowing (matrix) is enforced in code behind ff_school_admin_rbac.
-- (institution.manage, institution.view_analytics, institution.manage_teachers
--  and the teacher-inherited class.manage / report.view_class already belong to
--  institution_admin via the legacy seed; re-asserting them here as well keeps a
--  fresh DB consistent and is a no-op on PROD.)

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name = 'institution_admin'
  AND p.code IN (
    'institution.export_reports',
    'institution.manage_billing',
    'institution.view_billing',
    'institution.manage_staff',
    'institution.manage_students',
    -- pre-existing codes re-asserted for fresh-DB self-containment (no-op on PROD)
    'institution.manage',
    'institution.view_analytics',
    'institution.manage_teachers',
    'class.manage',
    'report.view_class'
  )
ON CONFLICT DO NOTHING;

COMMIT;

-- ─── Verify (manual check after applying) ────────────────────────────────────
-- SELECT p.code
--   FROM role_permissions rp
--   JOIN roles r        ON r.id = rp.role_id
--   JOIN permissions p  ON p.id = rp.permission_id
--  WHERE r.name = 'institution_admin'
--    AND p.code LIKE 'institution.%'
--  ORDER BY p.code;
-- Expected to INCLUDE: institution.export_reports, institution.manage,
-- institution.manage_billing, institution.manage_staff, institution.manage_students,
-- institution.manage_teachers, institution.view_analytics, institution.view_billing.
