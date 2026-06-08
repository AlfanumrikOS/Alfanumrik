-- Migration: 20260521100000_state_events_bus_rename.sql
-- Purpose: Fix the schema collision introduced by 20260516180000_domain_events_bus.sql.
--
-- THE PROBLEM
-- ===========
-- The baseline migration (00000000000000_baseline_from_prod.sql) already
-- contained a `public.domain_events` table — the LEGACY OUTBOX pattern
-- used by src/lib/domains/content.ts, the bulk plan-change route, and
-- the enqueue_event RPC. Its schema:
--   id            uuid PRIMARY KEY
--   event_type    text
--   aggregate_type text
--   aggregate_id  uuid
--   status        text ('pending'|'processing'|'processed'|...)
--   payload       jsonb
--
-- The Phase-1 substrate migration (20260516180000) tried to create a
-- DIFFERENT `public.domain_events` for the unified-state event bus:
--   event_id            uuid PK
--   kind                text
--   actor_auth_user_id  uuid
--   tenant_id           uuid
--   idempotency_key     text
--   occurred_at         timestamptz
--
-- Three failure modes that resulted:
--   1. `CREATE TABLE IF NOT EXISTS` silently no-op'd on environments that
--      had the legacy outbox (production + staging). The unified-state
--      table never got created.
--   2. `CREATE INDEX IF NOT EXISTS idx_domain_events_occurred ON
--      domain_events (occurred_at DESC, event_id)` would have failed
--      because those columns don't exist on the legacy table — the
--      migration left a partial state.
--   3. The pg_notify trigger `trg_domain_events_notify` references
--      `NEW.event_id`. If it ever attached to the legacy table, every
--      legacy outbox insert (super-admin plan changes, content events)
--      would have failed at runtime.
--
-- THE FIX
-- =======
-- Rename the unified-state bus to `public.state_events`. The legacy
-- `public.domain_events` outbox stays exactly where it was — no schema
-- changes, no behaviour changes for the routes that already depend on
-- it. Code in src/lib/state/* points at the new name from this PR
-- forward.
--
-- This migration is forward-only and idempotent:
--   - Drops the (probably-nonexistent) Phase-1 trigger and function.
--     On a fresh dev DB that never had the legacy outbox, the trigger
--     DID get created — that's why we drop, not just rename.
--   - Creates `public.state_events` fresh. The bus has never been
--     written to in production (both flags ship OFF), so there's no
--     data migration to do.
--   - Re-attaches the pg_notify trigger to the new table on a fresh
--     channel name (`state_events_new`) so listeners can't confuse
--     bus events with anything else.
--   - Adds `bus_cursor` so the polling event-listener daemon has a
--     watermark store. (Phase 2's migration that adds this is on an
--     unmerged PR; we put it here so the substrate is complete.)
--
-- DOWN (manual, destructive — staging only):
--   DROP TABLE IF EXISTS public.state_events CASCADE;
--   DROP TABLE IF EXISTS public.bus_cursor CASCADE;
--   DROP FUNCTION IF EXISTS public.notify_state_event() CASCADE;

-- ── 1. Tear down the broken Phase-1 wiring ──────────────────────────
-- These are no-ops on environments where they never got created
-- (production + staging). On a fresh dev DB they clean up the
-- collision.
DROP TRIGGER IF EXISTS trg_domain_events_notify ON public.domain_events;
DROP FUNCTION IF EXISTS public.notify_domain_event() CASCADE;

-- ── 2. The unified-state event bus, under its non-colliding name ───
CREATE TABLE IF NOT EXISTS public.state_events (
  event_id            uuid        PRIMARY KEY,
  kind                text        NOT NULL,
  actor_auth_user_id  uuid        NOT NULL,
  tenant_id           uuid                 REFERENCES public.schools(id) ON DELETE SET NULL,
  idempotency_key     text        NOT NULL,
  occurred_at         timestamptz NOT NULL,
  payload             jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT state_events_kind_format CHECK (
    kind ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$'
  ),
  CONSTRAINT state_events_idempotency_unique UNIQUE (idempotency_key)
);

COMMENT ON TABLE public.state_events IS
  'Append-only event bus for the unified state architecture '
  '(src/lib/state/). One row per cross-feature signal. Subscribers '
  'fan out via pg_notify + Supabase Realtime. Source of truth for '
  'event SHAPE: src/lib/state/events/registry.ts. NOT to be confused '
  'with public.domain_events, which is the legacy outbox table used '
  'by content / plan-change routes (different schema, different purpose).';

CREATE INDEX IF NOT EXISTS idx_state_events_occurred
  ON public.state_events (occurred_at DESC, event_id);

CREATE INDEX IF NOT EXISTS idx_state_events_tenant_kind
  ON public.state_events (tenant_id, kind, occurred_at DESC)
  WHERE tenant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_state_events_actor_kind
  ON public.state_events (actor_auth_user_id, kind, occurred_at DESC);

-- ── 3. pg_notify trigger on the new table ───────────────────────────
-- ORDER-INDEPENDENT SECURITY HARDENING: search_path is locked here in the
-- CREATE OR REPLACE so a fresh from-scratch replay ends up with the same
-- function definition prod has. The earlier migration
-- 20260515000002_security_hardening_secdef_anon_searchpath_rls_view.sql also
-- locks search_path on this function via ALTER FUNCTION, but that ALTER is now
-- guarded to no-op on a fresh replay (the function doesn't exist yet on May 15).
-- Baking SET search_path in here makes the end-state identical regardless of
-- replay order. On prod this is a no-op (the function already has the lock from
-- the May-15 ALTER; this migration is marked applied and won't re-run there).
CREATE OR REPLACE FUNCTION public.notify_state_event()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM pg_notify('state_events_new', NEW.event_id::text);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_state_events_notify ON public.state_events;
CREATE TRIGGER trg_state_events_notify
  AFTER INSERT ON public.state_events
  FOR EACH ROW EXECUTE FUNCTION public.notify_state_event();

-- ── 4. RLS — service_role only ──────────────────────────────────────
ALTER TABLE public.state_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role full access" ON public.state_events;
CREATE POLICY "service_role full access"
  ON public.state_events
  AS PERMISSIVE
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ── 5. Bus cursor for the polling listener daemon ───────────────────
-- Single-row-per-key store of the high-water mark the daemon has
-- processed. Restart-safety is "read cursor, resume". Lives here so
-- the substrate is self-contained.
CREATE TABLE IF NOT EXISTS public.bus_cursor (
  cursor_key   text PRIMARY KEY,
  cursor_value text NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.bus_cursor IS
  'High-water marks for bus consumers (e.g. the polling event-listener '
  'daemon in src/lib/state/runtime/event-listener.ts). Keyed by '
  'cursor_key (e.g. state_events_watermark).';

ALTER TABLE public.bus_cursor ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bus_cursor_service_all ON public.bus_cursor;
CREATE POLICY bus_cursor_service_all
  ON public.bus_cursor
  FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- Seed the default cursor so the first tick reads "all events since
-- the dawn of time" — which is fine because state_events starts empty.
INSERT INTO public.bus_cursor (cursor_key, cursor_value)
VALUES ('state_events_watermark', '1970-01-01T00:00:00Z')
ON CONFLICT (cursor_key) DO NOTHING;
