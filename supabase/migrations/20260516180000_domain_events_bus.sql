-- Migration: 20260516180000_domain_events_bus.sql (env-aware recovery)
--
-- ORIGINAL INTENT: stand up the unified-state event bus as public.domain_events.
--
-- DISCOVERED PROBLEM (post-merge of PR #752, 2026-05-12): production +
-- staging already had a legacy public.domain_events outbox table from
-- the baseline migration with a different schema (10 cols: id, event_type,
-- aggregate_type, aggregate_id, status, payload, retry_count, last_error,
-- created_at, processed_at). The original CREATE TABLE IF NOT EXISTS
-- silently no-op'd on those environments; the subsequent CREATE INDEX /
-- TRIGGER / POLICY statements failed on missing columns like occurred_at,
-- aborting the Deploy Production workflow.
--
-- The legacy outbox is in active use by three functions:
--   - public.atomic_school_plan_change (audit trail via enqueue_event)
--   - public.archive_processed_events (retention cleanup)
--   - public.enqueue_event             (the legacy INSERT helper)
-- All three must keep working untouched.
--
-- THE FIX: this migration is now env-aware. It detects the legacy outbox
-- and defers the unified-bus creation to
-- 20260521100000_state_events_bus_rename.sql, which creates the bus under
-- the non-colliding name public.state_events. On environments WITHOUT the
-- legacy outbox (clean dev DBs), the original creation path still runs.
--
-- Feature-flag seeds (ff_event_bus_v1, ff_orchestrator_v1) run on BOTH
-- paths — those flags exist independently of the bus table name.

DO $outer$
DECLARE
  v_legacy_outbox_exists boolean;
BEGIN
  -- Detect the legacy outbox by a column unique to it.
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'domain_events'
       AND column_name  = 'event_type'
  ) INTO v_legacy_outbox_exists;

  IF v_legacy_outbox_exists THEN
    RAISE NOTICE
      'Legacy public.domain_events outbox detected; deferring unified bus '
      'creation to 20260521100000_state_events_bus_rename.sql (which creates '
      'public.state_events under a non-colliding name). Legacy outbox '
      'preserved untouched.';
  ELSE
    -- ── Clean environment: original creation path ────────────────────
    EXECUTE $ddl$
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
      )
    $ddl$;

    EXECUTE $ddl$
      COMMENT ON TABLE public.domain_events IS
        'Append-only event bus for the unified state architecture. Every '
        'cross-feature signal lands here. Subscribers fan out via pg_notify '
        '+ Supabase Realtime. Source of truth for event SHAPE: '
        'src/lib/state/events/registry.ts.'
    $ddl$;

    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_domain_events_occurred '
            'ON public.domain_events (occurred_at DESC, event_id)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_domain_events_tenant_kind '
            'ON public.domain_events (tenant_id, kind, occurred_at DESC) '
            'WHERE tenant_id IS NOT NULL';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_domain_events_actor_kind '
            'ON public.domain_events (actor_auth_user_id, kind, occurred_at DESC)';

    EXECUTE $ddl$
      CREATE OR REPLACE FUNCTION public.notify_domain_event()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $fn$
      BEGIN
        PERFORM pg_notify('domain_events', NEW.event_id::text);
        RETURN NEW;
      END;
      $fn$
    $ddl$;

    EXECUTE 'DROP TRIGGER IF EXISTS trg_domain_events_notify ON public.domain_events';
    EXECUTE 'CREATE TRIGGER trg_domain_events_notify '
            'AFTER INSERT ON public.domain_events '
            'FOR EACH ROW EXECUTE FUNCTION public.notify_domain_event()';

    EXECUTE 'ALTER TABLE public.domain_events ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS "service_role full access" ON public.domain_events';
    EXECUTE $ddl$
      CREATE POLICY "service_role full access"
        ON public.domain_events
        AS PERMISSIVE
        FOR ALL
        TO service_role
        USING (true)
        WITH CHECK (true)
    $ddl$;
  END IF;

  -- ── Feature flag seed (runs on BOTH paths) ──────────────────────────
  -- These flags exist independently of which physical table the bus
  -- writes go to. ff_event_bus_v1 gates publishEvent() in
  -- src/lib/state/events/publish.ts; ff_orchestrator_v1 gates the
  -- consumer side.
  IF NOT EXISTS (SELECT 1 FROM public.feature_flags WHERE flag_name = 'ff_event_bus_v1') THEN
    INSERT INTO public.feature_flags (flag_name, is_enabled, rollout_percentage, description)
    VALUES (
      'ff_event_bus_v1', false, 0,
      'Gates writes to the unified state bus via src/lib/state/events/publish.ts. '
      'When ON: cross-feature events accumulate, queryable for audit. Pair with '
      'ff_orchestrator_v1 to activate the consumer side. Owner: principal-architect.'
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.feature_flags WHERE flag_name = 'ff_orchestrator_v1') THEN
    INSERT INTO public.feature_flags (flag_name, is_enabled, rollout_percentage, description)
    VALUES (
      'ff_orchestrator_v1', false, 0,
      'Gates the central orchestrator service (src/lib/state/orchestrator.ts). '
      'When ON: orchestrator picks up bus events via pg_notify, applies state '
      'mutations, drives rule-engine decisions. When OFF: bus is inert. '
      'Owner: principal-architect.'
    );
  END IF;
END
$outer$;
