-- Migration: 20260901140000_foxy_anthropic_primary_teaching.sql
-- Purpose: CEO-directed provider swap (2026-09-01, Pradeep Sharma). Make
--          ANTHROPIC the PRIMARY provider for Foxy teaching, with OpenAI as
--          the automatic fallback tier.
--
--          Mechanism: return ff_foxy_openai_primary_rollout_v1 to
--          is_enabled = false, rollout_percentage = 0.
--
-- ─── Why a flag flip and not a code change ───────────────────────────────────
--
--   This flag IS the documented lever for exactly this. From
--   supabase/functions/grounded-answer/claude.ts:
--
--     const table = (await shouldUseClaudePrimary(callerId))
--       ? CLAUDE_PRIMARY_FALLBACK_ORDER
--       : MODEL_FALLBACK_ORDER;
--
--   READ THE ARRAYS, NOT THE IDENTIFIERS — the names are inverted leftovers
--   from before the 2026-08-26 swap and both root CLAUDE.md and
--   protected-flags.ts warn about this explicitly:
--
--     MODEL_FALLBACK_ORDER          anthropic FIRST, openai second  <- wanted
--     CLAUDE_PRIMARY_FALLBACK_ORDER openai FIRST, anthropic second  <- current
--
--   shouldUseClaudePrimary() returns hashForRollout(callerId) < pct. The flag
--   has been is_enabled=true / rollout_percentage=100 since #1443 (recorded in
--   protected-flags.ts as CEO-approved intentionally-live, which is why it was
--   deliberately REMOVED from EXPECTED_OFF_FLAGS and why the flag-posture
--   canary reports clean while it is on). At pct=100 every caller with an id
--   buckets true, so 100% of identified Foxy teaching traffic currently
--   resolves OPENAI-PRIMARY with Anthropic only as fallback.
--
--   Setting the flag false/0 makes shouldUseClaudePrimary() return false for
--   every caller, so resolveModelOrder falls through to MODEL_FALLBACK_ORDER:
--
--     haiku   anthropic claude-haiku-4-5-20251001  -> openai gpt-4o-mini
--     sonnet  anthropic claude-sonnet-4-5-20250929 -> openai gpt-4o
--     auto    anthropic haiku -> anthropic sonnet  -> openai mini -> openai 4o
--
--   That is precisely "Anthropic primary for teaching, OpenAI fallback
--   secondary". No array edit, no parity-test churn — the arrays and the
--   Node-side LEGACY_FALLBACK_ORDER mirror already hold the wanted ordering.
--
-- ─── Companion changes in this same PR (all three must ship together) ────────
--
--   1. packages/lib/src/flags/protected-flags.ts — ff_foxy_openai_primary_
--      rollout_v1 re-added to EXPECTED_OFF_FLAGS. protected-flags.ts's own
--      instruction: "If ever rolled back to 0%, re-add
--      'ff_foxy_openai_primary_rollout_v1' to this list". Without it the
--      posture canary would stop watching a now-OFF ai_provider flag.
--   2. supabase/functions/grounded-answer/config.ts — MODEL_ROUTE_REV 5 -> 6.
--      Cache entries written under rev 5 were generated OpenAI-primary and
--      must not be served for requests made under the new Anthropic-primary
--      ordering. Same reasoning the rev-4 entry records for the mirror-image
--      2026-08-26 swap. This also sidesteps the rev-3 "gen_ctx does not record
--      WHICH order a cached response came from" limitation, which only bites
--      at intermediate percentages — 100 -> 0 is uniform on both sides.
--
--   Ordering is safe: deploy-production.yml runs "Apply Database Migrations"
--   BEFORE "Post-Deploy Health Check", so the flag is already false/0 by the
--   time the canary evaluates the newly-expanded EXPECTED_OFF_FLAGS.
--
-- No CEO-APPROVED-FLAG-FLIP marker is required or present:
-- scripts/check-protected-flag-migrations.mjs demands one only for a file
-- containing an enabling assignment (is_enabled = true, or a nonzero
-- rollout_percentage). This file only disables.
--
-- ff_foxy_openai_primary_rollout_v1 remains an ai_provider entry in
-- PROTECTED_FLAGS, so any FURTHER change still requires typed confirmation.
-- To reverse: set is_enabled = true, rollout_percentage = 100 (and remove it
-- from EXPECTED_OFF_FLAGS again) — that path needs the marker.
--
-- Idempotent, guarded on the table existing.

DO $foxy_anthropic_primary_teaching$
BEGIN
  IF to_regclass('public.feature_flags') IS NOT NULL THEN

    INSERT INTO public.feature_flags (
      flag_name, is_enabled, rollout_percentage, description,
      target_roles, target_environments, target_institutions,
      created_at, updated_at
    )
    VALUES (
      'ff_foxy_openai_primary_rollout_v1', false, 0,
      'Foxy OpenAI-primary rollback lever. OFF/0 = MODEL_FALLBACK_ORDER (Anthropic primary, OpenAI fallback). ON at P%% = CLAUDE_PRIMARY_FALLBACK_ORDER (OpenAI primary) for P%% of callers — note both identifiers are inverted leftovers, read the arrays in grounded-answer/config.ts. Returned to OFF/0 on 2026-09-01 by CEO direction (Pradeep Sharma) to make Anthropic primary for teaching with OpenAI as fallback secondary.',
      NULL, NULL, NULL, now(), now()
    )
    ON CONFLICT (flag_name) DO UPDATE
      SET is_enabled         = false,
          rollout_percentage = 0,
          updated_at         = now();

  END IF;
END
$foxy_anthropic_primary_teaching$;
