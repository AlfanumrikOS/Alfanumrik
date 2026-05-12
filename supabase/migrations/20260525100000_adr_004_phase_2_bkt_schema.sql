-- 20260525100000_adr_004_phase_2_bkt_schema.sql
--
-- ADR-004 Phase 2 / PR 2 of ADR-005 — schema for concept-mastery-projector.
--
-- Adds:
--   1. public.concept_attempts          NEW TABLE (per-attempt BKT chain log).
--   2. public.concept_mastery           NEW COLUMNS (concept_id, mastery_mean,
--                                       last_practiced_at, total_attempts,
--                                       total_correct, streak_current,
--                                       last_attempt_id, bkt_version, updated_at)
--                                       + partial UNIQUE INDEX on (student_id,
--                                       concept_id) WHERE concept_id IS NOT NULL.
--   3. subscriber_offsets               SEED ROW for concept-mastery-projector
--                                       (cursor set to NOW() — don't replay
--                                       historical learner.* events).
--
-- Spec : docs/superpowers/specs/2026-05-12-adr-004-phase-2-bkt-projector-design.md
-- Plan : docs/superpowers/plans/2026-05-12-adr-004-phase-2-bkt-projector.md
-- ADRs : docs/architecture/ADR-005-concept-first-adaptive-learning-spine.md
--        docs/architecture/ADR-004-adaptive-tutor.md
--
-- Legacy concept_mastery columns (topic_id, mastery_probability, p_know etc.)
-- are NOT modified. Legacy RPCs that reference them continue to work — the
-- old (student_id, topic_id) namespace and the new (student_id, concept_id)
-- namespace coexist on the same table for now.

-- ────────────────────────────────────────────────────────────────────
-- 1. concept_attempts
-- ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.concept_attempts (
  attempt_id              uuid         PRIMARY KEY,
  student_id              uuid         NOT NULL
                            REFERENCES public.students(id) ON DELETE CASCADE,
  concept_id              uuid         NOT NULL
                            REFERENCES public.chapter_concepts(id) ON DELETE CASCADE,
  attempt_sequence        int                   NULL,    -- assigned at /answer time inside RPC
  served_at               timestamptz  NOT NULL DEFAULT now(),
  answered_at             timestamptz           NULL,
  correct                 boolean               NULL,
  chosen_index            int                   NULL,
  response_time_ms        int                   NULL,
  prior_mastery_mean      numeric(7,6)          NULL,
  posterior_mastery_mean  numeric(7,6)          NULL,
  status                  text         NOT NULL DEFAULT 'reserved'
                            CHECK (status IN ('reserved','answered','excluded')),
  created_at              timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT concept_attempts_seq_unique UNIQUE (student_id, concept_id, attempt_sequence)
);

COMMENT ON TABLE public.concept_attempts IS
  'Per-attempt BKT chain log (ADR-004 Phase 2 / ADR-005 Path C v2). The RPC '
  'tutor_commit_attempt inserts one row per /api/tutor/answer call with '
  'status=''answered''. The route inserts status=''excluded'' rows when '
  'Path C is unavailable (flag-off OR RPC failure) — preserves audit trail '
  'without participating in the BKT chain. Canonical learner state '
  'mastery_mean is rolled up onto public.concept_mastery by '
  'concept-mastery-projector subscriber.';

-- Hot-path index for the RPC's chain-head read.
CREATE INDEX IF NOT EXISTS idx_concept_attempts_chain_head
  ON public.concept_attempts (student_id, concept_id, attempt_sequence DESC)
  WHERE status = 'answered';

-- RLS — service_role has full access; students can read their own attempts.
ALTER TABLE public.concept_attempts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS concept_attempts_read_own ON public.concept_attempts;
CREATE POLICY concept_attempts_read_own
  ON public.concept_attempts
  FOR SELECT TO authenticated
  USING (
    student_id IN (
      SELECT id FROM public.students WHERE auth_user_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS concept_attempts_service_role_all ON public.concept_attempts;
CREATE POLICY concept_attempts_service_role_all
  ON public.concept_attempts
  AS PERMISSIVE FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ────────────────────────────────────────────────────────────────────
-- 2. concept_mastery — ADD the Phase-0/Phase-2 columns
-- ────────────────────────────────────────────────────────────────────
-- The legacy table from baseline_from_prod.sql is keyed by (student_id,
-- topic_id) with mastery_probability. The Phase 0 /api/tutor/answer route
-- writes (student_id, concept_id) → mastery_mean — but no migration has
-- shipped those columns to prod yet (flag stayed OFF, so nothing noticed).
-- PR 2 adds them via ADD COLUMN IF NOT EXISTS so existing rows + legacy
-- RPCs are untouched. The partial UNIQUE INDEX below is what makes the
-- ON CONFLICT (student_id, concept_id) upsert resolve.

ALTER TABLE public.concept_mastery
  ADD COLUMN IF NOT EXISTS concept_id         uuid
                              REFERENCES public.chapter_concepts(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS mastery_mean       numeric(7,6),
  ADD COLUMN IF NOT EXISTS last_practiced_at  timestamptz,
  ADD COLUMN IF NOT EXISTS total_attempts     int          NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_correct      int          NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS streak_current     int          NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_attempt_id    uuid,
  ADD COLUMN IF NOT EXISTS bkt_version        int          NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS updated_at         timestamptz  NOT NULL DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS concept_mastery_student_concept_unique
  ON public.concept_mastery (student_id, concept_id)
  WHERE concept_id IS NOT NULL;

COMMENT ON COLUMN public.concept_mastery.concept_id IS
  'ADR-004 / ADR-005 Path C v2 — new key alongside legacy topic_id. The '
  'concept-mastery-projector upserts on (student_id, concept_id) via the '
  'partial unique index concept_mastery_student_concept_unique.';
COMMENT ON COLUMN public.concept_mastery.mastery_mean IS
  'BKT posterior mean in [0,1]. Written by concept-mastery-projector from '
  'learner.concept_check_answered events; equals the optimistic value '
  'returned by /api/tutor/answer once the projector catches up.';
COMMENT ON COLUMN public.concept_mastery.last_attempt_id IS
  'Idempotency anchor for concept-mastery-projector: if equals '
  'event.payload.attemptId, the projector skips (no-op).';
COMMENT ON COLUMN public.concept_mastery.bkt_version IS
  '0 = Phase 0 naive write or legacy column; 1 = Phase 2 BKT write. Lets '
  'analytics distinguish.';

-- ────────────────────────────────────────────────────────────────────
-- 3. Seed cursor for the new subscriber
-- ────────────────────────────────────────────────────────────────────
-- last_processed_occurred_at = now() so the subscriber doesn't replay
-- historical events. The substrate runtime treats events with
-- occurred_at > cursor as pending.
INSERT INTO public.subscriber_offsets (
  subscriber_name, kind_filter, last_processed_occurred_at
)
VALUES (
  'concept-mastery-projector', 'learner.concept_check_answered', now()
)
ON CONFLICT (subscriber_name) DO NOTHING;
