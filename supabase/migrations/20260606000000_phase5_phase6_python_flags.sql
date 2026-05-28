-- Migration: Add Python proxy feature flags for Phase 5 and Phase 6 AI services
-- Rollout strategy: 
--   1. Deploy Python services to Cloud Run
--   2. Wire PYTHON_AI_BASE_URL env var on the Edge Function
--   3. Gradually increase rollout_pct via Admin Dashboard or raw SQL
--   4. If issues occur, set kill_switch = true OR empty PYTHON_AI_BASE_URL
--
-- All flags default to OFF (enabled = true, but rollout_pct = 0).

INSERT INTO public.feature_flags (
    name, description, enabled, metadata
) VALUES 
(
    'ff_python_ncert_solver_v1',
    'Phase 5 Python cutover for ncert-solver. When enabled, the Supabase Edge function forwards to Cloud Run ai-services /v1/ncert-solver instead of running the legacy TS path. Default OFF until architect wires PYTHON_AI_BASE_URL.',
    true,
    '{"rollout_pct": 0, "kill_switch": false}'::jsonb
),
(
    'ff_python_cme_engine_v1',
    'Phase 5 Python cutover for cme-engine. When enabled, the Supabase Edge function forwards to Cloud Run ai-services /v1/cme-engine instead of running the legacy TS path. Default OFF until architect wires PYTHON_AI_BASE_URL.',
    true,
    '{"rollout_pct": 0, "kill_switch": false}'::jsonb
),
(
    'ff_python_foxy_tutor_v1',
    'Phase 6 Python cutover for foxy-tutor. When enabled, the Supabase Edge function forwards to Cloud Run ai-services /v1/foxy-tutor instead of running the legacy TS path. Default OFF until architect wires PYTHON_AI_BASE_URL.',
    true,
    '{"rollout_pct": 0, "kill_switch": false}'::jsonb
),
(
    'ff_python_quiz_generator_v1',
    'Phase 6 Python cutover for quiz-generator. When enabled, the Supabase Edge function forwards to Cloud Run ai-services /v1/quiz-generator instead of running the legacy TS path. Default OFF until architect wires PYTHON_AI_BASE_URL.',
    true,
    '{"rollout_pct": 0, "kill_switch": false}'::jsonb
)
ON CONFLICT (name) DO UPDATE SET
    description = EXCLUDED.description,
    metadata = EXCLUDED.metadata;
