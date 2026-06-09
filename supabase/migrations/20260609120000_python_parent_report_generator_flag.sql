-- Phase 2 continued - Python port of parent-report-generator (template path).
-- Default OFF. Phase 2.5 will wire MoL for the LLM-narrative variant; this
-- port covers the template-fallback path which the TS already uses when
-- Claude is unavailable.
INSERT INTO public.feature_flags (
  flag_name, description, is_enabled, rollout_percentage, metadata, created_at, updated_at
) VALUES (
  'ff_python_parent_report_generator_v1',
  'Per-request rollout flag for Python parent-report-generator (template path) on Cloud Run. When metadata.enabled=true AND request_id bucket < metadata.rollout_pct AND metadata.kill_switch is not true, the Edge Function forwards to Cloud Run. On proxy failure, falls through to the legacy TS handler (which itself falls back to its own template path if Claude fails). Net behavior: the parent sees a template-based report from either side.',
  false,
  0,
  jsonb_build_object(
    'enabled', false, 'rollout_pct', 0, 'kill_switch', false,
    'phase', 'phase_2_continued',
    'function', 'parent-report-generator'
  ),
  NOW(),
  NOW()
)
ON CONFLICT (flag_name) DO NOTHING;
