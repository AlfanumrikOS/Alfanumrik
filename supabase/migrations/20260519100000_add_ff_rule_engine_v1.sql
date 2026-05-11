-- Migration: 20260519100000_add_ff_rule_engine_v1.sql
-- Purpose: Seed the Phase 4 flag for the rule engine. Default OFF.
--
-- When ON, surfaces (sidebar nav, dashboard cards, upsell, parent
-- digest) call getLearnerDecisions(authUserId) instead of running
-- their own in-line policy checks. The rule engine reads
-- StudentState and returns a typed Decision[]; surfaces filter by
-- slug and render.
--
-- Rollout: flip per tenant during canary on the Cusiosense house
-- tenant first. Each surface keeps its legacy fallback until the
-- canary is verified; the cutover for each surface is a separate
-- PR.
--
-- DOWN (manual): DELETE FROM feature_flags WHERE flag_name = 'ff_rule_engine_v1';

INSERT INTO public.feature_flags (
  flag_name,
  is_enabled,
  rollout_percentage,
  description,
  created_at,
  updated_at
)
VALUES (
  'ff_rule_engine_v1',
  false,
  0,
  'Phase 4: surfaces call getLearnerDecisions() instead of in-line policy. Off by default; flip per tenant during canary.',
  now(),
  now()
)
ON CONFLICT (flag_name) DO NOTHING;
