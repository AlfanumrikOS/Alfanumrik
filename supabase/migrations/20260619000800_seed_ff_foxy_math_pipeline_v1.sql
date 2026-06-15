-- Migration: 20260619000800_seed_ff_foxy_math_pipeline_v1.sql
-- Purpose: Seed the feature flag `ff_foxy_math_pipeline_v1` (Foxy 3-Agent Math
--          Correctness Pipeline) so the row EXISTS in public.feature_flags and
--          is auditable + flippable from the super-admin console. Default
--          OFF / 0%.
--
--   ff_foxy_math_pipeline_v1
--     When ON: a math-solve query detected inside the EXISTING /api/foxy flow is
--     routed through the dedicated 3-agent pipeline —
--       (1) Classifier (Haiku, no thinking — topic/chapter/grade/difficulty),
--       (2) Solver (Haiku 4.5 + Extended Thinking, cached per-chapter NCERT
--           system prompt, NO RAG, emits structured step/math/answer blocks),
--       (3) Verifier (SymPy in the Python AI service, no LLM, fail-closed).
--     On a verifier MISMATCH the pipeline escalates ONCE to Sonnet+thinking; if
--     still wrong/unavailable the confident answer is replaced with
--     show-the-working + a "Check manually" badge (P12 — never serve a
--     confidently wrong answer). Non-math Foxy keeps the RAG grounded-answer
--     path UNCHANGED.
--     When OFF: the /api/foxy flow renders BYTE-IDENTICALLY to today — no math
--     classifier runs, no solver/verifier is invoked, the new
--     supabase/functions/solve-math module and the /v1/math/verify Python
--     endpoint are never reached, and the FoxyStructuredRenderer shows no
--     Verified/Check badge. This is the math-pipeline gate ONLY; Part-2 topic
--     progression and the foxy_pending_expectations `next_topic` widening
--     (migration 20260619000900) are SEPARATE and ramp independently of this
--     flag.
--
-- Plan: Foxy Math Correctness (3-Agent Pipeline) + Topic-Progression Fixes,
--       Part 1F ("New migration: seed ff_foxy_math_pipeline_v1 (flag OFF)
--       gating the whole math path"). Extended Thinking + the dedicated math
--       pipeline + Sonnet escalation are an AI model/architecture change
--       (CEO-directed in the plan); standard domain sign-offs apply
--       (ai-engineer / assessment / backend / architect / frontend / testing).
--
-- ─── Default-OFF contract ─────────────────────────────────────────────────────
-- This migration seeds the row in the DISABLED state only:
--   is_enabled = FALSE, rollout_percentage = 0.
-- The read path (isFeatureEnabled in src/lib/feature-flags.ts) returns false for
-- both `is_enabled = false` AND `rollout_percentage <= 0`, so the math pipeline
-- stays OFF until an operator explicitly flips this flag via the super-admin
-- console (or, for local dev, the documented local-dev seeder — see footer).
-- Seeding the row makes the flag visible/auditable — it does NOT enable the
-- behavior. Merging this migration is a zero-behavior change (the /api/foxy flow
-- renders byte-identically to today while the flag resolves OFF).
--
-- ─── Column shape (REG-125) ───────────────────────────────────────────────────
-- Mirrors the established flag-seed precedent VERBATIM
-- (20260619000700_seed_ff_foxy_learning_actions_v1.sql,
-- 20260619000600_seed_ff_adaptive_loops_bc_v1.sql,
-- 20260619000100_seed_ff_school_pulse_v1.sql for the defensive to_regclass guard
-- + explicit column list + audit description). The canonical feature_flags
-- columns are `flag_name` (UNIQUE) + `is_enabled` — NOT `name`/`enabled`
-- (baseline 00000000000000_baseline_from_prod.sql; feature_flags_flag_name_key
-- UNIQUE). The explicit column list (flag_name first) + ON CONFLICT (flag_name)
-- DO NOTHING conform to REG-125 (canonical feature_flags shape; never DO UPDATE —
-- so a pre-existing operator-set state is preserved on re-run). Scoping arrays
-- are left NULL (no role/env/institution narrowing) — the global
-- is_enabled=false / rollout=0 double gate is what holds the flag OFF.
--
-- Idempotent. Safe to re-run: ON CONFLICT (flag_name) DO NOTHING (backed by the
-- feature_flags flag_name unique constraint). The whole INSERT is additionally
-- guarded so it no-ops cleanly if the feature_flags table does not yet exist
-- (fresh DB / out-of-order apply), so the live-DB CI test and Supabase preview
-- branches never fail. No schema changes. Pure data seed.
--
-- ─── No new table ─────────────────────────────────────────────────────────────
-- This migration adds NO new table. The math pipeline is event/compute-only:
-- the classifier + solver run as a module the /api/foxy route calls, the
-- verifier runs in the Python AI service (SymPy, stateless), and the result is
-- rendered through the EXISTING FoxyStructuredRenderer. The next_topic
-- progression-state widening lives in a SEPARATE additive migration
-- (20260619000900_foxy_pending_expectations_add_next_topic.sql) and is gated by
-- the SEPARATE ff_foxy_pending_expectations_v1 flag (20260528000013), not this
-- one. No new tables → RLS N/A for this migration.
--
-- Owner: architect (this seed) + ai-engineer (classifier/solver prompts,
--        Extended Thinking, cached NCERT prompts, verifier integration) +
--        backend (solve-math wiring + math-python-client + verifier call) +
--        assessment (math-correctness semantics, SymPy verdict handling) +
--        frontend (Verified/Check badge) — all in parallel.
-- Added: 2026-06-14
--
-- ─── Reversible (manual DOWN) ─────────────────────────────────────────────────
--   DELETE FROM feature_flags WHERE flag_name = 'ff_foxy_math_pipeline_v1';
-- The application resolves a missing flag to OFF, so deletion is silent on the
-- production experience (the /api/foxy flow falls back to the legacy path).

DO $foxy_math_pipeline$
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
      'ff_foxy_math_pipeline_v1',
      false,
      0,
      'Foxy 3-Agent Math Correctness Pipeline: a math-solve query inside the existing /api/foxy flow is routed through Classifier (Haiku) -> Solver (Haiku 4.5 + Extended Thinking, cached per-chapter NCERT prompt, no RAG, structured step/math/answer blocks) -> Verifier (SymPy in the Python AI service, no LLM, fail-closed). On a verifier mismatch the pipeline escalates ONCE to Sonnet+thinking; if still wrong/unavailable the answer is replaced with show-the-working + a Check-manually badge (P12 — never serve a confidently wrong answer). Non-math Foxy keeps the RAG grounded-answer path unchanged. OFF = /api/foxy byte-identical to today (no classifier/solver/verifier, no Verified/Check badge). Math-pipeline gate ONLY; Part-2 topic progression + the foxy_pending_expectations next_topic widening (20260619000900) ramp independently. Default off. Plan: Foxy Math Correctness (3-Agent Pipeline), Part 1F.',
      NULL,
      NULL,
      NULL,
      now(),
      now()
    )
    ON CONFLICT (flag_name) DO NOTHING;
  ELSE
    RAISE NOTICE 'feature_flags table absent; skipping ff_foxy_math_pipeline_v1 seed (fresh DB).';
  END IF;
END $foxy_math_pipeline$;
