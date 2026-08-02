-- Migration: 20260802150000_seed_ff_quiz_v2.sql
-- Purpose: Seed the "Wave B3" screen 07 "Practice" student-frontend
--          feature flag so the row EXISTS in public.feature_flags and is
--          auditable + flippable from the super-admin console. Default
--          OFF / 0% — this migration is a zero-behavior-change deploy.
--
--   ff_quiz_v2
--     Additive branch inside the existing quiz screen render path
--     (apps/host/src/app/(student)/quiz/page.tsx): renders
--     <PracticeRunner> (packages/ui/src/quiz/v2/PracticeRunner.tsx) in
--     place of the legacy per-question JSX, showing per-question
--     correctness immediately via check_quiz_answer() instead of
--     deferring feedback to the results screen. Only takes effect when
--     the flag is ON, the mode is 'practice', and the question is MCQ —
--     the legacy per-question JSX is completely untouched when the flag
--     is off, the mode isn't 'practice', or the question isn't MCQ.
--
-- ─── Default-OFF contract ─────────────────────────────────────────────────────
-- This migration seeds the row in the DISABLED state only:
--   is_enabled = FALSE, rollout_percentage = 0.
-- The read path (isFeatureEnabled in packages/lib/src/feature-flags.ts)
-- returns false for both `is_enabled = false` AND `rollout_percentage <= 0`,
-- so the surface stays OFF until an operator explicitly flips the flag via
-- the super-admin console. Seeding the row makes it visible/auditable — it
-- does NOT enable any behavior. This migration is a zero-behavior-change
-- deploy.
--
-- ─── Column shape ─────────────────────────────────────────────────────────────
-- Mirrors the established flag-seed precedent in this exact session
-- (20260802090200_seed_ff_wave_b_frontend_flags.sql,
-- 20260802120000_seed_ff_wave_b_gap_screens.sql,
-- 20260802140000_seed_ff_exam_v2.sql) for the defensive to_regclass guard +
-- OFF/NULL-scoping semantics. Scoping arrays are left NULL (no role/env/
-- institution narrowing) — the global is_enabled=false / rollout=0 double
-- gate is what holds the flag OFF.
--
-- Idempotent. Safe to re-run: ON CONFLICT (flag_name) DO NOTHING (backed by
-- the feature_flags.flag_name unique constraint, feature_flags_flag_name_key).
-- The whole INSERT is additionally guarded so it no-ops cleanly if the
-- feature_flags table does not yet exist (fresh DB / out-of-order apply), so
-- the live-DB CI test and Supabase preview branches never fail. No schema
-- changes. Pure data seed. No new tables → RLS N/A; feature_flags keeps its
-- existing baseline RLS posture. `ff_quiz_v2` is not in
-- packages/lib/src/flags/protected-flags.ts, and this migration only ever
-- sets is_enabled=false/rollout_percentage=0, so
-- scripts/check-protected-flag-migrations.mjs has nothing to gate here.
--
-- Owner: architect (this seed only — the PracticeRunner.tsx surface +
--        the quiz/page.tsx gate wiring + check_quiz_answer() RPC are owned
--        by frontend/assessment/ai-engineer per their respective domains)
-- Added: 2026-08-02
--
-- ─── Reversible (manual DOWN) ─────────────────────────────────────────────────
--   DELETE FROM feature_flags WHERE flag_name = 'ff_quiz_v2';
-- The application resolves a missing flag to OFF, so deletion is silent on
-- the production experience.

DO $seed_ff_quiz_v2$
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
    VALUES (
      'ff_quiz_v2',
      false,
      0,
      'Wave B3 screen 07 Practice: additive branch inside the quiz screen render path rendering <PracticeRunner> (immediate per-question feedback via check_quiz_answer()) over the unchanged legacy per-question JSX, gated to practice-mode MCQ questions only. Default off.',
      NULL, NULL, NULL, now(), now()
    )
    ON CONFLICT (flag_name) DO NOTHING;
  ELSE
    RAISE NOTICE 'feature_flags table absent; skipping ff_quiz_v2 flag seed (fresh DB).';
  END IF;
END $seed_ff_quiz_v2$;
