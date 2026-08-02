-- Migration: 20260802120000_seed_ff_wave_b_gap_screens.sql
-- Purpose: Seed 6 new CEO-approved "Wave B gap-filling" student-frontend
--          feature flags, one per newly-built screen this session, so each
--          row EXISTS in public.feature_flags and is auditable + flippable
--          from the super-admin console. All default OFF / 0% — this
--          migration is a zero-behavior-change deploy.
--
--   ff_me_v2
--     New /me route (ProfileScreen.tsx). Net-new page.
--   ff_onboarding_v2
--     Additive branch inside the existing /onboarding flow (SetupFlow.tsx).
--     Existing onboarding path is untouched while OFF.
--   ff_learn_topic_v2
--     Additive branch inside the existing /learn/[subject]/[chapter]
--     chapter page (TopicPage.tsx). Existing chapter page path is untouched
--     while OFF.
--   ff_quiz_result_v2
--     Additive branch inside the existing /quiz results state
--     (ResultSummary.tsx). Existing results rendering is untouched while
--     OFF. Does not alter score/XP computation (P1/P2) — display-layer only.
--   ff_foxy_snap_v1
--     New /foxy/snap route (SnapDoubt.tsx) — presentational shell only;
--     camera/OCR capture is not wired yet. Fully inert while OFF.
--   ff_plan_v2
--     New PlanModal.tsx component (screen 15). Not yet wired to any trigger
--     point in this round — ships as a standalone, reviewable component.
--     No surface currently mounts it, so it is inert independent of the
--     flag; the flag is seeded now so the eventual wiring PR only needs to
--     add a gate check, not a schema change.
--
-- ─── Default-OFF contract ─────────────────────────────────────────────────────
-- This migration seeds all six rows in the DISABLED state only:
--   is_enabled = FALSE, rollout_percentage = 0.
-- The read path (isFeatureEnabled in packages/lib/src/feature-flags.ts)
-- returns false for both `is_enabled = false` AND `rollout_percentage <= 0`,
-- so every surface stays OFF until an operator explicitly flips a flag via
-- the super-admin console. Seeding the rows makes the flags visible/
-- auditable — it does NOT enable any behavior. This migration is a
-- zero-behavior-change deploy.
--
-- ─── Column shape ─────────────────────────────────────────────────────────────
-- Mirrors the established flag-seed precedent in this exact session
-- (20260802090200_seed_ff_wave_b_frontend_flags.sql) and earlier
-- (20260619000100_seed_ff_school_pulse_v1.sql,
-- 20260619000300_seed_ff_adaptive_remediation_v1.sql) for the defensive
-- to_regclass guard + OFF/NULL-scoping semantics. Scoping arrays are left
-- NULL (no role/env/institution narrowing) — the global is_enabled=false /
-- rollout=0 double gate is what holds every flag OFF.
--
-- Idempotent. Safe to re-run: ON CONFLICT (flag_name) DO NOTHING per row
-- (backed by the feature_flags.flag_name unique constraint,
-- feature_flags_flag_name_key). The whole INSERT is additionally guarded so
-- it no-ops cleanly if the feature_flags table does not yet exist (fresh DB
-- / out-of-order apply), so the live-DB CI test and Supabase preview
-- branches never fail. No schema changes. Pure data seed. No new tables →
-- RLS N/A; feature_flags keeps its existing baseline RLS posture. None of
-- these six flag names are in packages/lib/src/flags/protected-flags.ts, and
-- this migration only ever sets is_enabled=false/rollout_percentage=0, so
-- scripts/check-protected-flag-migrations.mjs has nothing to gate here.
--
-- Owner: architect (this seed) + frontend (surface gate wiring, in
--        parallel, against these exact flag names)
-- Added: 2026-08-02
--
-- ─── Reversible (manual DOWN) ─────────────────────────────────────────────────
--   DELETE FROM feature_flags WHERE flag_name IN (
--     'ff_me_v2', 'ff_onboarding_v2', 'ff_learn_topic_v2',
--     'ff_quiz_result_v2', 'ff_foxy_snap_v1', 'ff_plan_v2'
--   );
-- The application resolves a missing flag to OFF, so deletion is silent on
-- the production experience.

DO $wave_b_gap_screens$
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
    VALUES
    (
      'ff_me_v2',
      false,
      0,
      'Wave B gap screens: new /me route (ProfileScreen.tsx). Net-new page. Default off.',
      NULL, NULL, NULL, now(), now()
    ),
    (
      'ff_onboarding_v2',
      false,
      0,
      'Wave B gap screens: additive branch inside the existing /onboarding flow (SetupFlow.tsx). Existing onboarding path unaffected while off. Default off.',
      NULL, NULL, NULL, now(), now()
    ),
    (
      'ff_learn_topic_v2',
      false,
      0,
      'Wave B gap screens: additive branch inside the existing /learn/[subject]/[chapter] chapter page (TopicPage.tsx). Existing chapter page unaffected while off. Default off.',
      NULL, NULL, NULL, now(), now()
    ),
    (
      'ff_quiz_result_v2',
      false,
      0,
      'Wave B gap screens: additive branch inside the existing /quiz results state (ResultSummary.tsx). Display-layer only; does not alter score/XP computation. Existing results rendering unaffected while off. Default off.',
      NULL, NULL, NULL, now(), now()
    ),
    (
      'ff_foxy_snap_v1',
      false,
      0,
      'Wave B gap screens: new /foxy/snap route (SnapDoubt.tsx), presentational shell only; camera/OCR capture not yet wired. Default off.',
      NULL, NULL, NULL, now(), now()
    ),
    (
      'ff_plan_v2',
      false,
      0,
      'Wave B gap screens: new PlanModal.tsx component (screen 15). Not yet wired to a trigger point; ships as a standalone reviewable component. Default off.',
      NULL, NULL, NULL, now(), now()
    )
    ON CONFLICT (flag_name) DO NOTHING;
  ELSE
    RAISE NOTICE 'feature_flags table absent; skipping Wave B gap-screen flag seed (fresh DB).';
  END IF;
END $wave_b_gap_screens$;
