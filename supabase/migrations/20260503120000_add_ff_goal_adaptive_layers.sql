-- Migration: 20260503120000_add_ff_goal_adaptive_layers.sql
-- Purpose:   Seed two NEW feature flags as DISABLED on production AND staging:
--              1) ff_goal_profiles      — gates super-admin Goal Profile Preview page
--              2) ff_goal_aware_foxy    — gates expanded Foxy persona prompt + goal-aware
--                                         scorecard sentence on QuizResults
--            Both flags ship OFF. Behavior is byte-identical to legacy until an admin
--            flips is_enabled = true via the super-admin console (or SQL UPDATE).
--
-- Scope:     PURE DATA SEED. No schema changes. No DROP. No column adds. No RLS
--            changes. The feature_flags table already has read-by-all + write-by-admin
--            RLS installed via 20260320135221_fix_feature_flags_rls_and_student_data.sql.
--            This migration only inserts two rows.
--
-- Idempotency: feature_flags.flag_name has a UNIQUE constraint
--              (`feature_flags_flag_name_key`, see baseline 00000000000000) so we use
--              `INSERT ... ON CONFLICT (flag_name) DO NOTHING`. Re-running this
--              migration against staging or prod where the flags may already exist
--              from a manual seed is safe — pre-existing rows are not modified.
--
-- Defaults seeded (both flags identical scoping, identical safety posture):
--   is_enabled           = false     (OFF — must be explicitly toggled)
--   rollout_percentage   = 0         (no users see the new behavior)
--   target_environments  = {production, staging}  (applies in both envs once enabled)
--   target_roles         = {}        (applies to all roles when enabled)
--   target_institutions  = {}        (applies to all institutions when enabled)
--   target_grades        = {}        (applies to all grades)
--   target_subjects      = {}        (applies to all subjects)
--   target_languages     = {}        (applies to all languages)
--   metadata             = JSONB     (description + owner + rollout_strategy + kill_switch)
--   description          = TEXT      (short human-readable summary for the admin UI)
--
-- ─────────────────────────────────────────────────────────────────────────────
-- Operator runbook (flip in production)
-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 0 — preview page only (super-admin verifies persona configs):
--
--   UPDATE public.feature_flags
--   SET is_enabled         = true,
--       rollout_percentage = 100,
--       target_roles       = ARRAY['super_admin','admin']::text[],
--       updated_at         = now()
--   WHERE flag_name = 'ff_goal_profiles';
--
-- Phase 1 — goal-aware Foxy + scorecard (staged ramp across one week):
--
--   -- Day 1: 10% canary
--   UPDATE public.feature_flags
--   SET is_enabled         = true,
--       rollout_percentage = 10,
--       updated_at         = now()
--   WHERE flag_name = 'ff_goal_aware_foxy';
--
--   -- Day 3: 25%   |   Day 5: 50%   |   Day 7: 100%
--   UPDATE public.feature_flags
--   SET rollout_percentage = 25,  updated_at = now() WHERE flag_name = 'ff_goal_aware_foxy';
--   UPDATE public.feature_flags
--   SET rollout_percentage = 50,  updated_at = now() WHERE flag_name = 'ff_goal_aware_foxy';
--   UPDATE public.feature_flags
--   SET rollout_percentage = 100, updated_at = now() WHERE flag_name = 'ff_goal_aware_foxy';
--
-- Per-user determinism: src/lib/feature-flags.ts hashForRollout(userId, flag_name)
-- guarantees the same student stays in the same bucket across reloads.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- Kill switch (instant rollback, no migration revert needed)
-- ─────────────────────────────────────────────────────────────────────────────
--
--   UPDATE public.feature_flags
--   SET is_enabled = false, updated_at = now()
--   WHERE flag_name IN ('ff_goal_profiles','ff_goal_aware_foxy');
--
-- The 5-min in-process cache in src/lib/feature-flags.ts picks up the change
-- on the next loadFlags() tick. To force-invalidate immediately across all
-- serverless instances, ship a no-op deploy or call invalidateFlagCache() from
-- an admin endpoint.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- DOWN (manual — do NOT auto-run)
-- ─────────────────────────────────────────────────────────────────────────────
-- Setting is_enabled = false (above) is the recommended rollback. The full
-- delete is also safe because nothing in the production code path branches
-- when both flags are absent (isFeatureEnabled returns false for unknown
-- flag names — see src/lib/feature-flags.ts:103):
--
--   DELETE FROM public.feature_flags
--   WHERE flag_name IN ('ff_goal_profiles','ff_goal_aware_foxy');
--
-- ============================================================================
-- 1. Seed: ff_goal_profiles (Phase 0)
-- ============================================================================

INSERT INTO public.feature_flags (
  flag_name,
  is_enabled,
  rollout_percentage,
  target_environments,
  target_roles,
  target_institutions,
  target_grades,
  target_subjects,
  target_languages,
  description,
  metadata
)
VALUES (
  'ff_goal_profiles',
  false,                                         -- OFF by default
  0,                                             -- 0% rollout
  ARRAY['production','staging']::text[],         -- applies in both envs once flipped
  ARRAY[]::text[],                               -- all roles (when enabled)
  ARRAY[]::uuid[],                               -- all institutions
  ARRAY[]::text[],                               -- all grades
  ARRAY[]::text[],                               -- all subjects
  ARRAY[]::text[],                               -- all languages
  'Phase 0 — exposes /super-admin/goal-profiles preview page that lets admins '
  'inspect each of the 6 goal personas + their config tables. Default OFF; '
  'opt-in only via super-admin console.',
  '{"description":"Phase 0 — exposes /super-admin/goal-profiles page that previews the 6 goal profile configs.","owner":"assessment","added":"2026-05-03","rollout_strategy":"manual super-admin toggle"}'::jsonb
)
ON CONFLICT (flag_name) DO NOTHING;

-- ============================================================================
-- 2. Seed: ff_goal_aware_foxy (Phase 1)
-- ============================================================================

INSERT INTO public.feature_flags (
  flag_name,
  is_enabled,
  rollout_percentage,
  target_environments,
  target_roles,
  target_institutions,
  target_grades,
  target_subjects,
  target_languages,
  description,
  metadata
)
VALUES (
  'ff_goal_aware_foxy',
  false,                                         -- OFF by default
  0,                                             -- 0% rollout
  ARRAY['production','staging']::text[],         -- applies in both envs once flipped
  ARRAY[]::text[],                               -- all roles (when enabled)
  ARRAY[]::uuid[],                               -- all institutions
  ARRAY[]::text[],                               -- all grades
  ARRAY[]::text[],                               -- all subjects
  ARRAY[]::text[],                               -- all languages
  'Phase 1 — replaces single-line GOAL_PROMPT_MAP injection with multi-paragraph '
  'persona per (goal × mode), and renders goal-aware scorecard sentence after '
  'every quiz. Default OFF preserves byte-identical legacy behavior.',
  '{"description":"Phase 1 — replaces single-line GOAL_PROMPT_MAP injection with multi-paragraph persona per (goal × mode), and renders goal-aware scorecard sentence after every quiz. Default OFF preserves byte-identical legacy behavior.","owner":"ai-engineer+frontend","added":"2026-05-03","rollout_strategy":"start at 0%, ramp to 10/25/50/100 across one week","kill_switch":"set is_enabled=false to instantly revert to legacy goal section"}'::jsonb
)
ON CONFLICT (flag_name) DO NOTHING;

-- ============================================================================
-- 3. Verification block — confirm seed via deploy logs
-- ============================================================================
-- Counts the two flags we just seeded and RAISE NOTICEs the result. Matches
-- the "verification block" pattern used in prior seed migrations so deploy
-- output makes it obvious the migration ran.

DO $$
DECLARE
  v_count integer;
  v_ff_goal_profiles_enabled boolean;
  v_ff_goal_aware_foxy_enabled boolean;
BEGIN
  SELECT COUNT(*) INTO v_count
    FROM public.feature_flags
    WHERE flag_name IN ('ff_goal_profiles','ff_goal_aware_foxy');

  SELECT is_enabled INTO v_ff_goal_profiles_enabled
    FROM public.feature_flags WHERE flag_name = 'ff_goal_profiles';

  SELECT is_enabled INTO v_ff_goal_aware_foxy_enabled
    FROM public.feature_flags WHERE flag_name = 'ff_goal_aware_foxy';

  RAISE NOTICE '[ff_goal_adaptive_layers] seeded % / 2 expected flags', v_count;
  RAISE NOTICE '[ff_goal_adaptive_layers] ff_goal_profiles is_enabled = %', v_ff_goal_profiles_enabled;
  RAISE NOTICE '[ff_goal_adaptive_layers] ff_goal_aware_foxy is_enabled = %', v_ff_goal_aware_foxy_enabled;

  IF v_count <> 2 THEN
    RAISE WARNING '[ff_goal_adaptive_layers] expected 2 flags present, found %', v_count;
  END IF;

  -- Hard safety: ensure we did not accidentally ship either flag in the ON state.
  -- This guards against a developer hand-editing the INSERT above to is_enabled=true.
  IF v_ff_goal_profiles_enabled IS TRUE OR v_ff_goal_aware_foxy_enabled IS TRUE THEN
    -- Note: an EXISTING enabled flag (from a manual prior seed) would also trip this.
    -- That is intentional: the migration's contract is "both flags exist and are OFF
    -- after this migration runs against a fresh DB". If they were already ON, the
    -- operator should know.
    RAISE NOTICE '[ff_goal_adaptive_layers] one or both flags are currently is_enabled=true (pre-existing state preserved by ON CONFLICT DO NOTHING)';
  END IF;
END $$;
