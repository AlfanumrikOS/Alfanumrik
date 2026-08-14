-- Migration: 20260815000007_seed_ff_foxy_everyday_examples_v1.sql
-- Purpose: seed the feature flag `ff_foxy_everyday_examples_v1` (default OFF).
--   Gates an ADDITIVE directive appended to Foxy's structured-output system
--   prompt (EVERYDAY_EXAMPLE_DIRECTIVE in
--   supabase/functions/grounded-answer/structured-prompt.ts) that REQUIRES at
--   least one everyday-Indian-life "example" block on explanation-style turns
--   (learn / explain / doubt).
--
--   OFF = today's prompt byte-for-byte (buildStructuredOutputPrompt returns
--   FOXY_STRUCTURED_OUTPUT_PROMPT unchanged), so this seed ships as a strict
--   no-op until ops ramps it.
--
--   Reuses the EXISTING "example" block type — no FoxyResponse schema change,
--   no new block type, no client change. The flag state is folded into the
--   response-cache gen_ctx tuple (gen-ctx.ts `everyday_examples`), so flipping
--   this flag rotates the cache key for affected requests and can never serve
--   a flag-OFF answer to a flag-ON student (or vice versa).
--
-- Reader: supabase/functions/grounded-answer/_everyday-flag.ts — 60s TTL cache,
--   fail-CLOSED (missing row / unreadable flag → OFF, i.e. today's behaviour).
--   A missing row is therefore SAFE, which is why this seed is guarded and
--   idempotent rather than required.
--
-- Default-OFF contract: is_enabled = FALSE, rollout_percentage = 0.
-- Idempotent (ON CONFLICT DO NOTHING), to_regclass-guarded. PURE DATA SEED —
-- INSERTs one ROW into public.feature_flags. NO schema change: no new table,
-- no new column, no constraint or index change, no RLS change (P8 N/A — the
-- feature_flags table's existing RLS posture is untouched).
-- Owner: ai-engineer. Reviewers (P14): assessment (curriculum scope +
--   age-appropriateness of the directive), testing. Added: 2026-08-13.
--
-- Reversible (manual DOWN):
--   DELETE FROM feature_flags WHERE flag_name = 'ff_foxy_everyday_examples_v1';

DO $ff_foxy_everyday_examples_v1$
BEGIN
  IF to_regclass('public.feature_flags') IS NOT NULL THEN
    INSERT INTO public.feature_flags (
      flag_name, is_enabled, rollout_percentage, description,
      target_roles, target_environments, target_institutions,
      created_at, updated_at
    )
    VALUES (
      'ff_foxy_everyday_examples_v1', false, 0,
      'Foxy explanations: gates an additive system-prompt directive requiring at least one everyday-Indian-life "example" block (daily life, festivals, cricket, familiar contexts) on learn/explain/doubt turns. Reuses the existing "example" block type; illustrative framing only — all factual claims still come from the NCERT reference material. Folded into the response-cache gen_ctx so flips rotate the cache key. Default OFF; ops/CEO own the ramp.',
      NULL, NULL, NULL, now(), now()
    )
    ON CONFLICT (flag_name) DO NOTHING;
  ELSE
    RAISE NOTICE 'feature_flags table absent; skipping ff_foxy_everyday_examples_v1 seed (fresh DB).';
  END IF;
END $ff_foxy_everyday_examples_v1$;
