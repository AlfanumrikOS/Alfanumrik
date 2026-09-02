-- Migration: 20260902190000_seed_ff_admin_aal2_enforcement_v1.sql
-- Purpose: Seed the CEO-approved (P1-10, 2026-09-02 launch audit) feature
--          flag `ff_admin_aal2_enforcement_v1` so the row EXISTS in
--          public.feature_flags and is auditable + flippable from the
--          super-admin console. Default OFF / 0%.
--
--   ff_admin_aal2_enforcement_v1
--     When ON: authorizeAdmin() (packages/lib/src/admin-auth.ts) requires a
--     verified aal2 session (a completed TOTP challenge) for any admin_users
--     row whose admin_level is 'admin' or 'super_admin' — independent of
--     the specific route's OWN required level, so e.g. a super_admin
--     hitting a support-tier route still needs aal2. A session that has not
--     completed a second-factor challenge gets 403 ADMIN_MFA_REQUIRED,
--     pointing to /super-admin/enroll-mfa.
--     When OFF: authorizeAdmin() is BYTE-IDENTICAL to before this fix — the
--     aal claim is never read and no session is ever denied on this basis.
--
-- ─── Default-OFF contract ─────────────────────────────────────────────────────
-- Seeded is_enabled = FALSE, rollout_percentage = 0. Live-verified before
-- writing this migration: 0 of 3 active super_admin accounts have ANY
-- verified MFA factor enrolled (auth.mfa_factors) — flipping this ON before
-- enrollment locks out every admin, including the account that would flip
-- it back off. The rollout plan is: enroll every admin/super_admin account
-- via /super-admin/enroll-mfa first, THEN flip this flag.
--
-- Idempotent (ON CONFLICT (flag_name) DO NOTHING) and fresh-DB-guarded
-- (to_regclass check), matching the established precedent
-- (20260619000100_seed_ff_school_pulse_v1.sql).
--
-- NOT registered in packages/lib/src/flags/protected-flags.ts in this
-- migration — deliberately scoped out. Worth doing as a follow-up given
-- this flag's blast radius (accidentally enabling it before enrollment
-- completes could lock out every admin), but it starts OFF and nothing in
-- this change flips it, so the immediate risk is low.
--
-- Owner: architect (RBAC/auth domain, per .claude/CLAUDE.md's domain table)
-- Added: 2026-09-02
--
-- ─── Reversible (manual DOWN) ─────────────────────────────────────────────────
--   DELETE FROM feature_flags WHERE flag_name = 'ff_admin_aal2_enforcement_v1';
-- The application resolves a missing flag to OFF, so deletion is silent.

DO $admin_aal2$
BEGIN
  IF to_regclass('public.feature_flags') IS NOT NULL THEN
    INSERT INTO public.feature_flags (
      flag_name,
      is_enabled,
      rollout_percentage,
      description,
      target_roles,
      target_environments,
      target_institutions,
      created_at,
      updated_at
    )
    VALUES (
      'ff_admin_aal2_enforcement_v1',
      false,
      0,
      'Requires a verified TOTP second factor (aal2) for admin_users rows at admin_level admin/super_admin. P1-10, CEO-approved 2026-09-02. Default off — flip only after every admin/super_admin account has enrolled via /super-admin/enroll-mfa (0 of 3 enrolled as of this seed).',
      NULL,
      NULL,
      NULL,
      now(),
      now()
    )
    ON CONFLICT (flag_name) DO NOTHING;
  ELSE
    RAISE NOTICE 'feature_flags table absent; skipping ff_admin_aal2_enforcement_v1 seed (fresh DB).';
  END IF;
END $admin_aal2$;
