-- Migration: 20260619000600_seed_ff_adaptive_loops_bc_v1.sql
-- Purpose: Seed the feature flag `ff_adaptive_loops_bc_v1` (Phase A Loops B &
--          C — inactivity re-engagement nudge + at-risk-concentration immediate
--          escalation, on the Loop A substrate) so the row EXISTS in
--          public.feature_flags and is auditable + flippable from the
--          super-admin console. Default OFF / 0%.
--
--   ff_adaptive_loops_bc_v1
--     When ON: the daily-cron inject phase ALSO evaluates the inactivity
--     ('broken' verdict) and at-risk-concentration ('high' band) Pulse signals
--     and opens adaptive_interventions rows for Loops B & C (Loop B = a
--     re-engagement nudge; Loop C = an immediate teacher/parent escalation).
--     This is a SEPARATE flag from ff_adaptive_remediation_v1 (Loop A): the two
--     ramp INDEPENDENTLY so ops can run proven Loop A without B/C, or roll back
--     B/C without touching A (spec Decision X1).
--     When OFF: NO new B/C injections (the inactivity + at_risk_concentration
--     inject branches short-circuit; the mastery_cliff branch still respects its
--     own ff_adaptive_remediation_v1 flag) — but mid-flight B/C interventions
--     still complete naturally: the verify phase is gated on the existence of
--     active rows, NOT this flag, so the kill switch DRAINS rather than freezes
--     (spec Section 9 kill-switch semantics; Decision X2). No student is left in
--     limbo.
--
-- Spec: docs/superpowers/specs/2026-06-13-phase-a-loops-b-c-design.md
--       (Sections 2 "flag-gated, default OFF", 5.3 "New feature flag",
--        9 "Validation & Rollout"; Decisions X1/X2).
--
-- ─── Default-OFF contract ─────────────────────────────────────────────────────
-- This migration seeds the row in the DISABLED state only:
--   is_enabled = FALSE, rollout_percentage = 0.
-- The read path (isFeatureEnabled in src/lib/feature-flags.ts) returns false for
-- both `is_enabled = false` AND `rollout_percentage <= 0`, so both loops stay OFF
-- until an operator explicitly flips this flag via the super-admin console.
-- Seeding the row makes the flag visible/auditable — it does NOT enable the
-- behavior. Merging this migration is a zero-behavior change (Loop A unaffected;
-- it reads a DIFFERENT flag).
--
-- ─── Column shape ─────────────────────────────────────────────────────────────
-- Mirrors the established flag-seed precedent VERBATIM
-- (20260619000300_seed_ff_adaptive_remediation_v1.sql and
-- 20260619000100_seed_ff_school_pulse_v1.sql for the defensive to_regclass guard
-- + explicit column list + audit description). Scoping arrays are left NULL (no
-- role/env/institution narrowing) — the global is_enabled=false / rollout=0
-- double gate is what holds the flag OFF. Staging-first enablement per the spec
-- rollout plan (synthetic 'broken'-inactivity + synthetic 'high'-band drills
-- before any prod flip). The explicit column list (flag_name first) + ON CONFLICT
-- (flag_name) DO NOTHING conform to REG-125 (canonical feature_flags shape:
-- flag_name/is_enabled, NOT name/enabled; never DO UPDATE).
--
-- Idempotent. Safe to re-run: ON CONFLICT (flag_name) DO NOTHING (backed by the
-- feature_flags flag_name unique constraint). The whole INSERT is additionally
-- guarded so it no-ops cleanly if the feature_flags table does not yet exist
-- (fresh DB / out-of-order apply), so the live-DB CI test and Supabase preview
-- branches never fail. No schema changes. Pure data seed. No new tables → RLS
-- N/A; the table keeps its existing baseline RLS posture.
--
-- Owner: architect (this seed, with the 20260619000500 CHECK-extension) + ops
--        (flag definition review + flip procedure/runbook) + backend (cron
--        inject branches gate against this exact flag name, in parallel)
-- Added: 2026-06-13
--
-- ─── Reversible (manual DOWN) ─────────────────────────────────────────────────
--   DELETE FROM feature_flags WHERE flag_name = 'ff_adaptive_loops_bc_v1';
-- The application resolves a missing flag to OFF, so deletion is silent on the
-- production experience (already-active B/C interventions still drain via the
-- verify phase, by design).

DO $adaptive_loops_bc$
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
      'ff_adaptive_loops_bc_v1',
      false,
      0,
      'Phase A Loops B & C adaptive closed loops on the Loop A substrate: Loop B (inactivity ''broken'' -> re-engagement nudge + return-window check + parent escalation on expiry, full-auto) and Loop C (at-risk-concentration ''high'' band -> IMMEDIATE teacher/parent escalation + band-drop verify + re-notify on expiry). SEPARATE flag from ff_adaptive_remediation_v1 (Loop A); ramps independently (Decision X1). Gates the inactivity + at_risk_concentration inject branches; the verify phase drains active B/C rows regardless of this flag (kill switch drains, does not freeze; Decision X2). Default off; staging-first. Spec: docs/superpowers/specs/2026-06-13-phase-a-loops-b-c-design.md',
      NULL,
      NULL,
      NULL,
      now(),
      now()
    )
    ON CONFLICT (flag_name) DO NOTHING;
  ELSE
    RAISE NOTICE 'feature_flags table absent; skipping ff_adaptive_loops_bc_v1 seed (fresh DB).';
  END IF;
END $adaptive_loops_bc$;
