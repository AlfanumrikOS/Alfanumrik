-- ADR-005 PR 1: Per-subscriber substrate for the projector runtime.
--
-- Adds the per-subscriber bookkeeping tables that replace the single global
-- `bus_cursor`, plus the persistent retry state, dead-letter table, hot-path
-- index on the state-events bus, lag observability view, seed row for the
-- mastery-state-writer subscriber, and a kill-switch feature flag for the
-- projector-runner Edge Function.
--
-- See:
--   docs/superpowers/specs/2026-05-12-projector-substrate-design.md
--   docs/superpowers/plans/2026-05-12-state-runtime-hardening.md
--
-- All tables are service_role-only via RLS (matches `public.state_events`).

-- Per-subscriber watermarks. One row per registered subscriber.
CREATE TABLE IF NOT EXISTS public.subscriber_offsets (
  subscriber_name             text         PRIMARY KEY,
  kind_filter                 text         NOT NULL,
  last_processed_event_id     uuid                  NULL,
  last_processed_occurred_at  timestamptz           NULL,
  events_processed            bigint       NOT NULL DEFAULT 0,
  events_dead_lettered        bigint       NOT NULL DEFAULT 0,
  updated_at                  timestamptz  NOT NULL DEFAULT now()
);

-- Persistent per-event retry state across ticks. Cleared on success;
-- promoted to subscriber_dead_letters when attempt_count reaches maxRetries.
CREATE TABLE IF NOT EXISTS public.subscriber_retry_state (
  event_id            uuid         NOT NULL,
  subscriber_name     text         NOT NULL,
  attempt_count       int          NOT NULL,
  first_attempted_at  timestamptz  NOT NULL DEFAULT now(),
  last_attempted_at   timestamptz  NOT NULL DEFAULT now(),
  last_error          text         NOT NULL,
  PRIMARY KEY (event_id, subscriber_name)
);

-- Terminal: events that exhausted all retries.
CREATE TABLE IF NOT EXISTS public.subscriber_dead_letters (
  event_id             uuid         NOT NULL,
  subscriber_name      text         NOT NULL,
  attempt_count        int          NOT NULL,
  last_error           text         NOT NULL,
  first_attempted_at   timestamptz  NOT NULL,
  last_attempted_at    timestamptz  NOT NULL DEFAULT now(),
  resolved_at          timestamptz           NULL,
  PRIMARY KEY (event_id, subscriber_name)
);

-- Hot-path index on the bus.
CREATE INDEX IF NOT EXISTS idx_state_events_kind_occurred_event
  ON public.state_events (kind, occurred_at, event_id);

-- RLS: service_role only (matches state_events).
ALTER TABLE public.subscriber_offsets       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriber_retry_state   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriber_dead_letters  ENABLE ROW LEVEL SECURITY;

-- Explicit service_role policies (matches A-08 audit pattern + state_events).
DROP POLICY IF EXISTS subscriber_offsets_service_all      ON public.subscriber_offsets;
CREATE POLICY        subscriber_offsets_service_all      ON public.subscriber_offsets
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS subscriber_retry_state_service_all  ON public.subscriber_retry_state;
CREATE POLICY        subscriber_retry_state_service_all  ON public.subscriber_retry_state
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS subscriber_dead_letters_service_all ON public.subscriber_dead_letters;
CREATE POLICY        subscriber_dead_letters_service_all ON public.subscriber_dead_letters
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Per-subscriber lag view.
--
-- ORDER-INDEPENDENT SECURITY HARDENING: created WITH (security_invoker = on) so
-- the view enforces the querier's RLS on state_events / subscriber_offsets /
-- subscriber_retry_state. The earlier migration
-- 20260515000002_security_hardening_secdef_anon_searchpath_rls_view.sql also
-- hardens this view via ALTER VIEW, but that ALTER is now guarded to no-op on a
-- fresh replay (the view doesn't exist yet on May 15). Baking the invoker
-- setting in here makes the end-state identical on every environment regardless
-- of replay order. On prod this is a no-op: the view already exists and is
-- already security_invoker=on from the May-15 ALTER (this migration is marked
-- applied and won't re-run there).
CREATE OR REPLACE VIEW public.subscriber_lag
WITH (security_invoker = on) AS
SELECT
  so.subscriber_name,
  so.kind_filter,
  so.last_processed_occurred_at,
  so.events_processed,
  so.events_dead_lettered,
  (
    SELECT COUNT(*)
    FROM public.state_events se
    WHERE se.kind = so.kind_filter
      AND (se.occurred_at, se.event_id) >
          (COALESCE(so.last_processed_occurred_at, '1970-01-01'::timestamptz),
           COALESCE(so.last_processed_event_id, '00000000-0000-0000-0000-000000000000'::uuid))
  ) AS events_behind,
  (
    SELECT COUNT(*) FROM public.subscriber_retry_state
    WHERE subscriber_name = so.subscriber_name
  ) AS events_in_retry,
  NOW() - COALESCE(so.last_processed_occurred_at, NOW()) AS age_behind
FROM public.subscriber_offsets so;

-- Seed offsets at NOW so this migration doesn't replay history.
INSERT INTO public.subscriber_offsets (subscriber_name, kind_filter, last_processed_occurred_at)
VALUES ('mastery-state-writer', 'learner.mastery_changed', NOW())
ON CONFLICT (subscriber_name) DO NOTHING;

-- Kill-switch flag.
INSERT INTO public.feature_flags (
  flag_name, description, is_enabled, rollout_percentage, target_environments
)
VALUES (
  'ff_projector_runner_v1',
  'ADR-005 PR 1: kill-switch for the projector-runner Edge Function. When OFF, the runner returns {skipped:true}. See docs/superpowers/specs/2026-05-12-projector-substrate-design.md',
  false, 0, '{}'::text[]
)
ON CONFLICT (flag_name) DO NOTHING;
