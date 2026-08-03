-- Migration: 20260802090000_widen_learning_events_placement_probe.sql
-- Purpose: REVERTED 2026-08-02, same session, before this file was ever
--          applied to any database. Originally widened
--          learning_events.event_type to admit 'placement_probe' and added
--          a DB-enforced idempotency guard for the placement-answer write
--          path (Wave B "Placement Check" feature, flag-gated by
--          ff_placement_v1, seeded in migration 20260802090200).
--
-- WHY REVERTED: same session, assessment determined (with evidence) that
-- Placement Check duplicates the already-live, more rigorous /diagnostic
-- system (packages/lib/src/diagnostic/blueprint.ts) and deleted its
-- selector/hook/component/tests entirely; backend is removing the
-- now-orphaned /api/v2/placement* routes and contract/OpenAPI entries in
-- parallel. ff_placement_v1 was seeded OFF and never flipped — zero rows
-- with event_type='placement_probe' exist anywhere, and nothing will read
-- or write that event type once backend's cleanup lands.
--
-- Architect decision (per CEO's explicit "do not keep anything old"
-- directive — default to removing dead capability, not leaving it as
-- unreferenced cruft, whenever removal is free):
--   - CHECK constraint: NARROWED BACK to the original 8 values. A widen by
--     itself is harmless to leave, but a CHECK-admitted value with no
--     writer anywhere in the codebase (and no BKT-projector wiring — that
--     was already deferred/out of scope even before the revert) is exactly
--     the unreferenced cruft the CEO asked us to avoid. Reverting it here
--     is free: this migration was never applied anywhere, so there is no
--     data to break and no compensating migration to write.
--   - Unique index (learning_events_placement_probe_idempotency_uniq):
--     DROPPED outright. It existed solely to guard a write path
--     (POST /api/v2/placement/answer) that no longer exists once backend's
--     cleanup lands; there is no "harmless to keep" case for an index
--     guarding zero possible writers.
--
-- Net effect: this migration is now an intentional no-op against every real
-- environment (all of which already have the original 8-value constraint
-- and no such index), and self-heals any environment that somehow already
-- applied the pre-revert widened version. Kept as a file, rather than
-- deleted, to preserve the historical record of the explored-then-abandoned
-- widen and to record the reasoning above at the point future readers will
-- look for it.
--
-- Idempotent: DROP CONSTRAINT IF EXISTS + re-ADD CONSTRAINT is safe to
-- re-run (byte-identical on a second apply); DROP INDEX IF EXISTS is safe
-- to re-run.

BEGIN;

-- Revert: restore the original 8-value CHECK constraint.
-- 'placement_probe' removed — see header note above.
ALTER TABLE public.learning_events
  DROP CONSTRAINT IF EXISTS learning_events_event_type_check;

ALTER TABLE public.learning_events
  ADD CONSTRAINT learning_events_event_type_check
  CHECK (event_type IN (
    'quiz_attempt','foxy_ask','hint_used','topic_opened',
    'session_start','session_end','mastery_updated','solver_used'
  ));

-- Revert: the placement_probe idempotency guard has zero possible writers
-- now that the feature it protected is deleted. Dropped outright.
-- IF EXISTS is defensive only — this migration was never applied anywhere.
DROP INDEX IF EXISTS learning_events_placement_probe_idempotency_uniq;

COMMIT;
