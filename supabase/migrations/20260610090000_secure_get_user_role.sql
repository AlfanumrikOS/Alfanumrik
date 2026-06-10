-- Migration: 20260610090000_secure_get_user_role.sql
-- Date: 2026-06-10
--
-- WHY THIS FILE EXISTS (security finding H1 — PII enumeration)
-- ------------------------------------------------------------
-- get_user_role(p_auth_user_id uuid) is SECURITY DEFINER and was callable by
-- ANY authenticated user with ANY auth_user_id. Because it returns role,
-- name, grade, and school_id for the supplied id, a logged-in attacker could
-- enumerate UUIDs (e.g. harvested from leaderboards, class rosters, or URLs)
-- and read profile PII for arbitrary users — students included — without
-- touching any RLS-protected table. (anon was already revoked by
-- 20260515000002; authenticated was the remaining vector.)
--
-- THE FIX
-- -------
-- Recreate the function EXACTLY as defined in
-- 20260609180000_extend_get_user_role_school_admin.sql, adding one early
-- guard: a caller whose JWT role is NOT service_role may only query their
-- own identity (p_auth_user_id must equal auth.uid()).
--
-- CALL-SITE AUDIT (2026-06-10 — every caller in src/, supabase/functions/,
-- mobile/, and SQL):
--   SAFE / self-id, authenticated client:
--     - src/lib/AuthContext.tsx:304            (user.id — own session)
--     - mobile/lib/providers/role_provider.dart:51 (currentUser.id — own session)
--     - src/lib/supabase.ts:838 getUserRole()  (exported helper; no production
--       caller passes a foreign id — only referenced by api.test.ts typeof check)
--   SAFE / service_role key (guard bypassed):
--     - src/lib/middleware-helpers.ts:112      (PostgREST fetch with service key)
--     - src/app/api/super-admin/debug/whoami/route.ts:286 (getSupabaseAdmin())
--     - supabase/functions/export-report/index.ts:92 via resolveCallerRole
--       (called at index.ts:595 with the service-role client AND the caller's
--       own user.id)
--   INTERNAL SQL:
--     - admin_update_user_status() (baseline line 365) calls
--       get_user_role(p_target_auth_user_id). That RPC has ZERO callers in
--       application code (only the generated database.types.ts entry). If it
--       is ever activated it must be invoked via the service-role client, or
--       this guard will raise inside it. Documented as accepted residual risk.
--   No call site passes a different user's id through an authenticated
--   (non-service-role) client → guard is non-breaking.
--
-- SECURITY DEFINER JUSTIFICATION (required by architecture rules):
--   The function must read students/teachers/guardians/school_admins across
--   role tables that the caller cannot read directly under RLS, to compute a
--   consolidated role envelope for the caller's OWN identity. The new
--   auth.uid() binding makes DEFINER safe: a non-service-role caller can only
--   ever retrieve their own row(s).
--
-- NOTE ON NON-JWT CONTEXTS (psql, SQL editor, pg_cron):
--   auth.role() and auth.uid() are NULL there, so calls with a non-NULL
--   p_auth_user_id will raise. No pg_cron job or migration calls this
--   function. Ops can simulate service_role via
--   set_config('request.jwt.claims','{"role":"service_role"}', true) if a
--   manual lookup is ever needed.
--
-- RISKS: LOW — signature, return shape, grants, and body are unchanged
--   except for the guard. CREATE OR REPLACE preserves existing ACLs
--   (anon already revoked by 20260515000002; re-asserted below).
-- IDEMPOTENCY: YES — CREATE OR REPLACE + idempotent REVOKE.
-- EXECUTION ORDER: must run after 20260609180000 (it copies that body).
--   Filename 20260610090000 sorts after it. On environments already past
--   20260614200002, apply with the staging pipeline's out-of-order handling
--   (supabase db push --include-all) — this file is standalone either way.

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
  -- H1 guard (2026-06-10): non-service-role callers may only query their own
  -- identity. Blocks authenticated-key PII enumeration of arbitrary UUIDs.
  IF coalesce(auth.role(), '') <> 'service_role'
     AND p_auth_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'get_user_role: callers may only query their own identity';
  END IF;

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

-- Re-assert: anon must never execute this function (20260515000002 parity).
REVOKE EXECUTE ON FUNCTION public.get_user_role(uuid) FROM anon;

-- Verification: simulate the three JWT contexts via transaction-local GUCs
-- (auth.role()/auth.uid() read request.jwt.* settings). Each scenario is
-- fail-soft (WARNING, never aborts the migration).
DO $verify$
DECLARE
  v_result jsonb;
  v_guard_fired boolean := false;
BEGIN
  -- Scenario A: service_role context → bypass allowed, returns 'none' for
  -- a non-existent UUID.
  BEGIN
    PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
    PERFORM set_config('request.jwt.claim.role', 'service_role', true);
    PERFORM set_config('request.jwt.claim.sub', '', true);
    v_result := public.get_user_role('00000000-0000-0000-0000-000000000000'::uuid);
    IF v_result->>'primary_role' IS DISTINCT FROM 'none' THEN
      RAISE WARNING '[20260610090000] service_role path returned unexpected primary_role: %',
        v_result->>'primary_role';
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[20260610090000] service_role bypass FAILED (% — %). Middleware/admin callers would break — investigate before deploy.',
      SQLSTATE, SQLERRM;
  END;

  -- Scenario B: authenticated self-lookup → allowed.
  BEGIN
    PERFORM set_config('request.jwt.claims',
      '{"role":"authenticated","sub":"11111111-1111-1111-1111-111111111111"}', true);
    PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
    PERFORM set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
    v_result := public.get_user_role('11111111-1111-1111-1111-111111111111'::uuid);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[20260610090000] authenticated self-lookup FAILED (% — %). AuthContext/mobile would break — investigate before deploy.',
      SQLSTATE, SQLERRM;
  END;

  -- Scenario C: authenticated CROSS-USER lookup → guard must fire.
  BEGIN
    v_result := public.get_user_role('22222222-2222-2222-2222-222222222222'::uuid);
  EXCEPTION WHEN OTHERS THEN
    v_guard_fired := true;
  END;
  IF NOT v_guard_fired THEN
    RAISE WARNING '[20260610090000] guard DID NOT fire on cross-user lookup — H1 fix not effective';
  ELSE
    RAISE NOTICE '[20260610090000] get_user_role identity guard verified. COMPLETE.';
  END IF;

  -- Clear simulated claims (transaction-local, but explicit for any
  -- statements that might share this transaction).
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
END $verify$;
