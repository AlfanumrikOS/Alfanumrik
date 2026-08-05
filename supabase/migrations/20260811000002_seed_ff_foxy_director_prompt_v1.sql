-- Migration: 20260811000002_seed_ff_foxy_director_prompt_v1.sql
-- Purpose: Foxy North-Star Phase 4 — seed the feature flag
--   `ff_foxy_director_prompt_v1` (default OFF / 0%). Gates the
--   {{pedagogy_rules_section}} slot switch inside grounded-answer's
--   prompt builder that replaces the current hand-rolled pedagogy tree
--   with the Director prompt (ai-engineer-authored). OFF = today's
--   prompt, byte-for-byte.
--
-- Default-OFF contract: is_enabled = FALSE, rollout_percentage = 0.
-- Idempotent (ON CONFLICT DO NOTHING), to_regclass-guarded. Pure data
-- seed — no schema change, no new table, RLS N/A. Owner: architect.
-- Reviewers (P14): ai-engineer (prompt authorship), assessment (pedagogy
-- correctness), ops, testing. Added: 2026-08-05.
--
-- Reversible (manual DOWN):
--   DELETE FROM feature_flags WHERE flag_name = 'ff_foxy_director_prompt_v1';
-- A missing flag row resolves the same as is_enabled = false.

DO $ff_foxy_director_prompt_v1$
BEGIN
  IF to_regclass('public.feature_flags') IS NOT NULL THEN
    INSERT INTO public.feature_flags (
      flag_name, is_enabled, rollout_percentage, description,
      target_roles, target_environments, target_institutions,
      created_at, updated_at
    )
    VALUES (
      'ff_foxy_director_prompt_v1', false, 0,
      'Foxy North-Star Phase 4: gates the {{pedagogy_rules_section}} slot switch in grounded-answer''s prompt builder — swaps the hand-rolled pedagogy tree for the ai-engineer-authored Director prompt. OFF = current prompt unchanged. Default OFF; ops/CEO own the ramp after Wave-4 evaluation.',
      NULL, NULL, NULL, now(), now()
    )
    ON CONFLICT (flag_name) DO NOTHING;
  ELSE
    RAISE NOTICE 'feature_flags table absent; skipping ff_foxy_director_prompt_v1 seed (fresh DB).';
  END IF;
END $ff_foxy_director_prompt_v1$;
