-- Phase 2 — Python port of verify-question-bank (claim/release stub path).
-- Default OFF. Phase 2.5 will wire the grounded-answer verifier call.
INSERT INTO public.feature_flags (
  flag_name, description, is_enabled, rollout_percentage, metadata, created_at, updated_at
) VALUES (
  'ff_python_verify_question_bank_v1',
  'Per-request rollout flag for Python verify-question-bank on Cloud Run. Phase 2 stub releases each claimed row back to legacy_unverified (no actual verifier call); Phase 2.5 will wire grounded-answer. On proxy failure, falls through to the legacy TS handler verbatim.',
  false,
  0,
  jsonb_build_object(
    'enabled', false, 'rollout_pct', 0, 'kill_switch', false,
    'phase', 'phase_2_stub',
    'function', 'verify-question-bank'
  ),
  NOW(),
  NOW()
)
ON CONFLICT (flag_name) DO NOTHING;
