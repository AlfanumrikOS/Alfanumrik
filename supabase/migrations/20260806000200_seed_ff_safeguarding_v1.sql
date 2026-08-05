-- Migration: 20260806000200_seed_ff_safeguarding_v1.sql
-- Purpose: Seed the feature flag `ff_safeguarding_v1` (Foxy North-Star Phase 1,
--          S5.6/U6 safeguarding flow) so the row EXISTS in public.feature_flags
--          and is auditable + flippable from the super-admin console.
--          Default OFF / 0%.
--
--   ff_safeguarding_v1
--     When ON: the pre-LLM disclosure-classifier stage in the Foxy pipeline is
--     active (self_harm / abuse / violence / acute_distress detection), rows
--     are written to safeguarding_escalations (20260806000100), the routing
--     worker notifies designated adults per the approved A1 policy, and the
--     student receives the age-appropriate support response (Childline 1098).
--     When OFF: the classifier stage short-circuits — no new escalation rows,
--     no routing, Foxy behavior unchanged. Already-written escalation rows
--     remain reviewable through both review lanes regardless of this flag —
--     the school-admin lane gated by safeguarding.review (granted to
--     institution_admin, migration 20260806000100) and the super-admin lane
--     gated by authorizeAdmin('admin') per house convention. (The review
--     surface is not flag-gated: a kill switch must never hide an open
--     child-safety escalation from its reviewer.)
--
-- Spec: docs/superpowers/specs/2026-08-05-foxy-north-star-alignment-design.md
--       (S1.7 -> S5.6 build; U6 row; approval A1 APPROVED 2026-08-05;
--        risk register: "Safeguarding false pos/neg -> conservative
--        thresholds, human review, staged rollout, policy sign-off first").
--
-- ─── Default-OFF contract ─────────────────────────────────────────────────────
-- This migration seeds the row in the DISABLED state only:
--   is_enabled = FALSE, rollout_percentage = 0.
-- The read path (isFeatureEnabled in packages/lib/src/feature-flags.ts) returns
-- false for both `is_enabled = false` AND `rollout_percentage <= 0`, so the
-- classifier stays OFF until an operator explicitly flips this flag via the
-- super-admin console (staged rollout after policy sign-off, per the spec's
-- risk register). Seeding the row makes the flag visible/auditable — it does
-- NOT enable the behavior. Merging this migration is a zero-behavior change.
--
-- ─── Column shape ─────────────────────────────────────────────────────────────
-- Mirrors the established flag-seed precedent VERBATIM
-- (20260619000600_seed_ff_adaptive_loops_bc_v1.sql: defensive to_regclass guard
-- + explicit column list + audit description). Scoping arrays left NULL — the
-- global is_enabled=false / rollout=0 double gate holds the flag OFF. The
-- explicit column list (flag_name first) + ON CONFLICT (flag_name) DO NOTHING
-- conform to REG-125 (canonical feature_flags shape: flag_name/is_enabled, NOT
-- name/enabled; never DO UPDATE).
--
-- Idempotent. Safe to re-run: ON CONFLICT (flag_name) DO NOTHING (backed by the
-- feature_flags flag_name unique constraint). The whole INSERT is additionally
-- guarded so it no-ops cleanly if the feature_flags table does not yet exist
-- (fresh DB / out-of-order apply). No schema changes. Pure data seed. No new
-- tables -> RLS N/A.
--
-- Owner: architect (this seed) + ai-engineer (classifier stage, in a parallel
--        Phase 1 PR) + ops (flip procedure / staged rollout).
-- Added: 2026-08-05
--
-- ─── Reversible (manual DOWN) ─────────────────────────────────────────────────
--   DELETE FROM feature_flags WHERE flag_name = 'ff_safeguarding_v1';
-- The application resolves a missing flag to OFF, so deletion is silent on the
-- production experience (existing escalation rows stay reviewable, by design).

DO $safeguarding_v1$
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
      'ff_safeguarding_v1',
      false,
      0,
      'Foxy safeguarding flow (S5.6/U6): pre-LLM disclosure classifier (self_harm/abuse/violence/acute_distress) -> safeguarding_escalations rows -> routing worker -> human review lanes (school-admin lane gated by safeguarding.review; super-admin lane by authorizeAdmin admin-level per house convention). When OFF the classifier stage short-circuits (no new escalations, Foxy unchanged); the review lanes stay open regardless so a kill switch never hides an open child-safety escalation. Default off; staged rollout after policy sign-off per approval A1. Spec: docs/superpowers/specs/2026-08-05-foxy-north-star-alignment-design.md',
      NULL,
      NULL,
      NULL,
      now(),
      now()
    )
    ON CONFLICT (flag_name) DO NOTHING;
  ELSE
    RAISE NOTICE 'feature_flags table absent; skipping ff_safeguarding_v1 seed (fresh DB).';
  END IF;
END $safeguarding_v1$;
