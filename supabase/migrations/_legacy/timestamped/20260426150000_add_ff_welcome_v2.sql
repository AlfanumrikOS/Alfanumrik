-- Migration: 20260426150000_add_ff_welcome_v2.sql
-- Purpose: Seed the `ff_welcome_v2` feature flag that gates the mobile-first
--          editorial redesign of the /welcome landing page (Indian Editorial
--          Tutor aesthetic). Flag is OFF by default; the existing /welcome
--          page renders v1 until the flag is flipped.
--
-- Schema note: feature_flags.flag_name has no UNIQUE constraint in production
-- (see header comments on 20260418100800_feature_flags.sql,
--  20260413170000_kill_switch_flags.sql, and 20260414120000_payment_subscribe_atomic_fix.sql).
-- We use the established DO $$ IF NOT EXISTS pattern instead of ON CONFLICT.
--
-- RLS: feature_flags already has read-by-all + write-by-admin policies
-- installed via 20260320135221_fix_feature_flags_rls_and_student_data.sql.
-- This migration adds a row only; no policy changes required.
--
-- Rollout strategy (operator runbook):
-- ─────────────────────────────────────
--   1. Smoke test in staging
--      Super admin → Feature Flags → ff_welcome_v2 → set is_enabled = true
--      with rollout_percentage = 100 in staging environment only.
--      Equivalent SQL (run in Supabase SQL editor):
--
--        UPDATE feature_flags
--        SET is_enabled         = true,
--            rollout_percentage = 100,
--            target_environments = ARRAY['staging']::text[],
--            updated_at         = now()
--        WHERE flag_name = 'ff_welcome_v2';
--
--   2. 10% canary in production
--      Super admin → Feature Flags → ff_welcome_v2 → enable + 10%.
--      Equivalent SQL:
--
--        UPDATE feature_flags
--        SET is_enabled         = true,
--            rollout_percentage = 10,
--            target_environments = ARRAY['production']::text[],
--            updated_at         = now()
--        WHERE flag_name = 'ff_welcome_v2';
--
--      Per-user determinism: hashForRollout(userId, 'ff_welcome_v2') in
--      src/lib/feature-flags.ts ensures the same user always sees the same
--      variant across reloads. Anonymous visitors (no userId in context) are
--      treated as enabled when rollout_percentage > 0 (existing backward-compat
--      behavior — see feature-flags.ts:131). For a marketing landing page this
--      is acceptable; if pure 10% sampling on anon visitors is required later,
--      the route handler should hash on a stable client cookie.
--
--   3. Targeted preview for QA / specific users
--      The flag system supports per-role and per-institution scoping but NOT
--      per-userId allowlists. For QA preview while flag is off in production,
--      the recommended pattern is the `?v=2` query-string force-on documented
--      in src/lib/feature-flags.ts (welcome-v2 force-preview escape hatch).
--      To enable for a specific role only:
--
--        UPDATE feature_flags
--        SET is_enabled   = true,
--            target_roles = ARRAY['admin','super_admin']::text[],
--            updated_at   = now()
--        WHERE flag_name = 'ff_welcome_v2';
--
--   4. Full rollout
--
--        UPDATE feature_flags
--        SET is_enabled         = true,
--            rollout_percentage = 100,
--            target_environments = NULL,   -- all envs
--            target_roles        = NULL,   -- all roles
--            updated_at         = now()
--        WHERE flag_name = 'ff_welcome_v2';
--
--   5. Instant rollback (no migration revert needed)
--
--        UPDATE feature_flags
--        SET is_enabled = false,
--            updated_at = now()
--        WHERE flag_name = 'ff_welcome_v2';
--
--      The 5-min in-process cache in src/lib/feature-flags.ts will pick up
--      the change on the next loadFlags() call. To force-invalidate immediately
--      across all serverless instances, ship a no-op deploy or call
--      invalidateFlagCache() from an admin endpoint.
--
-- DOWN (manual rollback — do not auto-run):
-- ──────────────────────────────────────────
--   DELETE FROM feature_flags WHERE flag_name = 'ff_welcome_v2';
--
--   Removing the row is safe because the TypeScript registry defaults the
--   flag to false when absent (isFeatureEnabled returns false for unknown
--   flag names — see feature-flags.ts:103).

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM feature_flags WHERE flag_name = 'ff_welcome_v2'
  ) THEN
    INSERT INTO feature_flags (
      flag_name,
      is_enabled,
      rollout_percentage,
      description
    )
    VALUES (
      'ff_welcome_v2',
      false,                  -- OFF by default; opt-in only
      0,                      -- 0% rollout; flip via super-admin or SQL above
      'Mobile-first editorial redesign of /welcome (Indian Editorial Tutor aesthetic). '
      'When enabled, the /welcome route renders the WelcomeV2 server component '
      'instead of the legacy WelcomeV1. Same URL, no SEO split. The `?v=2` '
      'query-string force-preview always renders v2 regardless of flag state '
      '(QA escape hatch). Owner: orchestrator → frontend (port pending).'
    );
  END IF;
END $$;
