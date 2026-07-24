-- Migration: 20260724170000_seed_ff_lesson_generation_v1.sql
-- Purpose: Seed the feature flag `ff_lesson_generation_v1` (GenAI ecosystem
--          Phase 5b — student-facing Lesson Generation Agent) so the row EXISTS
--          in public.feature_flags and is auditable + flippable from the
--          super-admin console. Default OFF / 0%.
--
--   ff_lesson_generation_v1
--     When ON: the student-facing Lesson Generation Agent endpoint is permitted
--     to synthesise and serve a generated lesson (NCERT-grounded lesson notes)
--     for a student. The lesson endpoint reads the student's existing memory via
--     getStudentMemory and grounds generation through callGroundedAnswer against
--     the existing RAG corpus. This is the staged rollout seam for Phase 5b of
--     the GenAI blueprint.
--     When OFF (default): NO generated lesson is served — the endpoint
--     short-circuits before touching any data source or invoking generation.
--     Merging + wiring the endpoint is a zero-behavior change while this flag is
--     OFF.
--
-- Spec: docs/superpowers/specs/2026-07-24-lesson-generation-agent-design.md
--       (GenAI Phase 5b — Lesson Generation Agent). Umbrella reference:
--       docs/superpowers/specs/2026-07-24-genai-ecosystem-architecture.md.
--
-- ─── Read-only substrate (no new table/RLS in this increment) ────────────────
-- This increment introduces NO new table, NO new RLS, and NO schema change.
-- The lesson endpoint composes over EXISTING substrate only:
--   - getStudentMemory: reads the already-existing unified/learner memory the
--     platform already exposes (per-student self read via the RLS-scoped server
--     client; cross-student reads must gate through the canAccessStudent +
--     service-role Pulse pattern, same as the other read-only agents).
--   - callGroundedAnswer: invokes the existing grounded-answer Edge Function
--     against the existing RAG corpus. No new persistence is created by this seed.
-- NO new table, NO new RLS, and NO schema change is required here.
--
-- ─── Default-OFF contract ─────────────────────────────────────────────────────
-- This migration seeds the row in the DISABLED state only:
--   is_enabled = FALSE, rollout_percentage = 0.
-- The read path (isFeatureEnabled in src/lib/feature-flags.ts) returns false for
-- both `is_enabled = false` AND `rollout_percentage <= 0`, so the Lesson
-- Generation Agent endpoint stays OFF until an operator explicitly flips this
-- flag via the super-admin console. Seeding the row makes the flag
-- visible/auditable — it does NOT enable the behavior. Merging this migration is
-- a zero-behavior change.
--
-- This is NOT a constitution-pinned / protected flag: it is a staged rollout of
-- an additive seam and behaves like the other default-OFF staged flags
-- (ff_school_pulse_v1, ff_adaptive_remediation_v1, ff_adaptive_loops_bc_v1,
-- ff_model_gateway_v1, ff_unified_memory_v1, ff_response_eval_v1,
-- ff_outcome_prediction_v1). Ops may need to add 'ff_lesson_generation_v1' to
-- EXPECTED_OFF_FLAGS in packages/lib/src/flags/protected-flags.ts (ops-owned) so
-- the default-OFF canary accounts for the new row — flagged to ops; not edited
-- here.
--
-- ─── Column shape (REG-125) ───────────────────────────────────────────────────
-- Mirrors the established flag-seed precedent VERBATIM
-- (20260724150000_seed_ff_outcome_prediction_v1.sql,
-- 20260724140000_seed_ff_response_eval_v1.sql,
-- 20260724130000_seed_ff_unified_memory_v1.sql,
-- 20260724120000_seed_ff_model_gateway_v1.sql for the defensive to_regclass
-- guard + explicit column list + audit description). Scoping arrays are left NULL
-- (no role/env/institution narrowing) — the global is_enabled=false / rollout=0
-- double gate is what holds the flag OFF. The explicit column list (flag_name
-- first) + ON CONFLICT (flag_name) DO NOTHING conform to REG-125 (canonical
-- feature_flags shape: flag_name/is_enabled, NOT name/enabled; never DO UPDATE).
--
-- Idempotent. Safe to re-run: ON CONFLICT (flag_name) DO NOTHING (backed by the
-- feature_flags flag_name unique constraint). The whole INSERT is additionally
-- guarded so it no-ops cleanly if the feature_flags table does not yet exist
-- (fresh DB / out-of-order apply), so the live-DB CI test and Supabase preview
-- branches never fail. No schema changes. Pure data seed. No new tables → RLS
-- N/A; the table keeps its existing baseline RLS posture.
--
-- Owner: architect (this seed) + ai-engineer (lesson agent + grounded-answer
--        prompt-template/caller registration under
--        supabase/functions/grounded-answer/**) + backend (the lesson API route)
--        + ops (flag definition review + flip procedure/runbook +
--        EXPECTED_OFF_FLAGS canary entry).
-- Added: 2026-07-24
--
-- ─── Reversible (manual DOWN) ─────────────────────────────────────────────────
--   DELETE FROM feature_flags WHERE flag_name = 'ff_lesson_generation_v1';
-- The application resolves a missing flag to OFF, so deletion is silent on the
-- production experience (byte-identical to today's no-generated-lesson behavior).

DO $lesson_generation$
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
      'ff_lesson_generation_v1',
      false,
      0,
      'Gates the student-facing Lesson Generation Agent (GenAI Phase 5b). OFF = no generated lesson served.',
      NULL,
      NULL,
      NULL,
      now(),
      now()
    )
    ON CONFLICT (flag_name) DO NOTHING;
  ELSE
    RAISE NOTICE 'feature_flags table absent; skipping ff_lesson_generation_v1 seed (fresh DB).';
  END IF;
END $lesson_generation$;
