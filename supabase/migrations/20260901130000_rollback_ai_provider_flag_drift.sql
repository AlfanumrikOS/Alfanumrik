-- Migration: 20260901130000_rollback_ai_provider_flag_drift.sql
-- Purpose: CEO-authorized incident rollback (2026-09-01). Returns 2 confirmed-
--          drifted ai_provider-tier feature flags to their own already-
--          documented CEO-approved baseline: is_enabled = false,
--          rollout_percentage = 0.
--
--          This is a ROLLBACK to registered baseline, not a new enablement —
--          no flag is turned on and no rollout_percentage rises above 0 in
--          this file. Same shape and intent as
--          20260802160000_rollback_confirmed_flag_drift_incident.sql.
--
-- ─── How this surfaced ───────────────────────────────────────────────────────
--
--   deploy-production.yml's "Post-Deploy Health Check" step (flag posture
--   canary, GET /api/cron/flag-posture-canary) failed on main with:
--
--     Feature-flag posture drift detected (2 flag(s)):
--       ff_mol_hybrid_mode_v1  expected is_enabled=false, rollout_percentage=0
--       ff_model_gateway_v1    expected is_enabled=false, rollout_percentage=0
--       (both observed at rollout_percentage 100)
--
--   The canary is working exactly as designed. It failed identically on the
--   PRIOR production deploy (bdd768d9, 03:23 UTC) before the deploy that
--   surfaced it to us (7482da70, 04:18 UTC), so the drift predates both and
--   was not introduced by either.
--
-- ─── Flags rolled back (both set to is_enabled = false, rollout_percentage = 0)
--
--   1. ff_model_gateway_v1
--        ai_provider-tier protected flag, EXPECTED_OFF_FLAGS member. Its
--        registry reason (packages/lib/src/flags/protected-flags.ts) states:
--        when ON, the gateway's default policy adds an OpenAI fallback tier
--        (gpt-4o-mini/gpt-4o) behind Anthropic for Foxy's intent classifier
--        (packages/lib/src/ai/workflows/foxy-router.ts) — "a real cross-
--        provider routing change requiring explicit CEO provider approval
--        that has not been given."
--
--        THIS IS A REPEAT. 20260802160000 item 7 records this same flag
--        drifting to ON "with zero admin_audit_log rows — an unaudited
--        direct-DB-write bypass of the console confirmation gate", rolled
--        back at 07:02 UTC (commit 6e00d483's addendum) and drifting back
--        the same day, which that migration logged as "the second
--        occurrence". This is at least the third.
--
--   2. ff_mol_hybrid_mode_v1
--        ai_provider-tier protected flag, EXPECTED_OFF_FLAGS member; part of
--        the E6 MoL program, which protected-flags.ts marks "(paused)".
--        NOT part of the 2026-08-02 incident batch — this is its first
--        recorded drift, so do not read it as a known-recurring flag.
--
-- ─── What this migration does NOT do ─────────────────────────────────────────
--
--   It does not identify or close the write path. Rolling the values back
--   restores posture and unblocks production deploys; it does not explain how
--   a protected flag reached rollout_percentage 100 without an
--   admin_audit_log row, and on prior evidence the value can drift back. The
--   durable fix is finding the writer that bypasses admin_flip_feature_flag —
--   tracked separately, NOT closed by this file.
--
--   No CEO-APPROVED-FLAG-FLIP marker appears below and none is required:
--   scripts/check-protected-flag-migrations.mjs demands one only for a file
--   containing an enabling assignment (is_enabled = true, or a nonzero
--   rollout_percentage). This file contains neither.
--
-- Idempotent: safe to re-run. Guarded on public.feature_flags existing so a
-- fresh project / DR rebuild that has not yet created the table is a no-op
-- rather than an error.

DO $rollback_ai_provider_flag_drift$
BEGIN
  IF to_regclass('public.feature_flags') IS NOT NULL THEN

    -- 1. ff_model_gateway_v1 — ai_provider tier. Cross-provider routing change
    --    (adds an OpenAI fallback tier behind Anthropic in Foxy's intent
    --    classifier) that has never received CEO provider approval. Rollback
    --    to registered OFF/0 baseline. Third recorded occurrence.
    INSERT INTO public.feature_flags (
      flag_name, is_enabled, rollout_percentage, description,
      target_roles, target_environments, target_institutions,
      created_at, updated_at
    )
    VALUES (
      'ff_model_gateway_v1', false, 0,
      'GenAI Phase 1 Model Gateway (L2). ai_provider-tier protected flag, seeded OFF by migration 20260724120000. When ON its default policy adds an OpenAI fallback tier behind Anthropic for Foxy''s intent classifier — a cross-provider routing change requiring explicit CEO provider approval that has not been given. CEO-authorized incident rollback to registered false/0 baseline, 2026-09-01 (third recorded drift; see 20260802160000 item 7).',
      NULL, NULL, NULL, now(), now()
    )
    ON CONFLICT (flag_name) DO UPDATE
      SET is_enabled         = false,
          rollout_percentage = 0,
          updated_at         = now();

    -- 2. ff_mol_hybrid_mode_v1 — ai_provider tier, E6 MoL program (paused).
    --    Rollback to registered OFF/0 baseline. First recorded drift.
    INSERT INTO public.feature_flags (
      flag_name, is_enabled, rollout_percentage, description,
      target_roles, target_environments, target_institutions,
      created_at, updated_at
    )
    VALUES (
      'ff_mol_hybrid_mode_v1', false, 0,
      'E6 Model Orchestration Layer hybrid mode. ai_provider-tier protected flag; the MoL program is marked paused in packages/lib/src/flags/protected-flags.ts and no approved ramp exists. CEO-authorized incident rollback to registered false/0 baseline, 2026-09-01 (first recorded drift for this flag).',
      NULL, NULL, NULL, now(), now()
    )
    ON CONFLICT (flag_name) DO UPDATE
      SET is_enabled         = false,
          rollout_percentage = 0,
          updated_at         = now();

  END IF;
END
$rollback_ai_provider_flag_drift$;
