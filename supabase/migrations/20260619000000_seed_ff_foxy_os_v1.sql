-- Migration: 20260619000000_seed_ff_foxy_os_v1.sql
-- Purpose: Seed the Foxy AI Tutor mobile-first redesign feature flag (ff_foxy_os_v1). Default OFF.
--
-- Production visibility is governed by this flag (is_enabled=false → the Foxy OS
-- redesign stays OFF on prod). Seeding the row makes the flag visible/auditable and
-- flippable from the super-admin console — it does NOT enable the behavior. The
-- server read path (isFeatureEnabled in src/lib/feature-flags.ts) returns false for
-- both is_enabled=false AND rollout_percentage<=0, so the redesign stays OFF until an
-- operator explicitly flips this flag.
--
-- No schema changes. Pure data seed. Fully idempotent and defensive:
-- the whole INSERT is guarded so it no-ops cleanly if the feature_flags table
-- does not yet exist (fresh DB / out-of-order apply), so the live-DB CI test
-- and Supabase preview branch never fail.
--
-- Owner: architect (this seed) + frontend (Foxy OS UI surfaces this wave)
-- Added: 2026-06-12
--
-- DOWN (manual): DELETE FROM feature_flags WHERE flag_name = 'ff_foxy_os_v1';
-- The application falls back to the current Foxy experience when the flag is
-- missing or OFF, so deletion is silent on the production experience.

DO $foxy_os$
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
      'ff_foxy_os_v1',
      false,
      0,
      'Foxy AI Tutor mobile-first redesign (compact bar + study sheet). Default off.',
      ARRAY['production','staging']::text[],
      now(),
      now()
    )
    ON CONFLICT (flag_name) DO NOTHING;
  ELSE
    RAISE NOTICE 'feature_flags table absent; skipping ff_foxy_os_v1 seed (fresh DB).';
  END IF;
END $foxy_os$;
