-- Migration: 20260716090200_seed_ff_response_cache_serve_ncert_v1.sql
-- Purpose: Seed the feature flag `ff_response_cache_serve_ncert_v1`
--          (response-cache v2, CEO-approved decisions 1-3, 2026-07-16) so the
--          row EXISTS in public.feature_flags and is auditable + flippable
--          from the super-admin console. Default OFF / 0%.
--
--   ff_response_cache_serve_ncert_v1
--     When ON: the ncert-solver caller is allowed to SERVE responses from the
--     response-cache v2 tiers (L1 in-memory / L2 cache-only Upstash Redis /
--     L3 ncert_solver_solutions) instead of always regenerating. This is the
--     PER-CALLER serving flag: it gates serving for ncert-solver specifically,
--     so cache serving can ramp caller-by-caller.
--     When OFF: ncert-solver behaves BYTE-IDENTICALLY to today — every request
--     goes through full generation; no cache-read path is exercised for this
--     caller. (Cache WRITES to the durable L3 tier are governed separately by
--     ff_ncert_solver_solution_store_v1 — the two flags ramp independently so
--     the store can warm before serving flips, and serving can be killed
--     without discarding the store.)
--
-- ─── Default-OFF contract ─────────────────────────────────────────────────────
-- This migration seeds the row in the DISABLED state only:
--   is_enabled = FALSE, rollout_percentage = 0.
-- The read path (isFeatureEnabled in src/lib/feature-flags.ts) returns false for
-- both `is_enabled = false` AND `rollout_percentage <= 0`, so cache serving for
-- ncert-solver stays OFF until an operator explicitly flips this flag via the
-- super-admin console. Seeding the row makes the flag visible/auditable — it
-- does NOT enable the behavior. Merging this migration is a zero-behavior
-- change.
--
-- ─── Column shape ─────────────────────────────────────────────────────────────
-- Mirrors the established flag-seed precedent VERBATIM
-- (20260619000100_seed_ff_school_pulse_v1.sql and
-- 20260619000600_seed_ff_adaptive_loops_bc_v1.sql for the defensive
-- to_regclass guard + explicit column list + audit description). Scoping
-- arrays are left NULL (no role/env/institution narrowing) — the global
-- is_enabled=false / rollout=0 double gate is what holds the flag OFF. The
-- explicit column list (flag_name first) + ON CONFLICT (flag_name) DO NOTHING
-- conform to REG-125 (canonical feature_flags shape: flag_name/is_enabled,
-- NOT name/enabled; never DO UPDATE).
--
-- Idempotent. Safe to re-run: ON CONFLICT (flag_name) DO NOTHING (backed by the
-- feature_flags flag_name unique constraint). The whole INSERT is additionally
-- guarded so it no-ops cleanly if the feature_flags table does not yet exist
-- (fresh DB / out-of-order apply), so the live-DB CI test and Supabase preview
-- branches never fail. No schema changes. Pure data seed. No new tables → RLS
-- N/A; the table keeps its existing baseline RLS posture.
--
-- Owner: architect (this seed) + ai-engineer (pipeline gates the ncert-solver
--        cache-serve path against this exact flag name, in parallel) + ops
--        (flip procedure). Added: 2026-07-16.
--
-- ─── Reversible (manual DOWN) ─────────────────────────────────────────────────
--   DELETE FROM feature_flags WHERE flag_name = 'ff_response_cache_serve_ncert_v1';
-- The application resolves a missing flag to OFF, so deletion is silent on the
-- production experience.

DO $response_cache_serve_ncert$
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
      'ff_response_cache_serve_ncert_v1',
      false,
      0,
      'Response-cache v2 per-caller SERVING flag for ncert-solver: when ON, ncert-solver may serve from the cache tiers (L1 in-memory / L2 cache-only Upstash Redis / L3 ncert_solver_solutions) instead of regenerating. When OFF, ncert-solver regenerates every response (byte-identical to pre-v2 behavior). SEPARATE flag from ff_ncert_solver_solution_store_v1 (L3 writes); the two ramp independently. CEO-approved decisions 1-3, 2026-07-16. Default off; staging-first.',
      NULL,
      NULL,
      NULL,
      now(),
      now()
    )
    ON CONFLICT (flag_name) DO NOTHING;
  ELSE
    RAISE NOTICE 'feature_flags table absent; skipping ff_response_cache_serve_ncert_v1 seed (fresh DB).';
  END IF;
END $response_cache_serve_ncert$;
