-- Migration: 20260518100000_add_ff_foxy_context_rich_v1.sql
-- Purpose: Seed the Phase 3 flag for context-rich Foxy. Default OFF.
--
-- When ON, the Foxy chat route splices the unified-state AI context
-- block (~1500 tokens) into the system prompt after the existing
-- safety rails / tenant overrides / lab section / mastery intent. The
-- block carries: identity, focus-subject mastery, top-3 other subjects'
-- mastery, engagement (streak, XP), recent 12 journey events, and a
-- suggested teaching opportunity.
--
-- Rollout: enabled per-tenant during canary on the Cusiosense house
-- tenant. Flip via feature_flags + a percentage rule once parity (no
-- regression on `helpful` rating in PostHog) is verified.
--
-- DOWN (manual): DELETE FROM feature_flags WHERE flag_name = 'ff_foxy_context_rich_v1';

INSERT INTO public.feature_flags (
  flag_name,
  is_enabled,
  rollout_percentage,
  description,
  created_at,
  updated_at
)
VALUES (
  'ff_foxy_context_rich_v1',
  false,
  0,
  'Phase 3: splice the unified-state AI context block into Foxy''s system prompt. Off by default; flip per tenant during canary.',
  now(),
  now()
)
ON CONFLICT (flag_name) DO NOTHING;
