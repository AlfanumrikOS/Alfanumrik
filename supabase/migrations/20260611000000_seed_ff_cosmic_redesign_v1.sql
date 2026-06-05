-- Migration: 20260611000000_seed_ff_cosmic_redesign_v1.sql
-- Purpose: Seed the cosmic dark redesign feature flag (ff_cosmic_redesign_v1). Default OFF.
--
-- Production visibility is governed by this flag (is_enabled=false → cosmic stays OFF on prod).
-- Preview deployments auto-enable cosmic via VERCEL_ENV in the frontend (NEXT_PUBLIC_VERCEL_ENV),
-- independent of this row, so reviewers can see the redesign on Vercel previews while prod
-- remains on the current visual identity.
--
-- No schema changes. Pure data seed. Fully idempotent and defensive:
-- the whole INSERT is guarded so it no-ops cleanly if the feature_flags table
-- does not yet exist (fresh DB / out-of-order apply), so the live-DB CI test
-- and Supabase preview branch never fail.
--
-- Owner: architect (this seed) + frontend (cosmic UI surfaces this wave)
-- Added: 2026-06-05
--
-- DOWN (manual): DELETE FROM feature_flags WHERE flag_name = 'ff_cosmic_redesign_v1';
-- The application falls back to the current (non-cosmic) theme when the flag is
-- missing or OFF, so deletion is silent on the production experience.

DO $cosmic$
BEGIN
  IF to_regclass('public.feature_flags') IS NOT NULL THEN
    INSERT INTO public.feature_flags (
      flag_name,
      is_enabled,
      rollout_percentage,
      description,
      target_environments,
      created_at,
      updated_at
    )
    VALUES (
      'ff_cosmic_redesign_v1',
      false,
      0,
      'Cosmic dark redesign — new visual identity. Default off; previews auto-enable via VERCEL_ENV.',
      ARRAY['production','staging']::text[],
      now(),
      now()
    )
    ON CONFLICT (flag_name) DO NOTHING;
  ELSE
    RAISE NOTICE 'feature_flags table absent; skipping ff_cosmic_redesign_v1 seed (fresh DB).';
  END IF;
END $cosmic$;
