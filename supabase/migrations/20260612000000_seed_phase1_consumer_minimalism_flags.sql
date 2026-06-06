-- Migration: 20260612000000_seed_phase1_consumer_minimalism_flags.sql
-- Purpose: Seed the four Phase 1 "consumer minimalism" feature flags. All DEFAULT OFF.
--
-- Plan: docs/superpowers/plans/2026-06-06-phase-1-consumer-minimalism.md
--
-- Flags seeded (all is_enabled = false, rollout_percentage = 0):
--   ff_today_home_v1            — gates the consolidated "Today" home surface.
--   ff_unified_quiz_v1          — gates the unified quiz entry/experience.
--   ff_parent_glance_v1         — gates the parent at-a-glance summary surface.
--   ff_parent_unified_auth_v1   — gates the unified parent auth flow.
--
-- No schema changes. Pure data seed. No new table → no RLS required.
-- This migration does NOT drop or alter any object.
--
-- Idempotent and defensive (matches 20260611000000_seed_ff_cosmic_redesign_v1.sql):
--   - The whole INSERT is guarded so it no-ops cleanly if the feature_flags
--     table does not yet exist (fresh DB / out-of-order apply), so the live-DB
--     CI test and Supabase preview branch never fail.
--   - ON CONFLICT (flag_name) DO NOTHING relies on the existing UNIQUE
--     constraint feature_flags_flag_name_key (present in the prod baseline),
--     so re-running is a no-op for rows that already exist.
--
-- Owner: architect (this seed). Consuming surfaces gated by these flags are
-- frontend/backend follow-ups in the Phase 1 plan above.
--
-- Rollout (per flag, run from super-admin console or SQL):
--   UPDATE feature_flags
--   SET is_enabled = true, rollout_percentage = 10, updated_at = now()
--   WHERE flag_name = '<flag>';
--
-- Instant rollback (per flag):
--   UPDATE feature_flags SET is_enabled = false, updated_at = now()
--   WHERE flag_name = '<flag>';
--
-- DOWN (manual):
--   DELETE FROM feature_flags
--   WHERE flag_name IN (
--     'ff_today_home_v1', 'ff_unified_quiz_v1',
--     'ff_parent_glance_v1', 'ff_parent_unified_auth_v1'
--   );
-- Each consuming surface falls back to current behaviour when its flag is
-- missing or OFF, so deletion is silent on the production experience.

BEGIN;

DO $phase1$
BEGIN
  IF to_regclass('public.feature_flags') IS NOT NULL THEN
    INSERT INTO public.feature_flags (
      flag_name,
      is_enabled,
      rollout_percentage,
      description,
      created_at,
      updated_at
    )
    VALUES
      (
        'ff_today_home_v1',
        false,
        0,
        'Phase 1 consumer minimalism: gates the consolidated "Today" home surface. Default off.',
        now(),
        now()
      ),
      (
        'ff_unified_quiz_v1',
        false,
        0,
        'Phase 1 consumer minimalism: gates the unified quiz entry/experience. Default off.',
        now(),
        now()
      ),
      (
        'ff_parent_glance_v1',
        false,
        0,
        'Phase 1 consumer minimalism: gates the parent at-a-glance summary surface. Default off.',
        now(),
        now()
      ),
      (
        'ff_parent_unified_auth_v1',
        false,
        0,
        'Phase 1 consumer minimalism: gates the unified parent auth flow. Default off.',
        now(),
        now()
      )
    ON CONFLICT (flag_name) DO NOTHING;
  ELSE
    RAISE NOTICE 'feature_flags table absent; skipping Phase 1 consumer-minimalism flag seed (fresh DB).';
  END IF;
END $phase1$;

COMMIT;
