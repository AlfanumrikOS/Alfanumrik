-- Phase 1A: rollback flag for MoL-routed admin functions (2026-06-03)
--
-- Context: Phase 1A migrated six admin/async Edge Functions from direct
--   fetch('https://api.anthropic.com/v1/messages', ...) to the MoL
--   generateResponse() router with `preferred_provider: 'openai'`. This
--   yields ~85-90% per-call cost reduction (gpt-4o-mini vs Haiku 4.5) on
--   admin-only / async workloads where latency tolerance is high.
--
-- This flag is the dedicated rollback control: if OpenAI starts producing
-- bad output, ops can set is_enabled=false (or metadata.kill_switch=true)
-- and within the 5-minute Edge-function flag cache TTL all six functions
-- revert to their byte-for-byte legacy direct-Anthropic-fetch path.
--
-- Default: ENABLED on both staging + production (OpenAI primary via MoL).
-- The functions affected:
--   1. bulk-question-gen        (quiz_generation + evaluation)
--   2. bulk-non-mcq-gen         (quiz_generation)
--   3. generate-concepts        (concept_explanation)
--   4. generate-answers         (explanation)
--   5. extract-ncert-questions  (quiz_generation)
--   6. parent-report-generator  (evaluation)
--
-- Kill switch contract (read by isMolAdminRoutingEnabled() in each function):
--   metadata.kill_switch === true   → force legacy path
--   metadata.enabled    === false   → force legacy path
--   metadata.enabled    === true    → force MoL (overrides is_enabled)
--   else                            → fall back to is_enabled column
--
-- Recovery: re-enable by reversing the update
--   (is_enabled=true, metadata.kill_switch=false, metadata.enabled=true).
--
-- Note: deliberately ONE shared flag for all six functions. We want a single
-- kill switch ops can hit during an OpenAI incident, not six surfaces to
-- triage individually. Per-function override would re-introduce the cross-
-- function drift this Phase eliminated.

insert into public.feature_flags (
  flag_name,
  is_enabled,
  rollout_percentage,
  target_environments,
  metadata,
  created_at,
  updated_at
) values (
  'ff_mol_admin_functions_v1',
  true,
  100,
  array['staging', 'production'],
  jsonb_build_object(
    'enabled', true,
    'kill_switch', false,
    'description', 'Phase 1A: routes bulk-question-gen, bulk-non-mcq-gen, generate-concepts, generate-answers, extract-ncert-questions, parent-report-generator through MoL (OpenAI primary). When disabled, functions fall back to legacy direct-Anthropic-fetch path.',
    'owner', 'ai-engineer'
  ),
  now(),
  now()
)
on conflict (flag_name) do nothing;
