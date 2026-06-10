-- Migration: Enable production-ready feature flags for local development
-- Purpose: Sync local feature_flags table with production flag state
-- Usage: This migration seeds/updates flags that are known to be stable in production
-- Date: 2026-06-15
-- 
-- NOTE: This migration is SAFE to run multiple times (uses ON CONFLICT).
-- It only affects local development environments and is idempotent.
-- 
-- To roll back: DELETE FROM feature_flags WHERE flag_name IN (list below)
-- To check status: SELECT flag_name, is_enabled, rollout_percentage FROM feature_flags ORDER BY flag_name;

-- ═══════════════════════════════════════════════════════════════════════════
-- LANDING PAGE & MARKETING
-- ═══════════════════════════════════════════════════════════════════════════

-- Welcome v2 — modern landing page (stable in production)
INSERT INTO feature_flags (flag_name, is_enabled, target_environments, rollout_percentage, metadata)
VALUES ('ff_welcome_v2', true, ARRAY['development', 'staging'], 100, NULL)
ON CONFLICT (flag_name) DO UPDATE SET
  is_enabled = true,
  target_environments = ARRAY['development', 'staging'],
  rollout_percentage = 100;

-- ═══════════════════════════════════════════════════════════════════════════
-- PEDAGOGY V2 — DAILY RHYTHM & CURIOSITY DIVE
-- ═══════════════════════════════════════════════════════════════════════════

-- Daily Rhythm — adaptive Today home + SRS queue
INSERT INTO feature_flags (flag_name, is_enabled, target_environments, rollout_percentage, metadata)
VALUES ('ff_pedagogy_v2_daily_rhythm', true, ARRAY['development', 'staging'], 100, NULL)
ON CONFLICT (flag_name) DO UPDATE SET
  is_enabled = true,
  target_environments = ARRAY['development', 'staging'],
  rollout_percentage = 100;

-- Weekly Curiosity Dive — exploration + misconception finder
INSERT INTO feature_flags (flag_name, is_enabled, target_environments, rollout_percentage, metadata)
VALUES ('ff_pedagogy_v2_weekly_dive', true, ARRAY['development', 'staging'], 100, NULL)
ON CONFLICT (flag_name) DO UPDATE SET
  is_enabled = true,
  target_environments = ARRAY['development', 'staging'],
  rollout_percentage = 100;

-- Monthly Synthesis — learner progress summary + WhatsApp parent share
INSERT INTO feature_flags (flag_name, is_enabled, target_environments, rollout_percentage, metadata)
VALUES ('ff_pedagogy_v2_monthly_synthesis', true, ARRAY['development', 'staging'], 100, NULL)
ON CONFLICT (flag_name) DO UPDATE SET
  is_enabled = true,
  target_environments = ARRAY['development', 'staging'],
  rollout_percentage = 100;

-- Productive Failure v1 — ZPD problem BEFORE tutorial (for improve_basics)
INSERT INTO feature_flags (flag_name, is_enabled, target_environments, rollout_percentage, metadata)
VALUES ('ff_productive_failure_v1', true, ARRAY['development', 'staging'], 100, NULL)
ON CONFLICT (flag_name) DO UPDATE SET
  is_enabled = true,
  target_environments = ARRAY['development', 'staging'],
  rollout_percentage = 100;

-- Distractor Micro Explainer v1 — wrong-answer remediation
INSERT INTO feature_flags (flag_name, is_enabled, target_environments, rollout_percentage, metadata)
VALUES ('ff_distractor_micro_explainer_v1', true, ARRAY['development', 'staging'], 100, NULL)
ON CONFLICT (flag_name) DO UPDATE SET
  is_enabled = true,
  target_environments = ARRAY['development', 'staging'],
  rollout_percentage = 100;

-- ═══════════════════════════════════════════════════════════════════════════
-- EDITORIAL ATLAS REDESIGN
-- ═══════════════════════════════════════════════════════════════════════════

-- Editorial Atlas v1 — Master switch (new visual identity + unified shell)
INSERT INTO feature_flags (flag_name, is_enabled, target_environments, rollout_percentage, metadata)
VALUES ('ff_editorial_atlas_v1', true, ARRAY['development', 'staging'], 100, NULL)
ON CONFLICT (flag_name) DO UPDATE SET
  is_enabled = true,
  target_environments = ARRAY['development', 'staging'],
  rollout_percentage = 100;

-- Editorial Atlas — student dashboard canary
INSERT INTO feature_flags (flag_name, is_enabled, target_environments, rollout_percentage, metadata)
VALUES ('ff_editorial_atlas_student', true, ARRAY['development', 'staging'], 100, NULL)
ON CONFLICT (flag_name) DO UPDATE SET
  is_enabled = true,
  target_environments = ARRAY['development', 'staging'],
  rollout_percentage = 100;

-- Editorial Atlas — parent portal canary
INSERT INTO feature_flags (flag_name, is_enabled, target_environments, rollout_percentage, metadata)
VALUES ('ff_editorial_atlas_parent', true, ARRAY['development', 'staging'], 100, NULL)
ON CONFLICT (flag_name) DO UPDATE SET
  is_enabled = true,
  target_environments = ARRAY['development', 'staging'],
  rollout_percentage = 100;

-- Editorial Atlas — teacher dashboard canary
INSERT INTO feature_flags (flag_name, is_enabled, target_environments, rollout_percentage, metadata)
VALUES ('ff_editorial_atlas_teacher', true, ARRAY['development', 'staging'], 100, NULL)
ON CONFLICT (flag_name) DO UPDATE SET
  is_enabled = true,
  target_environments = ARRAY['development', 'staging'],
  rollout_percentage = 100;

-- Editorial Atlas — school admin canary
INSERT INTO feature_flags (flag_name, is_enabled, target_environments, rollout_percentage, metadata)
VALUES ('ff_editorial_atlas_school', true, ARRAY['development', 'staging'], 100, NULL)
ON CONFLICT (flag_name) DO UPDATE SET
  is_enabled = true,
  target_environments = ARRAY['development', 'staging'],
  rollout_percentage = 100;

-- ═══════════════════════════════════════════════════════════════════════════
-- CONSUMER MINIMALISM (Phase 1)
-- ═══════════════════════════════════════════════════════════════════════════

-- Today Home v1 — adaptive home + 4-tab student nav (Wave A)
INSERT INTO feature_flags (flag_name, is_enabled, target_environments, rollout_percentage, metadata)
VALUES ('ff_today_home_v1', true, ARRAY['development', 'staging'], 100, NULL)
ON CONFLICT (flag_name) DO UPDATE SET
  is_enabled = true,
  target_environments = ARRAY['development', 'staging'],
  rollout_percentage = 100;

-- Parent Encourage v1 — parent→child cheer button (Wave D)
INSERT INTO feature_flags (flag_name, is_enabled, target_environments, rollout_percentage, metadata)
VALUES ('ff_parent_encourage_v1', true, ARRAY['development', 'staging'], 100, NULL)
ON CONFLICT (flag_name) DO UPDATE SET
  is_enabled = true,
  target_environments = ARRAY['development', 'staging'],
  rollout_percentage = 100;

-- ═══════════════════════════════════════════════════════════════════════════
-- GOAL-ADAPTIVE LEARNING (Phases 0-4)
-- ═══════════════════════════════════════════════════════════════════════════

-- Goal Profiles — super-admin preview page
INSERT INTO feature_flags (flag_name, is_enabled, target_environments, rollout_percentage, metadata)
VALUES ('ff_goal_profiles', true, ARRAY['development', 'staging'], 100, NULL)
ON CONFLICT (flag_name) DO UPDATE SET
  is_enabled = true,
  target_environments = ARRAY['development', 'staging'],
  rollout_percentage = 100;

-- Goal Aware Foxy — persona system prompt + goal-aware scorecards
INSERT INTO feature_flags (flag_name, is_enabled, target_environments, rollout_percentage, metadata)
VALUES ('ff_goal_aware_foxy', true, ARRAY['development', 'staging'], 100, NULL)
ON CONFLICT (flag_name) DO UPDATE SET
  is_enabled = true,
  target_environments = ARRAY['development', 'staging'],
  rollout_percentage = 100;

-- Goal Aware Selection — adaptive quiz generation (Phase 2)
INSERT INTO feature_flags (flag_name, is_enabled, target_environments, rollout_percentage, metadata)
VALUES ('ff_goal_aware_selection', true, ARRAY['development', 'staging'], 100, NULL)
ON CONFLICT (flag_name) DO UPDATE SET
  is_enabled = true,
  target_environments = ARRAY['development', 'staging'],
  rollout_percentage = 100;

-- ═══════════════════════════════════════════════════════════════════════════
-- STUDY MENU V2
-- ═══════════════════════════════════════════════════════════════════════════

-- Study Menu v2 — sidebar consolidation (Library, Refresh, Exam Sprint)
INSERT INTO feature_flags (flag_name, is_enabled, target_environments, rollout_percentage, metadata)
VALUES ('ff_study_menu_v2', true, ARRAY['development', 'staging'], 100, NULL)
ON CONFLICT (flag_name) DO UPDATE SET
  is_enabled = true,
  target_environments = ARRAY['development', 'staging'],
  rollout_percentage = 100;

-- ═══════════════════════════════════════════════════════════════════════════
-- SUPER-ADMIN FEATURES
-- ═══════════════════════════════════════════════════════════════════════════

-- Goal Admin Profiles — super-admin editing of goal personas
INSERT INTO feature_flags (flag_name, is_enabled, target_environments, rollout_percentage, metadata)
VALUES ('ff_goal_admin_profiles', true, ARRAY['development', 'staging'], 100, NULL)
ON CONFLICT (flag_name) DO UPDATE SET
  is_enabled = true,
  target_environments = ARRAY['development', 'staging'],
  rollout_percentage = 100;

-- ═══════════════════════════════════════════════════════════════════════════
-- SUMMARY
-- ═══════════════════════════════════════════════════════════════════════════
-- 
-- Enabled flags (17 total):
--   1. ff_welcome_v2                    — Modern landing page
--   2. ff_pedagogy_v2_daily_rhythm      — Daily Rhythm Queue
--   3. ff_pedagogy_v2_weekly_dive       — Curiosity Dive
--   4. ff_pedagogy_v2_monthly_synthesis — Synthesis + parent share
--   5. ff_productive_failure_v1         — ZPD-first learning
--   6. ff_distractor_micro_explainer_v1 — Wrong-answer remediation
--   7. ff_editorial_atlas_v1            — Master redesign switch
--   8. ff_editorial_atlas_student       — Student canary
--   9. ff_editorial_atlas_parent        — Parent canary
--   10. ff_editorial_atlas_teacher      — Teacher canary
--   11. ff_editorial_atlas_school       — School-admin canary
--   12. ff_today_home_v1                — Adaptive Today home
--   13. ff_parent_encourage_v1          — Parent cheer button
--   14. ff_goal_profiles                — Goal admin preview
--   15. ff_goal_aware_foxy              — Persona system prompts
--   16. ff_goal_aware_selection         — Adaptive quiz generation
--   17. ff_study_menu_v2                — Sidebar consolidation
--
-- All scoped to: development + staging only (production unchanged)
-- All set to 100% rollout (no canary sampling)
--
-- To verify: SELECT COUNT(*) FROM feature_flags WHERE is_enabled = true AND target_environments @> ARRAY['development'];
