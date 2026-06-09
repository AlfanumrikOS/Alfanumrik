-- Phase 2 — Python port of extract-ncert-questions (stub path).
-- Default OFF. Phase 2.5 will wire MoL routing for the actual extraction.
INSERT INTO public.feature_flags (
  flag_name, description, is_enabled, rollout_percentage, metadata, created_at, updated_at
) VALUES (
  'ff_python_extract_ncert_questions_v1',
  'Per-request rollout flag for Python extract-ncert-questions on Cloud Run. Phase 2 stub returns chapter discovery only (no actual extraction); Phase 2.5 will wire MoL routing. On proxy failure, falls through to the legacy TS handler verbatim.',
  false,
  0,
  jsonb_build_object(
    'enabled', false, 'rollout_pct', 0, 'kill_switch', false,
    'phase', 'phase_2_stub',
    'function', 'extract-ncert-questions'
  ),
  NOW(),
  NOW()
)
ON CONFLICT (flag_name) DO NOTHING;
