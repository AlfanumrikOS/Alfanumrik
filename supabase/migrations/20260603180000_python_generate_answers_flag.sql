-- Phase 2 (2026-05-24): Python AI services cutover — feature flag for
--   generate-answers. Second function in the per-function ramp from TS Edge
--   to Python on Cloud Run (asia-south1 / Mumbai). The first
--   (ff_python_bulk_question_gen_v1, migration 20260603170000) shipped
--   2026-05-24 (default OFF). Generate-answers is admin-only (x-admin-key
--   shared secret) and has the highest-volume non-AI-prompt traffic per
--   docs/PYTHON_AI_LONG_TERM_VISION.md migration order.
--
-- Default: DISABLED on both staging + production (rollout_pct=0). Until
--   architect confirms the Cloud Run service URL is wired into
--   PYTHON_AI_BASE_URL env var on the Edge Function AND staging
--   smoke-tests pass against the Python implementation directly, NO
--   traffic forwards. The proxy helper additionally short-circuits when
--   PYTHON_AI_BASE_URL is empty so this flag has zero effect on a fresh
--   environment that doesn't yet have the URL set.
--
-- Ramp procedure: ops bumps `metadata.rollout_pct` per
--   docs/PYTHON_AI_OPERATIONS.md "Cutover procedure for individual
--   functions" — 10% → 25% → 50% → 100% with 8-12h watch at each step.
--
-- Kill switch contract (read by shouldProxyToPython in
--   supabase/functions/_shared/python-ai-proxy.ts):
--     metadata.kill_switch === true                → never proxy
--     typeof metadata.enabled === 'boolean'         → that value wins
--     else                                          → is_enabled column
--   On ANY flag-read failure the helper defaults to NOT proxying — never
--   silently routes to Cloud Run when ops thinks the switch is off.
--   Same precedence as ff_python_bulk_question_gen_v1 so the ops mental
--   model is uniform across both Python cutover flags.
--
-- Per-function design choice (Phase 2 continues the Phase 1 convention):
--   one flag per function. Each function has its own cutover schedule and
--   blast radius. ff_python_bulk_question_gen_v1 and
--   ff_python_generate_answers_v1 are independently ramped; an OpenAI
--   incident on one does NOT force-flip the other to TS at the same time.
--
-- Auth note: TS generate-answers uses x-admin-key constant-time comparison
--   (NOT a Supabase user JWT like bulk-question-gen). The Python port
--   mirrors this in services/ai/business/generate_answers/auth.py. The
--   ADMIN_API_KEY env var must be set on Cloud Run for the Python service
--   to accept any requests once the flag is bumped.

insert into public.feature_flags (
  flag_name,
  is_enabled,
  rollout_percentage,
  target_environments,
  metadata,
  created_at,
  updated_at
) values (
  'ff_python_generate_answers_v1',
  false,
  0,
  array['staging', 'production'],
  jsonb_build_object(
    'enabled',     false,
    'kill_switch', false,
    'rollout_pct', 0,
    'description', 'Phase 2 Python cutover for generate-answers. When enabled, the Supabase Edge function forwards to Cloud Run ai-services /v1/generate-answers instead of running the Phase 1A TS path. Default OFF until architect wires PYTHON_AI_BASE_URL and ADMIN_API_KEY on Cloud Run.',
    'owner',       'ai-engineer'
  ),
  now(),
  now()
)
on conflict (flag_name) do nothing;
