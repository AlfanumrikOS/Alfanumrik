-- Migration: 20260713220000_bus_cursor_created_at.sql
-- Purpose: Make the state-event bus cursor order by the server-set, monotonic
--          `state_events.created_at` instead of caller-supplied `occurred_at`.
--
-- WHY (2026-07-13 incident)
-- =========================
-- The runtime (packages/lib/src/state/runtime/tick-one.ts) fetched events with
-- `.gte('occurred_at', cursor).order('occurred_at')` and advanced each
-- subscriber's watermark to the processed/dead-lettered event's occurred_at.
-- occurred_at is CALLER-SUPPLIED. An integration test (tick-one.test.ts) seeds
-- events with far-future occurred_at into a DB shared with live subscribers;
-- when its cleanup lagged, the live `mastery-state-writer` consumed a leftover
-- stamped occurred_at=2032 and advanced its watermark to 2032 — after which
-- every real, now-stamped event sorted BELOW the cursor and was silently
-- skipped. created_at is server-set and monotonic, so ordering by it makes the
-- bus immune to whatever occurred_at a publisher (or a test) chose.
--
-- This migration adds the cursor column, backfills it, and repoints the
-- `subscriber_lag` monitoring view to rank by created_at. The runtime change
-- (offsets.ts + tick-one.ts) reads/writes `last_processed_created_at` and falls
-- back to `last_processed_occurred_at` when it is NULL, so this migration and
-- the code deploy are order-independent (safe either way).
--
-- PRE-MERGE: validate on staging with an isolated state-runtime DB — this
-- changes bus DELIVERY ORDERING. See the companion runtime PR.
--
-- DOWN (manual):
--   DROP VIEW IF EXISTS public.subscriber_lag;  -- then recreate from 20260524110001
--   ALTER TABLE public.subscriber_offsets DROP COLUMN IF EXISTS last_processed_created_at;

BEGIN;

-- ── 1. Cursor column ───────────────────────────────────────────────────────
ALTER TABLE public.subscriber_offsets
  ADD COLUMN IF NOT EXISTS last_processed_created_at timestamptz;

-- ── 2. Backfill ────────────────────────────────────────────────────────────
-- Prefer the created_at of the exact last-processed event (precise resume
-- point). Fall back to the old occurred_at watermark, then to epoch, so no row
-- is left NULL and no subscriber jumps forward past unprocessed events.
UPDATE public.subscriber_offsets so
SET last_processed_created_at = COALESCE(
      (SELECT e.created_at FROM public.state_events e
        WHERE e.event_id = so.last_processed_event_id),
      so.last_processed_occurred_at,
      '1970-01-01T00:00:00Z'::timestamptz
    )
WHERE so.last_processed_created_at IS NULL;

-- ── 3. Repoint the lag view to created_at ──────────────────────────────────
-- DROP+CREATE (not CREATE OR REPLACE) so we can add the new column without
-- hitting the "cannot change view column order" constraint. events_behind and
-- age_behind now measure lag in INGESTION order, which is what the runtime
-- actually consumes.
DROP VIEW IF EXISTS public.subscriber_lag;
CREATE VIEW public.subscriber_lag AS
SELECT
  so.subscriber_name,
  so.kind_filter,
  so.last_processed_created_at,
  so.last_processed_occurred_at,
  so.events_processed,
  so.events_dead_lettered,
  (
    SELECT COUNT(*)
    FROM public.state_events se
    WHERE se.kind = so.kind_filter
      AND (se.created_at, se.event_id) >
          (COALESCE(so.last_processed_created_at, '1970-01-01'::timestamptz),
           COALESCE(so.last_processed_event_id, '00000000-0000-0000-0000-000000000000'::uuid))
  ) AS events_behind,
  (
    SELECT COUNT(*) FROM public.subscriber_retry_state
    WHERE subscriber_name = so.subscriber_name
  ) AS events_in_retry,
  NOW() - COALESCE(so.last_processed_created_at, NOW()) AS age_behind
FROM public.subscriber_offsets so;

-- Preserve the security posture the original view carried (20260524110001):
-- the view runs with the querier's RLS, not the definer's.
ALTER VIEW public.subscriber_lag SET (security_invoker = true);

COMMIT;
