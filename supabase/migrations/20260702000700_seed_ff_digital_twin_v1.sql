-- Migration: 20260702000700_seed_ff_digital_twin_v1.sql
-- Purpose: Seed the feature flag `ff_digital_twin_v1` (Digital Twin + Knowledge
--          Graph, Slice 1) so the row EXISTS in public.feature_flags and is
--          auditable + flippable from the super-admin console. Default OFF / 0%.
--
--   ff_digital_twin_v1
--     Master switch for the Digital Twin + Knowledge Graph behaviors built on the
--     concept_edges unified graph + learner_twin_snapshots/_memory substrate and
--     the traverse_prerequisites / detect_blocked_dependents RPCs. When OFF, none
--     of the twin surfaces/consumers run; the additive concept_edges branch of
--     detect_knowledge_gaps and the 'prerequisite_aware' generate_learning_path
--     path type are simply not invoked by flag-gated callers. Default: false.
--
-- ─── Default-OFF contract ─────────────────────────────────────────────────────
-- Seeds the row DISABLED only: is_enabled = FALSE, rollout_percentage = 0. The
-- read path (isFeatureEnabled in src/lib/feature-flags.ts) returns false for both
-- is_enabled=false AND rollout_percentage<=0, so the flag stays OFF until an
-- operator explicitly flips it. Seeding the row makes the flag visible/auditable
-- -- it does NOT enable any behavior. Zero-behavior change on merge.
--
-- ─── Column shape ─────────────────────────────────────────────────────────────
-- Mirrors the established flag-seed precedent VERBATIM
-- (20260619000600_seed_ff_adaptive_loops_bc_v1.sql): defensive to_regclass guard,
-- explicit column list (flag_name first), scoping arrays NULL, ON CONFLICT
-- (flag_name) DO NOTHING (REG-125 canonical shape; never DO UPDATE).
--
-- Idempotent. Safe to re-run. Guarded so it no-ops cleanly if feature_flags does
-- not yet exist (fresh DB / out-of-order apply). No schema changes. Pure data seed.
-- No new tables -> RLS N/A.
--
-- Reversible (manual DOWN):
--   DELETE FROM feature_flags WHERE flag_name = 'ff_digital_twin_v1';

DO $digital_twin$
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
      'ff_digital_twin_v1',
      false,
      0,
      'Digital Twin + Knowledge Graph (Slice 1). Master switch for the learner digital-twin behaviors built on the concept_edges unified prerequisite graph + learner_twin_snapshots/learner_twin_memory substrate and the traverse_prerequisites / detect_blocked_dependents RPCs. When OFF, no twin surface/consumer runs and the additive concept_edges branches of detect_knowledge_gaps + the prerequisite_aware generate_learning_path path type are not invoked by flag-gated callers. Default off; staging-first. Migrations: 20260702000100..20260702000600.',
      NULL,
      NULL,
      NULL,
      now(),
      now()
    )
    ON CONFLICT (flag_name) DO NOTHING;
  ELSE
    RAISE NOTICE 'feature_flags table absent; skipping ff_digital_twin_v1 seed (fresh DB).';
  END IF;
END $digital_twin$;
