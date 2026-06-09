-- Phase 2 — Python port of bulk-non-mcq-gen (stub path).
INSERT INTO public.feature_flags (
  flag_name, description, is_enabled, rollout_percentage, metadata, created_at, updated_at
) VALUES (
  'ff_python_bulk_non_mcq_gen_v1',
  'Per-request rollout flag for Python bulk-non-mcq-gen on Cloud Run. Phase 2 stub returns 0 generated; Phase 2.5 wires MoL + Sonnet oracle grader bypass.',
  false,
  0,
  jsonb_build_object(
    'enabled', false, 'rollout_pct', 0, 'kill_switch', false,
    'phase', 'phase_2_stub', 'function', 'bulk-non-mcq-gen'
  ),
  NOW(),
  NOW()
)
ON CONFLICT (flag_name) DO NOTHING;
