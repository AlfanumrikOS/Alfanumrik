-- Migration: 20260615000000_phase3c_seed_white_label_flags.sql
-- Purpose: Seed the four Phase 3C "white-label" feature flags. All DEFAULT OFF.
--
-- Plan: docs/superpowers/plans/2026-06-09-phase-3c-white-label-activation.md (Wave A, A1)
-- Spec: docs/superpowers/specs/2026-06-09-phase-3c-white-label-activation-design.md
--
-- WHY: these four flags were seeded in PRODUCTION by the pre-baseline `_legacy/`
-- migrations (20260507000004-7) but were NEVER registered in
-- src/lib/feature-flags.ts FLAG_DEFAULTS nor re-seeded at the post-baseline root.
-- Result: prod has the DB rows, but a fresh CI/staging/Preview env has neither a
-- row nor a default → inconsistent resolution across environments. This seed
-- (paired with the FLAG_DEFAULTS registration in feature-flags.ts) closes the
-- gap so every env resolves these flags identically — OFF.
--
-- Flags seeded (all is_enabled = false, rollout_percentage = 0):
--   ff_tenant_type_v1             — per-tenant tenant_type discriminator (foundation).
--   ff_tenant_module_registry_v1  — per-tenant module registry (resolver short-circuits
--                                   to all-enabled when OFF; src/lib/modules/registry.ts).
--   ff_tenant_config_v2           — per-tenant config overrides (resolver returns registry
--                                   defaults when OFF; src/lib/tenant-config/index.ts).
--   ff_event_bus_v1               — cross-module domain event bus. Registered/seeded for
--                                   correctness + env-parity ONLY; NOT activated this phase.
--
-- No schema changes. Pure data seed. No new table → no RLS required.
-- This migration does NOT drop or alter any object. It NEVER changes is_enabled
-- on an existing row (ON CONFLICT DO NOTHING, never DO UPDATE), so the prod rows
-- created by the legacy seeds are left untouched (no-op on prod).
--
-- Self-contained — references no `_legacy/` migration. The conflict target is the
-- UNIQUE constraint feature_flags_flag_name_key, present in the prod baseline
-- (00000000000000_baseline_from_prod.sql).
--
-- Idempotent and defensive (matches 20260612000000_seed_phase1_consumer_minimalism_flags.sql):
--   - The whole INSERT is guarded by to_regclass so it no-ops cleanly if the
--     feature_flags table does not yet exist (fresh DB / out-of-order apply), so
--     the live-DB CI test and Supabase preview branch never fail.
--   - ON CONFLICT (flag_name) DO NOTHING relies on the existing UNIQUE constraint
--     feature_flags_flag_name_key, so re-running is a no-op for rows that already
--     exist. On PROD (rows already present from the legacy seeds) this is a no-op;
--     on a fresh Preview/CI/staging env it creates the rows so the super-admin
--     Flags console can toggle them.
--
-- Owner: architect (this seed). The module route guard (A2, backend) and the nav
-- gating (A3, frontend) are downstream follow-ups in the Phase 3C plan above —
-- this step only registers + seeds the flags.
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
--     'ff_tenant_type_v1', 'ff_tenant_module_registry_v1',
--     'ff_tenant_config_v2', 'ff_event_bus_v1'
--   );
-- Each consuming surface falls back to current behaviour (all-modules-enabled /
-- registry defaults) when its flag is missing or OFF, so deletion is silent on
-- the production experience.

BEGIN;

DO $phase3c$
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
        'ff_tenant_type_v1',
        false,
        0,
        'Phase 3C white-label: gates the per-tenant tenant_type discriminator (b2c | school | white_label). Default off.',
        now(),
        now()
      ),
      (
        'ff_tenant_module_registry_v1',
        false,
        0,
        'Phase 3C white-label: gates the per-tenant module registry; resolver short-circuits to all-modules-enabled when off. Default off.',
        now(),
        now()
      ),
      (
        'ff_tenant_config_v2',
        false,
        0,
        'Phase 3C white-label: gates per-tenant config overrides (AI persona / locale / branding); resolver returns registry defaults when off. Default off.',
        now(),
        now()
      ),
      (
        'ff_event_bus_v1',
        false,
        0,
        'Phase 3C white-label: gates the cross-module domain event bus. Registered for correctness only; NOT activated this phase. Default off.',
        now(),
        now()
      )
    ON CONFLICT (flag_name) DO NOTHING;
  ELSE
    RAISE NOTICE 'feature_flags table absent; skipping Phase 3C white-label flag seed (fresh DB).';
  END IF;
END $phase3c$;

COMMIT;
