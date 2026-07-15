-- Migration: 20260715100300_admin_repair_user_onboarding_institution_admin.sql
-- Purpose: Teach admin_repair_user_onboarding() about school admins.
--          (Phase 3a of the onboarding-hardening initiative — DB layer.)
--          The repair RPC (called by apps/host/src/app/api/auth/repair/route.ts)
--          previously knew only student/teacher/parent, so a school admin with a
--          missing/broken onboarding_state could not be repaired — the common gap
--          being a school_admins row created by the app-side helper
--          packages/lib/src/identity/school-admin-bootstrap.ts that never wrote
--          onboarding_state. This adds an idempotent institution_admin branch.
--
-- BODY PROVENANCE (byte-preservation contract)
-- --------------------------------------------
-- Rebased on the current definition in
-- 00000000000000_baseline_from_prod.sql:292-341 (no later migration redefines it;
-- 20260516040000 / 20260516050000 only REVOKE its EXECUTE). The diff versus that
-- source is purely ADDITIVE — for a user with NO school_admins row the behavior is
-- unchanged:
--   1. DECLARE: two new locals (v_has_school_admin, v_school_id).
--   2. One new EXISTS probe: v_has_school_admin.
--   3. The auto-detect CASE gains ONE prepended arm
--      `WHEN v_has_school_admin THEN 'institution_admin'`. When p_force_role is
--      supplied the CASE is never evaluated (COALESCE short-circuits), so forced
--      repairs are unaffected; when it is NULL, only users who HAVE a school_admins
--      row change branch — exactly the users this migration is meant to serve. The
--      existing teacher > parent > student ordering is preserved verbatim below the
--      new arm.
--   4. One new `ELSIF v_role = 'institution_admin' THEN ...` profile-resolution
--      branch (idempotent: reuse the earliest school_admins membership, else create
--      a minimal school + founding admin, then self-heal the institution_admin RBAC
--      grant that sync_user_roles_for_user does NOT cover).
--   5. Additive keys `had_school_admin` in the audit metadata and the return JSON.
-- The onboarding_state upsert, PERFORM sync_user_roles_for_user, and the shared
-- audit/return scaffold are otherwise identical to the source.
--
-- WHY 'principal' ON CREATE: consistent with the bootstrap RPC
-- (20260715100100) — 'principal' is the canonical full-capability Wave-C role.
-- All four school_admins.role values still resolve to the single institution_admin
-- RBAC role via trg_sync_school_admin_role.
--
-- SAFETY CONTRACT
-- ---------------
--   - IDEMPOTENT: reuse-before-insert on school_admins (no unique key on
--     auth_user_id), ON CONFLICT DO NOTHING on user_roles, onboarding_state upsert
--     ON CONFLICT DO UPDATE. Safe to call repeatedly (P15 rule 4).
--   - ADDITIVE: no new tables (P8 RLS N/A), no DROP, grades untouched (P5 N/A).
--   - SECURITY DEFINER preserved with pinned search_path='public' (matches source);
--     needed because repair writes profile/onboarding/role rows for a user who may
--     have no profile row yet, before RLS can grant them access.
--   - EXECUTE re-REVOKED from anon, authenticated, PUBLIC at the end to preserve
--     the hardened posture set by 20260516040000 / 20260516050000 (service-role /
--     definer-internal only). CREATE OR REPLACE keeps existing grants, but the
--     explicit re-REVOKE guarantees the posture on fresh environments regardless of
--     apply order and never weakens it.
--
-- APPLICATION IS DEPLOY-TIME (docs/runbooks/schema-reproducibility-fix.md).
-- EXECUTION ORDER: after 20260715100000 (the widened intended_role CHECK — the
--   onboarding_state upsert writes intended_role='institution_admin'). Filename
--   sorts after it.

CREATE OR REPLACE FUNCTION public.admin_repair_user_onboarding(
  p_auth_user_id uuid,
  p_force_role text DEFAULT NULL::text
) RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $$
DECLARE
  v_role TEXT;
  v_profile_id UUID;
  v_has_student BOOLEAN;
  v_has_teacher BOOLEAN;
  v_has_guardian BOOLEAN;
  v_has_school_admin BOOLEAN;
  v_school_id UUID;
BEGIN
  SELECT EXISTS(SELECT 1 FROM students WHERE auth_user_id = p_auth_user_id) INTO v_has_student;
  SELECT EXISTS(SELECT 1 FROM teachers WHERE auth_user_id = p_auth_user_id) INTO v_has_teacher;
  SELECT EXISTS(SELECT 1 FROM guardians WHERE auth_user_id = p_auth_user_id) INTO v_has_guardian;
  SELECT EXISTS(SELECT 1 FROM school_admins WHERE auth_user_id = p_auth_user_id) INTO v_has_school_admin;

  v_role := COALESCE(p_force_role,
    CASE
      WHEN v_has_school_admin THEN 'institution_admin'
      WHEN v_has_teacher THEN 'teacher'
      WHEN v_has_guardian THEN 'parent'
      WHEN v_has_student THEN 'student'
      ELSE 'student'
    END
  );

  IF v_role = 'student' AND v_has_student THEN
    SELECT id INTO v_profile_id FROM students WHERE auth_user_id = p_auth_user_id LIMIT 1;
  ELSIF v_role = 'teacher' AND v_has_teacher THEN
    SELECT id INTO v_profile_id FROM teachers WHERE auth_user_id = p_auth_user_id LIMIT 1;
  ELSIF v_role = 'parent' AND v_has_guardian THEN
    SELECT id INTO v_profile_id FROM guardians WHERE auth_user_id = p_auth_user_id LIMIT 1;
  ELSIF v_role = 'institution_admin' THEN
    -- Ensure the structural school-admin rows exist (idempotent). Common repair
    -- case: the school_admins row exists (app-side helper) but onboarding_state
    -- was never written. Reuse the earliest membership; only create a minimal
    -- school + founding admin when NONE exists (e.g. repair forced via
    -- p_force_role before any school_admins row was created). school_admins has
    -- no unique key on auth_user_id, so reuse-before-insert is the idempotency
    -- guard (not ON CONFLICT).
    SELECT id, school_id INTO v_profile_id, v_school_id
      FROM school_admins WHERE auth_user_id = p_auth_user_id
      ORDER BY created_at ASC, id ASC LIMIT 1;

    IF v_profile_id IS NULL THEN
      INSERT INTO schools (name, board) VALUES ('My School', 'CBSE')
        RETURNING id INTO v_school_id;
      INSERT INTO school_admins (auth_user_id, school_id, role)
        VALUES (p_auth_user_id, v_school_id, 'principal')
        ON CONFLICT DO NOTHING
        RETURNING id INTO v_profile_id;
      -- Defensive: if a concurrent invocation raced us, re-resolve so
      -- v_profile_id is never NULL.
      IF v_profile_id IS NULL THEN
        SELECT id INTO v_profile_id FROM school_admins
          WHERE auth_user_id = p_auth_user_id AND school_id = v_school_id
          ORDER BY created_at ASC, id ASC LIMIT 1;
      END IF;
    END IF;

    -- Self-heal the institution_admin RBAC grant. sync_user_roles_for_user()
    -- (called below) only handles student/teacher/parent, so ensure it here.
    -- Mirrors sync_school_admin_role(); no-op if already granted or role absent.
    INSERT INTO user_roles (auth_user_id, role_id, is_active)
    SELECT p_auth_user_id, r.id, true
      FROM roles r
     WHERE r.name = 'institution_admin' AND r.is_active = true
    ON CONFLICT (auth_user_id, role_id) DO NOTHING;
  END IF;

  INSERT INTO onboarding_state (auth_user_id, intended_role, step, profile_id, completed_at)
  VALUES (p_auth_user_id, v_role, 'completed', v_profile_id, now())
  ON CONFLICT (auth_user_id) DO UPDATE SET
    step = 'completed',
    profile_id = COALESCE(v_profile_id, onboarding_state.profile_id),
    error_message = NULL, completed_at = now(), updated_at = now();

  PERFORM sync_user_roles_for_user(p_auth_user_id);

  INSERT INTO auth_audit_log (auth_user_id, event_type, metadata)
  VALUES (p_auth_user_id, 'bootstrap_success',
    jsonb_build_object('action', 'admin_repair', 'role', v_role, 'profile_id', v_profile_id,
      'had_student', v_has_student, 'had_teacher', v_has_teacher, 'had_guardian', v_has_guardian,
      'had_school_admin', v_has_school_admin));

  RETURN jsonb_build_object('status', 'repaired', 'role', v_role, 'profile_id', v_profile_id,
    'had_student', v_has_student, 'had_teacher', v_has_teacher, 'had_guardian', v_has_guardian,
    'had_school_admin', v_has_school_admin);
END;
$$;

-- Preserve the hardened EXECUTE posture (20260516040000 / 20260516050000):
-- service-role / definer-internal only. Idempotent; never weakens.
REVOKE EXECUTE ON FUNCTION public.admin_repair_user_onboarding(uuid, text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_repair_user_onboarding(uuid, text) FROM PUBLIC;

-- Verification (no data writes). Fail-soft WARNING only.
DO $verify$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'admin_repair_user_onboarding'
   LIMIT 1;

  IF v_def IS NULL THEN
    RAISE WARNING '[20260715100300] admin_repair_user_onboarding not found after CREATE OR REPLACE';
  ELSIF position('v_has_school_admin' IN v_def) = 0 THEN
    RAISE WARNING '[20260715100300] admin_repair_user_onboarding lacks the institution_admin branch — Phase 3a fix not applied';
  ELSE
    RAISE NOTICE '[20260715100300] admin_repair_user_onboarding institution_admin branch verified. COMPLETE.';
  END IF;
END $verify$;
