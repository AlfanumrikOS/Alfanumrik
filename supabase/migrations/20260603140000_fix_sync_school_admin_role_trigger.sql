-- Migration: 20260603140000_fix_sync_school_admin_role_trigger.sql
-- Purpose: Repair broken sync_school_admin_role() trigger function on school_admins.
--
-- WHAT WAS BROKEN
-- ---------------
-- The prod definition of public.sync_school_admin_role() (baseline lines 7925-7936)
-- inserts into user_roles using a non-existent column "role_name":
--
--   INSERT INTO user_roles (auth_user_id, role_name)
--   VALUES (NEW.auth_user_id, 'institution_admin')
--   ON CONFLICT (auth_user_id, role_name) DO NOTHING;
--
-- The user_roles table (baseline lines 14686-14694) only has columns:
--   id, auth_user_id, role_id (uuid FK -> roles.id), is_active, assigned_at,
--   assigned_by, expires_at.
--
-- There is no role_name column, so every INSERT on school_admins fails with
-- "column role_name of relation user_roles does not exist". Because the trigger
-- is AFTER INSERT in the same transaction, the parent INSERT is rolled back and
-- the caller observes the demo school-admin creation as "profile_failed" at
-- POST /api/super-admin/demo-accounts (role=school_admin) → /super-admin/demo.
--
-- WHY THIS FIX IS CORRECT
-- -----------------------
-- The replacement body follows the same pattern as the working
-- sync_user_roles_for_user() function (baseline lines 7939-7973): it resolves
-- role_id from the roles table by name and is_active, then inserts the proper
-- (auth_user_id, role_id, is_active) tuple with ON CONFLICT on the real
-- composite key. The 'institution_admin' row is seeded by the legacy migration
-- 20260327210000_extended_rbac_roles.sql, so the lookup resolves on prod.
--
-- The function is also defensive: if the institution_admin row is somehow
-- missing (fresh DB, mis-seed, etc.), we skip silently and still RETURN NEW
-- so the parent school_admins INSERT succeeds. RBAC enforcement happens at
-- the API boundary via authorizeRequest(); the trigger is best-effort role
-- sync, not the security boundary.
--
-- BLAST RADIUS
-- ------------
-- Affected flow: super-admin demo school creation
--   /super-admin/demo → POST /api/super-admin/demo-accounts with
--   role=school_admin → INSERT into school_admins → AFTER INSERT trigger
--   trg_sync_school_admin_role → sync_school_admin_role().
--
-- Before this fix: every such INSERT crashes → "profile_failed".
-- After this fix: INSERT succeeds and institution_admin role is granted in
-- user_roles. No other callers; trg_sync_school_admin_role only fires on
-- school_admins.
--
-- The existing AFTER INSERT trigger trg_sync_school_admin_role does NOT need
-- to be recreated -- CREATE OR REPLACE FUNCTION rewrites the body in place
-- and the trigger continues to fire against the new definition.
--
-- IDEMPOTENCY
-- -----------
-- CREATE OR REPLACE FUNCTION is safe to re-run. No schema mutation; no DDL on
-- school_admins, user_roles, or roles. P8 RLS invariant: N/A (no new tables).

CREATE OR REPLACE FUNCTION public.sync_school_admin_role() RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_role_id UUID;
BEGIN
  -- Look up the institution_admin role_id. If missing (defensive), skip
  -- silently so the parent school_admins INSERT is not aborted.
  SELECT id
    INTO v_role_id
    FROM roles
   WHERE name = 'institution_admin'
     AND is_active = true
   LIMIT 1;

  IF v_role_id IS NOT NULL THEN
    INSERT INTO user_roles (auth_user_id, role_id, is_active)
    VALUES (NEW.auth_user_id, v_role_id, true)
    ON CONFLICT (auth_user_id, role_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

-- Verify: SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname='sync_school_admin_role';
-- Should NOT contain 'role_name'.
