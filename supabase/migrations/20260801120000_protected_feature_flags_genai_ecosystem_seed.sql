-- Migration: 20260801120000_protected_feature_flags_genai_ecosystem_seed.sql
-- Purpose: Registers 5 already-seeded GenAI ecosystem feature flags
--          (ff_model_gateway_v1, ff_unified_memory_v1,
--          ff_outcome_prediction_v1, ff_lesson_generation_v1,
--          ff_content_generation_v1) in the DB-layer protected-flag mirror
--          (public.protected_feature_flags), closing a flag-governance gap
--          exposed by the 2026-07-24..27 GenAI generation-agent incident:
--          ff_lesson_generation_v1 and ff_content_generation_v1 went from
--          seeded-OFF to 100%-production-rollout in a single day
--          (20260724220000_set_ff_generation_rollout_100.sql) with ZERO CI
--          check, console confirmation, or canary alert firing, because none
--          of the 6 GenAI-Phase flags seeded on 2026-07-24
--          (20260724120000 / 130000 / 140000 / 150000 / 170000 / 180000) had
--          ever been added to PROTECTED_FLAGS / EXPECTED_OFF_FLAGS
--          (packages/lib/src/flags/protected-flags.ts) or this DB mirror --
--          the safety net built by the 20260722090000 / 20260722090100
--          Phase 0 hardening is opt-in PER FLAG, and nobody had opted these
--          in.
--
-- Companion TS change (SAME PR, required by the parity-test contract in
-- apps/host/src/__tests__/api/super-admin/
-- feature-flags-protected-guardrail.test.ts): packages/lib/src/flags/
-- protected-flags.ts adds these 5 flag names to PROTECTED_FLAGS (tier
-- 'ai_provider' for ff_model_gateway_v1, 'staged_rollout' for the other 4)
-- and to EXPECTED_OFF_FLAGS, in the same change as this migration.
--
-- ─── Why NOT ff_response_eval_v1 (the 6th 2026-07-24 GenAI flag) ─────────────
-- ff_response_eval_v1 was deliberately enabled at 100% by
-- 20260724190000_enable_ff_response_eval_v1.sql as a fire-and-forget,
-- metadata-only observability sensor (verified: grep of every migration
-- mentioning ff_response_eval_v1 shows no later file disables it). Its
-- approved posture is ON, so it does not belong in EXPECTED_OFF_FLAGS (which
-- is for flags whose approved posture is OFF), and it was not implicated in
-- the incident. Left untouched here and in the TS registry -- same standing
-- exclusion pattern already documented for ff_atomic_subscription_activation
-- elsewhere in that table (approved-ON, not drift).
--
-- ─── Current live status of the 5 flags registered here (independently
-- verified 2026-08-01 against migrations/source, not inferred from the
-- incident report) ────────────────────────────────────────────────────────
--   * ff_model_gateway_v1        -- seeded OFF/0% (20260724120000); grep of
--     every migration confirms no later file enables it. Gates an OpenAI
--     fallback tier behind Anthropic in Foxy's intent classifier
--     (packages/lib/src/ai/workflows/foxy-router.ts, classifyWithLLM) when
--     ON -- a real cross-provider routing change pending CEO provider
--     approval that has not been given.
--   * ff_unified_memory_v1       -- seeded OFF/0% (20260724130000); never
--     enabled. Blocked on an unresolved DPDP erasure-pending interlock
--     (design spec docs/superpowers/specs/2026-07-24-unified-student-memory-
--     design.md Sec 2.3/3): Foxy's teachingDirectorSection is not yet
--     erasure-guarded (verified: no getStudentMemory/erasure reference in
--     apps/host/src/app/api/foxy/_lib/teaching-director.ts;
--     packages/lib/src/memory/ contains only erasure-guard.ts and
--     preferences.ts -- no composer implementation exists yet).
--   * ff_outcome_prediction_v1   -- seeded OFF/0% (20260724150000); never
--     enabled. Backend route + tests are complete
--     (apps/host/src/app/api/predict/outcome/route.ts, 460 lines;
--     apps/host/src/__tests__/lib/predict/outcome-prediction.test.ts;
--     apps/host/src/__tests__/api/predict/outcome-route.test.ts) but ZERO UI
--     surface reaches it (verified: no reference to predict/outcome or
--     outcome_prediction anywhere else under apps/host/src/app).
--   * ff_lesson_generation_v1 and
--     ff_content_generation_v1   -- seeded OFF, escalated to a 10% canary
--     same-day (20260724200000 / 20260724210000), then to 100%
--     (20260724220000), then FORCE-DISABLED 3 days later
--     (20260727120000_disable_ff_generation_agents.sql) because both
--     abstain on ~100% of requests in production (zero cbse_syllabus rows
--     at rag_status='ready' under the strict-mode coverage precheck in
--     supabase/functions/grounded-answer/coverage.ts). That migration's own
--     re-enablement precondition -- do not re-enable until (a) the
--     coverage/confidence gate fix has landed AND (b) it is validated
--     against production data -- is reproduced in this migration's
--     protected-flag reason text below so the console guardrail carries the
--     same warning at the point of any future re-enable attempt.
--
-- ─── Column shape / idempotency ───────────────────────────────────────────
-- Mirrors 20260722090000_protected_feature_flags_registry.sql /
-- 20260801100500_seed_ff_whatsapp_bot.sql exactly: to_regclass-guarded DO
-- block, explicit (flag_name, tier, reason) column list, ON CONFLICT
-- (flag_name) DO UPDATE (this registry's convention -- re-running refreshes
-- tier/reason without needing a DELETE first). Pure data seed against an
-- EXISTING table -- no new table, no schema change, so RLS is N/A here:
-- protected_feature_flags already carries its service-role-only RLS posture
-- from 20260722090000, unchanged by this file.
--
-- This migration does NOT touch public.feature_flags at all: all 5 flags'
-- feature_flags rows already exist from their own 2026-07-24 seed/enable/
-- disable migrations and keep their current is_enabled/rollout_percentage
-- values completely unchanged by this file (OFF/0 for the first 3;
-- OFF/0 for the generation pair, per 20260727120000; ff_response_eval_v1,
-- ON/100, is not referenced by this file at all).
--
-- Idempotent. Additive only. No DROP TABLE/COLUMN.
--
-- Owner: architect. Reviewers (P14 -- AI-provider chain + RBAC/auth chain):
--        ai-engineer (ff_model_gateway_v1 routing policy, ff_unified_memory_v1
--        erasure interlock, ff_lesson_generation_v1 / ff_content_generation_v1
--        grounded generation), assessment (ff_outcome_prediction_v1
--        prediction rules), backend (the 3 read-only API routes), ops (flag
--        posture / runbook updates).
-- Added: 2026-08-01.
--
-- ─── Rollback (MANUAL ONLY -- never auto-run) ────────────────────────────────
--   DELETE FROM public.protected_feature_flags
--     WHERE flag_name IN (
--       'ff_model_gateway_v1', 'ff_unified_memory_v1',
--       'ff_outcome_prediction_v1', 'ff_lesson_generation_v1',
--       'ff_content_generation_v1'
--     );
-- Removing these rows only removes the DB-guard-trigger + console-typed-
-- confirmation protection; it does not change any flag's is_enabled /
-- rollout_percentage value (those live on the unrelated feature_flags rows,
-- untouched by this file).

DO $genai_ecosystem_protected$
BEGIN
  IF to_regclass('public.protected_feature_flags') IS NOT NULL THEN
    INSERT INTO public.protected_feature_flags (flag_name, tier, reason) VALUES
      (
        'ff_model_gateway_v1',
        'ai_provider',
        'AI provider-routing change (GenAI Model Gateway L2; seeded OFF by migration 20260724120000, never enabled). When ON, the gateway''s default policy adds an OpenAI fallback tier (gpt-4o-mini/gpt-4o) behind Anthropic for Foxy''s intent classifier (packages/lib/src/ai/workflows/foxy-router.ts) -- a real cross-provider routing change requiring explicit CEO provider approval that has not been given.'
      ),
      (
        'ff_unified_memory_v1',
        'staged_rollout',
        'Blocked on an unresolved DPDP erasure-pending interlock (seeded OFF by migration 20260724130000, never enabled; design spec docs/superpowers/specs/2026-07-24-unified-student-memory-design.md Sec 2.3/3): enabling before Foxy''s teachingDirectorSection is brought under the erasure-pending guard would let a mid-erasure student''s teaching directive leak into prompts. That interlock is still open as of 2026-08-01 -- no getStudentMemory composer exists yet.'
      ),
      (
        'ff_outcome_prediction_v1',
        'staged_rollout',
        'Read-only Outcome Prediction Agent endpoint (GenAI Phase 5a; seeded OFF by migration 20260724150000, never enabled). Backend route and tests are complete, but zero UI surface reaches it -- verified no reference to predict/outcome or outcome_prediction anywhere under apps/host/src/app outside the route itself. Enabling today would activate a route nobody can navigate to; hold OFF until a UI consumer ships.'
      ),
      (
        'ff_lesson_generation_v1',
        'staged_rollout',
        'Student-facing Lesson Generation Agent (GenAI Phase 5b): escalated to 100% same-day (20260724220000) then FORCE-DISABLED 3 days later (20260727120000) because it abstained on ~100% of requests -- production has zero cbse_syllabus rows at rag_status=''ready'' under the strict-mode coverage precheck, a dead end, not a degradation. Do NOT re-enable until (a) the coverage/confidence gate fix has landed (chapters legitimately reaching rag_status=''ready'', or a deliberately revised readiness predicate) AND (b) that fix is validated against production data with a real grounded, non-abstain response.'
      ),
      (
        'ff_content_generation_v1',
        'staged_rollout',
        'Student-facing Content Generation Agent, Mermaid diagrams (GenAI Phase 5c): escalated to 100% same-day (20260724220000) then FORCE-DISABLED 3 days later (20260727120000) because it abstained on ~100% of requests -- production has zero cbse_syllabus rows at rag_status=''ready'' under the strict-mode coverage precheck, a dead end, not a degradation. Do NOT re-enable until (a) the coverage/confidence gate fix has landed (chapters legitimately reaching rag_status=''ready'', or a deliberately revised readiness predicate) AND (b) that fix is validated against production data with a real grounded, non-abstain response.'
      )
    ON CONFLICT (flag_name) DO UPDATE
      SET tier = EXCLUDED.tier,
          reason = EXCLUDED.reason;
  ELSE
    RAISE NOTICE 'protected_feature_flags table absent; skipping GenAI ecosystem protected-flag registration (fresh DB).';
  END IF;
END $genai_ecosystem_protected$;

-- ─── Verify (manual, after applying) ─────────────────────────────────────────
-- SELECT flag_name, tier FROM protected_feature_flags
--   WHERE flag_name IN (
--     'ff_model_gateway_v1', 'ff_unified_memory_v1', 'ff_outcome_prediction_v1',
--     'ff_lesson_generation_v1', 'ff_content_generation_v1'
--   ) ORDER BY flag_name;
-- -- expect: 5 rows -- ai_provider, staged_rollout, staged_rollout,
-- --         staged_rollout, staged_rollout.
-- BEGIN;
--   UPDATE feature_flags SET is_enabled = true
--    WHERE flag_name = 'ff_model_gateway_v1'; -- as a direct SQL session, no ack GUC set
--   -- expect: ERROR FLAG_PROTECTED (blocked by trg_protect_feature_flags, 20260722090100).
-- ROLLBACK;
