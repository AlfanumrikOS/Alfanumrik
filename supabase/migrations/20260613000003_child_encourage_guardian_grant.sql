-- Migration: 20260613000003_child_encourage_guardian_grant.sql
-- Purpose: Forward-fix the `child.encourage` grant so it actually reaches the
--          parent-facing role on PROD, which is named `guardian` (NOT `parent`).
--
-- ─── Why this migration exists ───────────────────────────────────────────────
-- The original Wave D migration `20260613000000_child_encourage_permission.sql`
-- granted `child.encourage` to the role named `'parent'` (its header even cites
-- the legacy seed `20260324070000_production_rbac_system.sql` line 568 as
-- evidence the role is `'parent'`). That assumption is wrong for PROD.
--
-- PROD's actual role set — confirmed 2026-06-06 — is:
--     admin, content_manager, finance, guardian, institution_admin, reviewer,
--     student, super_admin, support, teacher, tutor
-- There is NO `parent` role. The parent-facing role is named `guardian`, and all
-- five sibling `child.*` permissions (child.view_performance, child.view_progress,
-- etc.) are granted to `guardian`. So the original grant's
--     WHERE r.name IN ('parent', 'admin', 'super_admin')
-- no-op'd for the intended grantee: the SELECT-join produced zero rows for the
-- `parent` predicate (no such role), leaving `child.encourage` missing its
-- `guardian` grant. Result: the parent encourage / cheers feature is currently
-- non-functional for actual parents.
--
-- ─── Forward-fix, not edit-in-place ──────────────────────────────────────────
-- `20260613000000` is already applied to PROD. Applied migrations are immutable
-- (P8 / Supabase migration discipline) — we never edit a migration that has run.
-- This is the standard forward-fix pattern: add a NEW migration with a later
-- timestamp that supplies the missing grant idempotently.
--
-- ─── Approval ────────────────────────────────────────────────────────────────
-- CEO-approved permission grant 2026-06-06 (Wave D). Per `.claude/CLAUDE.md`
-- ("User Approval Required For → RBAC role or permission additions"), RBAC grant
-- changes require user approval; given by the CEO on 2026-06-06.
--
-- ─── Schema references (verified against baseline RBAC seed) ──────────────────
--   role_permissions(role_id, permission_id)  — UNIQUE(role_id, permission_id)
--   roles(name)                               — TEXT NOT NULL UNIQUE
--   permissions(code)                         — TEXT NOT NULL UNIQUE
-- No DROP. Idempotent (ON CONFLICT DO NOTHING). Safe to re-run.

BEGIN;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'guardian' AND p.code = 'child.encourage'
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
-- Expected on PROD: guardian (plus admin/super_admin if those wildcard/defensive
-- grants resolved). The key new row is `guardian | child.encourage`.
