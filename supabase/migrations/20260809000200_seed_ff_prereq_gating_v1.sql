-- Migration: 20260809000200_seed_ff_prereq_gating_v1.sql
-- Purpose: Foxy North-Star Phase 3 (CEO-approved A6) — seed the feature flag
--   `ff_prereq_gating_v1` (default OFF / 0%).
--
--   ff_prereq_gating_v1
--     Gates prerequisite-aware gating in the learn path: when ON, the
--     selector/orchestrator may consult the concept_edges prerequisite graph
--     (traverse_prerequisites, 20260702000400) and concept_mastery to steer a
--     student toward unmastered prerequisites before serving dependent
--     topics. OFF (this seed) = today's behavior, byte-for-byte. Consumption
--     lands in later Phase-3 TS changes (assessment/ai-engineer owned); this
--     seed only makes the row exist, auditable, and flippable.
--
-- Default-OFF contract: is_enabled = FALSE, rollout_percentage = 0 — both
-- independently guarantee the no-op seed state. Idempotent (ON CONFLICT DO
-- NOTHING), to_regclass-guarded. Pure data seed — no schema change, no new
-- table, RLS N/A. Owner: architect. Reviewers (P14): assessment (gating
-- pedagogy), ai-engineer, ops, testing. Added: 2026-08-05.
--
-- Reversible (manual DOWN):
--   DELETE FROM feature_flags WHERE flag_name = 'ff_prereq_gating_v1';
-- A missing flag row resolves the same as is_enabled = false.

DO $ff_prereq_gating_v1$
BEGIN
  IF to_regclass('public.feature_flags') IS NOT NULL THEN
    INSERT INTO public.feature_flags (
      flag_name, is_enabled, rollout_percentage, description,
      target_roles, target_environments, target_institutions,
      created_at, updated_at
    )
    VALUES (
      'ff_prereq_gating_v1', false, 0,
      'Foxy North-Star Phase 3: prerequisite-aware gating in the learn path (consult concept_edges via traverse_prerequisites + concept_mastery to steer toward unmastered prerequisites first). OFF = current behavior unchanged. Default OFF; ops/CEO own the ramp after Phase-3 evaluation.',
      NULL, NULL, NULL, now(), now()
    )
    ON CONFLICT (flag_name) DO NOTHING;
  ELSE
    RAISE NOTICE 'feature_flags table absent; skipping ff_prereq_gating_v1 seed (fresh DB).';
  END IF;
END $ff_prereq_gating_v1$;
