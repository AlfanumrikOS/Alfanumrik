-- Migration: 20260619000300_seed_ff_adaptive_remediation_v1.sql
-- Purpose: Seed the feature flag `ff_adaptive_remediation_v1` (Phase A Loop A —
--          adaptive closed loop, CEO-approved TIERED authority model 3) so the
--          row EXISTS in public.feature_flags and is auditable + flippable
--          from the super-admin console. Default OFF / 0%.
--
--   ff_adaptive_remediation_v1
--     When ON: the daily-cron inject step evaluates mastery-cliff signals and
--     auto-injects targeted remediation interventions (adaptive_interventions
--     rows, created by 20260619000200), and /api/rhythm/today composes the
--     remediation lane for active rows.
--     When OFF: NO new injections (the inject step short-circuits; the rhythm
--     lane renders empty) — but mid-flight interventions still complete
--     naturally: the verify cron step is gated on the existence of active
--     rows, NOT this flag, so the kill switch DRAINS rather than freezes
--     (spec Section 9 kill-switch semantics). No student is left in limbo.
--
-- Spec: docs/superpowers/specs/2026-06-12-phase-a-loop-a-adaptive-remediation-design.md
--       (Sections 2 "flag-gated, default OFF", 9 "Validation & Rollout").
--
-- ─── Default-OFF contract ─────────────────────────────────────────────────────
-- This migration seeds the row in the DISABLED state only:
--   is_enabled = FALSE, rollout_percentage = 0.
-- The read path (isFeatureEnabled in src/lib/feature-flags.ts) returns false for
-- both `is_enabled = false` AND `rollout_percentage <= 0`, so the loop stays OFF
-- until an operator explicitly flips this flag via the super-admin console.
-- Seeding the row makes the flag visible/auditable — it does NOT enable the
-- behavior. Merging this migration is a zero-behavior change.
--
-- ─── Column shape ─────────────────────────────────────────────────────────────
-- Mirrors the established flag-seed precedent
-- (20260619000100_seed_ff_school_pulse_v1.sql for the defensive to_regclass
-- guard + audit description; 20260611000100_seed_ff_school_admin_rbac_flag.sql
-- for the OFF/NULL-scoping semantics). Scoping arrays are left NULL (no
-- role/env/institution narrowing) — the global is_enabled=false / rollout=0
-- double gate is what holds the flag OFF. Staging-first enablement per the
-- spec rollout plan (synthetic-cliff drill before any prod flip).
--
-- Idempotent. Safe to re-run: ON CONFLICT (flag_name) DO NOTHING (backed by the
-- feature_flags flag_name unique constraint). The whole INSERT is additionally
-- guarded so it no-ops cleanly if the feature_flags table does not yet exist
-- (fresh DB / out-of-order apply), so the live-DB CI test and Supabase preview
-- branches never fail. No schema changes. Pure data seed. No new tables → RLS
-- N/A; the table keeps its existing baseline RLS posture.
--
-- Owner: architect (this seed, with the 20260619000200 data layer) + ops
--        (flag definition review + flip procedure/runbook) + backend (cron
--        steps + routes gate against this exact flag name, in parallel)
-- Added: 2026-06-12
--
-- ─── Reversible (manual DOWN) ─────────────────────────────────────────────────
--   DELETE FROM feature_flags WHERE flag_name = 'ff_adaptive_remediation_v1';
-- The application resolves a missing flag to OFF, so deletion is silent on the
-- production experience (already-active interventions still drain via the
-- verify cron, by design).

DO $adaptive_remediation$
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
      'ff_adaptive_remediation_v1',
      false,
      0,
      'Phase A Loop A adaptive closed loop: mastery-cliff auto-remediation injection + recovery verification (TIERED authority, CEO-approved 2026-06-12). Gates the daily-cron inject step and the /api/rhythm/today remediation lane; the verify step drains active rows regardless of this flag (kill switch drains, does not freeze). Default off; staging-first. Spec: docs/superpowers/specs/2026-06-12-phase-a-loop-a-adaptive-remediation-design.md',
      NULL,
      NULL,
      NULL,
      now(),
      now()
    )
    ON CONFLICT (flag_name) DO NOTHING;
  ELSE
    RAISE NOTICE 'feature_flags table absent; skipping ff_adaptive_remediation_v1 seed (fresh DB).';
  END IF;
END $adaptive_remediation$;
