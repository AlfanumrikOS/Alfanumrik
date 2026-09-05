-- Migration: 20260905130000_seed_ff_foxy_concise_output_budget_v1.sql
-- Purpose: Seed the feature flag `ff_foxy_concise_output_budget_v1` (Foxy LLM
--          cost optimization) so the row EXISTS in public.feature_flags and
--          is auditable + flippable from the super-admin console.
--          Default OFF / 0%.
--
--   ff_foxy_concise_output_budget_v1
--     When ON: for Foxy modes learn/explain/revise/explorer ONLY, max_tokens
--     drops from 3000 to 900 (CONCISE_MODE_MAX_TOKENS in
--     packages/lib/src/foxy/prompt-sections.ts) and a short concise-answer
--     directive (buildConciseOutputDirective) is composed onto the mode
--     directive, asking for 2-4 sentences + one check question instead of a
--     multi-block teaching exposition. practice/doubt/homework are
--     deliberately excluded: doubt/homework were raised to 2500 specifically
--     to fix a 2026-08-05 production incident (FOXY-RAWJSON) where a
--     1024-token budget truncated a worked-math structured-JSON response
--     mid-object; practice has a separate fixed 5-mcq shape unrelated to this
--     lever. When OFF: max_tokens and the mode directive are byte-identical
--     to today (MODE_MAX_TOKENS, no extra directive).
--
-- Context: CEO-approved direction (2026-09-05) to cap non-practice-mode
-- output length as part of Foxy per-chat LLM cost reduction. 900 (not the
-- originally-discussed 250) was chosen as a conservative starting point --
-- see the code comment above CONCISE_MODE_MAX_TOKENS for the token-budget
-- math relative to the FOXY-RAWJSON incident. Ramp only after validating
-- against the foxy-golden-turns fixtures and a real quality spot-check.
--
-- ─── Default-OFF contract ─────────────────────────────────────────────────────
-- Seeded DISABLED: is_enabled = FALSE, rollout_percentage = 0. The read path
-- (isFeatureEnabled in packages/lib/src/feature-flags.ts) returns false for
-- both is_enabled=false AND rollout_percentage<=0, so nothing changes for any
-- live student until an operator explicitly ramps this via the super-admin
-- console.
--
-- Idempotent (ON CONFLICT (flag_name) DO NOTHING), guarded for a fresh DB
-- where feature_flags may not exist yet. No schema changes. Pure data seed.
--
-- ─── Reversible (manual DOWN) ─────────────────────────────────────────────────
--   DELETE FROM feature_flags WHERE flag_name = 'ff_foxy_concise_output_budget_v1';
-- A missing flag resolves to OFF, so deletion is silent on the production
-- experience.

DO $foxy_concise_output_budget_v1$
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
      'ff_foxy_concise_output_budget_v1',
      false,
      0,
      'Foxy LLM cost optimization: for learn/explain/revise/explorer modes only, drops max_tokens from 3000 to 900 and injects a short concise-answer directive (2-4 sentences + one check question). practice/doubt/homework excluded -- doubt/homework were raised to 2500 to fix the 2026-08-05 FOXY-RAWJSON truncation incident, practice has its own fixed 5-mcq shape. Default off; ramp only after validating against foxy-golden-turns fixtures and a real quality spot-check.',
      NULL,
      NULL,
      NULL,
      now(),
      now()
    )
    ON CONFLICT (flag_name) DO NOTHING;
  ELSE
    RAISE NOTICE 'feature_flags table absent; skipping ff_foxy_concise_output_budget_v1 seed (fresh DB).';
  END IF;
END $foxy_concise_output_budget_v1$;
