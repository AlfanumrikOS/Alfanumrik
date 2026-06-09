-- Phase 2 continued - Python port of nep-compliance Edge Function.
-- Default OFF. Pure data aggregation (no AI calls); produces NEP 2020 HPC.
INSERT INTO public.feature_flags (
  flag_name, description, is_enabled, rollout_percentage, metadata, created_at, updated_at
) VALUES (
  'ff_python_nep_compliance_v1',
  'Per-request rollout flag for Python nep-compliance on Cloud Run (Mumbai). When metadata.enabled=true AND request_id bucket < metadata.rollout_pct AND metadata.kill_switch is not true, the Edge Function forwards to Cloud Run. On proxy failure, falls through to the legacy TS HPC generator verbatim.',
  false,
  0,
  jsonb_build_object(
    'enabled', false,
    'rollout_pct', 0,
    'kill_switch', false,
    'phase', 'phase_2_continued',
    'function', 'nep-compliance'
  ),
  NOW(),
  NOW()
)
ON CONFLICT (flag_name) DO NOTHING;
