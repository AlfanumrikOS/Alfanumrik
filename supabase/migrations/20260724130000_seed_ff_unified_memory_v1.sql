-- Migration: 20260724130000_seed_ff_unified_memory_v1.sql
-- Purpose: Seed the feature flag `ff_unified_memory_v1` (GenAI ecosystem Phase 2 —
--          Unified Student Memory read-API) so the row EXISTS in
--          public.feature_flags and is auditable + flippable from the super-admin
--          console. Default OFF / 0%.
--
--   ff_unified_memory_v1
--     When ON: reads flow through the Unified Student Memory read-API (a single
--     consolidated memory-assembly seam for all consumers — Foxy, remediation,
--     synthesis, etc.). This is the staged rollout seam for Phase 2 of the GenAI
--     blueprint.
--     When OFF (default): the platform reproduces TODAY's legacy per-reader memory
--     assembly byte-for-byte — every consumer assembles its own memory context the
--     way it does today. Merging + wiring the unified read-API is a zero-behavior
--     change while this flag is OFF.
--
-- Spec: docs/superpowers/specs/2026-07-24-genai-ecosystem-architecture.md
--       (GenAI Phase 2 — Unified Student Memory).
--
-- ─── Default-OFF contract ─────────────────────────────────────────────────────
-- This migration seeds the row in the DISABLED state only:
--   is_enabled = FALSE, rollout_percentage = 0.
-- The read path (isFeatureEnabled in src/lib/feature-flags.ts) returns false for
-- both `is_enabled = false` AND `rollout_percentage <= 0`, so the unified
-- read-API stays OFF until an operator explicitly flips this flag via the
-- super-admin console. Seeding the row makes the flag visible/auditable — it does
-- NOT enable the behavior. Merging this migration is a zero-behavior change.
--
-- This is NOT a constitution-pinned / protected flag: it is a staged rollout of
-- an additive seam and behaves like the other default-OFF staged flags
-- (ff_school_pulse_v1, ff_adaptive_remediation_v1, ff_adaptive_loops_bc_v1,
-- ff_model_gateway_v1). Ops may need to add 'ff_unified_memory_v1' to
-- EXPECTED_OFF_FLAGS in packages/lib/src/flags/protected-flags.ts (ops-owned) so
-- the default-OFF canary accounts for the new row — flagged to ops; not edited
-- here.
--
-- ─── Column shape (REG-125) ───────────────────────────────────────────────────
-- Mirrors the established flag-seed precedent VERBATIM
-- (20260724120000_seed_ff_model_gateway_v1.sql,
-- 20260716120000_seed_ff_foxy_math_format_v2.sql,
-- 20260619000600_seed_ff_adaptive_loops_bc_v1.sql for the defensive to_regclass
-- guard + explicit column list + audit description). Scoping arrays are left NULL
-- (no role/env/institution narrowing) — the global is_enabled=false / rollout=0
-- double gate is what holds the flag OFF. The explicit column list (flag_name
-- first) + ON CONFLICT (flag_name) DO NOTHING conform to REG-125 (canonical
-- feature_flags shape: flag_name/is_enabled, NOT name/enabled; never DO UPDATE).
--
-- Idempotent. Safe to re-run: ON CONFLICT (flag_name) DO NOTHING (backed by the
-- feature_flags flag_name unique constraint). The whole INSERT is additionally
-- guarded so it no-ops cleanly if the feature_flags table does not yet exist
-- (fresh DB / out-of-order apply), so the live-DB CI test and Supabase preview
-- branches never fail. No schema changes. Pure data seed. No new tables → RLS
-- N/A; the table keeps its existing baseline RLS posture.
--
-- Owner: architect (this seed) + ai-engineer (memory read-API implementation
--        under packages/lib/src/memory/**) + ops (flag definition review + flip
--        procedure/runbook + EXPECTED_OFF_FLAGS canary entry).
-- Added: 2026-07-24
--
-- ─── Reversible (manual DOWN) ─────────────────────────────────────────────────
--   DELETE FROM feature_flags WHERE flag_name = 'ff_unified_memory_v1';
-- The application resolves a missing flag to OFF, so deletion is silent on the
-- production experience (byte-identical to today's legacy per-reader memory
-- assembly).

DO $unified_memory$
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
      'ff_unified_memory_v1',
      false,
      0,
      'Gates the Unified Student Memory read-API (GenAI Phase 2). OFF = legacy per-reader memory assembly (byte-identical).',
      NULL,
      NULL,
      NULL,
      now(),
      now()
    )
    ON CONFLICT (flag_name) DO NOTHING;
  ELSE
    RAISE NOTICE 'feature_flags table absent; skipping ff_unified_memory_v1 seed (fresh DB).';
  END IF;
END $unified_memory$;
