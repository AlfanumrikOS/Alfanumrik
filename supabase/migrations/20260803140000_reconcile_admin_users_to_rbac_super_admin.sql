-- Migration: 20260803140000_reconcile_admin_users_to_rbac_super_admin.sql
-- Purpose: Reconcile the two super-admin identity models so that every operator
--          who is an ACTIVE `admin_users` super_admin also holds an ACTIVE
--          `user_roles` grant for the RBAC `super_admin` role.
--
-- ─── Why this exists (PR-3 precondition) ─────────────────────────────────────
--   P2-1 swaps the 13 `/api/internal/admin/*` handlers from the
--   `requireAdminSecret` shared-secret gate to `authorizeRequest(request, <code>)`
--   (RBAC). `authorizeRequest` (packages/lib/src/rbac.ts) resolves super_admin
--   status ONLY from the RBAC tables — `get_user_permissions` reads `user_roles`
--   JOIN `roles`, filtering `ur.is_active = true AND (ur.expires_at IS NULL OR
--   ur.expires_at > now())`. It does NOT consult `admin_users`.
--
--   The panel's own auth (`authorizeAdmin`, and the PR-2 middleware bridge) accept
--   the UNION of `admin_users` ∪ `user_roles`. Therefore an operator who is
--   super_admin ONLY in `admin_users` (with no active `user_roles` super_admin
--   grant) is fully authorized TODAY via that path, yet would be DENIED by the
--   handlers after they swap to `authorizeRequest`. This migration closes that
--   gap BEFORE the swap lands, guaranteeing no operator loses access.
--
-- ─── Scope / safety contract (HARD CONSTRAINTS) ──────────────────────────────
--   - ADDITIVE ONLY. Grants the EXISTING `super_admin` RBAC role to people who
--     are ALREADY active `admin_users` super_admins. It creates NO new role and
--     NO new permission, and grants super_admin to NO ONE who is not already an
--     active `admin_users` super_admin. It is a reconciliation of two auth
--     models for the same set of operators — not an authorization expansion — so
--     it is not a new privilege grant requiring a fresh approval gate.
--   - IDEMPOTENT / SAFE TO REPLAY. The INSERT source is filtered to operators who
--     currently LACK an active, non-expired super_admin grant (NOT EXISTS guard),
--     and the INSERT carries `ON CONFLICT ON CONSTRAINT
--     user_roles_auth_user_id_role_id_key DO UPDATE` that only reactivates a
--     stale (inactive OR expired) existing row. On a fully-reconciled DB the
--     source set is empty and the statement is a no-op. Re-running never
--     duplicates a grant (blocked by the UNIQUE (auth_user_id, role_id)
--     constraint) and never touches an already-active row (guarded DO UPDATE).
--   - RESOLVE BY NAME, NEVER BY HARDCODED UUID. The super_admin role id is
--     resolved from `roles` by `name = 'super_admin'`. If that row is absent on a
--     partially-seeded DB the CROSS JOIN yields zero rows (silent no-op).
--   - NO NEW TABLE / NO RLS CHANGE. Writes rows into the existing `user_roles`
--     table via the service-role migration runner; its baseline RLS posture is
--     unchanged.
--
-- ─── Column / constraint reference (baseline_from_prod.sql) ──────────────────
--   user_roles(id uuid pk, auth_user_id uuid NOT NULL, role_id uuid NOT NULL
--     FK->roles(id) ON DELETE CASCADE, is_active boolean DEFAULT true,
--     assigned_at timestamptz DEFAULT now(), assigned_by uuid (nullable, NO FK),
--     expires_at timestamptz (nullable)); UNIQUE (auth_user_id, role_id) via
--     user_roles_auth_user_id_role_id_key (and a duplicate user_roles_unique).
--   admin_users(auth_user_id uuid UNIQUE nullable, admin_level text NOT NULL
--     DEFAULT 'admin', is_active boolean DEFAULT true).
--   roles(name text NOT NULL UNIQUE, is_active boolean DEFAULT true).
--
--   `assigned_by` is set to the operator's own auth_user_id (self-grant: they
--   already hold the equivalent authority via admin_users). `expires_at` is NULL
--   (non-expiring), `is_active` is true — the exact shape get_user_permissions
--   requires to resolve the role.

BEGIN;

-- `AS tgt` aliases the INSERT target so the DO UPDATE ... WHERE can reference the
-- EXISTING conflicting row unambiguously (Postgres-documented pattern). The `ur`
-- alias in the NOT EXISTS subquery is in the SELECT (source) scope only and does
-- not collide with `tgt` in the ON CONFLICT scope.
INSERT INTO public.user_roles AS tgt (auth_user_id, role_id, is_active, assigned_by, expires_at)
SELECT a.auth_user_id, sar.id, true, a.auth_user_id, NULL
FROM public.admin_users a
CROSS JOIN (
  SELECT id FROM public.roles WHERE name = 'super_admin' AND is_active = true
) sar
WHERE a.is_active = true
  AND a.admin_level = 'super_admin'
  AND a.auth_user_id IS NOT NULL
  -- Only operators who lack an ACTIVE, non-expired super_admin grant today.
  AND NOT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.auth_user_id = a.auth_user_id
      AND ur.role_id = sar.id
      AND ur.is_active = true
      AND (ur.expires_at IS NULL OR ur.expires_at > now())
  )
ON CONFLICT ON CONSTRAINT user_roles_auth_user_id_role_id_key DO UPDATE
  SET is_active = true,
      expires_at = NULL
  -- Reactivate a stale (inactive OR expired) row only; never churn an
  -- already-active grant (keeps replay a true no-op).
  WHERE tgt.is_active IS NOT TRUE
     OR tgt.expires_at IS NOT NULL;

COMMIT;

-- ─── Verify (manual check after applying) ────────────────────────────────────
-- Every active admin_users super_admin now has an active, non-expiring
-- user_roles super_admin grant (expect 0 rows):
--   SELECT a.auth_user_id
--   FROM admin_users a
--   JOIN roles r ON r.name = 'super_admin'
--   WHERE a.is_active = true AND a.admin_level = 'super_admin'
--     AND a.auth_user_id IS NOT NULL
--     AND NOT EXISTS (
--       SELECT 1 FROM user_roles ur
--       WHERE ur.auth_user_id = a.auth_user_id AND ur.role_id = r.id
--         AND ur.is_active = true AND (ur.expires_at IS NULL OR ur.expires_at > now())
--     );
