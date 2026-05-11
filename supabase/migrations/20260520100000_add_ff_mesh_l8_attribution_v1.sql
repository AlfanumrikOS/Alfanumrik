-- Migration: 20260520100000_add_ff_mesh_l8_attribution_v1.sql
-- Purpose: Seed the Phase 5 flag for L8 outcome attribution. Default OFF.
--
-- When ON, the L8 runner (scripts/run-l8-attribution.ts) attributes
-- shipped cycles by computing before/after metric deltas using
-- domain_events as the journey source of truth, and writes one
-- outcome_metrics row per (cycle, metric).
--
-- Rollout: flip ON globally once Phase 2's event bus has been live
-- for >= 14d on the Cusiosense house tenant — the L8 attribution
-- needs at least one full pre+post window of events to compute
-- non-trivial deltas. Until then, the runner can be invoked manually
-- in --dry-run mode to validate the math.
--
-- DOWN (manual): DELETE FROM feature_flags WHERE flag_name = 'ff_mesh_l8_attribution_v1';

INSERT INTO public.feature_flags (
  flag_name,
  is_enabled,
  rollout_percentage,
  description,
  created_at,
  updated_at
)
VALUES (
  'ff_mesh_l8_attribution_v1',
  false,
  0,
  'Phase 5: L8 evolution agent attributes shipped cycles via before/after deltas on domain_events. Off by default; flip once event bus has accumulated >=14d of data.',
  now(),
  now()
)
ON CONFLICT (flag_name) DO NOTHING;
