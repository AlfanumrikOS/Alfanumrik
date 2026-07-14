-- Migration: 20260715130000_seed_ff_foxy_perception_v1.sql
-- Purpose: Seed the feature flag `ff_foxy_perception_v1` (Foxy per-turn
--          PERCEPTION classifier — the "sensor" that turns each tutoring turn
--          into structured observability signal: topic / Bloom / misconception
--          / struggle / intent) so the row EXISTS in public.feature_flags and
--          is auditable + flippable from the super-admin console. Default
--          OFF / 0%.
--
--   ff_foxy_perception_v1
--     When ON: after building the reply, the /api/foxy route fires the per-turn
--     perception classifier FIRE-AND-FORGET (never blocking/affecting the
--     student's answer). The LLM classification runs ONLY on the Python MOL
--     service (POST /v1/classify, cheap gpt-4o-mini evaluation task); on a
--     non-null result the route publishes a `learner.turn_classified`
--     OBSERVABILITY event (codes/ids/enums only, no student text — P13). This is
--     pure observability: it NEVER writes a mastery surface (P1/P2/P3 untouched).
--     ADDITIONALLY GATED BY INFRA: even with this flag ON, perception is a no-op
--     until `PYTHON_AI_BASE_URL` is wired in (the Node client returns null when
--     it is empty) — so the feature is fully dark in production until BOTH the
--     flag is ON and Python infra is configured.
--     When OFF: the /api/foxy flow is BYTE-IDENTICAL to today — the entire
--     perception step (flag read, Python classify call, publish) lives inside a
--     single fire-and-forget async block that returns immediately when the flag
--     resolves OFF: no classifier call, no extra latency on the reply, no DB
--     write, no event. The `learner.turn_classified` event kind (already in the
--     event registry) simply never fires.
--
-- Plan: Foxy Intelligent Learning OS, Phase 1C ("Perception classifier").
--       AI-tutor behavior change — standard downstream reviewers apply
--       (assessment: classification semantics + curriculum scope + Bloom/
--       misconception mapping; testing).
--
-- ─── Default-OFF contract ─────────────────────────────────────────────────────
-- This migration seeds the row in the DISABLED state only:
--   is_enabled = FALSE, rollout_percentage = 0.
-- The read path (isFeatureEnabled in packages/lib/src/feature-flags.ts) returns
-- false for both `is_enabled = false` AND `rollout_percentage <= 0`, so
-- perception stays OFF until an operator explicitly flips this flag via the
-- super-admin console. Seeding the row makes the flag visible/auditable — it
-- does NOT enable the behavior. Merging this migration is a zero-behavior change
-- (the /api/foxy flow renders byte-identically while the flag resolves OFF).
--
-- ─── Column shape (REG-125) ───────────────────────────────────────────────────
-- Mirrors the established flag-seed precedent VERBATIM
-- (20260715000200_seed_ff_foxy_real_practice_v1.sql,
-- 20260619000800_seed_ff_foxy_math_pipeline_v1.sql,
-- 20260619000100_seed_ff_school_pulse_v1.sql for the defensive to_regclass guard
-- + explicit column list + audit description). The canonical feature_flags
-- columns are `flag_name` (UNIQUE) + `is_enabled` — NOT `name`/`enabled`
-- (baseline 00000000000000_baseline_from_prod.sql; feature_flags_flag_name_key
-- UNIQUE). The explicit column list (flag_name first) + ON CONFLICT (flag_name)
-- DO NOTHING conform to REG-125 (canonical feature_flags shape; never DO UPDATE
-- — so a pre-existing operator-set state is preserved on re-run). Scoping arrays
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
-- This migration adds NO new table. Perception is event/compute-only: the
-- classifier runs in the Python AI service (POST /v1/classify), the Node route
-- calls it fire-and-forget, and the result is published to the EXISTING
-- state_events bus via the EXISTING `learner.turn_classified` event kind. No new
-- tables → RLS N/A for this migration.
--
-- Owner: ai-engineer (Node client + perception orchestrator + Python
--        /v1/classify endpoint + route wiring) + assessment (classification
--        semantics review) + testing.
-- Added: 2026-07-15
--
-- ─── Reversible (manual DOWN) ─────────────────────────────────────────────────
--   DELETE FROM feature_flags WHERE flag_name = 'ff_foxy_perception_v1';
-- The application resolves a missing flag to OFF, so deletion is silent on the
-- production experience (the /api/foxy flow falls back to no perception).

DO $foxy_perception$
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
      'ff_foxy_perception_v1',
      false,
      0,
      'Foxy per-turn PERCEPTION classifier: after building the reply, /api/foxy fires a fire-and-forget classifier (never blocks/affects the student answer) that runs ONLY on the Python MOL service (POST /v1/classify, cheap gpt-4o-mini evaluation task) and publishes a learner.turn_classified OBSERVABILITY event (topic/Bloom/misconception/struggle/intent; codes/ids/enums only, no student text — P13). Pure observability; never writes a mastery surface (P1/P2/P3 untouched). Additionally dark until PYTHON_AI_BASE_URL is wired in (the Node client no-ops when it is empty). OFF = /api/foxy byte-identical to today (no classifier call, no extra latency, no DB write, no event). Default off; staging-first. Plan: Foxy Intelligent Learning OS, Phase 1C.',
      NULL,
      NULL,
      NULL,
      now(),
      now()
    )
    ON CONFLICT (flag_name) DO NOTHING;
  ELSE
    RAISE NOTICE 'feature_flags table absent; skipping ff_foxy_perception_v1 seed (fresh DB).';
  END IF;
END $foxy_perception$;
