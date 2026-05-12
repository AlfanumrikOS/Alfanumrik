-- Migration: 20260523110000_revise_route_phase_4.sql
-- Purpose: Phase 4 of ADR-001 (The Learner Loop). Seeds the gating flag
--          for the new /revise route — the first-class destination for
--          decayed-topic revisits. Without this flag, /revise's data
--          endpoint 404s and the existing QuizResults "Re-read Chapter
--          N" deep-link points at /learn/[s]/[c]?mode=read&from=quiz
--          (legacy behaviour).
--
-- Strategic context: docs/architecture/ADR-001-learner-loop-unification.md
--
-- The /revise route exists because:
--   - "Revise" was a verb scattered across the product but had no home —
--     a `revision` task-type inside study plan, and one Re-read CTA on
--     QuizResults. No browsable surface for "topics you previously knew
--     but haven't touched in a while."
--   - The Loop resolver's `revise_decayed_topic` action needs a place
--     to dispatch to. /learn?mode=read is fine for ONE chapter but
--     doesn't surface the STACK of decayed topics.
--   - The /revise page lists every decayed chapter (mastery >= 0.6 AND
--     last-touched > retention window), sorted most-stale-first, with
--     a recommended modality button (read / explainer / worked-example)
--     per card.
--
-- The flag gates:
--   - The /revise page render (404 when off → BottomNav doesn't surface it).
--   - The /api/learner/revise-stack endpoint (404 when off).
--   - The QuizResults Re-read CTA URL choice (legacy /learn vs new /revise).
--
-- DOWN (manual, destructive — staging only):
--   DELETE FROM feature_flags WHERE flag_name = 'ff_revise_route_v1';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM feature_flags WHERE flag_name = 'ff_revise_route_v1'
  ) THEN
    INSERT INTO feature_flags (
      flag_name,
      is_enabled,
      rollout_percentage,
      description
    )
    VALUES (
      'ff_revise_route_v1',
      false,
      0,
      'Gates the /revise route (Phase 4 of ADR-001) — the first-class '
      'destination for decayed-topic revisits. When OFF, the new page '
      'and its /api/learner/revise-stack endpoint both 404, the '
      'BottomNav does not surface the entry, and the QuizResults '
      'Re-read CTA continues to deep-link to /learn/[s]/[c]?mode=read. '
      'When ON, the resolver''s revise_decayed_topic action dispatches '
      'to /revise and students can browse a stack of decayed chapters '
      'with a recommended modality button per card. Owner: principal-architect.'
    );
  END IF;
END $$;
