-- Migration: 20260613000002_ff_parent_encourage_v1.sql
-- Purpose: Seed the `ff_parent_encourage_v1` feature flag (DEFAULT OFF) that
--          gates the Wave D parent → child encouragement ("cheers") surface.
--
-- Plan: docs/superpowers/plans/2026-06-06-* (Wave D — parent encourage / cheers).
--
-- Flag seeded (is_enabled = false, rollout_percentage = 0):
--   ff_parent_encourage_v1 — gates the parent encourage / cheers experience
--                            (parent_cheers table + child.encourage permission).
--
-- No schema changes. Pure data seed. No new table → no RLS required.
-- This migration does NOT drop or alter any object.
--
-- Idempotent and defensive (matches 20260612000000_seed_phase1_consumer_minimalism_flags.sql):
--   - The whole INSERT is guarded so it no-ops cleanly if the feature_flags
--     table does not yet exist (fresh DB / out-of-order apply), so the live-DB
--     CI test and Supabase preview branch never fail.
--   - ON CONFLICT (flag_name) DO NOTHING relies on the existing UNIQUE
--     constraint feature_flags_flag_name_key (present in the prod baseline),
--     so re-running is a no-op for rows that already exist.
--
-- Owner: architect (this seed). Consuming surfaces gated by this flag are
-- frontend/backend follow-ups in the Wave D plan above.
--
-- Rollout (run from super-admin console or SQL):
--   UPDATE feature_flags
--   SET is_enabled = true, rollout_percentage = 10, updated_at = now()
--   WHERE flag_name = 'ff_parent_encourage_v1';
--
-- Instant rollback:
--   UPDATE feature_flags SET is_enabled = false, updated_at = now()
--   WHERE flag_name = 'ff_parent_encourage_v1';
--
-- DOWN (manual):
--   DELETE FROM feature_flags WHERE flag_name = 'ff_parent_encourage_v1';
-- The consuming surface falls back to current behaviour when the flag is
-- missing or OFF, so deletion is silent on the production experience.

BEGIN;

DO $waved$
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
        'ff_parent_encourage_v1',
        false,
        0,
        'Wave D: gates the parent → child encouragement ("cheers") surface. Default off.',
        now(),
        now()
      )
    ON CONFLICT (flag_name) DO NOTHING;
  ELSE
    RAISE NOTICE 'feature_flags table absent; skipping ff_parent_encourage_v1 seed (fresh DB).';
  END IF;
END $waved$;

COMMIT;
