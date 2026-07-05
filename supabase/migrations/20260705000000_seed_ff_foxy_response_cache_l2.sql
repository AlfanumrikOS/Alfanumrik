-- Migration: 20260705000000_seed_ff_foxy_response_cache_l2.sql
-- Purpose: Seed TWO net-new feature flags for the shared Redis (Upstash)
--          response-cache L2 tier in front of the `grounded-answer` Supabase
--          Edge Function pipeline (the shared backend behind Foxy/ncert-solver/
--          quiz-generator/concept-engine/diagnostic), so both rows EXIST in
--          public.feature_flags and are auditable + flippable from the
--          super-admin console. Default OFF / 0% for both.
--
--   ff_foxy_response_cache_l2_v1
--     When ON: `grounded-answer` consults the shared Redis L2 cache before
--     falling back to the existing retrieval/generation path, and writes
--     fresh responses back into it. Rollout-percentage-capable (per-user
--     deterministic hashing), so it can ramp gradually once shadow data
--     validates the hit-rate assumption.
--     When OFF: `grounded-answer` never reads or writes the L2 tier —
--     BYTE-IDENTICAL to today.
--
--   ff_foxy_response_cache_l2_shadow_v1
--     When ON: `grounded-answer` computes the L2 cache key and records
--     whether it WOULD have been a hit, purely for offline hit-rate
--     analysis — it never serves a cached value and never mutates
--     student-visible output. Independent of ff_foxy_response_cache_l2_v1
--     (neither gates the other); intended to run ahead of the real-serving
--     flag to validate assumptions before any flip.
--     When OFF: no shadow evaluation runs.
--
-- ─── Default-OFF contract ─────────────────────────────────────────────────────
-- This migration seeds both rows in the DISABLED state only:
--   is_enabled = FALSE, rollout_percentage = 0.
-- The read path (isFeatureEnabled in src/lib/feature-flags.ts) returns false for
-- both `is_enabled = false` AND `rollout_percentage <= 0`, so both stay OFF
-- until an operator explicitly flips them via the super-admin console.
-- Seeding the rows makes the flags visible/auditable — it does NOT enable any
-- behavior. Merging this migration is a zero-behavior change.
--
-- ─── Column shape ─────────────────────────────────────────────────────────────
-- Mirrors the established flag-seed precedent
-- (20260619000300_seed_ff_adaptive_remediation_v1.sql and
-- 20260619000100_seed_ff_school_pulse_v1.sql for the defensive to_regclass
-- guard + explicit column list + audit description). Scoping arrays are left
-- NULL (no role/env/institution narrowing) — the global is_enabled=false /
-- rollout=0 double gate is what holds each flag OFF.
--
-- Idempotent. Safe to re-run: ON CONFLICT (flag_name) DO NOTHING (backed by the
-- feature_flags flag_name unique constraint). The whole INSERT block is
-- additionally guarded so it no-ops cleanly if the feature_flags table does not
-- yet exist (fresh DB / out-of-order apply), so the live-DB CI test and
-- Supabase preview branches never fail. No schema changes. Pure data seed. No
-- new tables → RLS N/A; the table keeps its existing baseline RLS posture.
--
-- Owner: architect (this seed) + ai-engineer (grounded-answer L2 read/write +
--        shadow instrumentation, in parallel, against these exact flag names)
-- Added: 2026-07-05
--
-- ─── Reversible (manual DOWN) ─────────────────────────────────────────────────
--   DELETE FROM feature_flags WHERE flag_name IN (
--     'ff_foxy_response_cache_l2_v1', 'ff_foxy_response_cache_l2_shadow_v1'
--   );
-- The application resolves a missing flag to OFF, so deletion is silent on the
-- production experience.

DO $foxy_response_cache_l2$
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
    VALUES
      (
        'ff_foxy_response_cache_l2_v1',
        false,
        0,
        'Shared Redis (Upstash) response-cache L2 tier for the grounded-answer Edge Function pipeline (Foxy/ncert-solver/quiz-generator/concept-engine/diagnostic): real-serving master switch. When ON, grounded-answer consults + writes the shared L2 cache; rollout-percentage-capable for gradual ramp. Default off.',
        NULL,
        NULL,
        NULL,
        now(),
        now()
      ),
      (
        'ff_foxy_response_cache_l2_shadow_v1',
        false,
        0,
        'Shared Redis (Upstash) response-cache L2 tier for the grounded-answer Edge Function pipeline: shadow/observability-only mode. When ON, grounded-answer records would-be-hit outcomes without ever serving a cached value. Independent of ff_foxy_response_cache_l2_v1; validates hit-rate assumptions ahead of any real-serving flip. Default off.',
        NULL,
        NULL,
        NULL,
        now(),
        now()
      )
    ON CONFLICT (flag_name) DO NOTHING;
  ELSE
    RAISE NOTICE 'feature_flags table absent; skipping ff_foxy_response_cache_l2_v1 / ff_foxy_response_cache_l2_shadow_v1 seed (fresh DB).';
  END IF;
END $foxy_response_cache_l2$;
