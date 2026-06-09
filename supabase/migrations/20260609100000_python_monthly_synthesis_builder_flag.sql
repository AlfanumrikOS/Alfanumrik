-- Phase 2 continued - Python port of monthly-synthesis-builder Edge Function.
-- Default OFF. Ops bumps rollout_percentage manually after Cloud Run deploy.
-- The Edge proxy in supabase/functions/monthly-synthesis-builder/index.ts
-- reads this envelope on every request:
--   - metadata.enabled (or is_enabled) must be true
--   - metadata.kill_switch must be falsy
--   - hash(request_id) % 100 < metadata.rollout_pct
-- If any check fails OR the Cloud Run forward throws, the legacy TS handler
-- below the proxy block runs the request to completion.

INSERT INTO public.feature_flags (
  flag_name, description, is_enabled, rollout_percentage, metadata, created_at, updated_at
) VALUES (
  'ff_python_monthly_synthesis_builder_v1',
  'Per-request rollout flag for Python monthly-synthesis-builder on Cloud Run (Mumbai). When metadata.enabled=true AND request_id bucket < metadata.rollout_pct AND metadata.kill_switch is not true, the Edge Function forwards to Cloud Run. On proxy failure, falls through to the legacy TS bundle-builder verbatim.',
  false,
  0,
  jsonb_build_object(
    'enabled', false,
    'rollout_pct', 0,
    'kill_switch', false,
    'phase', 'phase_2_continued',
    'function', 'monthly-synthesis-builder'
  ),
  NOW(),
  NOW()
)
ON CONFLICT (flag_name) DO NOTHING;
