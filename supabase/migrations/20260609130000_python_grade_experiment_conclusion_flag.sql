-- Phase 2 - Python port of grade-experiment-conclusion (rule-based path).
-- Default OFF. Phase 2.5 will wire MoL for the LLM-rubric variant.
INSERT INTO public.feature_flags (
  flag_name, description, is_enabled, rollout_percentage, metadata, created_at, updated_at
) VALUES (
  'ff_python_grade_experiment_conclusion_v1',
  'Per-request rollout flag for Python grade-experiment-conclusion (rule-based scoring) on Cloud Run. When metadata.enabled=true AND request_id bucket < metadata.rollout_pct AND metadata.kill_switch is not true, the Edge Function forwards to Cloud Run. On proxy failure, falls through to the legacy TS handler.',
  false,
  0,
  jsonb_build_object(
    'enabled', false, 'rollout_pct', 0, 'kill_switch', false,
    'phase', 'phase_2',
    'function', 'grade-experiment-conclusion'
  ),
  NOW(),
  NOW()
)
ON CONFLICT (flag_name) DO NOTHING;
