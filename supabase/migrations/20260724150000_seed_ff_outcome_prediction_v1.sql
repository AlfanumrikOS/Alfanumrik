-- Migration: 20260724150000_seed_ff_outcome_prediction_v1.sql
-- Purpose: Seed the feature flag `ff_outcome_prediction_v1` (GenAI ecosystem
--          Phase 5a — read-only Outcome Prediction Agent endpoint) so the row
--          EXISTS in public.feature_flags and is auditable + flippable from the
--          super-admin console. Default OFF / 0%.
--
--   ff_outcome_prediction_v1
--     When ON: the read-only Outcome Prediction Agent endpoint is permitted to
--     serve a per-student outcome prediction (pass/outcome likelihood expressed
--     over EXISTING bands) synthesised from already-computed data sources
--     (board_score_predictions, cme_exam_readiness, cbse_chapter_weights,
--     concept_mastery / cme_concept_state). This is the staged rollout seam for
--     Phase 5a of the GenAI blueprint. The agent is STRICTLY READ-ONLY — it
--     never writes board_score_predictions / cme_exam_readiness (owned by the
--     cron/edge functions) nor any mastery table.
--     When OFF (default): NO prediction is served — the endpoint short-circuits
--     before touching any data source. Merging + wiring the endpoint is a
--     zero-behavior change while this flag is OFF.
--
-- Spec: docs/superpowers/specs/2026-07-24-genai-ecosystem-architecture.md
--       (GenAI Phase 5a — Outcome Prediction Agent).
--
-- ─── Read-only contract (no new table/RLS in this increment) ─────────────────
-- The endpoint only READS existing tables. Its correct read pattern is captured
-- in the architect ruling accompanying this seed; in brief:
--   - board_score_predictions: RLS has student-self SELECT + guardian(approved)
--     SELECT + admin/super_admin SELECT + service_role ALL. A per-student read
--     via the RLS-scoped server client is sufficient for the student's own
--     prediction (no IDOR). Cross-student reads (teacher/parent surfaces) must
--     gate through an upstream canAccessStudent check + service role (Pulse
--     pattern) because there is NO teacher SELECT policy on this table.
--   - cme_exam_readiness: RLS has ONLY student-self SELECT (cme_readiness_own)
--     + service_role ALL (cme_readiness_service). No guardian, no teacher, no
--     admin SELECT. Per-student self read via the RLS-scoped server client is
--     sufficient; any cross-student read MUST use the canAccessStudent +
--     service-role Pulse pattern.
-- NO new table, NO new RLS, and NO schema change is required here.
--
-- ─── Default-OFF contract ─────────────────────────────────────────────────────
-- This migration seeds the row in the DISABLED state only:
--   is_enabled = FALSE, rollout_percentage = 0.
-- The read path (isFeatureEnabled in src/lib/feature-flags.ts) returns false for
-- both `is_enabled = false` AND `rollout_percentage <= 0`, so the Outcome
-- Prediction Agent endpoint stays OFF until an operator explicitly flips this
-- flag via the super-admin console. Seeding the row makes the flag
-- visible/auditable — it does NOT enable the behavior. Merging this migration is
-- a zero-behavior change.
--
-- This is NOT a constitution-pinned / protected flag: it is a staged rollout of
-- an additive read-only seam and behaves like the other default-OFF staged flags
-- (ff_school_pulse_v1, ff_adaptive_remediation_v1, ff_adaptive_loops_bc_v1,
-- ff_model_gateway_v1, ff_unified_memory_v1, ff_response_eval_v1). Ops may need
-- to add 'ff_outcome_prediction_v1' to EXPECTED_OFF_FLAGS in
-- packages/lib/src/flags/protected-flags.ts (ops-owned) so the default-OFF canary
-- accounts for the new row — flagged to ops; not edited here.
--
-- ─── Column shape (REG-125) ───────────────────────────────────────────────────
-- Mirrors the established flag-seed precedent VERBATIM
-- (20260724140000_seed_ff_response_eval_v1.sql,
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
-- Owner: architect (this seed) + assessment (prediction rules under
--        packages/lib/src/predict/**) + backend (the read-only API route) +
--        ai-engineer (agent registry entry) + ops (flag definition review + flip
--        procedure/runbook + EXPECTED_OFF_FLAGS canary entry).
-- Added: 2026-07-24
--
-- ─── Reversible (manual DOWN) ─────────────────────────────────────────────────
--   DELETE FROM feature_flags WHERE flag_name = 'ff_outcome_prediction_v1';
-- The application resolves a missing flag to OFF, so deletion is silent on the
-- production experience (byte-identical to today's no-prediction behavior).

DO $outcome_prediction$
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
      'ff_outcome_prediction_v1',
      false,
      0,
      'Gates the read-only Outcome Prediction Agent endpoint (GenAI Phase 5a). OFF = no prediction served.',
      NULL,
      NULL,
      NULL,
      now(),
      now()
    )
    ON CONFLICT (flag_name) DO NOTHING;
  ELSE
    RAISE NOTICE 'feature_flags table absent; skipping ff_outcome_prediction_v1 seed (fresh DB).';
  END IF;
END $outcome_prediction$;
