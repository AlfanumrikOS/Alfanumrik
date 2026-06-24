-- Migration: 20260624120000_seed_ff_streak_guardian_cron_v1.sql
-- Purpose: Seed two CEO-approved feature flags — ff_streak_guardian_cron_v1
--          and ff_level_up_celebration_v1 — so both rows EXIST in
--          public.feature_flags and are auditable + flippable from the
--          super-admin console. Default OFF / 0% for both.
--
-- ── ff_streak_guardian_cron_v1 ────────────────────────────────────────────────
--   When ON: the Vercel cron at /api/cron/streak-guardian (16:30 UTC = 22:00 IST,
--   registered in vercel.json alongside this migration) runs nightly. The route
--   is guarded by CRON_SECRET (x-vercel-signature in prod; Bearer CRON_SECRET in
--   dev/staging), matching the posture of the irt-calibrate and
--   adaptive-remediation cron routes.
--   When OFF: the route still accepts the Vercel invocation but exits early
--   (flag-gated fast-path), making the cron call a no-op. No streak data is
--   mutated until an operator explicitly enables this flag.
--
-- ── ff_level_up_celebration_v1 ────────────────────────────────────────────────
--   When ON: the LevelUpModal component renders inside QuizResults.tsx after a
--   student's cumulative XP crosses a level threshold (500 XP / level). The modal
--   is a client-side celebration overlay — no DB write path, no scoring change
--   (P1/P2 unchanged). Safe for staged rollout.
--   When OFF: QuizResults.tsx renders BYTE-IDENTICALLY to today — the modal does
--   not mount and no level-up XP threshold checks are surfaced.
--
-- ─── Default-OFF contract ─────────────────────────────────────────────────────
-- Both rows seeded in DISABLED state:
--   is_enabled = FALSE, rollout_percentage = 0.
-- The read path (isFeatureEnabled in src/lib/feature-flags.ts) returns false for
-- both `is_enabled = false` AND `rollout_percentage <= 0`, so both features stay
-- OFF until an operator explicitly flips the flag via the super-admin console.
-- Seeding the rows makes the flags visible/auditable — it does NOT enable the
-- behavior. Merging this migration is a zero-behavior change.
--
-- ─── Column shape ─────────────────────────────────────────────────────────────
-- Mirrors the established flag-seed precedent VERBATIM
-- (20260619000100_seed_ff_school_pulse_v1.sql and
--  20260619000600_seed_ff_adaptive_loops_bc_v1.sql for the defensive to_regclass
--  guard + explicit column list + ON CONFLICT (flag_name) DO NOTHING pattern per
--  REG-125). Scoping arrays are left NULL (no role/env/institution narrowing) —
--  the global is_enabled=false / rollout=0 double gate holds both flags OFF.
--
-- Idempotent. Safe to re-run: ON CONFLICT (flag_name) DO NOTHING (backed by the
-- feature_flags flag_name unique constraint). The whole INSERT block is
-- additionally guarded so it no-ops cleanly if the feature_flags table does not
-- yet exist (fresh DB / out-of-order apply), so the live-DB CI test and Supabase
-- preview branches never fail. No schema changes. Pure data seed. No new tables
-- → RLS N/A; the table keeps its existing baseline RLS posture.
--
-- Owner: architect (cron schedule + this seed) + frontend (LevelUpModal gate
--        wiring against ff_level_up_celebration_v1) + ops (flag flip procedure)
-- Added: 2026-06-24
--
-- ─── Reversible (manual DOWN) ─────────────────────────────────────────────────
--   DELETE FROM feature_flags WHERE flag_name IN (
--     'ff_streak_guardian_cron_v1',
--     'ff_level_up_celebration_v1'
--   );
-- The application resolves a missing flag to OFF, so deletion is silent on the
-- production experience.

DO $streak_guardian_and_level_up$
BEGIN
  IF to_regclass('public.feature_flags') IS NOT NULL THEN

    -- ── Flag 1: ff_streak_guardian_cron_v1 ──────────────────────────────────
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
    VALUES (
      'ff_streak_guardian_cron_v1',
      false,
      0,
      'Streak-guardian nightly cron (/api/cron/streak-guardian, 16:30 UTC = 22:00 IST). When ON the route evaluates and repairs streak state for all active students. Guarded by CRON_SECRET; matches irt-calibrate / adaptive-remediation cron posture. Default off; operator enables when ready.',
      NULL,
      NULL,
      NULL,
      now(),
      now()
    )
    ON CONFLICT (flag_name) DO NOTHING;

    -- ── Flag 2: ff_level_up_celebration_v1 ──────────────────────────────────
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
    VALUES (
      'ff_level_up_celebration_v1',
      false,
      0,
      'LevelUpModal celebration overlay in QuizResults.tsx. Renders when cumulative XP crosses a 500 XP level boundary. Client-side UI only — no scoring or DB-write path change (P1/P2 unchanged). Default off; staged rollout to students.',
      NULL,
      NULL,
      NULL,
      now(),
      now()
    )
    ON CONFLICT (flag_name) DO NOTHING;

  ELSE
    RAISE NOTICE 'feature_flags table absent; skipping ff_streak_guardian_cron_v1 + ff_level_up_celebration_v1 seeds (fresh DB).';
  END IF;
END $streak_guardian_and_level_up$;
