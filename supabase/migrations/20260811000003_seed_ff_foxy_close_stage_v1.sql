-- Migration: 20260811000003_seed_ff_foxy_close_stage_v1.sql
-- Purpose: Foxy North-Star Phase 4 — seed the feature flag
--   `ff_foxy_close_stage_v1` (default OFF / 0%). Gates an ADDITIVE
--   `close` payload on Foxy responses (the summarize / check-for-
--   understanding stage that follows the answer body). OFF = today's
--   response envelope unchanged; ON = the close block is appended
--   without altering existing fields. Consumers (FoxyPanel + mobile)
--   ignore unknown fields, so the flag is safe to ramp independent of
--   client rollout.
--
-- Default-OFF contract: is_enabled = FALSE, rollout_percentage = 0.
-- Idempotent (ON CONFLICT DO NOTHING), to_regclass-guarded. Pure data
-- seed — no schema change, no new table, RLS N/A. Owner: architect.
-- Reviewers (P14): ai-engineer (payload shape), frontend (UI render),
-- mobile (parity), ops, testing. Added: 2026-08-05.
--
-- Reversible (manual DOWN):
--   DELETE FROM feature_flags WHERE flag_name = 'ff_foxy_close_stage_v1';

DO $ff_foxy_close_stage_v1$
BEGIN
  IF to_regclass('public.feature_flags') IS NOT NULL THEN
    INSERT INTO public.feature_flags (
      flag_name, is_enabled, rollout_percentage, description,
      target_roles, target_environments, target_institutions,
      created_at, updated_at
    )
    VALUES (
      'ff_foxy_close_stage_v1', false, 0,
      'Foxy North-Star Phase 4: gates the additive `close` payload (summarize + check-for-understanding stage) on Foxy responses. Additive-only; existing fields untouched. Default OFF; ops/CEO own the ramp.',
      NULL, NULL, NULL, now(), now()
    )
    ON CONFLICT (flag_name) DO NOTHING;
  ELSE
    RAISE NOTICE 'feature_flags table absent; skipping ff_foxy_close_stage_v1 seed (fresh DB).';
  END IF;
END $ff_foxy_close_stage_v1$;
