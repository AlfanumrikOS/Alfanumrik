-- Migration: 20260613000000_child_encourage_permission.sql
-- Purpose: Seed the new `child.encourage` RBAC permission and grant it to the
--          parent, admin, and super_admin roles. Part of Wave D ("D-encourage":
--          parent → child cheers / encouragement channel).
--
-- Plan: docs/superpowers/plans/2026-06-06-* (Wave D — parent encourage / cheers).
--
-- CEO-approved permission addition 2026-06-06 (Wave D).
--   Per `.claude/CLAUDE.md` ("User Approval Required For → RBAC role or
--   permission additions"), new permission codes must be approved by the user
--   before seeding. Approval was given by the CEO on 2026-06-06.
--
-- ─── Pattern provenance ──────────────────────────────────────────────────────
-- This follows the proven, applied-to-prod pattern of
-- `_legacy/timestamped/20260415000011_subject_governance_rbac_permission.sql`:
--   1. INSERT the permission definition with ON CONFLICT (code) DO NOTHING.
--   2. Grant it to the target roles via a roles×permissions SELECT-join with
--      ON CONFLICT DO NOTHING.
-- Both steps are idempotent and safe to re-run.
--
-- ─── Role naming note ────────────────────────────────────────────────────────
-- The DB role is named `parent` (NOT `guardian`) — see the RBAC seed in
-- `_legacy/timestamped/20260324070000_production_rbac_system.sql` line 568:
--     ('parent', 'Parent', 'अभिभावक', 30, true)
-- The UI/onboarding surface labels this role "guardian", but every RBAC join
-- keys off the `parent` role name. The other child.* permissions
-- (child.view_performance, child.view_progress, ...) are granted to `parent` in
-- that same seed (lines 648-656), so child.encourage joins the same role.
--
-- Role assignment:
--   parent      — granted explicitly below (this is the primary grantee; parents
--                 send cheers to their linked children).
--   admin       — already holds ALL permissions via the wildcard grant in
--                 20260324070000_production_rbac_system.sql; included below
--                 defensively so a fresh restore from backup still mirrors
--                 production intent.
--   super_admin — same wildcard situation; included defensively.
--   all other roles — no grant (encouragement is a parent→child channel).

BEGIN;

-- ─── 1. Insert permission definition (idempotent) ────────────────────────────

INSERT INTO permissions (code, resource, action, description) VALUES
  ('child.encourage',
   'child',
   'encourage',
   'Send an encouragement ("cheer") to a linked child')
ON CONFLICT (code) DO NOTHING;

-- ─── 2. Grant the permission to parent (and admin/super_admin, defensively) ───

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM roles r, permissions p
 WHERE r.name IN ('parent', 'admin', 'super_admin')
   AND p.code = 'child.encourage'
ON CONFLICT DO NOTHING;

COMMIT;

-- ─── Verify (manual check after applying) ────────────────────────────────────
-- SELECT r.name AS role, p.code AS permission
--   FROM role_permissions rp
--   JOIN roles r ON r.id = rp.role_id
--   JOIN permissions p ON p.id = rp.permission_id
--  WHERE p.code = 'child.encourage'
--  ORDER BY r.name;
--
-- Expected: 3 rows — admin, parent, super_admin.
