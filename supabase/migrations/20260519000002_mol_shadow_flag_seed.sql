-- 20260519000002_mol_shadow_flag_seed.sql
-- C4.2a (2026-05-19): seed the shadow-routing feature flag for grounded-answer.
--
-- Companion to 20260519000001_mol_shadow_routing.sql (schema substrate) and
-- the C4.2a wire-up in pipeline.ts + pipeline-stream.ts. With the flag row
-- seeded as DISABLED on prod + staging, the helper short-circuits BEFORE
-- generateResponse() runs and zero shadow rows are written.
--
-- Default DISABLED. Flag stays off until ops promotes it via the super-admin
-- Flags console (C4.2b). When promoted, the helper reads the envelope below
-- from feature_flags.metadata; see supabase/functions/grounded-answer/
-- mol-shadow.ts:readShadowEnvelope for the contract.
--
-- Envelope shape (decoded by readShadowEnvelope):
--   enabled:     master kill bit; default false
--   kill_switch: ops short-circuit; default false
--   task_types:  TaskType allow-list (assessment-reviewed below)
--   rollout_pct: hash(request_id + ':' + task_type) % 100 < rollout_pct
--
-- Allow-list rationale (assessment review of PR #855):
--   * 'explanation'         — Foxy 'explain' / 'learn' modes (most volume).
--   * 'concept_explanation' — Foxy 'learn' mode + concept-engine ingestion.
--   * 'doubt_solving'       — Foxy 'doubt' mode (the original C4 target).
--   * 'step_by_step'        — ncert-solver primary answer.
--
-- Deliberately OMITTED from the allow-list:
--   * 'grounding_check'     — strict-mode fact-checker. The shadow leg
--     answers the same fact-check question on the SAME chunks; quality
--     signal is low because both providers tend to agree on the strict
--     spec. C5 may add it after primary-answer quality data lands.
--   * 'quiz_generation'     — quiz-generator. Output is structured JSON
--     with a deterministic oracle (REG-54) so the grader signal is
--     duplicative with existing oracle gating.
--   * 'evaluation'          — quiz-generator verifier + diagnostic. Same
--     oracle argument as quiz_generation.
--   * 'reasoning'           — JEE/NEET deep-reasoning. Routed to Sonnet
--     today; shadow comparison against gpt-4o-mini would be unfair (price
--     class mismatch). Defer to C5 when we can route the shadow to gpt-4o.
--   * 'ocr_extraction'      — image-only; OpenAI vision route is a
--     different MOL plan-table entry. Defer to C5.
--
-- Operator runbook (C4.2b):
--   1. Verify mol_request_logs has at least 24h of baseline rows.
--   2. Enable on staging: rollout_pct=10. Watch for shadow row volume
--      ≈ 10% of baseline volume. Verify shadow_role='shadow' rows pair
--      to baseline via mol_shadow_pairs_v1.
--   3. Ramp to 25 → 50 → 100 over 48 hours.
--   4. Kill switch: set metadata.kill_switch=true (or is_enabled=false).
--      In-process flag cache TTL is 5 min.
--   5. Cost guardrail: every shadow row writes inr_cost to
--      mol_request_logs. Monitor sum(inr_cost) WHERE shadow_role='shadow'
--      AND created_at > now() - interval '1 hour' < budget.
--
-- Migration is fully idempotent: pure ON CONFLICT DO NOTHING insert, no
-- schema changes. Re-runnable safely.

INSERT INTO public.feature_flags (
  flag_name,
  is_enabled,
  rollout_percentage,
  description,
  metadata,
  target_environments,
  created_at,
  updated_at
)
VALUES (
  'ff_grounded_answer_mol_shadow_v1',
  false,
  0,
  'C4 shadow routing: fire parallel OpenAI shadow call on every grounded-answer LLM invocation. Discard shadow response (Anthropic still serves user) but persist for offline grader comparison. Default DISABLED. Envelope: {enabled, kill_switch, task_types[], rollout_pct}.',
  jsonb_build_object(
    'enabled', false,
    'kill_switch', false,
    'task_types', jsonb_build_array(
      'explanation',
      'concept_explanation',
      'doubt_solving',
      'step_by_step'
    ),
    'rollout_pct', 0
  ),
  ARRAY['staging', 'production']::TEXT[],
  now(),
  now()
)
ON CONFLICT (flag_name) DO NOTHING;

-- Verify seed landed; emit NOTICE for runbook visibility.
DO $verify$
DECLARE
  v_count   integer;
  v_enabled boolean;
BEGIN
  SELECT count(*) INTO v_count
    FROM public.feature_flags
   WHERE flag_name = 'ff_grounded_answer_mol_shadow_v1';

  IF v_count = 0 THEN
    RAISE WARNING 'C4.2a: ff_grounded_answer_mol_shadow_v1 NOT seeded — investigate.';
  ELSE
    SELECT is_enabled INTO v_enabled
      FROM public.feature_flags
     WHERE flag_name = 'ff_grounded_answer_mol_shadow_v1';
    RAISE NOTICE 'C4.2a: ff_grounded_answer_mol_shadow_v1 present count=% is_enabled=%', v_count, v_enabled;
    IF v_enabled THEN
      RAISE WARNING 'C4.2a: ff_grounded_answer_mol_shadow_v1 is ENABLED — intent was OFF, verify.';
    END IF;
  END IF;
END $verify$;
