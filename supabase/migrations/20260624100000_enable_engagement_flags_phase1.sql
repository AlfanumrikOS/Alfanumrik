-- Migration: 20260624100000_enable_engagement_flags_phase1.sql
-- Purpose: Phase 1 Engagement Activation — UPSERT 8 feature flags that have
--          verified, production-ready code behind them to is_enabled = TRUE.
--
-- RCA context (2026-06-24): The Dopamine Loop RCA identified that engagement
-- infrastructure was 60-70% built but not enabled. All 8 flags have been
-- individually verified with working code behind them.
--
-- Already ON (UPSERT re-asserts idempotently):
--   ff_teacher_command_center — enabled by 20260620001601
--   ff_parent_glance_v1       — enabled by 20260620001601
--
-- Newly flipped ON by this migration:
--   ff_parent_encourage_v1         — seeded OFF by 20260613000002
--   ff_teacher_assignment_lifecycle — seeded OFF by 20260623010000
--   ff_teacher_gradebook_depth      — seeded OFF by 20260623010000
--   ff_teacher_parent_comms         — seeded OFF by 20260623010000
--   ff_pedagogy_v2_weekly_dive      — seeded OFF by 20260510000000
--   ff_foxy_learning_actions_v1     — seeded OFF by 20260619000700
--   ff_level_up_celebration_v1     — seeded OFF by 20260624120000 (UPSERT wins: 100000 < 120000)
--
-- Stakeholder impact:
--   Parents:  EncourageButton (cheer with 6h rate-limit) via ff_parent_encourage_v1
--   Teachers: GradingQueue + StudentMasteryReport + parent-notify (3 additive gates)
--   Students: Weekly Curiosity Dive CTA + Foxy learning action bar + level-up modal
--
-- Rollback:
--   UPDATE public.feature_flags SET is_enabled = FALSE, updated_at = now()
--   WHERE flag_name IN (same 9 names — add ff_level_up_celebration_v1);
--
-- Pattern: mirrors 20260620001601_enable_latest_frontend_flags.sql (idempotent UPSERT).
-- Additive. Idempotent. Replayable. No DDL. No new tables. RLS not affected.
-- Guarded with IF to_regclass so it no-ops on a fresh DB.
-- Owner: architect. CEO-approved, 2026-06-24.

DO $$
BEGIN
  IF to_regclass('public.feature_flags') IS NOT NULL THEN

    -- 1. Parent Encourage — cheer button on ParentGlanceHome.
    INSERT INTO public.feature_flags (
      flag_name, is_enabled, rollout_percentage,
      target_roles, target_environments, target_institutions,
      created_at, updated_at
    ) VALUES (
      'ff_parent_encourage_v1', TRUE, 100,
      NULL, NULL, NULL, now(), now()
    )
    ON CONFLICT (flag_name) DO UPDATE
      SET is_enabled = TRUE, rollout_percentage = 100, updated_at = now();

    -- 2. Parent Glance Home (already ON — re-asserting idempotently).
    INSERT INTO public.feature_flags (
      flag_name, is_enabled, rollout_percentage,
      target_roles, target_environments, target_institutions,
      created_at, updated_at
    ) VALUES (
      'ff_parent_glance_v1', TRUE, 100,
      NULL, NULL, NULL, now(), now()
    )
    ON CONFLICT (flag_name) DO UPDATE
      SET is_enabled = TRUE, rollout_percentage = 100, updated_at = now();

    -- 3. Teacher Command Center (already ON — re-asserting idempotently).
    INSERT INTO public.feature_flags (
      flag_name, is_enabled, rollout_percentage,
      target_roles, target_environments, target_institutions,
      created_at, updated_at
    ) VALUES (
      'ff_teacher_command_center', TRUE, 100,
      NULL, NULL, NULL, now(), now()
    )
    ON CONFLICT (flag_name) DO UPDATE
      SET is_enabled = TRUE, rollout_percentage = 100, updated_at = now();

    -- 4. Teacher Assignment Lifecycle — grading queue inside CommandCenter.
    INSERT INTO public.feature_flags (
      flag_name, is_enabled, rollout_percentage,
      target_roles, target_environments, target_institutions,
      created_at, updated_at
    ) VALUES (
      'ff_teacher_assignment_lifecycle', TRUE, 100,
      NULL, NULL, NULL, now(), now()
    )
    ON CONFLICT (flag_name) DO UPDATE
      SET is_enabled = TRUE, rollout_percentage = 100, updated_at = now();

    -- 5. Teacher Gradebook Depth — Bloom drill-through inside CommandCenter.
    INSERT INTO public.feature_flags (
      flag_name, is_enabled, rollout_percentage,
      target_roles, target_environments, target_institutions,
      created_at, updated_at
    ) VALUES (
      'ff_teacher_gradebook_depth', TRUE, 100,
      NULL, NULL, NULL, now(), now()
    )
    ON CONFLICT (flag_name) DO UPDATE
      SET is_enabled = TRUE, rollout_percentage = 100, updated_at = now();

    -- 6. Teacher Parent Comms — one-tap Tell-the-parent button.
    INSERT INTO public.feature_flags (
      flag_name, is_enabled, rollout_percentage,
      target_roles, target_environments, target_institutions,
      created_at, updated_at
    ) VALUES (
      'ff_teacher_parent_comms', TRUE, 100,
      NULL, NULL, NULL, now(), now()
    )
    ON CONFLICT (flag_name) DO UPDATE
      SET is_enabled = TRUE, rollout_percentage = 100, updated_at = now();

    -- 7. Pedagogy v2 Weekly Dive — Curiosity Dive CTA on student dashboard.
    INSERT INTO public.feature_flags (
      flag_name, is_enabled, rollout_percentage,
      target_roles, target_environments, target_institutions,
      created_at, updated_at
    ) VALUES (
      'ff_pedagogy_v2_weekly_dive', TRUE, 100,
      NULL, NULL, NULL, now(), now()
    )
    ON CONFLICT (flag_name) DO UPDATE
      SET is_enabled = TRUE, rollout_percentage = 100, updated_at = now();

    -- 8. Foxy Learning Actions v1 — redesigned action bar (Explain/Practice/Revise/Quiz).
    INSERT INTO public.feature_flags (
      flag_name, is_enabled, rollout_percentage,
      target_roles, target_environments, target_institutions,
      created_at, updated_at
    ) VALUES (
      'ff_foxy_learning_actions_v1', TRUE, 100,
      NULL, NULL, NULL, now(), now()
    )
    ON CONFLICT (flag_name) DO UPDATE
      SET is_enabled = TRUE, rollout_percentage = 100, updated_at = now();

    -- 9. Level-Up Celebration Modal — client-side overlay in QuizResults.tsx.
    --    Seeded OFF by 20260624120000 (DO NOTHING). This UPSERT runs first
    --    (timestamp 100000 < 120000), so the flag is ON from day 1 and the
    --    later DO NOTHING seed leaves it enabled. No DB-write or scoring
    --    change (P1/P2 unchanged) — pure client-side celebration UI.
    INSERT INTO public.feature_flags (
      flag_name, is_enabled, rollout_percentage,
      target_roles, target_environments, target_institutions,
      created_at, updated_at
    ) VALUES (
      'ff_level_up_celebration_v1', TRUE, 100,
      NULL, NULL, NULL, now(), now()
    )
    ON CONFLICT (flag_name) DO UPDATE
      SET is_enabled = TRUE, rollout_percentage = 100, updated_at = now();

  ELSE
    RAISE NOTICE 'feature_flags table absent; skipping engagement flag enablement (fresh DB).';
  END IF;
END $$;
