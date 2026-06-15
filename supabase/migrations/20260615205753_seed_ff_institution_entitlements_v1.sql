-- Migration: 20260615205753_seed_ff_institution_entitlements_v1.sql
-- Purpose: Seed the feature flag `ff_institution_entitlements_v1` (per-school
--          deal-driven entitlements) so the row EXISTS in public.feature_flags
--          and is auditable + flippable from the super-admin console.
--          Default OFF / 0%.
--
--   ff_institution_entitlements_v1
--     When ON: the runtime entitlement resolver (src/lib/entitlements/) consults
--     institution_entitlements for (school_id, entitlement_key) deal-specific
--     grants — honouring effective_from/effective_to windows — before falling
--     back to plan defaults and then platform defaults (3-layer resolution).
--     When OFF: the resolver IGNORES institution_entitlements rows entirely and
--     returns plan/platform defaults only. Rows are still writable by ops (so
--     deals can be configured ahead of rollout) but have NO runtime effect, so
--     merging this seed + the table migration is a zero-behavior change.
--
-- Spec / paired migration: 20260615205752_institution_entitlements.sql
--
-- ─── Default-OFF contract ─────────────────────────────────────────────────────
-- This migration seeds the row in the DISABLED state only:
--   is_enabled = FALSE, rollout_percentage = 0.
-- The read path (isFeatureEnabled in src/lib/feature-flags.ts) returns false for
-- both `is_enabled = false` AND `rollout_percentage <= 0`, so the resolver stays
-- on plan/platform defaults until an operator explicitly flips this flag via the
-- super-admin console. Seeding the row makes the flag visible/auditable — it does
-- NOT enable the behavior.
--
-- ─── Column shape ─────────────────────────────────────────────────────────────
-- Mirrors the established flag-seed precedent VERBATIM
-- (20260619000600_seed_ff_adaptive_loops_bc_v1.sql,
-- 20260619000300_seed_ff_adaptive_remediation_v1.sql,
-- 20260619000100_seed_ff_school_pulse_v1.sql) for the defensive to_regclass guard
-- + explicit column list (flag_name first) + audit description. Scoping arrays
-- are left NULL (no role/env/institution narrowing) — the global
-- is_enabled=false / rollout=0 double gate is what holds the flag OFF. The
-- explicit column list + ON CONFLICT (flag_name) DO NOTHING conform to REG-125
-- (canonical feature_flags shape: flag_name/is_enabled, NOT name/enabled; never
-- DO UPDATE).
--
-- Idempotent. Safe to re-run: ON CONFLICT (flag_name) DO NOTHING (backed by the
-- feature_flags flag_name unique constraint). The whole INSERT is additionally
-- guarded so it no-ops cleanly if the feature_flags table does not yet exist
-- (fresh DB / out-of-order apply), so the live-DB CI test and Supabase preview
-- branches never fail. No schema changes. Pure data seed. No new tables → RLS
-- N/A; the table keeps its existing baseline RLS posture.
--
-- Owner: architect (this seed + the 20260615205752 table) + ops (flag definition
--        review + flip procedure/runbook)
-- Added: 2026-06-15
--
-- ─── Reversible (manual DOWN) ─────────────────────────────────────────────────
--   DELETE FROM feature_flags WHERE flag_name = 'ff_institution_entitlements_v1';
-- The application resolves a missing flag to OFF, so deletion is silent on the
-- production experience.

DO $institution_entitlements$
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
      'ff_institution_entitlements_v1',
      false,
      0,
      'Per-school deal-driven entitlements. When ON, the entitlement resolver (src/lib/entitlements/) consults institution_entitlements for (school_id, entitlement_key) deal-specific grants — feature/module enablement + usage limits, honouring effective_from/effective_to windows — before falling back to plan defaults then platform defaults (3-layer resolution). When OFF, institution_entitlements rows are ignored at runtime (resolver returns plan/platform defaults only), so ops can configure deals ahead of rollout. Default off; staging-first. Table: 20260615205752_institution_entitlements.sql.',
      NULL,
      NULL,
      NULL,
      now(),
      now()
    )
    ON CONFLICT (flag_name) DO NOTHING;
  ELSE
    RAISE NOTICE 'feature_flags table absent; skipping ff_institution_entitlements_v1 seed (fresh DB).';
  END IF;
END $institution_entitlements$;
