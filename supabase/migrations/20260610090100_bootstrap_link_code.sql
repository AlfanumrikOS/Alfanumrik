-- Migration: 20260610090100_bootstrap_link_code.sql
-- Date: 2026-06-10
--
-- WHY THIS FILE EXISTS (finding M5 — p_link_code accepted but never used)
-- -----------------------------------------------------------------------
-- bootstrap_user_profile() has carried a p_link_code parameter since
-- 20260402100000 and every server caller (auth/callback, auth/confirm,
-- /api/auth/bootstrap) passes the parent-supplied child link code into it —
-- but the function body NEVER read the parameter. Guardians who signed up
-- with a link code got an account with zero linked children and had to
-- re-enter the code in the parent portal (many never did).
--
-- THE FIX
-- -------
-- When p_role IN ('parent','guardian') AND p_link_code is non-empty, resolve
-- the student and create the guardian_student_links row idempotently.
--
-- MECHANISM CHOICE (per review): we CALL the existing SECURITY DEFINER RPC
-- public.link_guardian_via_invite_code(p_guardian_auth_id, p_invite_code)
-- (baseline line 5579) instead of inlining, because it already:
--   * matches students.invite_code OR students.link_code (upper/trim'd),
--     only for is_active students;
--   * rejects self-linking;
--   * is idempotent: ON CONFLICT (guardian_id, student_id) DO UPDATE →
--     status 'approved', is_verified TRUE;
--   * bumps invite_codes.use_count and writes admin_audit_log;
--   * returns {'success': bool, ...} instead of raising on bad codes.
-- Its EXECUTE was revoked from anon/authenticated (20260516040000), which
-- does NOT block this nested call: inside this SECURITY DEFINER function the
-- privilege check runs as the function owner, not the end caller.
--
-- PERMISSION LEVEL — DPDP LEAST-PRIVILEGE AMENDMENT (backend P14 review,
-- 2026-06-10)
-- ----------------------------------------------------------------------
-- link_guardian_via_invite_code hardcodes permission_level='full' on its
-- INSERT branch, while the OTP-verified parent-portal flow
-- (link_guardian_to_student_via_code, baseline:5573) grants 'view' (also
-- the column DEFAULT). Nothing in app code or RLS reads permission_level
-- today — status alone gates access (verified by backend reviewer) — but
-- the divergence is a latent privilege footgun: a future feature keying on
-- 'full' would silently grant signup-linked guardians more access than
-- OTP-verified portal-linked ones, with no verification step behind it
-- (DPDP data-minimisation: default to the least privilege that satisfies
-- the flow). This migration therefore downgrades the link to 'view'
-- immediately after a successful call — but ONLY when the row was created
-- by this very invocation. NEVER downgrade a pre-existing link:
--   1. BEFORE calling the RPC we resolve the student the code points at
--      (same predicate the RPC uses: invite_code OR link_code, upper/trim,
--      is_active) and record whether a guardian_student_links row already
--      exists for the pair (v_link_preexisted).
--   2. The RPC's ON CONFLICT (guardian_id, student_id) DO UPDATE clause
--      deliberately does NOT touch permission_level, so a re-run against a
--      pre-existing link (possibly elevated to 'full' by an admin action)
--      is left untouched by the RPC itself...
--   3. ...and our post-call UPDATE is skipped when v_link_preexisted, is
--      targeted at the exact row id the RPC returned ('link_id' key), AND
--      is restricted to permission_level='full' — it can only undo the
--      RPC's own hardcoded default, never any other value.
-- Explicit pre-existence capture was chosen over created_at/updated_at
-- freshness heuristics because now()-based comparisons misclassify rows
-- committed by transactions that began after this one. The downgrade lives
-- inside the same fail-soft EXCEPTION block: if it errors, the plpgsql
-- savepoint rollback also undoes the link insert and link_status reports
-- 'invalid_code', so the P15 retry-heal path re-converges on the next call.
--
-- FAIL-SOFT GUARANTEE (P15): an invalid/expired/missing link code NEVER
-- aborts profile creation. The link attempt is wrapped in its own exception
-- block and only sets link_status.
--
-- RETURN SHAPE: every return path now carries an ADDITIVE 'link_status' key
-- ('linked' | 'invalid_code' | 'not_attempted'). No existing key is removed
-- or renamed, so /api/auth/bootstrap and both auth routes are unaffected.
--
-- IDEMPOTENCY / RETRY-HEAL: the early-return path (step='completed') also
-- attempts the link for parent callers with a code. The 3-layer P15 failsafe
-- may legitimately re-invoke bootstrap after a transient link failure; since
-- the link RPC itself is ON CONFLICT-idempotent, a retry converges to the
-- linked state instead of permanently dropping the code.
--
-- BODY PROVENANCE: copied from 20260610000000_publish_quiz_completed_event.sql
-- (the CURRENT definition — includes the learner.signed_up state_events
-- publish), NOT from the baseline. Diff vs that body is exactly: the
-- v_link_* declarations, the two link-attempt blocks (each with the
-- pre-existence capture + 'view' downgrade described above), and
-- 'link_status' on the return paths (+ in the bootstrap_success audit
-- metadata).
--
-- SEARCH_PATH: set to 'public, auth, pg_catalog' to match the value the
-- security-advisor repair (20260614200000) pins for this function. On fresh
-- environments the repair re-ALTERs after this file; on environments where
-- the repair already ran, this file applies last. Using the identical value
-- makes ordering irrelevant — both converge.
--
-- SECURITY DEFINER JUSTIFICATION (required by architecture rules):
--   Profile bootstrap must insert into students/teachers/guardians/
--   onboarding_state/auth_audit_log before the caller has any profile row,
--   i.e. before any RLS policy can grant them write access. Same rationale
--   as the prior definition; unchanged.
--
-- RISKS: LOW — signature unchanged, all prior behavior preserved; new
--   behavior is additive and fail-soft.
-- IDEMPOTENCY: YES — CREATE OR REPLACE + idempotent REVOKE.
-- EXECUTION ORDER: after 20260610000000 (body provenance). Filename
--   20260610090100 sorts after it.

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
-- 20260610000000 parity).
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
    RAISE WARNING '[20260610090100] bootstrap_user_profile not found after CREATE OR REPLACE';
  ELSIF position('link_status' IN v_def) = 0 THEN
    RAISE WARNING '[20260610090100] bootstrap_user_profile body does not contain link_status — M5 fix not applied';
  ELSIF position('link_guardian_via_invite_code' IN v_def) = 0 THEN
    RAISE WARNING '[20260610090100] bootstrap_user_profile does not call link_guardian_via_invite_code — M5 fix not applied';
  ELSIF position('v_link_preexisted' IN v_def) = 0 THEN
    RAISE WARNING '[20260610090100] bootstrap_user_profile lacks the pre-existence-guarded permission_level downgrade — DPDP least-privilege amendment (backend P14 review 2026-06-10) not applied';
  ELSE
    RAISE NOTICE '[20260610090100] bootstrap_user_profile link_code wiring + DPDP view-downgrade verified. COMPLETE.';
  END IF;

  -- The linking RPC this function depends on must exist (it ships in the
  -- baseline; this guards against a partial fresh-env bootstrap).
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'link_guardian_via_invite_code'
  ) THEN
    RAISE WARNING '[20260610090100] dependency public.link_guardian_via_invite_code is MISSING — link attempts will fail-soft to invalid_code';
  END IF;
END $verify$;
