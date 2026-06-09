-- Migration: 20260609180000_extend_get_user_role_school_admin.sql
-- Date: 2026-06-09
--
-- WHY THIS FILE EXISTS
-- --------------------
-- get_user_role (baseline line 5336) only queries students, teachers,
-- guardians. It has never known about school_admins.
--
-- For any school_admin user the RPC returns { roles: [] } because none of
-- those three tables contain their auth_user_id. AuthContext sees
-- rolesResolved = false and falls through to the fallback block, which fires
-- .single() on all three tables. PostgREST returns HTTP 406 on .single() when
-- zero rows exist, producing three console errors per render cycle.
-- The school_admins .maybeSingle() check later in the fallback does find the
-- row, so the user can still log in -- but the 406 noise repeats on every
-- page load and indicates the primary auth path is broken for school_admins.
--
-- This migration extends get_user_role to also query school_admins, so:
--   1. rolesResolved = true → fallback block never runs → zero 406 errors
--   2. primary_role is set correctly via the RPC instead of the fallback
--   3. The school_admin field is returned in the RPC response for future use
--
-- RISKS: LOW
--   - CREATE OR REPLACE is a backwards-compatible extension; the function
--     signature is unchanged (same argument, same RETURNS jsonb).
--   - Adds one new key ('institution_admin') to the JSONB response. Any code
--     that does not reference it is unaffected (JSONB extra keys are ignored).
--   - All four table lookups are LIMITed to 1 row, so performance is the same.
-- IDEMPOTENCY: YES — CREATE OR REPLACE.
-- EXECUTION ORDER: Independent. No dependencies on Phase 3B migrations.

CREATE OR REPLACE FUNCTION public.get_user_role(p_auth_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_s  record;
  v_t  record;
  v_g  record;
  v_sa record;
  v_roles text[] := '{}';
BEGIN
  -- Students
  SELECT id, name, grade, onboarding_completed
    INTO v_s
    FROM students
   WHERE auth_user_id = p_auth_user_id
   LIMIT 1;
  IF FOUND THEN v_roles := array_append(v_roles, 'student'); END IF;

  -- Teachers
  SELECT id, name, onboarding_completed
    INTO v_t
    FROM teachers
   WHERE auth_user_id = p_auth_user_id
   LIMIT 1;
  IF FOUND THEN v_roles := array_append(v_roles, 'teacher'); END IF;

  -- Guardians / Parents
  SELECT id, name
    INTO v_g
    FROM guardians
   WHERE auth_user_id = p_auth_user_id
   LIMIT 1;
  IF FOUND THEN v_roles := array_append(v_roles, 'guardian'); END IF;

  -- School Admins (institution_admin) — added 2026-06-09
  -- Only returns active accounts so deactivated demo accounts are invisible
  -- to the auth system (their row stays in the DB but won't grant the role).
  SELECT id, school_id
    INTO v_sa
    FROM school_admins
   WHERE auth_user_id = p_auth_user_id
     AND is_active = true
   LIMIT 1;
  IF FOUND THEN v_roles := array_append(v_roles, 'institution_admin'); END IF;

  RETURN jsonb_build_object(
    'roles',   to_jsonb(v_roles),

    'student', CASE WHEN v_s.id IS NOT NULL THEN
      jsonb_build_object(
        'id',                    v_s.id,
        'name',                  v_s.name,
        'grade',                 v_s.grade,
        'onboarding_completed',  COALESCE(v_s.onboarding_completed, false)
      )
    END,

    'teacher', CASE WHEN v_t.id IS NOT NULL THEN
      jsonb_build_object(
        'id',                    v_t.id,
        'name',                  v_t.name,
        'onboarding_completed',  COALESCE(v_t.onboarding_completed, false)
      )
    END,

    'guardian', CASE WHEN v_g.id IS NOT NULL THEN
      jsonb_build_object('id', v_g.id, 'name', v_g.name)
    END,

    -- New key: institution_admin.  Keyed on school_id so the client can
    -- redirect directly to /school-admin?school_id=... without a second query.
    'institution_admin', CASE WHEN v_sa.id IS NOT NULL THEN
      jsonb_build_object('id', v_sa.id, 'school_id', v_sa.school_id)
    END,

    'primary_role', CASE
      WHEN v_t.id  IS NOT NULL THEN 'teacher'
      WHEN v_sa.id IS NOT NULL THEN 'institution_admin'
      WHEN v_g.id  IS NOT NULL THEN 'guardian'
      WHEN v_s.id  IS NOT NULL THEN 'student'
      ELSE 'none'
    END
  );
END;
$$;

-- Verification: confirm function compiles and returns expected shape for a
-- non-existent UUID (all NULLs, roles: []).
DO $verify$
DECLARE
  v_result jsonb;
BEGIN
  SELECT public.get_user_role('00000000-0000-0000-0000-000000000000'::uuid)
    INTO v_result;

  IF v_result->>'primary_role' IS DISTINCT FROM 'none' THEN
    RAISE WARNING '[20260609180000] get_user_role returned unexpected primary_role for null UUID: %',
      v_result->>'primary_role';
  ELSE
    RAISE NOTICE '[20260609180000] get_user_role extended with institution_admin branch. COMPLETE.';
  END IF;
END $verify$;
