-- Migration: Register v1 submit_quiz_results deprecation gate flag
-- P0-1 remediation (audit 2026-08-07) — REBUILT against real schema.
--
-- The v1 RPC reads live question_bank.correct_answer_index at submission time,
-- making scores non-reproducible after content edits. The correct fix is:
--   1. Register an ops-visible kill-switch flag (below, schema-verified).
--   2. Block v1 at the application gateway level — packages/lib/src/supabase.ts
--      submitQuizResults() now calls ONLY submit_quiz_results_v2 (no v1 fallback).
--   3. Do NOT rewrite the ~900-line v1 RPC body (risk of corrupting scoring).
--
-- feature_flags real columns (baseline 00000000000000:11212-11230):
--   id, flag_name, is_enabled, rollout_percentage, target_grades, description,
--   updated_by, created_at, updated_at, target_institutions, target_roles,
--   target_environments, wave, target_subjects, target_languages, launch_date, metadata

INSERT INTO public.feature_flags (flag_name, is_enabled, description, metadata)
VALUES (
  'ff_v1_quiz_rpc_blocked',
  false,
  'P0 gate: when enabled, web clients MUST be blocked from calling submit_quiz_results (v1) '
  'at the API gateway. The TS client already routes only to submit_quiz_results_v2. '
  'This flag is ops-visibility + gateway enforcement switch; mobile must be fully on v2 '
  'before flipping ON.',
  jsonb_build_object(
    'phase', 'audit-2026-08-07',
    'owner', 'data-platform',
    'preconditions', jsonb_build_array(
      'ff_server_only_quiz_submit enabled in same environment',
      '/api/v2/quiz/submit verified >= 24h',
      'mobile fully on v2 (all APKs call submit_quiz_results_v2)'
    ),
    'kill_switch', 'flip is_enabled=false to instantly re-allow v1',
    'gate_level', 'application_gateway',
    'added', '2026-08-07'
  )
)
ON CONFLICT (flag_name) DO NOTHING;

-- Verify the flag registered (schema-verified column names)
DO $$
DECLARE v_count integer;
BEGIN
  SELECT count(*) INTO v_count
  FROM public.feature_flags
  WHERE flag_name = 'ff_v1_quiz_rpc_blocked';
  IF v_count = 0 THEN
    RAISE EXCEPTION 'ff_v1_quiz_rpc_blocked failed to register';
  END IF;
END $$;
