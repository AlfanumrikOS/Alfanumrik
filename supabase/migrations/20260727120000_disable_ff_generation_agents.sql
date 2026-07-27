-- Migration: 20260727120000_disable_ff_generation_agents.sql
-- Purpose: Turn BOTH `ff_lesson_generation_v1` and `ff_content_generation_v1`
--          OFF (is_enabled = FALSE, rollout_percentage = 0), SUPERSEDING the
--          100% full-rollout values written by 20260724220000.
--
-- ============================================================================
-- WHY THIS MIGRATION EXISTS — READ BEFORE FLIPPING THESE BACK ON
-- ============================================================================
-- CEO decision, 2026-07-27: both student-facing GenAI generation agents are
-- turned OFF because, at 100% exposure, they serve a DEAD-END "not ready"
-- message on ~100% of requests. Turning them off removes a broken path at
-- zero product cost — nothing of value is being withdrawn from students.
--
-- Root cause of the dead end (verified in-source, not inferred):
--
--   1. Both generators build their GroundedRequest with `mode: 'strict'`
--      (packages/lib/src/lesson/generate-lesson.ts:260,
--       packages/lib/src/diagram/generate-diagram.ts:298).
--   2. Strict mode runs the coverage precheck BEFORE Voyage/Claude
--      (supabase/functions/grounded-answer/coverage.ts). That precheck is a
--      hard gate on `cbse_syllabus.rag_status = 'ready'` — for a specific
--      chapter it returns `{ ready: true }` ONLY when the row's rag_status is
--      literally 'ready'; anything else short-circuits the whole pipeline to
--      `abstain_reason: 'chapter_not_ready'`.
--   3. Production currently has ZERO `cbse_syllabus` rows at
--      rag_status = 'ready' (CEO-reported production observation, 2026-07-27).
--      This is consistent with how the status is computed:
--      `recompute_syllabus_status()` only promotes a chapter to 'ready' when
--      `chunk_count >= 50` AND `verified_question_count >= 40`, so the ~16,006
--      ingested NCERT chunks covering ~98.6% of syllabus rows still read
--      'partial' purely because their questions are UNVERIFIED. The corpus is
--      NOT missing — the readiness signal is.
--   4. Net effect: every /api/lesson and /api/content/diagram call abstains.
--      The student sees a button that always fails.
--
-- So the surface is 100% abstain, not "sometimes degraded". Withdrawing it is
-- strictly an improvement in student experience.
--
-- ── WHY is_enabled = FALSE AND NOT MERELY rollout_percentage = 0 ─────────────
-- This is the load-bearing detail of this migration. The CLIENT-side reader for
-- these two flags is `getFeatureFlags()` (packages/lib/src/supabase.ts:81-109),
-- reached via apps/host/src/app/foxy/_hooks/useGenAiContentFlags.ts. That
-- function selects ONLY:
--     flag_name, is_enabled, target_roles, target_environments, target_institutions
-- It does NOT select or apply `rollout_percentage` (unlike the server-side
-- `isFeatureEnabled`, which does apply the deterministic
-- hashForRollout(userId, flagName) < rollout_percentage predicate).
--
-- Consequence: setting rollout_percentage = 0 ALONE would leave the client
-- resolving both flags to TRUE, so the /foxy Study Tools pills ("Diagram" /
-- "Lesson notes") would stay VISIBLE while the server-side routes — which DO
-- honour rollout — return their flag-disabled 404 response. That is a
-- strictly WORSE state than today: a visible button that 404s.
--
-- Setting is_enabled = FALSE makes the client reader resolve both to false,
-- StudyToolsBar renders `null`, and the whole surface becomes a clean no-op
-- byte-identical to the pre-launch /foxy page. rollout_percentage = 0 is
-- written as belt-and-braces so the server-side evaluator agrees and so the
-- matrix override (disabled everywhere => rolloutPercentage must be 0) stays
-- valid under the generator's validation rule.
--
-- ── RE-ENABLEMENT PRECONDITION (do not just flip this back) ──────────────────
-- Do NOT re-enable either flag as a "try it again" toggle. Re-enable ONLY
-- after BOTH of the following are true:
--   (a) The coverage/confidence gate fix has landed — i.e. either enough
--       chapters legitimately reach rag_status = 'ready', or the strict-mode
--       readiness predicate is deliberately revised (an assessment +
--       ai-engineer decision, since it defines what "groundable" means); AND
--   (b) That fix is VALIDATED AGAINST PRODUCTION DATA — a real production
--       read showing a non-trivial count of ready chapters, and a real
--       /api/lesson + /api/content/diagram call returning grounded output
--       rather than an abstain envelope.
-- Flipping these on before (a) and (b) simply restores the dead end.
--
-- ============================================================================
-- SAFETY / SCOPE
-- ============================================================================
-- Sequence of intent for these two flags, in timestamp order:
--
--   20260724170000_seed_ff_lesson_generation_v1.sql    -> seeded OFF  /   0%
--   20260724180000_seed_ff_content_generation_v1.sql   -> seeded OFF  /   0%
--   20260724200000_enable_ff_lesson_generation_v1.sql  -> ON  /  10% (canary)
--   20260724210000_enable_ff_content_generation_v1.sql -> ON  /  10% (canary)
--   20260724220000_set_ff_generation_rollout_100.sql   -> ON  / 100% (full)
--   20260727120000  <-- THIS FILE                      -> OFF /   0% (CEO 07-27)
--
-- Remedy pattern is identical to 20260724220000's: DO NOT edit or delete any
-- already-merged migration. Migrations apply in timestamp order, so this
-- later-timestamped file runs AFTER the whole chain and wins. Replaying the
-- chain on a fresh database (CI live-DB tests, new staging, DR restore)
-- therefore converges on the CEO-decided end state of OFF/0, and replaying it
-- against production asserts the same. The seed/canary/full-rollout migrations
-- remain in history as an accurate record of what was intended at the time.
--
-- Scope is EXACTLY two flags. This migration deliberately touches no other row:
--   * `ff_response_eval_v1` (20260724190000), `ff_unified_memory_v1`,
--     `ff_model_gateway_v1`, `ff_outcome_prediction_v1` keep their existing
--     posture and are NOT written here.
--
-- Neither flag is in PROTECTED_FLAGS or EXPECTED_OFF_FLAGS
-- (packages/lib/src/flags/protected-flags.ts) or in the DB mirror
-- public.protected_feature_flags, so the BEFORE UPDATE guard trigger
-- (20260722090100) does not block this write and no console-guardrail
-- typed-confirmation applies. Nothing in this file alters PROTECTED_FLAGS,
-- EXPECTED_OFF_FLAGS, the DB mirror, or the forced-OFF posture migration
-- (20260720110000).
--
-- Governance: the feature-flag matrix source of truth
-- (scripts/feature-flag-matrix.overrides.json) was updated to
-- stagingEnabled=false / productionEnabled=false / rolloutPercentage=0 for both
-- flags with the CEO's 2026-07-27 decision recorded in
-- rationale/enablementEvidence, and regenerated into
-- scripts/feature-flag-matrix.json in this same change, so the live-DB matrix
-- verifier (scripts/verify-feature-flag-matrix.ts) and the reconciler stay
-- green against these rows.
--
-- Pattern: mirrors 20260724220000_set_ff_generation_rollout_100.sql (idempotent
-- UPSERT with the explicit REG-125-conformant column list —
-- flag_name/is_enabled, never name/enabled). ON CONFLICT DO UPDATE flips the
-- existing row and preserves its description. Additive. Idempotent. Replayable.
-- No DDL. No new tables. RLS not affected. Guarded with IF to_regclass so it
-- no-ops on a fresh DB without feature_flags.
-- Owner: ops (flag posture) — flagged for architect review.

DO $generation_agents_disable$
BEGIN
  IF to_regclass('public.feature_flags') IS NOT NULL THEN

    -- Student-facing Lesson Generation Agent (GenAI Phase 5b) — OFF per CEO
    -- decision 2026-07-27. 100% abstain via the strict-mode rag_status='ready'
    -- coverage gate. is_enabled=FALSE is REQUIRED (not just rollout 0) so the
    -- client-side getFeatureFlags() reader hides the /foxy pill.
    INSERT INTO public.feature_flags (
      flag_name, is_enabled, rollout_percentage,
      target_roles, target_environments, target_institutions,
      created_at, updated_at
    ) VALUES (
      'ff_lesson_generation_v1', FALSE, 0,
      NULL, NULL, NULL, now(), now()
    )
    ON CONFLICT (flag_name) DO UPDATE
      SET is_enabled = FALSE, rollout_percentage = 0, updated_at = now();

    -- Student-facing Content Generation Agent (GenAI Phase 5c, Mermaid
    -- diagrams) — OFF per CEO decision 2026-07-27. Same dead-end abstain path,
    -- same reason for is_enabled=FALSE over rollout 0.
    INSERT INTO public.feature_flags (
      flag_name, is_enabled, rollout_percentage,
      target_roles, target_environments, target_institutions,
      created_at, updated_at
    ) VALUES (
      'ff_content_generation_v1', FALSE, 0,
      NULL, NULL, NULL, now(), now()
    )
    ON CONFLICT (flag_name) DO UPDATE
      SET is_enabled = FALSE, rollout_percentage = 0, updated_at = now();

  ELSE
    RAISE NOTICE 'feature_flags table absent; skipping ff_lesson_generation_v1 / ff_content_generation_v1 disable (fresh DB).';
  END IF;
END $generation_agents_disable$;
