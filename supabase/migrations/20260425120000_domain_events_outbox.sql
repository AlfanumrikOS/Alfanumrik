-- Migration: 20260425120000_domain_events_outbox.sql
-- Phase 0d.1: outbox pattern foundation
-- Per docs/architecture/EVENT_CATALOG.md and MIGRATION_AND_ROLLBACK_PLAN.md
-- Owner: B12/B13 (analytics + ops read; service-role writes via enqueue_event)
--
-- Purpose:
--   Establish the `public.domain_events` outbox table that all bounded
--   contexts will use to publish cross-context domain events. Producers
--   call `enqueue_event(...)` inside the same transaction as the source
--   state change. A future polling worker (Phase 0d.2/0d.3, repurposing
--   the existing `queue-consumer` Edge Function) will dispatch events to
--   consumers and mark them processed.
--
-- Scope of this phase:
--   - Migration-only. No callers of `enqueue_event` are added here.
--   - No Edge Function or queue-consumer wiring. That is Phase 0d.2/0d.3.
--   - No schema changes to existing tables.
--
-- Safety:
--   - Idempotent: CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS,
--     CREATE OR REPLACE FUNCTION.
--   - RLS enabled with no permissive policies — only the service role
--     (which bypasses RLS) can read/write directly. Application code
--     publishes via the SECURITY DEFINER `enqueue_event` RPC.
--   - SECURITY DEFINER functions follow the project convention of
--     `SET search_path = public` (per migration 20260408000009 to
--     guard against search_path injection).
--   - Aggregate-and-status indexes support the planned polling worker
--     query patterns without full scans.

BEGIN;

-- ────────────────────────────────────────────────────────────
-- 1. domain_events table
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.domain_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type      text NOT NULL,           -- e.g. 'content.request_submitted', 'quiz.completed'
  aggregate_type  text NOT NULL,           -- e.g. 'content_request', 'quiz_session'
  aggregate_id    uuid,                    -- nullable: some events are not tied to a single aggregate
  payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
  status          text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','processing','processed','failed','dead_letter')),
  retry_count     integer NOT NULL DEFAULT 0,
  last_error      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  processed_at    timestamptz,
  CONSTRAINT domain_events_event_type_format CHECK (event_type ~ '^[a-z_]+\.[a-z_]+$')
);

COMMENT ON TABLE public.domain_events IS
  'Outbox table for cross-context domain events. Producers insert via enqueue_event RPC inside the source transaction; a polling worker dispatches to consumers. See docs/architecture/EVENT_CATALOG.md.';

COMMENT ON COLUMN public.domain_events.event_type IS
  'Dotted lower_snake event name, e.g. quiz.completed (matches ^[a-z_]+\.[a-z_]+$).';
COMMENT ON COLUMN public.domain_events.aggregate_type IS
  'The bounded-context aggregate this event belongs to (e.g. quiz_session, content_request).';
COMMENT ON COLUMN public.domain_events.aggregate_id IS
  'Optional aggregate primary key; null for events not tied to a single row.';
COMMENT ON COLUMN public.domain_events.status IS
  'Lifecycle: pending -> processing -> processed | failed -> dead_letter (after max retries).';

-- ────────────────────────────────────────────────────────────
-- 2. Indexes
-- ────────────────────────────────────────────────────────────
-- Polling-worker hot path: oldest pending events first.
CREATE INDEX IF NOT EXISTS idx_domain_events_pending
  ON public.domain_events (created_at)
  WHERE status = 'pending';

-- Recent events by type (for ops/analytics queries).
CREATE INDEX IF NOT EXISTS idx_domain_events_event_type
  ON public.domain_events (event_type, created_at DESC);

-- Lookups by aggregate (debugging, replay, audit).
CREATE INDEX IF NOT EXISTS idx_domain_events_aggregate
  ON public.domain_events (aggregate_type, aggregate_id);

-- ────────────────────────────────────────────────────────────
-- 3. RLS — service-role-only access
-- ────────────────────────────────────────────────────────────
-- Enable RLS without granting any policies to authenticated/anon. The
-- service role bypasses RLS by design, so server code (and the
-- enqueue_event SECURITY DEFINER RPC) can read/write while client code
-- cannot. This matches the outbox security posture: events are an
-- internal infrastructure concern, never directly exposed to end users.
ALTER TABLE public.domain_events ENABLE ROW LEVEL SECURITY;

-- Defensive grants. Service role already has full access via its
-- bypass; explicit grants make the intent visible. We REVOKE from
-- authenticated/anon to remove any default privileges.
GRANT SELECT, INSERT, UPDATE ON public.domain_events TO service_role;
REVOKE ALL ON public.domain_events FROM authenticated;
REVOKE ALL ON public.domain_events FROM anon;

-- ────────────────────────────────────────────────────────────
-- 4. enqueue_event RPC
-- ────────────────────────────────────────────────────────────
-- SECURITY DEFINER so producers can publish events without needing
-- direct INSERT privileges on domain_events. The function validates
-- event_type format and aggregate_type presence to prevent malformed
-- events from polluting the outbox.
--
-- search_path is pinned to `public` per project convention (migration
-- 20260408000009 fixed this for all postgres-owned SECDEF functions).
CREATE OR REPLACE FUNCTION public.enqueue_event(
  p_event_type      text,
  p_aggregate_type  text,
  p_aggregate_id    uuid DEFAULT NULL,
  p_payload         jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_id uuid;
BEGIN
  IF p_event_type IS NULL OR p_event_type !~ '^[a-z_]+\.[a-z_]+$' THEN
    RAISE EXCEPTION 'invalid event_type: must match ^[a-z_]+\.[a-z_]+$';
  END IF;
  IF p_aggregate_type IS NULL OR length(p_aggregate_type) = 0 THEN
    RAISE EXCEPTION 'aggregate_type required';
  END IF;

  INSERT INTO public.domain_events (
    event_type,
    aggregate_type,
    aggregate_id,
    payload
  )
  VALUES (
    p_event_type,
    p_aggregate_type,
    p_aggregate_id,
    COALESCE(p_payload, '{}'::jsonb)
  )
  RETURNING id INTO v_event_id;

  RETURN v_event_id;
END;
$$;

COMMENT ON FUNCTION public.enqueue_event(text, text, uuid, jsonb) IS
  'Insert a domain event into the outbox. Call inside the producer transaction so the event is committed atomically with the source state change. SECURITY DEFINER; service-role-only EXECUTE.';

REVOKE EXECUTE ON FUNCTION public.enqueue_event(text, text, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enqueue_event(text, text, uuid, jsonb) TO service_role;

-- ────────────────────────────────────────────────────────────
-- 5. archive_processed_events maintenance RPC
-- ────────────────────────────────────────────────────────────
-- Service-role-only cleanup. Deletes events whose status is 'processed'
-- and whose processed_at is older than the supplied interval (default
-- 30 days). Returns the number of rows deleted.
CREATE OR REPLACE FUNCTION public.archive_processed_events(
  p_older_than interval DEFAULT '30 days'
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  DELETE FROM public.domain_events
  WHERE status = 'processed'
    AND processed_at IS NOT NULL
    AND processed_at < now() - p_older_than;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.archive_processed_events(interval) IS
  'Delete processed events older than the supplied interval (default 30 days). Service-role-only maintenance RPC.';

REVOKE EXECUTE ON FUNCTION public.archive_processed_events(interval) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.archive_processed_events(interval) TO service_role;

COMMIT;
