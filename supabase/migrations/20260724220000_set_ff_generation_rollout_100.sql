-- Migration: 20260724220000_set_ff_generation_rollout_100.sql
-- Purpose: Set BOTH `ff_lesson_generation_v1` and `ff_content_generation_v1` to
--          is_enabled = TRUE at rollout_percentage = 100 (full exposure),
--          SUPERSEDING the 10% canary values written by the two immediately
--          preceding activation migrations.
--
-- ============================================================================
-- WHY THIS MIGRATION EXISTS (read this before touching the sequence)
-- ============================================================================
-- Sequence of intent for these two flags, in timestamp order:
--
--   20260724170000_seed_ff_lesson_generation_v1.sql    -> seeded OFF  /   0%
--   20260724180000_seed_ff_content_generation_v1.sql   -> seeded OFF  /   0%
--   20260724200000_enable_ff_lesson_generation_v1.sql  -> ON / 10%  (canary)
--   20260724210000_enable_ff_content_generation_v1.sql -> ON / 10%  (canary)
--   20260724220000  <-- THIS FILE                      -> ON / 100% (full)
--
-- On 2026-07-24 the CEO decided to go straight to FULL rollout for both GenAI
-- Phase 5b/5c student-facing generation agents rather than hold at the staged
-- 10% canary. Production was flipped to 100% by hand via the super-admin
-- feature-flag console at that time.
--
-- The two 10% activation migrations above are MERGED HISTORY and had NOT yet
-- been applied to production when the console flip happened. Left alone, the
-- next `supabase db push` would replay them and SILENTLY DOWNGRADE both live
-- flags from 100% back to 10% — a regression of an explicit CEO decision that
-- would look like a mysterious traffic drop rather than a config change.
--
-- Correct remedy (the one implemented here): DO NOT edit or delete the merged
-- 10% migrations. Migrations apply in timestamp order, so this later-timestamped
-- migration runs AFTER both of them and wins. Replaying the whole chain on a
-- fresh database (CI live-DB tests, new staging, DR restore) therefore converges
-- on the CEO-decided end state of 100%, and replaying it against production is a
-- no-op that simply re-asserts what is already live. The canary migrations
-- remain in history as an accurate record of what was intended at the time.
--
-- ============================================================================
-- SAFETY / SCOPE
-- ============================================================================
-- Scope is EXACTLY two flags. This migration deliberately touches no other row:
--   * `ff_response_eval_v1` is already correct at 100% (20260724190000) and is
--     NOT written here.
--   * `ff_model_gateway_v1`, `ff_unified_memory_v1`, `ff_outcome_prediction_v1`
--     keep their existing posture and are NOT written here.
--
-- Neither flag is a protected flag and neither is in EXPECTED_OFF_FLAGS
-- (packages/lib/src/flags/protected-flags.ts), so the forced-OFF posture
-- migration (20260720110000) does not cover them and no console-guardrail
-- typed-confirmation applies. Nothing in this file alters PROTECTED_FLAGS,
-- EXPECTED_OFF_FLAGS, or the forced-OFF posture.
--
-- Risk posture of what is being fully rolled out: both endpoints
-- (/api/lesson, /api/content/diagram) are STRICTLY READ-ONLY and
-- student-self-only. They read the caller's OWN grade + learner-memory slice
-- through the RLS-scoped server client and hand them to the sanctioned grounded
-- orchestrator, which fails soft to an abstain envelope when grounding cannot
-- support the chapter. No mastery/progress/XP writes; the only ledger touched is
-- audit_logs (metadata-only, P13). Output is bilingual (P7); grade stays a P5
-- STRING. Every generated Mermaid `code` string still passes the existing
-- validateMermaidCode injection-safety gate (Mermaid-only; no raw SVG/HTML).
-- Going to 100% widens exposure of that read-only surface; it does not change
-- the surface itself.
--
-- Rollout mechanics: the read sites re-evaluate each flag WITH per-user context
-- — isFeatureEnabled(FLAG, { role, userId }) — and the evaluator
-- (packages/lib/src/feature-flags.ts) applies rollout deterministically as
-- hashForRollout(userId, flagName) < rollout_percentage. At 100 that predicate
-- is true for every user, i.e. full exposure to all eligible students.
--
-- Governance: the feature-flag matrix source of truth
-- (scripts/feature-flag-matrix.overrides.json) was updated to
-- rolloutPercentage=100 for both flags with the CEO's 2026-07-24 decision
-- recorded in rationale/enablementEvidence, and regenerated into
-- scripts/feature-flag-matrix.json in this same change, so the live-DB matrix
-- verifier (scripts/verify-feature-flag-matrix.ts) and the reconciler stay green
-- against these rows.
--
-- Rollback (per flag, if full exposure must be pulled back):
--   -- back to the 10% canary:
--   UPDATE public.feature_flags
--      SET rollout_percentage = 10, updated_at = now()
--    WHERE flag_name IN ('ff_lesson_generation_v1', 'ff_content_generation_v1');
--   -- or fully off:
--   UPDATE public.feature_flags
--      SET is_enabled = FALSE, rollout_percentage = 0, updated_at = now()
--    WHERE flag_name IN ('ff_lesson_generation_v1', 'ff_content_generation_v1');
-- (and revert the overrides.json entries + regenerate the matrix).
--
-- Pattern: mirrors 20260724190000_enable_ff_response_eval_v1.sql (idempotent
-- UPSERT with the explicit REG-125-conformant column list —
-- flag_name/is_enabled, never name/enabled). ON CONFLICT DO UPDATE flips the
-- existing row and preserves its description. Additive. Idempotent. Replayable.
-- No DDL. No new tables. RLS not affected. Guarded with IF to_regclass so it
-- no-ops on a fresh DB without feature_flags.
-- Owner: architect (migration) — flagged for architect review.

DO $generation_rollout_100$
BEGIN
  IF to_regclass('public.feature_flags') IS NOT NULL THEN

    -- Student-facing Lesson Generation Agent (GenAI Phase 5b) — read-only,
    -- grounded, fail-soft. FULL rollout per CEO decision 2026-07-24,
    -- superseding the 10% canary in 20260724200000.
    INSERT INTO public.feature_flags (
      flag_name, is_enabled, rollout_percentage,
      target_roles, target_environments, target_institutions,
      created_at, updated_at
    ) VALUES (
      'ff_lesson_generation_v1', TRUE, 100,
      NULL, NULL, NULL, now(), now()
    )
    ON CONFLICT (flag_name) DO UPDATE
      SET is_enabled = TRUE, rollout_percentage = 100, updated_at = now();

    -- Student-facing Content Generation Agent (GenAI Phase 5c, Mermaid diagrams)
    -- — read-only, grounded, fail-soft. FULL rollout per CEO decision
    -- 2026-07-24, superseding the 10% canary in 20260724210000.
    INSERT INTO public.feature_flags (
      flag_name, is_enabled, rollout_percentage,
      target_roles, target_environments, target_institutions,
      created_at, updated_at
    ) VALUES (
      'ff_content_generation_v1', TRUE, 100,
      NULL, NULL, NULL, now(), now()
    )
    ON CONFLICT (flag_name) DO UPDATE
      SET is_enabled = TRUE, rollout_percentage = 100, updated_at = now();

  ELSE
    RAISE NOTICE 'feature_flags table absent; skipping ff_lesson_generation_v1 / ff_content_generation_v1 rollout-100 (fresh DB).';
  END IF;
END $generation_rollout_100$;
