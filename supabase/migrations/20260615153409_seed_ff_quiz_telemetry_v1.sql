-- Migration: 20260615153409_seed_ff_quiz_telemetry_v1.sql
-- Purpose: Seed the feature flag `ff_quiz_telemetry_v1` (post-submit quiz
--          telemetry — per-answer learning_events + mastery_updated events,
--          SPEC-1/2) so the row EXISTS in public.feature_flags and is auditable
--          + flippable from the super-admin console. Default OFF / 0%.
--
--   ff_quiz_telemetry_v1
--     When ON: after a quiz is submitted, the platform emits post-submit
--     telemetry — per-answer learning_events and mastery_updated events
--     (SPEC-1/2). SPEC-3 intervention alerts are deferred and NOT gated by this
--     flag.
--     When OFF: NO post-submit telemetry is emitted — the submit path behaves
--     BYTE-IDENTICALLY to today (no learning_events / mastery_updated events from
--     the quiz path). Quiz scoring (P1), XP (P2), and atomic submission (P4) are
--     untouched: this flag only controls the additive telemetry side-effect.
--
-- ─── Default-OFF contract ─────────────────────────────────────────────────────
-- This migration seeds the row in the DISABLED state only:
--   is_enabled = FALSE, rollout_percentage = 0.
-- The read path (isFeatureEnabled in src/lib/feature-flags.ts) returns false for
-- both `is_enabled = false` AND `rollout_percentage <= 0`, so telemetry stays OFF
-- until an operator explicitly flips this flag via the super-admin console.
-- Seeding the row makes the flag visible/auditable — it does NOT enable the
-- behavior. Merging this migration is a zero-behavior change.
--
-- ─── Column shape ─────────────────────────────────────────────────────────────
-- Mirrors the established flag-seed precedent VERBATIM
-- (20260619000600_seed_ff_adaptive_loops_bc_v1.sql,
-- 20260619000300_seed_ff_adaptive_remediation_v1.sql, and
-- 20260619000100_seed_ff_school_pulse_v1.sql for the defensive to_regclass guard
-- + explicit column list + audit description). Scoping arrays are left NULL (no
-- role/env/institution narrowing) — the global is_enabled=false / rollout=0
-- double gate is what holds the flag OFF. Staging-first enablement. The explicit
-- column list (flag_name first) + ON CONFLICT (flag_name) DO NOTHING conform to
-- REG-125 (canonical feature_flags shape: flag_name/is_enabled, NOT name/enabled;
-- never DO UPDATE).
--
-- Idempotent. Safe to re-run: ON CONFLICT (flag_name) DO NOTHING (backed by the
-- feature_flags_flag_name_key unique constraint). The whole INSERT is additionally
-- guarded so it no-ops cleanly if the feature_flags table does not yet exist
-- (fresh DB / out-of-order apply), so the live-DB CI test and Supabase preview
-- branches never fail. No schema changes. Pure data seed. No new tables → RLS
-- N/A; the table keeps its existing baseline RLS posture.
--
-- Owner: architect (this seed) + ops (flag definition review + flip procedure) +
--        backend (quiz post-submit telemetry path gates against this exact flag
--        name, in parallel)
-- Added: 2026-06-15
--
-- ─── Reversible (manual DOWN) ─────────────────────────────────────────────────
--   DELETE FROM feature_flags WHERE flag_name = 'ff_quiz_telemetry_v1';
-- The application resolves a missing flag to OFF, so deletion is silent on the
-- production experience.

DO $quiz_telemetry$
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
      'ff_quiz_telemetry_v1',
      false,
      0,
      'Post-submit quiz telemetry: per-answer learning_events + mastery_updated events (SPEC-1/2). OFF by default; SPEC-3 intervention alerts deferred.',
      NULL,
      NULL,
      NULL,
      now(),
      now()
    )
    ON CONFLICT (flag_name) DO NOTHING;
  ELSE
    RAISE NOTICE 'feature_flags table absent; skipping ff_quiz_telemetry_v1 seed (fresh DB).';
  END IF;
END $quiz_telemetry$;
