-- Migration: 20260724120000_seed_ff_model_gateway_v1.sql
-- Purpose: Seed the feature flag `ff_model_gateway_v1` (GenAI ecosystem Phase 1 —
--          provider-agnostic Model Gateway, L2 of the reference architecture) so
--          the row EXISTS in public.feature_flags and is auditable + flippable
--          from the super-admin console. Default OFF / 0%.
--
--   ff_model_gateway_v1
--     When ON: the Model Gateway's NON-DEFAULT routing policies are permitted
--     (policy-based model/provider selection, cost-tier routing, prompt-caching
--     tiers). This is the staged rollout seam for L2 of the GenAI blueprint.
--     When OFF (default): the gateway reproduces TODAY's Anthropic-primary
--     behavior byte-for-byte — every request routes to the current default
--     Claude model with the current prompt/params, so merging + wiring the
--     gateway is a zero-behavior change. No alternate provider (e.g. Gemini) and
--     no non-default policy is reachable while this flag is OFF.
--
--   NOTE: this flag only gates ROUTING POLICY. It does NOT authorize a new model
--   or provider. Adding a model/provider is a CONSTITUTION approval gate
--   (User Approval Required For > "AI model or provider changes") and requires a
--   companion change + CEO approval regardless of this flag's state.
--
-- Spec: docs/superpowers/specs/2026-07-24-genai-ecosystem-architecture.md
--       (Section 7 "Model Gateway (L2)", Section 12 "Phased roadmap — Phase 1").
-- Runbook: docs/runbooks/model-gateway-rollout.md
-- Sibling LLD: docs/superpowers/specs/2026-07-24-model-gateway-design.md (ai-engineer).
--
-- ─── Default-OFF contract ─────────────────────────────────────────────────────
-- This migration seeds the row in the DISABLED state only:
--   is_enabled = FALSE, rollout_percentage = 0.
-- The read path (isFeatureEnabled in src/lib/feature-flags.ts) returns false for
-- both `is_enabled = false` AND `rollout_percentage <= 0`, so the non-default
-- routing policies stay OFF until an operator explicitly flips this flag via the
-- super-admin console. Seeding the row makes the flag visible/auditable — it does
-- NOT enable the behavior. Merging this migration is a zero-behavior change.
--
-- This is NOT a constitution-pinned / protected flag: it is a staged rollout of
-- an additive seam and behaves like the other default-OFF staged flags
-- (ff_school_pulse_v1, ff_adaptive_remediation_v1, ff_adaptive_loops_bc_v1). Ops
-- may need to add 'ff_model_gateway_v1' to EXPECTED_OFF_FLAGS in
-- packages/lib/src/flags/protected-flags.ts (ops-owned) so the default-OFF canary
-- accounts for the new row — flagged to ops; not edited here.
--
-- ─── Column shape (REG-125) ───────────────────────────────────────────────────
-- Mirrors the established flag-seed precedent VERBATIM
-- (20260716120000_seed_ff_foxy_math_format_v2.sql,
-- 20260619000600_seed_ff_adaptive_loops_bc_v1.sql,
-- 20260619000300_seed_ff_adaptive_remediation_v1.sql for the defensive
-- to_regclass guard + explicit column list + audit description). Scoping arrays
-- are left NULL (no role/env/institution narrowing) — the global
-- is_enabled=false / rollout=0 double gate is what holds the flag OFF. The
-- explicit column list (flag_name first) + ON CONFLICT (flag_name) DO NOTHING
-- conform to REG-125 (canonical feature_flags shape: flag_name/is_enabled, NOT
-- name/enabled; never DO UPDATE).
--
-- Idempotent. Safe to re-run: ON CONFLICT (flag_name) DO NOTHING (backed by the
-- feature_flags flag_name unique constraint). The whole INSERT is additionally
-- guarded so it no-ops cleanly if the feature_flags table does not yet exist
-- (fresh DB / out-of-order apply), so the live-DB CI test and Supabase preview
-- branches never fail. No schema changes. Pure data seed. No new tables → RLS
-- N/A; the table keeps its existing baseline RLS posture.
--
-- Owner: architect (this seed) + ai-engineer (gateway implementation under
--        packages/lib/src/ai/gateway/**) + ops (flag definition review + flip
--        procedure/runbook + EXPECTED_OFF_FLAGS canary entry).
-- Added: 2026-07-24
--
-- ─── Reversible (manual DOWN) ─────────────────────────────────────────────────
--   DELETE FROM feature_flags WHERE flag_name = 'ff_model_gateway_v1';
-- The application resolves a missing flag to OFF, so deletion is silent on the
-- production experience (byte-identical to today's Anthropic-primary behavior).

DO $model_gateway$
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
      'ff_model_gateway_v1',
      false,
      0,
      'GenAI ecosystem Phase 1: provider-agnostic Model Gateway (L2). When ON: permits the gateway''s NON-DEFAULT routing policies (policy-based model/provider selection, cost-tier routing, prompt-caching tiers). When OFF (default): the gateway reproduces today''s Anthropic-primary behavior byte-for-byte (current default Claude model, current prompt/params) — a zero-behavior change; no alternate provider (e.g. Gemini) and no non-default policy is reachable. This flag gates ROUTING POLICY only; adding a new model/provider remains a CEO approval gate independent of this flag. Not constitution-pinned; staged, default-OFF, staging-first. Spec: docs/superpowers/specs/2026-07-24-genai-ecosystem-architecture.md. Runbook: docs/runbooks/model-gateway-rollout.md.',
      NULL,
      NULL,
      NULL,
      now(),
      now()
    )
    ON CONFLICT (flag_name) DO NOTHING;
  ELSE
    RAISE NOTICE 'feature_flags table absent; skipping ff_model_gateway_v1 seed (fresh DB).';
  END IF;
END $model_gateway$;
