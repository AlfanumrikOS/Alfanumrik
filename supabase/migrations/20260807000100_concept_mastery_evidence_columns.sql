-- Migration: 20260807000100_concept_mastery_evidence_columns.sql
-- Purpose: Foxy North-Star Phase 2 (spec docs/superpowers/specs/
--   2026-08-05-foxy-north-star-alignment-design.md §1.3) — add the evidence-
--   tracking columns to concept_mastery so the learner-state writer
--   (update_learner_state_post_quiz, rewired in 20260807000400) can maintain:
--     * evidence_count        — total scored evidence events for this topic
--     * evidence_quality      — running weighted mean of per-event evidence
--                               weight (1.0 unhinted .. 0.25 heavy-hint), 0..1
--     * independent_attempts / independent_correct — attempts with no hint
--                               (p_hint_level IS NULL OR 0)
--     * hinted_attempts / hinted_correct — attempts with hint tier 1..3
--
-- NOTE: mastery_variance ALREADY EXISTS on concept_mastery (added by
--   20260622020000_add_concept_mastery_cme_columns.sql as the pseudo-decay
--   0.25/(1+attempts*0.1) value). NO DDL for it here — 20260807000400 changes
--   only how it is COMPUTED (Beta posterior), not its column definition.
--
-- Backfill (historical rows predate hint telemetry, so all prior evidence is
-- treated as independent, full-quality):
--     evidence_count       = attempts
--     independent_attempts = attempts
--     independent_correct  = correct_attempts
--     evidence_quality     = 1.0 where attempts > 0
--   Guard: only rows where evidence_count = 0 (i.e. not yet backfilled /
--   not yet written by the new RPC) — safe to re-run, idempotent.
--
-- RLS: concept_mastery policies are row-scoped (student_id), not
--   column-scoped — additive columns are automatically covered. No RLS change.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS; duplicate_object-guarded CHECK;
--   guarded backfill. No DROP. No index changes.
-- Owner: architect. Added: 2026-08-05. Reviewers: assessment (formula math),
--   testing, quality.

ALTER TABLE public.concept_mastery
  ADD COLUMN IF NOT EXISTS evidence_count       integer          NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS evidence_quality     double precision NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS independent_attempts integer          NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS independent_correct  integer          NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS hinted_attempts      integer          NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS hinted_correct       integer          NOT NULL DEFAULT 0;

-- evidence_quality is a weighted mean of per-event weights in [0.25, 1.0],
-- so it is bounded 0..1 by construction; the CHECK pins the contract.
DO $$
BEGIN
  ALTER TABLE public.concept_mastery
    ADD CONSTRAINT concept_mastery_evidence_quality_range
    CHECK (evidence_quality >= 0 AND evidence_quality <= 1);
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

COMMENT ON COLUMN public.concept_mastery.evidence_count IS
  'Total scored evidence events for this student+topic. Backfilled = attempts '
  '(pre-hint-telemetry history treated as independent full-quality evidence). '
  'Maintained by update_learner_state_post_quiz (20260807000400).';
COMMENT ON COLUMN public.concept_mastery.evidence_quality IS
  'Running weighted mean (0..1) of per-event evidence weight: 1.0 no hint, '
  '0.7 hint tier 1, 0.45 tier 2, 0.25 tier 3. Backfilled = 1.0 where '
  'attempts > 0. Maintained by update_learner_state_post_quiz (20260807000400).';
COMMENT ON COLUMN public.concept_mastery.independent_attempts IS
  'Attempts answered with NO hint (hint_level NULL or 0). Feeds the Beta-'
  'posterior mastery_variance (alpha/beta weights 1.0).';
COMMENT ON COLUMN public.concept_mastery.independent_correct IS
  'Correct attempts answered with NO hint. Feeds the Beta-posterior '
  'mastery_variance (alpha weight 1.0).';
COMMENT ON COLUMN public.concept_mastery.hinted_attempts IS
  'Attempts answered WITH a hint (hint_level 1..3). Feeds the Beta-posterior '
  'mastery_variance (alpha/beta weights 0.45).';
COMMENT ON COLUMN public.concept_mastery.hinted_correct IS
  'Correct attempts answered WITH a hint. Feeds the Beta-posterior '
  'mastery_variance (alpha weight 0.45).';

-- ─── Backfill (guarded: only rows the new writer has not touched) ────────────
UPDATE public.concept_mastery
   SET evidence_count       = COALESCE(attempts, 0),
       independent_attempts = COALESCE(attempts, 0),
       independent_correct  = COALESCE(correct_attempts, 0),
       evidence_quality     = 1.0
 WHERE COALESCE(attempts, 0) > 0
   AND evidence_count = 0;
