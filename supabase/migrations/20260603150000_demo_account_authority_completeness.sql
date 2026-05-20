-- Migration: 20260603150000_demo_account_authority_completeness.sql
-- Purpose: Complete the demo-account authority fix begun in
--          20260603140000_fix_sync_school_admin_role_trigger.sql.
--          Closes the four remaining defects the architect audit found
--          while diagnosing the user-reported `profile_failed` on demo
--          creation, plus one defense-in-depth tightening.
--
-- BACKGROUND
-- ----------
-- The previous migration in this pair (20260603140000) repaired the
-- sync_school_admin_role() trigger so demo school-admin creation no longer
-- crashes on the bogus "role_name" column. While auditing the surrounding
-- code path, four further defects were identified that all share the same
-- root cause: the pg_dump-derived baseline at
-- supabase/migrations/00000000000000_baseline_from_prod.sql is a snapshot
-- of prod's CURRENT state, not the union of every legacy migration. Two
-- ALTER TABLE statements that ran historically against prod did not get
-- captured in the dump because the dump rewrites schema as inline column
-- definitions and the prod row had been mutated post-creation. Result:
-- any environment recreated from the baseline (fresh CI staging, DR
-- restore, new dev) is missing columns that prod has.
--
-- WHAT IS BROKEN AND HOW IT WAS DIAGNOSED
-- ---------------------------------------
-- Finding 2 -- teachers.is_demo missing in baseline:
--   The original legacy migration 20260401180000_demo_account_system.sql
--   ran ALTER TABLE teachers ADD COLUMN IF NOT EXISTS is_demo BOOLEAN
--   DEFAULT FALSE. Prod has the column, but the pg_dump-derived baseline
--   (00000000000000_baseline_from_prod.sql) shows teachers (lines
--   14390-14419) WITHOUT is_demo. Any fresh DB (CI, DR, dev) created
--   from the baseline alone has no is_demo, so demo-teacher creation
--   blows up at POST /api/super-admin/demo-accounts (role=teacher) with
--   a "column is_demo does not exist" error reported to the UI as
--   "profile_failed". Adding the column idempotently fixes both the
--   missing-on-fresh-DB and the already-applied-on-prod cases.
--
-- Finding 3 -- guardians.is_demo missing in baseline:
--   Same root cause as Finding 2. The legacy demo migration also added
--   is_demo to guardians, but the baseline shows guardians (lines
--   11432-11452) without the column. Demo parent creation crashes
--   identically on fresh DBs. Same idempotent ALTER TABLE pattern
--   resolves it.
--
-- Finding 4 -- sync_user_roles_on_insert() maps 'guardians' to a
--              non-existent role name 'guardian':
--   The baseline definition at lines 7976-8003 has:
--       ELSIF TG_TABLE_NAME = 'guardians' THEN
--         v_role_name := 'guardian';
--   But the seeded roles table (legacy 20260324070000_production_rbac_system.sql
--   line 568) contains 'parent', NOT 'guardian'. So when the trigger fires
--   on a guardians INSERT, the inner SELECT FROM roles WHERE name='guardian'
--   returns zero rows, the outer INSERT INTO user_roles inserts nothing,
--   and the trigger silently RETURN NEW. The parent demo account succeeds
--   creating a row in guardians but gets NO user_roles row. When that user
--   subsequently hits any /parent/* route, authorizeRequest() consults the
--   active role list, finds none, and silently denies. The original legacy
--   migration 20260324070000 line 503 had the correct mapping
--   ('guardians' -> 'parent'); the regression was introduced when the
--   trigger function body drifted on prod and the pg_dump captured the
--   broken version. Rewriting the function body via CREATE OR REPLACE
--   restores the correct mapping. The existing AFTER INSERT trigger
--   bindings on students/teachers/guardians (baseline lines 18602,
--   18611, 18617) continue to fire against the new function body --
--   CREATE OR REPLACE FUNCTION rewrites in place without DROP TRIGGER.
--
-- Backfill (also Finding 4) -- existing parent users with no user_roles:
--   Every parent who signed up while the broken function was in place
--   has a row in guardians but no user_roles entry. The /parent/* portal
--   was silently denying every one of them. The backfill INSERT below
--   creates the missing rows for every guardian with a non-null
--   auth_user_id. ON CONFLICT DO NOTHING makes it idempotent and safe
--   to re-run.
--
-- Finding 5 (defense in depth) -- admin_users has no role-sync trigger:
--   Today the codebase authorizes super-admin via admin_users.admin_level
--   directly (src/lib/admin-auth.ts), so the lack of a user_roles row
--   does not break super-admin login. But the audit flagged this as a
--   latent risk: any future path that consults user_roles first (e.g. a
--   downstream RBAC unification effort) would silently deny super-admin
--   users. Adding sync_admin_user_role() as an AFTER INSERT trigger on
--   admin_users mirrors NEW.admin_level into user_roles preemptively.
--   Mapping: 'super_admin' -> 'super_admin', 'admin' -> 'admin',
--   'finance' -> 'finance', 'support' -> 'support'. The roles
--   'super_admin' and 'admin' are seeded in legacy 20260324070000;
--   'finance' and 'support' are seeded in legacy 20260327210000. If
--   admin_level holds an unmapped value (e.g. 'moderator' from the
--   admin_users CHECK constraint) the function skips silently and
--   RETURN NEWs so the parent admin_users INSERT is never aborted.
--
-- BLAST RADIUS
-- ------------
-- Affected flows (all under /super-admin/demo and ongoing /parent/*):
--   * POST /api/super-admin/demo-accounts (role=teacher)
--     -- was failing on fresh DBs because teachers.is_demo missing.
--   * POST /api/super-admin/demo-accounts (role=parent)
--     -- was failing on fresh DBs because guardians.is_demo missing,
--        AND on every env because sync_user_roles_on_insert() silently
--        no-op'd, leaving the user with no user_roles row -> /parent/*
--        portal denied access on next login.
--   * Existing parent users created before this fix
--     -- backfill grants them the parent role retroactively. No effect
--        on a parent who already has the row (ON CONFLICT DO NOTHING).
--   * Future admin_users INSERTs
--     -- now also mirror to user_roles. No effect on existing rows
--        unless they happen to share auth_user_id with a future insert
--        (the trigger only fires AFTER INSERT, not on existing data).
--
-- IDEMPOTENCY
-- -----------
-- Every statement is safe to re-run:
--   * ALTER TABLE ... ADD COLUMN IF NOT EXISTS
--   * CREATE INDEX IF NOT EXISTS
--   * CREATE OR REPLACE FUNCTION
--   * INSERT ... ON CONFLICT DO NOTHING
--   * DROP TRIGGER IF EXISTS + CREATE TRIGGER
-- Re-running this migration on prod (where some are already applied via
-- legacy migrations) is a no-op; re-running on a fresh DB (where none
-- are applied) brings the schema fully forward.
--
-- DEPLOYMENT ORDERING
-- -------------------
-- Must apply AFTER 20260603140000_fix_sync_school_admin_role_trigger.sql.
-- Natural timestamp order handles this. No coupling to any specific
-- later migration; safe to ship as the head of the chain.
--
-- P8 RLS NOTE
-- -----------
-- No new tables created. The two ADD COLUMN statements add is_demo as
-- a non-nullable boolean with a safe default of false to existing tables
-- whose RLS posture already covers them. No new policies needed.

-- =============================================================================
-- SQL BLOCK 1 -- teachers.is_demo column
-- =============================================================================
ALTER TABLE teachers ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_teachers_is_demo ON teachers(is_demo) WHERE is_demo = true;

-- =============================================================================
-- SQL BLOCK 2 -- guardians.is_demo column
-- =============================================================================
ALTER TABLE guardians ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_guardians_is_demo ON guardians(is_demo) WHERE is_demo = true;

-- =============================================================================
-- SQL BLOCK 3 -- Rewrite sync_user_roles_on_insert() to use 'parent', not
--                'guardian'. Existing triggers on students/teachers/guardians
--                continue to fire against the new body; no DROP TRIGGER needed.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.sync_user_roles_on_insert() RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_role_name TEXT;
  v_auth_id UUID;
  v_role_id UUID;
BEGIN
  v_auth_id := NEW.auth_user_id;
  IF v_auth_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'students' THEN
    v_role_name := 'student';
  ELSIF TG_TABLE_NAME = 'teachers' THEN
    v_role_name := 'teacher';
  ELSIF TG_TABLE_NAME = 'guardians' THEN
    -- Canonical mapping: guardians table -> 'parent' role.
    -- The seeded roles table has 'parent' (legacy 20260324070000 line 568);
    -- there is no 'guardian' role. Pre-fix this branch silently no-op'd.
    v_role_name := 'parent';
  END IF;

  IF v_role_name IS NULL THEN
    RETURN NEW;
  END IF;

  -- Resolve role_id from name. If the seed is missing for any reason,
  -- skip silently rather than aborting the parent INSERT. RBAC is
  -- enforced at the API boundary; this trigger is best-effort sync.
  SELECT id
    INTO v_role_id
    FROM roles
   WHERE name = v_role_name
     AND is_active = true
   LIMIT 1;

  IF v_role_id IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO user_roles (auth_user_id, role_id, is_active)
  VALUES (v_auth_id, v_role_id, true)
  ON CONFLICT (auth_user_id, role_id) DO NOTHING;

  RETURN NEW;
END;
$$;

-- =============================================================================
-- SQL BLOCK 4 -- Backfill user_roles for existing guardians whose trigger
--                silently no-op'd while the broken function body was in place.
-- =============================================================================
INSERT INTO user_roles (auth_user_id, role_id, is_active)
SELECT g.auth_user_id, r.id, true
FROM guardians g
JOIN roles r ON r.name = 'parent' AND r.is_active = true
WHERE g.auth_user_id IS NOT NULL
ON CONFLICT (auth_user_id, role_id) DO NOTHING;

-- =============================================================================
-- SQL BLOCK 5 -- Defense-in-depth: mirror admin_users.admin_level into
--                user_roles via AFTER INSERT trigger. Skips silently on
--                unmapped values so the parent INSERT is never aborted.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.sync_admin_user_role() RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_role_name TEXT;
  v_role_id UUID;
BEGIN
  IF NEW.auth_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Map admin_level -> roles.name. Unknown levels (e.g. 'moderator',
  -- which the admin_users CHECK constraint allows) get no role assigned.
  IF NEW.admin_level = 'super_admin' THEN
    v_role_name := 'super_admin';
  ELSIF NEW.admin_level = 'admin' THEN
    v_role_name := 'admin';
  ELSIF NEW.admin_level = 'finance' THEN
    v_role_name := 'finance';
  ELSIF NEW.admin_level = 'support' THEN
    v_role_name := 'support';
  END IF;

  IF v_role_name IS NULL THEN
    RETURN NEW;
  END IF;

  -- Resolve role_id; skip silently if missing.
  SELECT id
    INTO v_role_id
    FROM roles
   WHERE name = v_role_name
     AND is_active = true
   LIMIT 1;

  IF v_role_id IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO user_roles (auth_user_id, role_id, is_active)
  VALUES (NEW.auth_user_id, v_role_id, true)
  ON CONFLICT (auth_user_id, role_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_admin_user_role ON admin_users;
CREATE TRIGGER trg_sync_admin_user_role
  AFTER INSERT ON admin_users
  FOR EACH ROW
  EXECUTE FUNCTION sync_admin_user_role();

-- =============================================================================
-- VERIFICATION QUERIES (run manually post-deploy; not executed by migration)
-- =============================================================================
-- Verify teachers.is_demo exists:
--   SELECT column_name FROM information_schema.columns WHERE table_name='teachers' AND column_name='is_demo';
-- Verify parent role-sync fix:
--   SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname='sync_user_roles_on_insert';
--   Should contain 'parent', should NOT contain 'guardian'.
-- Verify backfill:
--   SELECT count(*) FROM guardians g JOIN user_roles ur ON ur.auth_user_id = g.auth_user_id
--   JOIN roles r ON r.id = ur.role_id AND r.name = 'parent';
--   Should equal count of guardians with non-null auth_user_id.
