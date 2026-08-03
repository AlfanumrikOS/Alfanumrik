-- Migration: 20260803120000_seed_ff_foxy_openai_primary_rollout_v1.sql
-- Purpose: Seed the feature flag `ff_foxy_openai_primary_rollout_v1` (percentage-
--          based rollback lever for the 2026-08-02 OpenAI-primary provider swap,
--          REG-332, commit 5e6ffa9f) so the row EXISTS in public.feature_flags
--          and is auditable + flippable from the super-admin console.
--          Default OFF / 0%.
--
--   ff_foxy_openai_primary_rollout_v1
--     The 2026-08-02 swap flipped Foxy/ncert-solver/quiz-gen's model fallback
--     order from Anthropic-primary to OpenAI-primary as a FLAT, unconditional,
--     100%-of-traffic switch (MODEL_FALLBACK_ORDER in supabase/functions/
--     grounded-answer/config.ts / LEGACY_FALLBACK_ORDER in packages/lib/src/
--     ai/gateway/registry.ts). This flag adds a deterministic, percentage-
--     controlled lever ON TOP of that swap:
--       - is_enabled=false, OR rollout_percentage<=0, OR the caller has no
--         identifiable id, OR the flag read fails -> resolves to
--         MODEL_FALLBACK_ORDER / LEGACY_FALLBACK_ORDER (OpenAI-primary) --
--         today's shipped, 100%-live default. This is what keeps this seed a
--         pure no-op.
--       - is_enabled=true AND rollout_percentage=P (1-100) AND the caller has
--         an id -> that caller's deterministic hash bucket decides: bucket<P
--         rolls them BACK to the reconstructed Claude-primary order
--         (CLAUDE_PRIMARY_FALLBACK_ORDER); bucket>=P stays on OpenAI-primary.
--     Bucketing is per-student-id, deterministic (hash(id:flagName) % 100),
--     stable across a conversation (never per-request random). Implementation:
--     supabase/functions/grounded-answer/_model-rollout-flag.ts (Deno) and
--     packages/lib/src/ai/gateway/rollout.ts (TS Model Gateway), kept in
--     parity by apps/host/src/__tests__/lib/ai/gateway/
--     model-rollout-hash-parity.test.ts.
--
-- Default-OFF contract: is_enabled = FALSE, rollout_percentage = 0. Both
-- independently guarantee the no-op seed state. Owner: architect (this seed).
-- Reviewers (P14): ai-engineer, testing, quality. Ops/CEO owns the ramp
-- schedule once this ships. Added: 2026-08-03. Idempotent (ON CONFLICT DO
-- NOTHING), guarded with to_regclass. No schema changes, pure data seed, no
-- new tables, RLS N/A.
--
-- Reversible (manual DOWN):
--   DELETE FROM feature_flags WHERE flag_name = 'ff_foxy_openai_primary_rollout_v1';
-- A missing flag row resolves to OpenAI-primary (same as is_enabled=false).

DO $foxy_openai_primary_rollout$
BEGIN
  IF to_regclass('public.feature_flags') IS NOT NULL THEN
    INSERT INTO public.feature_flags (
      flag_name, is_enabled, rollout_percentage, description,
      target_roles, target_environments, target_institutions,
      created_at, updated_at
    )
    VALUES (
      'ff_foxy_openai_primary_rollout_v1', false, 0,
      'Percentage-based rollback lever for the 2026-08-02 OpenAI-primary provider swap (REG-332, commit 5e6ffa9f). See migration header for full semantics. Default OFF; CEO/orchestrator decides the ramp schedule after this ships.',
      NULL, NULL, NULL, now(), now()
    )
    ON CONFLICT (flag_name) DO NOTHING;
  ELSE
    RAISE NOTICE 'feature_flags table absent; skipping ff_foxy_openai_primary_rollout_v1 seed (fresh DB).';
  END IF;
END $foxy_openai_primary_rollout$;
