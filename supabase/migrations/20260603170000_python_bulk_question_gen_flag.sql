-- Phase 1 (2026-05-24): Python AI services cutover — feature flag for
--   bulk-question-gen. First function in the per-function ramp from TS Edge
--   to Python on Cloud Run (asia-south1 / Mumbai). Admin-only, lowest blast
--   radius, chosen as the canary candidate per
--   docs/PYTHON_AI_OPERATIONS.md migration-tracking table.
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
--   Same precedence as ff_mol_admin_functions_v1 so the ops mental model
--   is uniform across both Phase 1A (TS rollback) and Phase 1 (Python
--   cutover) flags.
--
-- Per-function design choice: one flag per function (NOT one shared
--   "ff_python_ai_services_v1" flag). Each function has its own cutover
--   schedule and its own blast radius. The shared-flag pattern in Phase
--   1A only made sense because all six admin functions used the same MoL
--   framework; here Python vs TS is a true runtime swap so per-function
--   control matters.

insert into public.feature_flags (
  flag_name,
  is_enabled,
  rollout_percentage,
  target_environments,
  metadata,
  created_at,
  updated_at
) values (
  'ff_python_bulk_question_gen_v1',
  false,
  0,
  array['staging', 'production'],
  jsonb_build_object(
    'enabled',     false,
    'kill_switch', false,
    'rollout_pct', 0,
    'description', 'Phase 1 Python cutover for bulk-question-gen. When enabled, the Supabase Edge function forwards to Cloud Run ai-services /v1/bulk-question-gen instead of running the legacy TS path. Default OFF until architect wires PYTHON_AI_BASE_URL.',
    'owner',       'ai-engineer'
  ),
  now(),
  now()
)
on conflict (flag_name) do nothing;
