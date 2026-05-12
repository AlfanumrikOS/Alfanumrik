-- Migration: 20260522100000_learner_loop_phase_1.sql
-- Purpose: Phase 1 of ADR-001 The Learner Loop. Seeds the gating flag for
--          the unified next-action resolver at GET /api/learner/next.
--          NO new tables in Phase 1 — the resolver composes on the
--          existing state architecture (StudentState projection from
--          PR #558+ / migration 20260517100000_learner_state_projections.sql,
--          state_events bus from 20260516180000 / 20260521100000).
--
-- Strategic context: docs/architecture/ADR-001-learner-loop-unification.md
--
-- What this seeds:
--   ff_learner_loop_v1 — gates writes-and-reads of /api/learner/next. When
--     OFF, the endpoint 404s and the dashboard / study-plan keep using
--     their legacy "what should I do?" heuristics. When ON, the resolver
--     becomes the single canonical answer for every "Begin Lesson" /
--     "Continue" / "Start Today's Quiz" CTA.
--
-- Rollout pattern: identical to ff_learn_read_mode_v1 (Phase 2-B). Default
-- OFF on every environment. Operator flips per-tenant or globally via the
-- super-admin flag console after Phase 2 wires the existing writers to
-- publish the new event kinds (learner.review_graded, learner.scan_extracted).
--
-- DOWN (manual, destructive — staging only):
--   DELETE FROM feature_flags WHERE flag_name = 'ff_learner_loop_v1';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM feature_flags WHERE flag_name = 'ff_learner_loop_v1'
  ) THEN
    INSERT INTO feature_flags (
      flag_name,
      is_enabled,
      rollout_percentage,
      description
    )
    VALUES (
      'ff_learner_loop_v1',
      false,
      0,
      'Gates GET /api/learner/next — the Learner Loop''s single next-action '
      'resolver (ADR-001). When OFF, endpoint 404s so callers fall through to '
      'legacy "what should I do?" heuristics. When ON, every Begin Lesson / '
      'Continue / Start Today''s Quiz CTA routes through the resolver. '
      'Owner: principal-architect.'
    );
  END IF;
END $$;
