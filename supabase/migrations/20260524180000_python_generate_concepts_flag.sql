-- Phase 2 continued (2026-05-24): Python AI services cutover — feature flag
--   for generate-concepts. Third function in the per-function ramp from TS
--   Edge to Python on Cloud Run (asia-south1 / Mumbai). Prior ports:
--     1. ff_python_bulk_question_gen_v1 (migration 20260603170000)
--     2. ff_python_generate_answers_v1  (migration 20260603180000)
--   generate-concepts is admin-only (x-admin-key shared secret); writes
--   chapter_concepts rows that drive student learning paths.
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
--   generate-concepts is admin-only batch ingestion (no student-facing
--   surface in the hot path), so a slow ramp is preferred over a fast one
--   to catch any chapter-coverage drift before it locks in.
--
-- Kill switch contract (read by shouldProxyToPython in
--   supabase/functions/_shared/python-ai-proxy.ts):
--     metadata.kill_switch === true                → never proxy
--     typeof metadata.enabled === 'boolean'         → that value wins
--     else                                          → is_enabled column
--   On ANY flag-read failure the helper defaults to NOT proxying — never
--   silently routes to Cloud Run when ops thinks the switch is off.
--   Same precedence as ff_python_bulk_question_gen_v1 and
--   ff_python_generate_answers_v1 so the ops mental model is uniform
--   across all three Python cutover flags.
--
-- Per-function design choice (Phase 2 convention): one flag per function.
--   Each function has its own cutover schedule and blast radius. An
--   OpenAI incident on one function does NOT force-flip the others to TS
--   at the same time.
--
-- Auth note: TS generate-concepts uses x-admin-key constant-time
--   comparison (matches generate-answers, NOT a Supabase user JWT like
--   bulk-question-gen). The Python port mirrors this in
--   services/ai/business/generate_concepts/auth.py — which re-exports
--   verify_admin_key from generate_answers.auth so there's only one
--   implementation across both functions.
--
-- Quality risk note: generate-concepts writes structured chapter_concepts
--   rows that students consume directly through the concept-card learning
--   surface. The Python validator (parse_concepts_response) is byte-
--   contract-equivalent to the TS parser. REG-76 pins this parity so a
--   Python regression that allowed 2-concept arrays or invalid bloom
--   levels would block before the proxy starts splitting traffic.

insert into public.feature_flags (
  flag_name,
  is_enabled,
  rollout_percentage,
  target_environments,
  metadata,
  created_at,
  updated_at
) values (
  'ff_python_generate_concepts_v1',
  false,
  0,
  array['staging', 'production'],
  jsonb_build_object(
    'enabled',     false,
    'kill_switch', false,
    'rollout_pct', 0,
    'description', 'Phase 2 Python cutover for generate-concepts. When enabled, the Supabase Edge function forwards to Cloud Run ai-services /v1/generate-concepts instead of running the Phase 1A TS path. Default OFF until architect wires PYTHON_AI_BASE_URL and ADMIN_API_KEY on Cloud Run.',
    'owner',       'ai-engineer',
    'phase',       'phase_2',
    'function',    'generate-concepts'
  ),
  now(),
  now()
)
on conflict (flag_name) do nothing;
