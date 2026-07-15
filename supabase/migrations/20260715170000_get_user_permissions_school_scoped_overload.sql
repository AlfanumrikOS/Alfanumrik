-- Migration: 20260715170000_get_user_permissions_school_scoped_overload.sql
-- Purpose: Add the two-argument, school-scoped overload of get_user_permissions
--          so packages/lib/src/rbac.ts resolves permissionScope='school' instead
--          of falling back to 'baseline-global'.
--
-- PHASE 5 (school-scoped RBAC).
--
-- BACKGROUND
-- ----------
-- rbac.ts::getUserPermissions() already CALLS a tenant-scoped RPC
--   get_user_permissions(p_auth_user_id, p_school_id)
-- and, when PostgREST reports the overload is missing (PGRST202 / 42883), falls
-- back to the one-argument baseline resolver and stamps permissionScope
-- 'baseline-global'. Until this overload exists that fallback fires on every
-- school-scoped call, so multi-school admins can reach the
-- SCHOOL_SCOPED_RBAC_REQUIRED path. This migration ships the missing overload;
-- the runtime's own guard means a correct overload simply REMOVES the
-- 'baseline-global' fallback (an upgrade, not a behavior change).
--
-- WHAT THIS IS / IS NOT
-- ---------------------
--   - ADDITIVE: a NEW function overload with a DIFFERENT signature
--     (uuid, uuid). It does NOT replace or weaken the one-argument
--     get_user_permissions(uuid) — that stays byte-for-byte owned by
--     baseline_from_prod.sql and its anon revoke in 20260515000002.
--   - NO new roles, NO new permission codes, NO grant beyond a role's matrix
--     (P9). This is purely a resolution function: for a given school it can only
--     resolve the SAME-or-FEWER permissions the one-arg version would, never more.
--   - NO schema change, NO new table, NO RLS change (P8 N/A), NO DROP.
--   - IDEMPOTENT: CREATE OR REPLACE + REVOKE are replayable.
--
-- SCHOOL SCOPE MODEL (school_admins is the scope carrier)
-- ------------------------------------------------------
-- The only school-scoped role in the RBAC matrix is `institution_admin`
-- (roles seed 20260612123200: it holds the institution.* / school.* grants and
-- inherits teacher.*; it is the single RBAC role synced from school_admins by the
-- sync_school_admin_role trigger). Every other role a user holds (student,
-- parent, tutor, teacher, support, reviewer, content_manager, finance, admin,
-- super_admin) is a self / global role and resolves EXACTLY as in the one-arg
-- version.
--
-- Therefore: the institution_admin role AND its permissions apply for
-- p_school_id ONLY when the caller has an ACTIVE school_admins membership for
-- that school. No membership -> institution_admin is dropped from both `roles`
-- and `permissions` for this school's context (fail-closed; also fail-closed when
-- p_school_id IS NULL, though rbac.ts only invokes this overload with a concrete
-- school id).
--
-- RETURN SHAPE (must match the one-arg version exactly — two consumers)
-- --------------------------------------------------------------------
--   jsonb {
--     "roles":       [ { "name", "display_name", "hierarchy_level" }, ... ],
--     "permissions": [ "<code>", ... ]   -- DISTINCT text codes
--   }
-- Consumer 1: rbac.ts reads data.roles and data.permissions.
-- Consumer 2: public.school_admin_has_selected_permission (20260711230713)
--             reads (v_permissions->'permissions') ? p_permission_code.
-- Both are satisfied identically by the shape above.
--
-- APPLICATION IS DEPLOY-TIME (docs/runbooks/schema-reproducibility-fix.md).
-- NOTE: flipping the ff_school_admin_rbac feature flag is a SEPARATE operational
--       rollout step and is intentionally NOT done here.

CREATE OR REPLACE FUNCTION public.get_user_permissions(
  p_auth_user_id uuid,
  p_school_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
  v_is_school_admin BOOLEAN;
BEGIN
  -- Scope gate: does the caller hold an ACTIVE school_admins membership for THIS
  -- school? school_admins is the scope carrier — institution_admin RBAC grants
  -- apply for p_school_id only when this is true.
  v_is_school_admin := EXISTS (
    SELECT 1
    FROM school_admins sa
    WHERE sa.auth_user_id = p_auth_user_id
      AND sa.school_id = p_school_id
      AND sa.is_active = true
  );

  SELECT jsonb_build_object(
    'roles', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'name', r.name,
               'display_name', r.display_name,
               'hierarchy_level', r.hierarchy_level))
      FROM user_roles ur
      JOIN roles r ON r.id = ur.role_id
      WHERE ur.auth_user_id = p_auth_user_id
        AND ur.is_active = true
        AND (ur.expires_at IS NULL OR ur.expires_at > now())
        AND r.is_active = true
        -- School-scope gate: the institution_admin role is only in scope for
        -- p_school_id when the caller is an active admin of that school. Every
        -- other role passes through identically to the one-arg version.
        AND (r.name <> 'institution_admin' OR v_is_school_admin)
    ), '[]'::jsonb),
    'permissions', COALESCE((
      SELECT jsonb_agg(DISTINCT p.code)
      FROM user_roles ur
      JOIN roles r ON r.id = ur.role_id
      JOIN role_permissions rp ON rp.role_id = ur.role_id
      JOIN permissions p ON p.id = rp.permission_id
      WHERE ur.auth_user_id = p_auth_user_id
        AND ur.is_active = true
        AND (ur.expires_at IS NULL OR ur.expires_at > now())
        AND p.is_active = true
        -- Same school-scope gate applied to permission resolution. A code
        -- granted via any in-scope role is included (DISTINCT dedupes overlap),
        -- so a user who ALSO holds teacher directly keeps teacher.* codes even
        -- when institution_admin is out of scope for this school.
        AND (r.name <> 'institution_admin' OR v_is_school_admin)
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

-- Mirror the one-arg twin's posture (20260515000002 revokes anon from the
-- one-argument overload). The only legitimate callers are the service-role
-- client (rbac.ts) and the SECURITY DEFINER resolver school_admin_has_selected_permission.
REVOKE EXECUTE ON FUNCTION public.get_user_permissions(p_auth_user_id uuid, p_school_id uuid) FROM anon;

COMMENT ON FUNCTION public.get_user_permissions(uuid, uuid) IS
  'School-scoped RBAC resolver (Phase 5). Same jsonb {roles, permissions} shape '
  'as the one-arg get_user_permissions(uuid); institution_admin grants resolve '
  'for p_school_id only when the caller has an active school_admins membership '
  'there. Additive overload — never weakens the one-arg baseline. Consumed by '
  'rbac.ts and school_admin_has_selected_permission.';
