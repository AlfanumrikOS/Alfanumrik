-- Migration: 20260522110000_learner_loop_dashboard_phase_3a.sql
-- Purpose: Phase 3a of ADR-001. Seeds the dashboard-side gating flag for
--          the Learner Loop's first UI consumer — the AboveFoldHero
--          "Continue Learning" card. When ON, the card renders the
--          action returned by GET /api/learner/next. When OFF, the
--          legacy BKT-topic Continue card renders (current behaviour).
--
-- Strategic context: docs/architecture/ADR-001-learner-loop-unification.md
--
-- Two-flag rollout (deliberate):
--   ff_learner_loop_v1            — gates the /api/learner/next endpoint
--   ff_learner_loop_dashboard_v1  — gates the dashboard rendering
--
-- Splitting them lets the operator warm the endpoint (verify resolver
-- decisions in PostHog, audit branch distribution) BEFORE any student
-- sees the UI change. Rollout order:
--   1. Flip ff_event_bus_v1 → 100%   (events flowing)
--   2. Flip ff_learner_loop_v1 → 10% canary → 100%  (endpoint live)
--   3. Verify learner_next_resolved volume + branch distribution in PostHog
--   4. Flip ff_learner_loop_dashboard_v1 → 10% canary → 100%  (UI live)
--
-- Steps 2 and 4 are reversible per-flag without touching the other.
--
-- DOWN (manual, destructive — staging only):
--   DELETE FROM feature_flags WHERE flag_name = 'ff_learner_loop_dashboard_v1';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM feature_flags WHERE flag_name = 'ff_learner_loop_dashboard_v1'
  ) THEN
    INSERT INTO feature_flags (
      flag_name,
      is_enabled,
      rollout_percentage,
      description
    )
    VALUES (
      'ff_learner_loop_dashboard_v1',
      false,
      0,
      'Gates the dashboard hero''s "Continue Learning" card rendering '
      'the action returned by /api/learner/next (Phase 3a of ADR-001). '
      'When OFF, the legacy BKT-topic Continue card renders. The '
      '/api/learner/next endpoint has its OWN flag (ff_learner_loop_v1) '
      'so the resolver can be warmed up before any UI flip. Operator '
      'flips this only after PostHog confirms learner_next_resolved '
      'volume and branch distribution look sensible. Owner: principal-architect.'
    );
  END IF;
END $$;
