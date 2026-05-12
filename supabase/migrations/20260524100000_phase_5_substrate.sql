-- Migration: 20260524100000_phase_5_substrate.sql
-- Purpose: Phase 5 of ADR-001 (The Learner Loop). Seeds two new flags
--          gating the substrate for the last two integrations:
--
--   ff_scan_to_queue_v1        Gates POST /api/learner/queue-from-scan
--                              (turns OCR'd questions from /api/scan-solve
--                              into flashcard seeds in
--                              spaced_repetition_cards). When OFF, the
--                              endpoint 404s and the /scan flow stays
--                              read-only.
--
--   ff_personalised_compete_v1 Gates GET /api/learner/weak-topics
--                              (returns the learner's sorted weak-topic
--                              list, used in a future PR by the
--                              Concept Chain daily challenge node
--                              selector + leaderboard tab). When OFF,
--                              the endpoint 404s and Compete stays
--                              grade-wide as today.
--
-- Strategic context: docs/architecture/ADR-001-learner-loop-unification.md
--
-- These are independent flags so the operator can roll the scan-to-queue
-- behaviour without committing to the Compete rework, and vice versa.
-- Both are substrate — no UI consumes them in this PR; future PRs wire
-- the /scan results page CTA and the Concept Chain node selector.
--
-- DOWN (manual, destructive — staging only):
--   DELETE FROM feature_flags
--     WHERE flag_name IN ('ff_scan_to_queue_v1', 'ff_personalised_compete_v1');

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM feature_flags WHERE flag_name = 'ff_scan_to_queue_v1'
  ) THEN
    INSERT INTO feature_flags (
      flag_name,
      is_enabled,
      rollout_percentage,
      description
    )
    VALUES (
      'ff_scan_to_queue_v1',
      false,
      0,
      'Gates POST /api/learner/queue-from-scan (Phase 5 of ADR-001). '
      'When ON, the /scan flow can convert OCR''d questions into '
      'flashcard seeds in spaced_repetition_cards with source=''scan''. '
      'When OFF, the endpoint 404s and scan output stays read-only on '
      'the results page (current behaviour). Independent of '
      'ff_personalised_compete_v1. Owner: principal-architect.'
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM feature_flags WHERE flag_name = 'ff_personalised_compete_v1'
  ) THEN
    INSERT INTO feature_flags (
      flag_name,
      is_enabled,
      rollout_percentage,
      description
    )
    VALUES (
      'ff_personalised_compete_v1',
      false,
      0,
      'Gates GET /api/learner/weak-topics (Phase 5 of ADR-001). When '
      'ON, returns the learner''s weak-topic list sorted by mastery '
      'ASC, which a future PR will plug into the Concept Chain daily '
      'challenge node selector (per-student personalisation instead '
      'of grade-wide) and the leaderboard mastery-percentile tab. '
      'When OFF, the endpoint 404s and Compete stays grade-wide as '
      'today. Independent of ff_scan_to_queue_v1. '
      'Owner: principal-architect.'
    );
  END IF;
END $$;
