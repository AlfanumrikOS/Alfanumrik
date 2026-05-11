-- Migration: 20260516180000_domain_events_bus.sql
-- Purpose: The substrate for the unified state architecture
--          (src/lib/state/). Every cross-feature signal in Alfanumrik
--          lands in this table as a row; subscribers consume via
--          pg_notify and Supabase Realtime.
--
-- This single table replaces the dozens of bespoke "feature X notifies
-- feature Y" call paths that exist today (quiz→parent, foxy→mastery,
-- school admin→student sidebar, etc.). Features publish events; the
-- Orchestrator and other subscribers fan out.
--
-- Why a table (rather than a pure pubsub):
--   - Durability: subscribers can replay missed events from a known
--     watermark. Realtime channels alone lose anything fired while a
--     subscriber was down.
--   - Audit: every cross-feature signal is queryable for compliance,
--     debugging, and the mesh agent's outcome attribution.
--   - Idempotency: UNIQUE(idempotency_key) makes publishEvent() safely
--     retryable; subscribers dedupe by event_id.
--
-- Design choices:
--   - `kind` is a free-form text constrained by CHECK (regex match).
--     The TS registry in src/lib/state/events/registry.ts is the source
--     of truth for the allowed set; the DB tolerates anything that
--     matches the slug shape so we can ship new events without a
--     migration.
--   - `payload` is jsonb. Schema enforcement is at the publishEvent()
--     layer (Zod). The DB is permissive on shape so we never lose a
--     well-formed event to a schema lag.
--   - `tenant_id` is denormalised onto every row for fast tenant-scoped
--     queries (parent notifications, school admin dashboards). Foreign
--     key only — RLS scope is the application layer's job; the bus
--     itself is service_role only.
--
-- pg_notify wire-up: a trigger fires `pg_notify('domain_events', ...)`
-- with the event_id on every INSERT. Subscribers (the Orchestrator
-- worker, mesh outcome attributor, parent notifier) LISTEN on the
-- channel and SELECT the row by event_id for the payload.
--
-- RLS: service_role only. End-user code reads the projections built by
-- subscribers (StudentState, parent reports, teacher dashboards), not
-- raw events. Mirrors the agent-mesh substrate pattern.
--
-- DOWN (manual, destructive — staging only):
--   DROP TABLE IF EXISTS public.domain_events CASCADE;
--   DROP FUNCTION IF EXISTS public.notify_domain_event() CASCADE;
--   DELETE FROM feature_flags WHERE flag_name = 'ff_orchestrator_v1';

CREATE TABLE IF NOT EXISTS public.domain_events (
  event_id            uuid        PRIMARY KEY,
  kind                text        NOT NULL,
  actor_auth_user_id  uuid        NOT NULL,
  tenant_id           uuid                 REFERENCES public.schools(id) ON DELETE SET NULL,
  idempotency_key     text        NOT NULL,
  occurred_at         timestamptz NOT NULL,
  payload             jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT domain_events_kind_format CHECK (
    kind ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$'
  ),
  CONSTRAINT domain_events_idempotency_unique UNIQUE (idempotency_key)
);

COMMENT ON TABLE public.domain_events IS
  'Append-only event bus for the unified state architecture. Every '
  'cross-feature signal lands here. Subscribers fan out via pg_notify '
  '+ Supabase Realtime. Source of truth for event SHAPE: '
  'src/lib/state/events/registry.ts.';

-- Hot path: subscribers want "all events since watermark, in order".
CREATE INDEX IF NOT EXISTS idx_domain_events_occurred
  ON public.domain_events (occurred_at DESC, event_id);

-- Tenant-scoped reads (parent notifications, school dashboards).
CREATE INDEX IF NOT EXISTS idx_domain_events_tenant_kind
  ON public.domain_events (tenant_id, kind, occurred_at DESC)
  WHERE tenant_id IS NOT NULL;

-- Per-actor lookups (e.g. "all events for this learner this week").
CREATE INDEX IF NOT EXISTS idx_domain_events_actor_kind
  ON public.domain_events (actor_auth_user_id, kind, occurred_at DESC);

-- ── pg_notify trigger ──────────────────────────────────────────────
-- Fires on every INSERT so async subscribers wake immediately. Payload
-- is just the event_id; subscribers SELECT the row for the full body.
-- Keeping NOTIFY payloads small avoids the 8000-byte channel limit.

CREATE OR REPLACE FUNCTION public.notify_domain_event()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pg_notify('domain_events', NEW.event_id::text);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_domain_events_notify ON public.domain_events;
CREATE TRIGGER trg_domain_events_notify
  AFTER INSERT ON public.domain_events
  FOR EACH ROW EXECUTE FUNCTION public.notify_domain_event();

-- ── RLS ────────────────────────────────────────────────────────────
ALTER TABLE public.domain_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role full access" ON public.domain_events;
CREATE POLICY "service_role full access"
  ON public.domain_events
  AS PERMISSIVE
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ── Feature flag seed ──────────────────────────────────────────────
-- Default OFF. Flipping ff_event_bus_v1 to true makes publishEvent()
-- start writing rows. Flipping ff_orchestrator_v1 makes the
-- Orchestrator start reading them and applying state mutations.
-- They are SEPARATE so the bus can warm up (events flowing, subscribers
-- watching) before the orchestrator takes ownership of state.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM feature_flags WHERE flag_name = 'ff_event_bus_v1') THEN
    INSERT INTO feature_flags (flag_name, is_enabled, rollout_percentage, description)
    VALUES (
      'ff_event_bus_v1', false, 0,
      'Gates writes to public.domain_events via src/lib/state/events/publish.ts. '
      'When ON: cross-feature events accumulate, queryable for audit, but no '
      'subscriber acts on them yet. Pair with ff_orchestrator_v1 to activate '
      'the consumer side. Owner: principal-architect.'
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM feature_flags WHERE flag_name = 'ff_orchestrator_v1') THEN
    INSERT INTO feature_flags (flag_name, is_enabled, rollout_percentage, description)
    VALUES (
      'ff_orchestrator_v1', false, 0,
      'Gates the central orchestrator service (src/lib/state/orchestrator.ts). '
      'When ON: orchestrator picks up domain_events via pg_notify, applies '
      'state mutations, drives rule-engine decisions. When OFF: bus is inert. '
      'Owner: principal-architect.'
    );
  END IF;
END $$;
