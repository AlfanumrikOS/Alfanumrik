-- Migration: 20260619001000_seed_ff_foxy_curriculum_guard_v1.sql
-- Purpose: Seed the feature flag `ff_foxy_curriculum_guard_v1` (Foxy Curriculum
--          Guard) so the row EXISTS in public.feature_flags and is auditable +
--          flippable from the super-admin console. Default OFF / 0%.
--
--   ff_foxy_curriculum_guard_v1
--     A deterministic (no-LLM) curriculum-authenticity guard layered on the
--     EXISTING /api/foxy STEM path. It runs two purely-mechanical tiers:
--       (T1) Enrolled-grade authenticity — the student's enrolled grade is the
--            only authority for what curriculum scope is in-bounds; nothing is
--            inferred from the query text or model output.
--       (T4a) Out-of-grade math lexicon — a static lexicon classifies a math
--            query against the enrolled grade's CBSE band.
--     When ON: the guard HARD-BLOCKS out-of-grade math on ALL STEM Foxy queries
--     and redirects the learner to their current chapter/topic, surfaced with the
--     "Outside-Current-Chapter" badge in the existing FoxyStructuredRenderer.
--     Decision A — an IN-GRADE but DIFFERENT-CHAPTER query — stays SOFT (gentle
--     nudge, not a hard block); only out-of-grade math is hard-blocked.
--     When OFF: the /api/foxy flow renders BYTE-IDENTICALLY to today — no tier
--     runs, no lexicon is consulted, no redirect/badge is emitted.
--     This guard is DECOUPLED from ff_foxy_math_pipeline_v1 (the 3-agent math
--     correctness pipeline, 20260619000800) — the two flags ramp independently
--     and neither gates the other.
--     ENV override: FF_FOXY_CURRICULUM_GUARD_V1, resolved through
--     isCurriculumGuardEnabled in src/lib/foxy/math-flag.ts (backend-owned).
--
-- Plan: Foxy Curriculum Guard (deterministic in-/out-of-grade authenticity).
--       New migration: seed ff_foxy_curriculum_guard_v1 (flag OFF) gating the
--       whole guard path. Deterministic, no-LLM; standard domain sign-offs apply.
--
-- ─── Default-OFF contract ─────────────────────────────────────────────────────
-- This migration seeds the row in the DISABLED state only:
--   is_enabled = FALSE, rollout_percentage = 0.
-- The read path (isFeatureEnabled in src/lib/feature-flags.ts) returns false for
-- both `is_enabled = false` AND `rollout_percentage <= 0`, so the curriculum
-- guard stays OFF until an operator explicitly flips this flag via the
-- super-admin console (or, for local dev, the documented local-dev seeder).
-- Seeding the row makes the flag visible/auditable — it does NOT enable the
-- behavior. Merging this migration is a zero-behavior change (the /api/foxy flow
-- renders byte-identically to today while the flag resolves OFF).
--
-- ─── Column shape (REG-125) ───────────────────────────────────────────────────
-- Mirrors the established flag-seed precedent VERBATIM
-- (20260619000800_seed_ff_foxy_math_pipeline_v1.sql,
-- 20260619000700_seed_ff_foxy_learning_actions_v1.sql,
-- 20260619000600_seed_ff_adaptive_loops_bc_v1.sql,
-- 20260619000100_seed_ff_school_pulse_v1.sql for the defensive to_regclass guard
-- + explicit column list + audit description). The canonical feature_flags
-- columns are `flag_name` (UNIQUE) + `is_enabled` — NOT `name`/`enabled`
-- (baseline 00000000000000_baseline_from_prod.sql; feature_flags_flag_name_key
-- UNIQUE). The explicit column list (flag_name first) + ON CONFLICT (flag_name)
-- DO NOTHING conform to REG-125 (canonical feature_flags shape; never DO UPDATE —
-- so a pre-existing operator-set state is preserved on re-run). Scoping arrays
-- are left NULL (no role/env/institution narrowing) — the global
-- is_enabled=false / rollout=0 double gate is what holds the flag OFF.
--
-- Idempotent. Safe to re-run: ON CONFLICT (flag_name) DO NOTHING (backed by the
-- feature_flags flag_name unique constraint). The whole INSERT is additionally
-- guarded so it no-ops cleanly if the feature_flags table does not yet exist
-- (fresh DB / out-of-order apply), so the live-DB CI test and Supabase preview
-- branches never fail. No schema changes. Pure data seed.
--
-- ─── No new table ─────────────────────────────────────────────────────────────
-- This migration adds NO new table. The curriculum guard is compute-only: the
-- two deterministic tiers (T1 enrolled-grade authenticity + T4a out-of-grade
-- math lexicon) run as logic the /api/foxy route calls, using the student's
-- already-stored enrolled grade and a static in-code lexicon, and the result is
-- rendered through the EXISTING FoxyStructuredRenderer (Outside-Current-Chapter
-- badge). No new tables → RLS N/A for this migration.
--
-- Owner: architect (this seed) + backend (guard wiring + isCurriculumGuardEnabled
--        resolver in src/lib/foxy/math-flag.ts + ENV override) + assessment
--        (in-/out-of-grade lexicon + chapter/topic redirect semantics) +
--        frontend (Outside-Current-Chapter badge) — all in parallel.
-- Added: 2026-06-15
--
-- ─── Reversible (manual DOWN) ─────────────────────────────────────────────────
--   DELETE FROM feature_flags WHERE flag_name = 'ff_foxy_curriculum_guard_v1';
-- The application resolves a missing flag to OFF, so deletion is silent on the
-- production experience (the /api/foxy flow falls back to the unguarded path).

DO $foxy_curriculum_guard$
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
      'ff_foxy_curriculum_guard_v1',
      false,
      0,
      'Foxy Curriculum Guard (deterministic, no-LLM): T1 enrolled-grade authenticity (the enrolled grade is the only scope authority) + T4a out-of-grade math lexicon (static lexicon classifies the math query against the enrolled grade band). Hard-blocks out-of-grade math on ALL STEM Foxy queries and redirects to the current chapter/topic with the Outside-Current-Chapter badge in the existing FoxyStructuredRenderer. Decision A (in-grade, different-chapter) stays SOFT (nudge, not a hard block). Decoupled from ff_foxy_math_pipeline_v1 (20260619000800) — the two ramp independently and neither gates the other. ENV override FF_FOXY_CURRICULUM_GUARD_V1 via the isCurriculumGuardEnabled resolver in src/lib/foxy/math-flag.ts. OFF = /api/foxy byte-identical to today (no tier runs, no lexicon, no redirect/badge). Default off. Plan: Foxy Curriculum Guard.',
      NULL,
      NULL,
      NULL,
      now(),
      now()
    )
    ON CONFLICT (flag_name) DO NOTHING;
  ELSE
    RAISE NOTICE 'feature_flags table absent; skipping ff_foxy_curriculum_guard_v1 seed (fresh DB).';
  END IF;
END $foxy_curriculum_guard$;
