-- Migration: 20260619000100_seed_ff_school_pulse_v1.sql
-- Purpose: Seed the CEO-approved (F3, 2026-06-12) feature flag `ff_school_pulse_v1`
--          so the row EXISTS in public.feature_flags and is auditable + flippable
--          from the super-admin console. Default OFF / 0%.
--
--   ff_school_pulse_v1
--     When ON: the School Pulse panel renders on the school-admin Command Center
--     (Slice B monitoring). The panel mounts inside the independently gated
--     ff_school_command_center surface — both flags must resolve ON for the
--     panel to be visible.
--     When OFF: the Command Center renders BYTE-IDENTICALLY to today — the
--     Pulse panel does not mount and no Pulse data paths are exercised.
--
-- ─── Default-OFF contract ─────────────────────────────────────────────────────
-- This migration seeds the row in the DISABLED state only:
--   is_enabled = FALSE, rollout_percentage = 0.
-- The read path (isFeatureEnabled in src/lib/feature-flags.ts) returns false for
-- both `is_enabled = false` AND `rollout_percentage <= 0`, so the panel stays OFF
-- until an operator explicitly flips this flag via the super-admin console.
-- Seeding the row makes the flag visible/auditable — it does NOT enable the
-- behavior.
--
-- ─── Column shape ─────────────────────────────────────────────────────────────
-- Mirrors the established flag-seed precedent
-- (20260611000100_seed_ff_school_admin_rbac_flag.sql for the OFF/NULL-scoping
-- semantics; 20260619000000_seed_ff_foxy_os_v1.sql for the defensive guard +
-- audit description). Scoping arrays are left NULL (no role/env/institution
-- narrowing) — the global is_enabled=false / rollout=0 double gate is what
-- holds the flag OFF.
--
-- Idempotent. Safe to re-run: ON CONFLICT (flag_name) DO NOTHING (backed by the
-- feature_flags flag_name unique constraint). The whole INSERT is additionally
-- guarded so it no-ops cleanly if the feature_flags table does not yet exist
-- (fresh DB / out-of-order apply), so the live-DB CI test and Supabase preview
-- branches never fail. No schema changes. Pure data seed. No new tables → RLS
-- N/A; the table keeps its existing baseline RLS posture.
--
-- Owner: ops (this seed + flag definition) + frontend (Pulse panel gate wiring,
--        in parallel, against this exact flag name)
-- Added: 2026-06-12
--
-- ─── Reversible (manual DOWN) ─────────────────────────────────────────────────
--   DELETE FROM feature_flags WHERE flag_name = 'ff_school_pulse_v1';
-- The application resolves a missing flag to OFF, so deletion is silent on the
-- production experience.

DO $school_pulse$
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
      'ff_school_pulse_v1',
      false,
      0,
      'School Pulse panel on the school-admin command center (Slice B monitoring). CEO-approved F3, 2026-06-12. Default off; requires ff_school_command_center for the host surface.',
      NULL,
      NULL,
      NULL,
      now(),
      now()
    )
    ON CONFLICT (flag_name) DO NOTHING;
  ELSE
    RAISE NOTICE 'feature_flags table absent; skipping ff_school_pulse_v1 seed (fresh DB).';
  END IF;
END $school_pulse$;
