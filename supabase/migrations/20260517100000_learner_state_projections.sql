-- Migration: 20260517100000_learner_state_projections.sql
-- Purpose: Phase 2 of the unified state architecture. Introduces the
--          read-side projection tables that the StudentStateBuilder reads
--          and the event-bus subscribers write.
--
-- Design choices:
--   - learner_mastery is the CLEAN per-chapter mastery projection. It is
--     what the StudentState model in src/lib/state/student-state.ts expects
--     to read. The legacy adaptive_mastery / concept_mastery / layer_mastery
--     tables stay in place untouched — Phase 2 doesn't migrate any data;
--     it only stands up the new path. Legacy tables can be retired in a
--     later phase once parity is verified.
--   - One row per (auth_user_id, subject_code, chapter_number). The
--     UNIQUE constraint makes the subscriber's upsert idempotent.
--   - mastery is a single double in [0,1]. We do not store BKT priors
--     (slip/guess/transition) here — those are fixed parameters of the
--     quiz-completion-service and recomputable from the event log. This
--     table is purely the rollup for fast reads.
--   - last_updated_at is the wall-clock of the latest learner.mastery_changed
--     event for this (learner, subject, chapter). The subscriber writes it.
--   - attempts is a cumulative counter, incremented by the subscriber on
--     each event. Useful for dashboards without re-aggregating quiz_sessions.
--
-- Why a new table instead of reusing adaptive_mastery:
--   - adaptive_mastery has 30+ columns and an opaque node_code that does
--     not map cleanly to (subject, chapter). Reading it from the unified
--     state builder would require a join with the syllabus graph.
--   - The new architecture is event-sourced; learner_mastery is a
--     projection that can be rebuilt from domain_events at any time.
--     Conflating projections with the legacy write-paths would couple
--     the two and block the legacy retirement plan.
--
-- RLS:
--   - service_role full access (used by builder + subscriber daemon)
--   - Learners can read their own rows (matches authUserId)
--   - Everyone else: no access. Teachers/parents/admins read via
--     server-side resolvers that use service_role.
--
-- DOWN (manual, destructive — staging only):
--   DROP TABLE IF EXISTS public.learner_mastery CASCADE;

-- ── 1. Table ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.learner_mastery (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id    uuid        NOT NULL,
  subject_code    text        NOT NULL,
  chapter_number  integer     NOT NULL CHECK (chapter_number > 0),
  mastery         double precision NOT NULL CHECK (mastery >= 0 AND mastery <= 1),
  attempts        integer     NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_updated_at timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT learner_mastery_unique
    UNIQUE (auth_user_id, subject_code, chapter_number),
  CONSTRAINT learner_mastery_subject_lower
    CHECK (subject_code = lower(subject_code))
);

COMMENT ON TABLE public.learner_mastery IS
  'Phase 2 read-side projection of per-chapter mastery. Written by the '
  'mastery-state-writer subscriber on learner.mastery_changed events. '
  'Read by buildStudentState() in src/lib/state/student-state-builder.ts.';

CREATE INDEX IF NOT EXISTS learner_mastery_by_user
  ON public.learner_mastery (auth_user_id);

CREATE INDEX IF NOT EXISTS learner_mastery_recently_updated
  ON public.learner_mastery (last_updated_at DESC);

-- ── 2. RLS ──────────────────────────────────────────────────────────
ALTER TABLE public.learner_mastery ENABLE ROW LEVEL SECURITY;

-- service_role bypass (used by server-side builder + subscriber)
CREATE POLICY learner_mastery_service_all
  ON public.learner_mastery
  FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- Learners read their own
CREATE POLICY learner_mastery_self_read
  ON public.learner_mastery
  FOR SELECT
  TO authenticated
  USING (auth.uid() = auth_user_id);

-- ── 3. Updated_at maintenance trigger ───────────────────────────────
-- The subscriber writes last_updated_at directly from the event's
-- occurredAt, but we also want a safety net for any direct admin writes.
CREATE OR REPLACE FUNCTION public.tg_learner_mastery_touch()
RETURNS trigger AS $$
BEGIN
  IF NEW.last_updated_at IS NULL OR NEW.last_updated_at < OLD.last_updated_at THEN
    NEW.last_updated_at := now();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS learner_mastery_touch ON public.learner_mastery;
CREATE TRIGGER learner_mastery_touch
  BEFORE UPDATE ON public.learner_mastery
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_learner_mastery_touch();

-- ── 4. Bus cursor for the event-listener daemon ─────────────────────
-- Single-row-per-key table that stores the high-water mark of
-- domain_events.occurred_at the daemon has processed. Daemon restart
-- is "read cursor, resume". Per-subscriber cursors are a future
-- enhancement (would require schema change here).
CREATE TABLE IF NOT EXISTS public.bus_cursor (
  cursor_key   text PRIMARY KEY,
  cursor_value text NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.bus_cursor IS
  'High-water marks for bus consumers. Keyed by cursor_key '
  '(e.g. domain_events_watermark). Read/written by '
  'src/lib/state/runtime/event-listener.ts on every tick.';

ALTER TABLE public.bus_cursor ENABLE ROW LEVEL SECURITY;

CREATE POLICY bus_cursor_service_all
  ON public.bus_cursor
  FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- Seed the default cursor so the first tick reads "all events since
-- the dawn of time" — which is fine because domain_events starts
-- empty.
INSERT INTO public.bus_cursor (cursor_key, cursor_value)
VALUES ('domain_events_watermark', '1970-01-01T00:00:00Z')
ON CONFLICT (cursor_key) DO NOTHING;
