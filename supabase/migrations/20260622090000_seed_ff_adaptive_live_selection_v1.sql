-- Migration: 20260622090000_seed_ff_adaptive_live_selection_v1.sql
-- Purpose: Seed the feature flag `ff_adaptive_live_selection_v1` (Phase 2 of the
--          adaptive-loop fix — the weak-topic-targeted LIVE quiz candidate
--          provider) so the row EXISTS in public.feature_flags and is auditable +
--          flippable from the super-admin console. Default OFF / 0%.
--
--   ff_adaptive_live_selection_v1
--     When ON (and the student HAS concept_mastery rows): the shared
--     selectAdaptiveQuestions candidate provider
--     (src/lib/adaptive/select-adaptive-questions.ts) is layered IN FRONT of the
--     existing getQuizQuestionsV2 fallback ladder, targeting the student's weak
--     topics for live quiz delivery.
--     When OFF (default): getQuizQuestionsV2 behaves byte-identically to today —
--     the adaptive provider is bypassed and the existing static fallback ladder
--     serves questions. Merging this migration is a zero-behavior change.
--
-- ─── Default-OFF contract ─────────────────────────────────────────────────────
-- This migration seeds the row in the DISABLED state only:
--   is_enabled = FALSE, rollout_percentage = 0.
-- The read path (isFeatureEnabled in src/lib/feature-flags.ts) returns false for
-- both `is_enabled = false` AND `rollout_percentage <= 0`, so the live adaptive
-- selection stays OFF until an operator explicitly flips this flag via the
-- super-admin console. Seeding the row makes the flag visible/auditable — it does
-- NOT enable the behavior. FLAG_DEFAULTS already resolves it to false in code, so
-- the seed simply makes the DB row match the code default.
--
-- ─── Column shape ─────────────────────────────────────────────────────────────
-- Mirrors the established flag-seed precedent VERBATIM
-- (20260619000300_seed_ff_adaptive_remediation_v1.sql,
-- 20260619000600_seed_ff_adaptive_loops_bc_v1.sql, and
-- 20260619000100_seed_ff_school_pulse_v1.sql for the defensive to_regclass guard
-- + explicit column list + audit description). Scoping arrays are left NULL (no
-- role/env/institution narrowing) — the global is_enabled=false / rollout=0
-- double gate is what holds the flag OFF. Staging-first enablement. The explicit
-- column list (flag_name first) + ON CONFLICT (flag_name) DO NOTHING conform to
-- REG-125 (canonical feature_flags shape: flag_name/is_enabled, NOT name/enabled;
-- never DO UPDATE).
--
-- Idempotent. Safe to re-run: ON CONFLICT (flag_name) DO NOTHING (backed by the
-- feature_flags flag_name unique constraint). The whole INSERT is additionally
-- guarded so it no-ops cleanly if the feature_flags table does not yet exist
-- (fresh DB / out-of-order apply), so the live-DB CI test and Supabase preview
-- branches never fail. No schema changes. Pure data seed. No new tables → RLS
-- N/A; the table keeps its existing baseline RLS posture.
--
-- Owner: architect (this seed) + ai-engineer (the gated provider + getQuizQuestionsV2
--        wiring, against this exact flag name, in parallel) + ops (flip procedure)
-- Added: 2026-06-22
--
-- ─── Reversible (manual DOWN) ─────────────────────────────────────────────────
--   DELETE FROM feature_flags WHERE flag_name = 'ff_adaptive_live_selection_v1';
-- The application resolves a missing flag to OFF, so deletion is silent on the
-- production experience.

DO $adaptive_live_selection$
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
      'ff_adaptive_live_selection_v1',
      false,
      0,
      'Phase 2 adaptive-loop fix: weak-topic-targeted LIVE quiz candidate provider (selectAdaptiveQuestions) layered IN FRONT of the getQuizQuestionsV2 fallback ladder. When ON and the student has concept_mastery rows, the adaptive provider selects questions targeting weak topics; when OFF (default) getQuizQuestionsV2 serves the existing static behavior byte-identically. Default off; staging-first. Code: src/lib/adaptive/select-adaptive-questions.ts, src/lib/feature-flags.ts (ADAPTIVE_LIVE_SELECTION_FLAGS).',
      NULL,
      NULL,
      NULL,
      now(),
      now()
    )
    ON CONFLICT (flag_name) DO NOTHING;
  ELSE
    RAISE NOTICE 'feature_flags table absent; skipping ff_adaptive_live_selection_v1 seed (fresh DB).';
  END IF;
END $adaptive_live_selection$;
