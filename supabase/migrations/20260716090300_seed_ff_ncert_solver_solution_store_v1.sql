-- Migration: 20260716090300_seed_ff_ncert_solver_solution_store_v1.sql
-- Purpose: Seed the feature flag `ff_ncert_solver_solution_store_v1`
--          (response-cache v2, CEO-approved decisions 1-3, 2026-07-16) so the
--          row EXISTS in public.feature_flags and is auditable + flippable
--          from the super-admin console. Default OFF / 0%.
--
--   ff_ncert_solver_solution_store_v1
--     When ON: the ncert-solver pipeline persists generated GroundedResponse
--     payloads into the durable L3 tier public.ncert_solver_solutions
--     (created by 20260716090100; UNIQUE (grade, subject_code, question_hash,
--     gen_ctx_hash), no TTL — invalidated by content_version/gen_ctx keying)
--     and may read L3 as the last cache tier behind L1/L2.
--     When OFF: the L3 tier is fully inert — no reads, no writes; the pipeline
--     behaves as the L1/L2-only stack. Existing L3 rows are retained (cheap,
--     PII-free by contract) so re-enabling starts warm.
--     SEPARATE flag from ff_response_cache_serve_ncert_v1 (per-caller serving):
--     the two ramp independently so the store can warm before serving flips,
--     and serving can be killed without discarding the store.
--
-- ─── Default-OFF contract ─────────────────────────────────────────────────────
-- This migration seeds the row in the DISABLED state only:
--   is_enabled = FALSE, rollout_percentage = 0.
-- The read path (isFeatureEnabled in src/lib/feature-flags.ts) returns false for
-- both `is_enabled = false` AND `rollout_percentage <= 0`, so the L3 tier stays
-- OFF until an operator explicitly flips this flag via the super-admin console.
-- Seeding the row makes the flag visible/auditable — it does NOT enable the
-- behavior. Merging this migration is a zero-behavior change (the
-- ncert_solver_solutions table sits empty and unreferenced until the flip).
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
-- Owner: architect (this seed, with the 20260716090100 table migration) +
--        ai-engineer (pipeline gates L3 reads/writes against this exact flag
--        name, in parallel) + ops (flip procedure). Added: 2026-07-16.
--
-- ─── Reversible (manual DOWN) ─────────────────────────────────────────────────
--   DELETE FROM feature_flags WHERE flag_name = 'ff_ncert_solver_solution_store_v1';
-- The application resolves a missing flag to OFF, so deletion is silent on the
-- production experience (L3 rows are retained but unread).

DO $ncert_solver_solution_store$
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
      'ff_ncert_solver_solution_store_v1',
      false,
      0,
      'Response-cache v2 durable L3 tier for ncert-solver: when ON, generated GroundedResponse payloads persist into public.ncert_solver_solutions (no TTL; invalidated by content_version/gen_ctx keying) and L3 may be read behind L1/L2. When OFF, L3 is fully inert (no reads/writes); rows are retained for warm re-enable. SEPARATE flag from ff_response_cache_serve_ncert_v1 (per-caller serving); the two ramp independently. CEO-approved decisions 1-3, 2026-07-16. Default off; staging-first.',
      NULL,
      NULL,
      NULL,
      now(),
      now()
    )
    ON CONFLICT (flag_name) DO NOTHING;
  ELSE
    RAISE NOTICE 'feature_flags table absent; skipping ff_ncert_solver_solution_store_v1 seed (fresh DB).';
  END IF;
END $ncert_solver_solution_store$;
