-- Migration: 20260808000200_seed_ff_preference_writer_v1.sql
-- Purpose: Foxy North-Star Phase 2 (spec §1.3, item D9) — seed the feature
--          flag `ff_preference_writer_v1` (default OFF / 0%) and add the
--          explicit-wins guard column to student_learning_profiles.
--
--   ff_preference_writer_v1
--     When ON: the D9 implicit preference writer may update learning
--     preference fields on student_learning_profiles from observed behavior
--     (e.g. preferred_explanation_depth, learning_style) — but ONLY for rows
--     where preferences_set_by_user = false. A student's explicit choice
--     always wins and is never overwritten by the implicit writer.
--     When OFF: no implicit preference writes anywhere. Zero behavior change.
--
-- ─── Default-OFF contract ─────────────────────────────────────────────────────
-- Seeded is_enabled = FALSE, rollout_percentage = 0. The read path
-- (isFeatureEnabled in packages/lib/src/feature-flags.ts) returns false for
-- both gates, so merging this migration is a zero-behavior change. Seeding
-- makes the flag visible/auditable in the super-admin console.
--
-- ─── Column shape ─────────────────────────────────────────────────────────────
-- Mirrors the established flag-seed precedent VERBATIM (20260806000200 /
-- 20260619000600): defensive to_regclass guard + explicit column list
-- (flag_name first) + ON CONFLICT (flag_name) DO NOTHING, per REG-125
-- (canonical feature_flags shape: flag_name/is_enabled, NOT name/enabled;
-- never DO UPDATE). Scoping arrays left NULL — the global double gate holds
-- the flag OFF.
--
-- ─── preferences_set_by_user ──────────────────────────────────────────────────
-- boolean NOT NULL DEFAULT false on student_learning_profiles: set true when
-- the STUDENT explicitly chooses preferences in settings; the D9 implicit
-- writer must skip (never downgrade) such rows. Additive, no backfill needed
-- (false = "never explicitly set" is correct for all existing rows). RLS:
-- student_learning_profiles policies are row-scoped — additive column
-- automatically covered; no RLS change.
--
-- Idempotent: guarded INSERT + ADD COLUMN IF NOT EXISTS. No DROP.
-- ─── Reversible (manual DOWN) ─────────────────────────────────────────────────
--   DELETE FROM feature_flags WHERE flag_name = 'ff_preference_writer_v1';
--   (column is additive and harmless if the flag is removed)
-- Owner: architect (seed + guard column) + backend (D9 writer, separate PR) +
--        ops (flip procedure). Added: 2026-08-05.

DO $preference_writer_v1$
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
      'ff_preference_writer_v1',
      false,
      0,
      'Foxy North-Star Phase 2 (D9): implicit learning-preference writer. When ON, observed-behavior signals may update preference fields on student_learning_profiles, but ONLY where preferences_set_by_user = false (explicit student choice always wins, guard column added in 20260808000200). When OFF: no implicit preference writes anywhere. Default off; ramp via super-admin console after the D9 writer ships. Spec: docs/superpowers/specs/2026-08-05-foxy-north-star-alignment-design.md §1.3',
      NULL,
      NULL,
      NULL,
      now(),
      now()
    )
    ON CONFLICT (flag_name) DO NOTHING;
  ELSE
    RAISE NOTICE 'feature_flags table absent; skipping ff_preference_writer_v1 seed (fresh DB).';
  END IF;
END $preference_writer_v1$;

-- Explicit-wins guard for the D9 implicit writer.
ALTER TABLE public.student_learning_profiles
  ADD COLUMN IF NOT EXISTS preferences_set_by_user boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.student_learning_profiles.preferences_set_by_user IS
  'Explicit-wins guard for the D9 implicit preference writer '
  '(ff_preference_writer_v1): true when the student explicitly set their '
  'learning preferences in settings; the implicit writer must skip such rows. '
  'Added 20260808000200 (Foxy North-Star Phase 2).';
