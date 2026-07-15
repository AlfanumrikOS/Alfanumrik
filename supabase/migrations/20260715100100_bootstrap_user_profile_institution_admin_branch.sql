-- Migration: 20260715100100_bootstrap_user_profile_institution_admin_branch.sql
-- Purpose: Make institution_admin a first-class onboarding role inside
--          bootstrap_user_profile(). (Phase 3a of the onboarding-hardening
--          initiative — DB layer.) Adds a school-admin branch that creates the
--          schools + school_admins rows AND drives onboarding_state, so a school
--          admin flows through the SAME funnel as student/teacher/parent instead
--          of the app-side out-of-band fail-soft path.
--
-- BODY PROVENANCE (byte-preservation contract)
-- --------------------------------------------
-- The function body is copied VERBATIM from the current definition in
-- 20260610090100_bootstrap_link_code.sql (the M5 link-code + DPDP
-- least-privilege version). The diff versus that source is EXACTLY THREE
-- additive changes — nothing existing is removed, reordered, or rewritten:
--   1. DECLARE: one new local `v_school_id UUID;`.
--   2. A new `ELSIF p_role = 'institution_admin' THEN ...` branch inserted
--      between the existing `parent` branch and the existing `ELSE` (invalid
--      role) branch.
--   3. The verify DO-block gains one additional (fail-soft WARNING) check that
--      the institution_admin branch is present.
-- Every student / teacher / parent branch, the M5 parent link-code guardian
-- logic (both the early-return retry-heal block and the post-insert block, each
-- with the pre-existence capture + 'view' downgrade), the ELSE invalid-role
-- error path, the shared onboarding_state upsert/complete, the auth_audit_log
-- bootstrap_success row, and the learner.signed_up state_events publish for
-- students are BYTE-FOR-BYTE identical to the source.
--
-- WHY THE BRANCH IS MINIMAL
-- -------------------------
-- Like the student/teacher/parent branches, the institution_admin branch only
-- resolves `v_profile_id`. The SHARED code already:
--   * INSERTs onboarding_state (intended_role=p_role='institution_admin',
--     step='identity_created') at the top — now permitted by the widened CHECK
--     in 20260715100000; and
--   * UPDATEs it to step='completed', profile_id=v_profile_id at the tail, plus
--     the bootstrap_success audit row.
-- So the 'identity_created' -> 'completed' onboarding_state advance for a school
-- admin is handled by the identical shared path used by every other role. The
-- branch's only job is to create/reuse the schools + school_admins rows and set
-- v_profile_id = school_admins.id, mirroring
-- packages/lib/src/identity/school-admin-bootstrap.ts::bootstrapSchoolAdminProfile.
--
-- RBAC: the AFTER INSERT trigger trg_sync_school_admin_role ->
-- sync_school_admin_role() (fixed in 20260603140000) grants the institution_admin
-- RBAC role in user_roles on every school_admins INSERT, so this migration adds
-- NO new RBAC roles/permissions (institution_admin already exists in the RBAC
-- seed). No RBAC change here.
--
-- CANONICAL ROLE = 'principal': the founding admin is written with
-- school_admins.role = 'principal', the full-capability role in the CEO-approved
-- Wave-C matrix (packages/lib/src/school-admin-auth.ts:91-142) — principal holds
-- the institution_admin capability superset PLUS institution.use_principal_ai.
-- All four school_admins.role values still resolve to the single institution_admin
-- RBAC role via the trigger; the text value only matters when ff_school_admin_rbac
-- is ON (default OFF).
--
-- IDEMPOTENCY (P15 rule 4)
-- ------------------------
-- school_admins has NO unique constraint on auth_user_id (baseline: a person may
-- administer multiple schools — only school_admins_pkey on id). A naive re-INSERT
-- on the P15 3-layer retry would therefore create DUPLICATE schools + admins. The
-- branch guards against this by FIRST reusing any existing membership for this
-- auth_user_id (earliest by created_at); it creates the school + founding admin
-- ONLY when none exists. Safe to call repeatedly.
--
-- P5: grades are TEXT strings — the school-admin branch never touches grades.
-- P8: no new tables — RLS N/A (schools/school_admins keep their baseline RLS).
--
-- SECURITY DEFINER JUSTIFICATION (required by architecture rules):
--   Profile bootstrap must insert into students/teachers/guardians/school_admins/
--   schools/onboarding_state/auth_audit_log BEFORE the caller has any profile row,
--   i.e. before any RLS policy can grant them write access. Unchanged rationale;
--   the new school-admin branch writes schools + school_admins under the same
--   pre-profile bootstrap need.
--
-- SEARCH_PATH: preserved EXACTLY as the source ('public, auth, pg_catalog') to
-- stay parity with the security-advisor repair (20260614200000).
--
-- RISKS: LOW — signature unchanged; all prior behavior byte-preserved; new
--   behavior is additive and idempotent.
-- IDEMPOTENCY: YES — CREATE OR REPLACE + idempotent REVOKE + reuse-before-insert.
-- APPLICATION IS DEPLOY-TIME (docs/runbooks/schema-reproducibility-fix.md).
-- EXECUTION ORDER: after 20260610090100 (body provenance) and after
--   20260715100000 (the widened intended_role CHECK). Filename sorts last.

CREATE OR REPLACE FUNCTION public.bootstrap_user_profile(
  p_auth_user_id      UUID,
  p_role              TEXT,
  p_name              TEXT,
  p_email             TEXT,
  p_grade             TEXT DEFAULT NULL::TEXT,
  p_board             TEXT DEFAULT NULL::TEXT,
  p_school_name       TEXT DEFAULT NULL::TEXT,
  p_subjects_taught   TEXT[] DEFAULT NULL::TEXT[],
  p_grades_taught     TEXT[] DEFAULT NULL::TEXT[],
  p_phone             TEXT DEFAULT NULL::TEXT,
  p_link_code         TEXT DEFAULT NULL::TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_catalog
AS $$
DECLARE
  v_profile_id UUID;
  v_onboarding_id UUID;
  v_existing_step TEXT;
  -- M5: guardian-student linking state
  v_link_code   TEXT := nullif(trim(coalesce(p_link_code, '')), '');
  v_link_status TEXT := 'not_attempted';
  v_link_result JSONB;
  -- DPDP least-privilege downgrade state (see header): which student the
  -- code resolves to, and whether the link existed BEFORE the RPC call.
  v_link_student_id UUID;
  v_link_preexisted BOOLEAN := FALSE;
  -- Phase 3a: school-admin bootstrap — the school this admin is keyed to.
  v_school_id UUID;
BEGIN
  SELECT step, profile_id INTO v_existing_step, v_profile_id
    FROM onboarding_state
    WHERE auth_user_id = p_auth_user_id;

  IF v_existing_step = 'completed' THEN
    -- M5 retry-heal: a completed parent re-invoking bootstrap with a link
    -- code (e.g. after a transient link failure) still converges to linked.
    -- Fail-soft: never disturbs the idempotent early return.
    IF p_role IN ('parent', 'guardian') AND v_link_code IS NOT NULL THEN
      BEGIN
        -- DPDP least-privilege (see header): capture pre-existence BEFORE
        -- the call so the post-success 'view' downgrade can never flatten a
        -- pre-existing (possibly admin-elevated 'full') link on retry-heal.
        SELECT s.id INTO v_link_student_id
          FROM public.students s
         WHERE (s.invite_code = upper(v_link_code) OR s.link_code = upper(v_link_code))
           AND s.is_active = TRUE
         LIMIT 1;
        v_link_preexisted := EXISTS (
          SELECT 1
            FROM public.guardian_student_links gsl
            JOIN public.guardians g ON g.id = gsl.guardian_id
           WHERE g.auth_user_id = p_auth_user_id
             AND gsl.student_id = v_link_student_id
        );
        v_link_result := public.link_guardian_via_invite_code(p_auth_user_id, v_link_code);
        IF coalesce(v_link_result->>'success', 'false') = 'true' THEN
          v_link_status := 'linked';
          IF NOT v_link_preexisted AND (v_link_result ? 'link_id') THEN
            UPDATE public.guardian_student_links
               SET permission_level = 'view', updated_at = now()
             WHERE id = (v_link_result->>'link_id')::uuid
               AND permission_level = 'full';
          END IF;
        ELSE
          v_link_status := 'invalid_code';
        END IF;
      EXCEPTION WHEN OTHERS THEN
        v_link_status := 'invalid_code';
      END;
    END IF;
    RETURN jsonb_build_object('status', 'already_completed', 'profile_id', v_profile_id,
      'link_status', v_link_status);
  END IF;

  INSERT INTO onboarding_state (auth_user_id, intended_role, step)
  VALUES (p_auth_user_id, p_role, 'identity_created')
  ON CONFLICT (auth_user_id) DO UPDATE SET
    step = 'identity_created',
    error_message = NULL,
    error_step = NULL,
    retry_count = onboarding_state.retry_count + 1,
    updated_at = now()
  RETURNING id INTO v_onboarding_id;

  BEGIN
    IF p_role = 'student' THEN
      INSERT INTO students (auth_user_id, name, email, grade, board, preferred_language, account_status)
      VALUES (
        p_auth_user_id, p_name, p_email,
        COALESCE(p_grade, '9'), COALESCE(p_board, 'CBSE'), 'en', 'active'
      )
      ON CONFLICT ON CONSTRAINT students_auth_user_id_unique DO UPDATE SET
        name = EXCLUDED.name, updated_at = now()
      RETURNING id INTO v_profile_id;

    ELSIF p_role = 'teacher' THEN
      INSERT INTO teachers (auth_user_id, name, email, school_name, subjects_taught, grades_taught)
      VALUES (
        p_auth_user_id, p_name, p_email, p_school_name,
        COALESCE(p_subjects_taught, '{}'), COALESCE(p_grades_taught, '{}')
      )
      ON CONFLICT ON CONSTRAINT teachers_auth_user_id_unique DO UPDATE SET
        name = EXCLUDED.name, updated_at = now()
      RETURNING id INTO v_profile_id;

    ELSIF p_role = 'parent' THEN
      INSERT INTO guardians (auth_user_id, name, email, phone)
      VALUES (p_auth_user_id, p_name, p_email, p_phone)
      ON CONFLICT ON CONSTRAINT guardians_auth_user_id_unique DO UPDATE SET
        name = EXCLUDED.name, updated_at = now()
      RETURNING id INTO v_profile_id;

    ELSIF p_role = 'institution_admin' THEN
      -- Phase 3a: school-admin bootstrap, mirroring the app-side fail-soft helper
      -- packages/lib/src/identity/school-admin-bootstrap.ts (bootstrapSchoolAdminProfile):
      -- create a schools row then a school_admins row keyed to it. The AFTER INSERT
      -- trigger trg_sync_school_admin_role -> sync_school_admin_role() grants the
      -- institution_admin RBAC role in user_roles automatically (see
      -- 20260603140000_fix_sync_school_admin_role_trigger.sql), so no explicit RBAC
      -- wiring is needed here.
      --
      -- IDEMPOTENCY (P15 rule 4): school_admins has NO unique constraint on
      -- auth_user_id (a person may administer multiple schools), so a naive
      -- re-INSERT on the P15 retry path would create duplicate schools + admins.
      -- Reuse any existing membership FIRST (earliest by created_at); only create
      -- the school + founding admin when none exists.
      SELECT sa.id, sa.school_id
        INTO v_profile_id, v_school_id
        FROM public.school_admins sa
       WHERE sa.auth_user_id = p_auth_user_id
       ORDER BY sa.created_at ASC, sa.id ASC
       LIMIT 1;

      IF v_profile_id IS NULL THEN
        -- Name falls back to 'My School', board to 'CBSE' — identical to the
        -- app-side helper. city/state are not part of this RPC's signature, so
        -- they stay NULL (nullable in schools).
        INSERT INTO public.schools (name, board)
        VALUES (
          COALESCE(NULLIF(TRIM(p_school_name), ''), 'My School'),
          COALESCE(NULLIF(TRIM(p_board), ''), 'CBSE')
        )
        RETURNING id INTO v_school_id;

        -- Canonical role 'principal' = the full-capability Wave-C role.
        INSERT INTO public.school_admins (auth_user_id, school_id, role, name, email, phone)
        VALUES (p_auth_user_id, v_school_id, 'principal', p_name, p_email, p_phone)
        ON CONFLICT DO NOTHING
        RETURNING id INTO v_profile_id;

        -- Defensive: if a concurrent invocation won the race and ON CONFLICT
        -- skipped our INSERT, re-resolve so v_profile_id (-> onboarding_state
        -- .profile_id) is never NULL.
        IF v_profile_id IS NULL THEN
          SELECT sa.id INTO v_profile_id
            FROM public.school_admins sa
           WHERE sa.auth_user_id = p_auth_user_id
             AND sa.school_id = v_school_id
           ORDER BY sa.created_at ASC, sa.id ASC
           LIMIT 1;
        END IF;
      END IF;

    ELSE
      UPDATE onboarding_state SET
        step = 'failed', error_message = 'Invalid role: ' || p_role,
        error_step = 'profile_created', updated_at = now()
      WHERE id = v_onboarding_id;
      RETURN jsonb_build_object('status', 'error', 'error', 'Invalid role',
        'link_status', 'not_attempted');
    END IF;

  EXCEPTION WHEN OTHERS THEN
    UPDATE onboarding_state SET
      step = 'failed', error_message = SQLERRM,
      error_step = 'profile_created', updated_at = now()
    WHERE id = v_onboarding_id;
    RETURN jsonb_build_object('status', 'error', 'error', SQLERRM,
      'link_status', 'not_attempted');
  END;

  -- M5: wire the signup-supplied child link code (fail-soft — an invalid,
  -- expired, or already-used code never aborts profile creation). Only the
  -- 'parent' branch can reach here with a guardian row; 'guardian' is kept
  -- in the predicate for symmetry with the early-return path.
  IF p_role IN ('parent', 'guardian') AND v_link_code IS NOT NULL THEN
    BEGIN
      -- DPDP least-privilege (backend P14 review, 2026-06-10 — see header):
      -- resolve the student with the SAME predicate the RPC uses, then record
      -- whether the guardian<->student link already exists. Only a row created
      -- by THIS invocation may be downgraded from the RPC's hardcoded 'full'
      -- to 'view'; a pre-existing link is never touched.
      SELECT s.id INTO v_link_student_id
        FROM public.students s
       WHERE (s.invite_code = upper(v_link_code) OR s.link_code = upper(v_link_code))
         AND s.is_active = TRUE
       LIMIT 1;
      v_link_preexisted := EXISTS (
        SELECT 1
          FROM public.guardian_student_links gsl
          JOIN public.guardians g ON g.id = gsl.guardian_id
         WHERE g.auth_user_id = p_auth_user_id
           AND gsl.student_id = v_link_student_id
      );
      v_link_result := public.link_guardian_via_invite_code(p_auth_user_id, v_link_code);
      IF coalesce(v_link_result->>'success', 'false') = 'true' THEN
        v_link_status := 'linked';
        IF NOT v_link_preexisted AND (v_link_result ? 'link_id') THEN
          -- Targets the exact row the RPC returned; the permission_level
          -- predicate restricts the write to undoing the RPC's own default.
          UPDATE public.guardian_student_links
             SET permission_level = 'view', updated_at = now()
           WHERE id = (v_link_result->>'link_id')::uuid
             AND permission_level = 'full';
        END IF;
      ELSE
        v_link_status := 'invalid_code';
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_link_status := 'invalid_code';
    END;
  END IF;

  UPDATE onboarding_state SET
    step = 'completed', profile_id = v_profile_id,
    completed_at = now(), updated_at = now()
  WHERE id = v_onboarding_id;

  INSERT INTO auth_audit_log (auth_user_id, event_type, metadata)
  VALUES (p_auth_user_id, 'bootstrap_success',
    jsonb_build_object('role', p_role, 'profile_id', v_profile_id,
      'link_status', v_link_status));

  -- Publish learner.signed_up event if role is student
  IF p_role = 'student' THEN
    INSERT INTO public.state_events (
      event_id,
      kind,
      actor_auth_user_id,
      tenant_id,
      idempotency_key,
      occurred_at,
      payload
    ) VALUES (
      gen_random_uuid(),
      'learner.signed_up',
      p_auth_user_id,
      NULL,
      'learner-signed-up:' || p_auth_user_id::text,
      NOW(),
      jsonb_build_object(
        'grade',     COALESCE(p_grade, '9'),
        'board',     COALESCE(p_board, 'CBSE'),
        'language',  'en',
        'invitedBy', NULL
      )
    )
    ON CONFLICT (idempotency_key) DO NOTHING;
  END IF;

  RETURN jsonb_build_object('status', 'success', 'profile_id', v_profile_id, 'role', p_role,
    'link_status', v_link_status);
END;
$$;

-- Re-assert: anon must never execute this function (20260515000002 /
-- 20260610000000 / 20260610090100 parity).
REVOKE EXECUTE ON FUNCTION public.bootstrap_user_profile(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT[], TEXT[], TEXT, TEXT) FROM anon;

-- Verification: confirm the new definition is in place (no data writes — we
-- never invoke the RPC from a migration). Fail-soft WARNINGs only.
DO $verify$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'bootstrap_user_profile'
   LIMIT 1;

  IF v_def IS NULL THEN
    RAISE WARNING '[20260715100100] bootstrap_user_profile not found after CREATE OR REPLACE';
  ELSIF position('link_status' IN v_def) = 0 THEN
    RAISE WARNING '[20260715100100] bootstrap_user_profile body does not contain link_status — M5 fix regressed (byte-preservation broken)';
  ELSIF position('link_guardian_via_invite_code' IN v_def) = 0 THEN
    RAISE WARNING '[20260715100100] bootstrap_user_profile does not call link_guardian_via_invite_code — M5 fix regressed (byte-preservation broken)';
  ELSIF position('v_link_preexisted' IN v_def) = 0 THEN
    RAISE WARNING '[20260715100100] bootstrap_user_profile lacks the DPDP least-privilege downgrade — byte-preservation broken';
  ELSIF position('institution_admin' IN v_def) = 0 THEN
    RAISE WARNING '[20260715100100] bootstrap_user_profile lacks the institution_admin branch — Phase 3a fix not applied';
  ELSE
    RAISE NOTICE '[20260715100100] bootstrap_user_profile institution_admin branch + M5/DPDP preservation verified. COMPLETE.';
  END IF;

  -- The linking RPC this function depends on must exist (it ships in the
  -- baseline; this guards against a partial fresh-env bootstrap).
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'link_guardian_via_invite_code'
  ) THEN
    RAISE WARNING '[20260715100100] dependency public.link_guardian_via_invite_code is MISSING — link attempts will fail-soft to invalid_code';
  END IF;

  -- The trigger that grants the institution_admin RBAC role on school_admins
  -- INSERT must exist for the school-admin branch to end up role-complete.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'sync_school_admin_role'
  ) THEN
    RAISE WARNING '[20260715100100] dependency public.sync_school_admin_role trigger fn is MISSING — school admins will lack the institution_admin RBAC role until repaired';
  END IF;
END $verify$;
