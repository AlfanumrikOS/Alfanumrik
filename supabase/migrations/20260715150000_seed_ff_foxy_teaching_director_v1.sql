-- Migration: 20260715150000_seed_ff_foxy_teaching_director_v1.sql
-- Purpose: Seed the feature flag `ff_foxy_teaching_director_v1` (Phase 2.1 —
--          Foxy Teaching Director) so the row EXISTS in public.feature_flags
--          and is auditable + flippable from the super-admin console. Default
--          OFF / 0%.
--
--   ff_foxy_teaching_director_v1
--     When ON: on a Foxy TEACHING turn (learn/explain/revise/doubt/homework/
--     explorer — NOT the MCQ-emitting quiz_me / practice turns), the /api/foxy
--     route composes a deterministic teaching plan from the already-loaded
--     learner state (composeTeachingPlan, packages/lib/src/foxy/teaching-
--     director.ts), injects it as an ADDITIVE directive appended to the
--     grounded-answer request's cognitive_context_section (the reliably-
--     rendered slot the Digital Twin already uses), advances a per-session
--     lesson step (persisted to foxy_sessions.lesson_step / lesson_objective_
--     concept_id, migration 20260715140000), and returns a context-aware
--     `suggestedButtons` + `nextActions` set on the success wire response.
--     When OFF (default): the Director block is skipped entirely — the directive
--     section is '', no lesson step is read or written, and the grounded request
--     + wire shape are BYTE-IDENTICAL to today. The Director never touches the
--     RAG / grounding / abstain / structured-validation path (P12).
--
-- Spec/plan: Foxy Teaching Director Phase 2.1 wiring (pure module
--            packages/lib/src/foxy/teaching-director.ts + migration
--            20260715140000_foxy_sessions_lesson_state.sql).
--
-- ─── Default-OFF contract ─────────────────────────────────────────────────────
-- This migration seeds the row in the DISABLED state only:
--   is_enabled = FALSE, rollout_percentage = 0.
-- The read path (isFeatureEnabled in src/lib/feature-flags.ts) returns false for
-- both `is_enabled = false` AND `rollout_percentage <= 0`, so the Director stays
-- OFF until an operator explicitly flips this flag via the super-admin console.
-- Seeding the row makes the flag visible/auditable — it does NOT enable the
-- behavior. Merging this migration is a zero-behavior change.
--
-- ─── Column shape (REG-125) ───────────────────────────────────────────────────
-- Mirrors the established flag-seed precedent VERBATIM
-- (20260715130000_seed_ff_foxy_perception_v1.sql,
-- 20260619000600_seed_ff_adaptive_loops_bc_v1.sql,
-- 20260619000100_seed_ff_school_pulse_v1.sql for the defensive to_regclass guard
-- + explicit column list + audit description). Scoping arrays are left NULL (no
-- role/env/institution narrowing) — the global is_enabled=false / rollout=0
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
-- Owner: ai-engineer (route wiring + this seed). Reviewers (P14): assessment
--        (pedagogy correctness), testing, frontend (renders suggestedButtons).
-- Added: 2026-07-15
--
-- ─── Reversible (manual DOWN) ─────────────────────────────────────────────────
--   DELETE FROM feature_flags WHERE flag_name = 'ff_foxy_teaching_director_v1';
-- The application resolves a missing flag to OFF, so deletion is silent on the
-- production experience (byte-identical to today).

DO $foxy_teaching_director$
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
      'ff_foxy_teaching_director_v1',
      false,
      0,
      'Phase 2.1 Foxy Teaching Director: on a teaching turn (learn/explain/revise/doubt/homework/explorer) the /api/foxy route composes a deterministic teaching plan (composeTeachingPlan) from already-loaded learner state, injects it as an ADDITIVE directive appended to the cognitive_context_section template variable, advances a per-session lesson step (foxy_sessions.lesson_step / lesson_objective_concept_id), and returns suggestedButtons + nextActions on the wire. Additive only — never touches the RAG/grounding/abstain/structured-validation path (P12). Default off; OFF is byte-identical to today. Pure module: packages/lib/src/foxy/teaching-director.ts.',
      NULL,
      NULL,
      NULL,
      now(),
      now()
    )
    ON CONFLICT (flag_name) DO NOTHING;
  ELSE
    RAISE NOTICE 'feature_flags table absent; skipping ff_foxy_teaching_director_v1 seed (fresh DB).';
  END IF;
END $foxy_teaching_director$;
