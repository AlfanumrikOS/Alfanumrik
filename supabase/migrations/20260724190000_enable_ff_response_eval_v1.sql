-- Migration: 20260724190000_enable_ff_response_eval_v1.sql
-- Purpose: Flip `ff_response_eval_v1` ON at rollout 100 — the GenAI Phase 4
--          runtime 9-dimension ResponseEval observability sensor.
--
-- Context (2026-07-24 launch enablement, CEO-authorized): the ResponseEval
-- sensor (implementation under packages/lib/src/ai/eval/**, ai-engineer-owned)
-- emits a fire-and-forget, metadata-only quality signal per AI response into the
-- existing append-only public.ops_events log (logOpsEvent — service-role write,
-- PII-redacted per P13). It NEVER touches the AI response payload, the latency
-- budget, or the student-visible experience: when this flag is ON the response
-- path is byte-identical to when it is OFF, plus a side-channel emit. There is no
-- partial-rollout value in an observability sensor, so it is enabled at 100%.
--
-- This flag was seeded OFF / 0% by
-- 20260724140000_seed_ff_response_eval_v1.sql. It is NOT a protected flag and is
-- NOT in EXPECTED_OFF_FLAGS (packages/lib/src/flags/protected-flags.ts) — it is a
-- normal staged-rollout flag, so no console-guardrail typed-confirmation or
-- forced-OFF posture (migration 20260720110000) applies to it.
--
-- Governance: the feature-flag matrix source of truth
-- (scripts/feature-flag-matrix.overrides.json) records this reviewed rollout with
-- enablementEvidence and was regenerated into scripts/feature-flag-matrix.json
-- (stagingEnabled=true, productionEnabled=true, rolloutPercentage=100) in the
-- same change, so the live-DB matrix verifier
-- (scripts/verify-feature-flag-matrix.ts) and reconciler stay green against this
-- row.
--
-- Rollback:
--   UPDATE public.feature_flags
--      SET is_enabled = FALSE, rollout_percentage = 0, updated_at = now()
--    WHERE flag_name = 'ff_response_eval_v1';
-- (and revert the overrides.json entry + regenerate the matrix.)
--
-- Pattern: mirrors 20260702210000_enable_ff_adaptive_live_selection_v1.sql
-- (idempotent UPSERT with the explicit REG-125-conformant column list —
-- flag_name/is_enabled, never name/enabled). The ON CONFLICT DO UPDATE flips the
-- existing seeded row and preserves its description. Additive. Idempotent.
-- Replayable. No DDL. No new tables. RLS not affected. Guarded with
-- IF to_regclass so it no-ops on a fresh DB without feature_flags.
-- Owner: architect (migration) — flagged for architect review.

DO $response_eval_enable$
BEGIN
  IF to_regclass('public.feature_flags') IS NOT NULL THEN

    -- Runtime ResponseEval observability sensor (GenAI Phase 4) — fire-and-forget,
    -- metadata-only, byte-identical student-facing behavior.
    INSERT INTO public.feature_flags (
      flag_name, is_enabled, rollout_percentage,
      target_roles, target_environments, target_institutions,
      created_at, updated_at
    ) VALUES (
      'ff_response_eval_v1', TRUE, 100,
      NULL, NULL, NULL, now(), now()
    )
    ON CONFLICT (flag_name) DO UPDATE
      SET is_enabled = TRUE, rollout_percentage = 100, updated_at = now();

  ELSE
    RAISE NOTICE 'feature_flags table absent; skipping ff_response_eval_v1 enablement (fresh DB).';
  END IF;
END $response_eval_enable$;
