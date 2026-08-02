-- Migration: 20260802090000_widen_learning_events_placement_probe.sql
-- Purpose: Widen learning_events.event_type to admit placement probes, and
--          close a write-path race with a DB-enforced idempotency guard.
--          Wave B (Today-home v2 / offline / exam schedule / placement
--          check), flag-gated by ff_placement_v1 (seeded OFF in migration
--          20260802090200). This migration alone changes zero behavior.
--
-- WHY (event_type widening): the first-run placement check needs to set a
-- BKT prior without recording a graded attempt. Storing it as 'quiz_attempt'
-- would inflate attempt counts and let calibration masquerade as earned
-- performance. Storing it on student_learning_profiles as a new column
-- would put a second writer on a canonical table.
--
-- Instead: one new event_type on the append-only stream. The projector
-- treats 'placement_probe' as prior-setting and never as performance.
-- Provenance lives in context: { source: 'placement', unseen: boolean }.
-- (BKT-projector wiring for this event type is explicitly out of scope for
-- this migration and stays deferred future work.)
--
-- BACKWARD COMPATIBILITY: this only WIDENS the CHECK constraint. Every
-- existing row still satisfies it; no data is rewritten; no reader changes.
-- Rollback: re-add the narrower constraint after deleting placement rows.
--
-- WHY (idempotency index) — review follow-up, confirmed race condition:
-- the placement-answer write path can be retried by the client (flaky
-- connection, duplicate tap) the same way a quiz submit can. Per the
-- quiz_sessions precedent (20260504100200_quiz_idempotency_key.sql),
-- idempotency is enforced with a DB-level partial UNIQUE index, not an
-- app-level select-then-insert (which races). The API layer generates an
-- idempotency key at write time and stores it in
-- context->>'idempotencyKey'; this partial unique index guarantees at most
-- one placement_probe row per (student_id, idempotencyKey). A retry raises
-- a unique-violation (Postgres error code 23505), which the API route is
-- expected to catch and translate into { accepted: true, duplicate: true }
-- — mirroring how the quiz path's caller handles the quiz_sessions
-- idempotency index.
--
-- Index name for backend's 23505 match:
--   learning_events_placement_probe_idempotency_uniq
-- Columns: (student_id, (context ->> 'idempotencyKey')),
--   filtered to event_type = 'placement_probe'.
-- Note: a NULL context->>'idempotencyKey' never collides with itself (NULL
-- <> NULL under a unique index), so this only guards writes that actually
-- supply a key. Callers are expected to always supply one, mirroring the
-- quiz path's contract.
--
-- Idempotent: DROP CONSTRAINT IF EXISTS + re-ADD CONSTRAINT is safe to
-- re-run (the widened CHECK is byte-identical on a second apply);
-- CREATE UNIQUE INDEX IF NOT EXISTS is safe to re-run.

BEGIN;

ALTER TABLE public.learning_events
  DROP CONSTRAINT IF EXISTS learning_events_event_type_check;

ALTER TABLE public.learning_events
  ADD CONSTRAINT learning_events_event_type_check
  CHECK (event_type IN (
    'quiz_attempt','foxy_ask','hint_used','topic_opened',
    'session_start','session_end','mastery_updated','solver_used',
    'placement_probe'
  ));

-- Race-condition fix: DB-enforced idempotency for placement_probe writes.
CREATE UNIQUE INDEX IF NOT EXISTS learning_events_placement_probe_idempotency_uniq
  ON public.learning_events (student_id, (context ->> 'idempotencyKey'))
  WHERE event_type = 'placement_probe';

COMMIT;
