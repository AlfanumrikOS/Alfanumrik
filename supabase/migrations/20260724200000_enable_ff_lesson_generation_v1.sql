-- Migration: 20260724200000_enable_ff_lesson_generation_v1.sql
-- Purpose: Flip `ff_lesson_generation_v1` ON at rollout 10 — a LOW-PERCENTAGE
--          canary of the GenAI Phase 5b student-facing Lesson Generation Agent
--          (/api/lesson — on-demand, NCERT-grounded, bilingual lesson notes).
--
-- Context (2026-07-24 launch enablement, CEO-authorized staged rollout): the
-- lesson agent (route apps/host/src/app/api/lesson/route.ts, backend-owned;
-- generator packages/lib/src/lesson/generate-lesson.ts, ai-engineer/assessment-
-- owned) is a STRICTLY READ-ONLY, student-self-only endpoint. It reads the
-- caller's OWN grade + learner-memory slice via the RLS-scoped server client and
-- hands them to the sanctioned grounded orchestrator, which fails soft to an
-- abstain envelope when grounding can't support the chapter. No mastery/progress
-- writes; the only ledger touched is audit_logs (metadata-only, P13). Output is
-- bilingual (P7); grade stays a P5 STRING.
--
-- WHY 10% (a TRUE per-user canary, not blanket exposure): the read site
-- re-evaluates the flag WITH per-user context — isFeatureEnabled(FLAG, { role,
-- userId }) — and the evaluator (packages/lib/src/feature-flags.ts) applies
-- rollout_percentage deterministically as hashForRollout(userId, flagName) <
-- rollout_percentage. So is_enabled=TRUE + rollout_percentage=10 exposes a
-- STABLE, deterministic ~10% slice of students (the same students each time),
-- NOT 100% of the base. This is the mechanism that makes a staged canary real
-- for this flag.
--
-- This flag was seeded OFF / 0% by 20260724170000_seed_ff_lesson_generation_v1.sql.
-- It is NOT a protected flag and is NOT in EXPECTED_OFF_FLAGS
-- (packages/lib/src/flags/protected-flags.ts) — it is a normal staged-rollout
-- flag, so no console-guardrail typed-confirmation and no forced-OFF posture
-- (migration 20260720110000) applies to it.
--
-- Governance: the feature-flag matrix source of truth
-- (scripts/feature-flag-matrix.overrides.json) records this reviewed rollout with
-- enablementEvidence and was regenerated into scripts/feature-flag-matrix.json
-- (stagingEnabled=true, productionEnabled=true, rolloutPercentage=10) in the same
-- change, so the live-DB matrix verifier (scripts/verify-feature-flag-matrix.ts)
-- and reconciler stay green against this row.
--
-- Rollback:
--   UPDATE public.feature_flags
--      SET is_enabled = FALSE, rollout_percentage = 0, updated_at = now()
--    WHERE flag_name = 'ff_lesson_generation_v1';
-- (and revert the overrides.json entry + regenerate the matrix.)
--
-- Pattern: mirrors 20260724190000_enable_ff_response_eval_v1.sql /
-- 20260702210000_enable_ff_adaptive_live_selection_v1.sql (idempotent UPSERT with
-- the explicit REG-125-conformant column list — flag_name/is_enabled, never
-- name/enabled). The ON CONFLICT DO UPDATE flips the existing seeded row and
-- preserves its description. Additive. Idempotent. Replayable. No DDL. No new
-- tables. RLS not affected. Guarded with IF to_regclass so it no-ops on a fresh
-- DB without feature_flags.
-- Owner: architect (migration) — flagged for architect review.

DO $lesson_generation_enable$
BEGIN
  IF to_regclass('public.feature_flags') IS NOT NULL THEN

    -- Student-facing Lesson Generation Agent (GenAI Phase 5b) — read-only,
    -- grounded, fail-soft. LOW-PERCENTAGE canary at deterministic per-user 10%.
    INSERT INTO public.feature_flags (
      flag_name, is_enabled, rollout_percentage,
      target_roles, target_environments, target_institutions,
      created_at, updated_at
    ) VALUES (
      'ff_lesson_generation_v1', TRUE, 10,
      NULL, NULL, NULL, now(), now()
    )
    ON CONFLICT (flag_name) DO UPDATE
      SET is_enabled = TRUE, rollout_percentage = 10, updated_at = now();

  ELSE
    RAISE NOTICE 'feature_flags table absent; skipping ff_lesson_generation_v1 enablement (fresh DB).';
  END IF;
END $lesson_generation_enable$;
