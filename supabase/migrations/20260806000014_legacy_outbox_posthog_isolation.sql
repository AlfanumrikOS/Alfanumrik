-- Migration: Legacy outbox deprecation + PostHog environment isolation (P2-10, P2-11)
-- Audit remediation 2026-08-06:
--   1. Deprecates legacy domain_events outbox in favor of state_events bus.
--   2. Documents PostHog environment separation requirement.

-- Part 1: Mark legacy outbox as deprecated with COMMENT
COMMENT ON TABLE public.domain_events IS
  'DEPRECATED (P2-11, 2026-08-06): Legacy outbox pattern. Consumer should use state_events for new events. This table is retained for historical event replay only. Do not insert new events here.';

-- Verify state_events is the canonical event bus
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables WHERE table_name = 'state_events'
  ) THEN
    RAISE WARNING 'state_events table does not exist. Please run migrations 20260516180000 and 20260521100000 first.';
  END IF;
END $$;

-- Add a check constraint to domain_events to prevent new inserts via application code
-- (existing triggers/consumers can still write during migration period)
-- This is a soft enforcement via comment; hard enforcement requires consumer migration

-- Part 2: PostHog environment isolation record
CREATE TABLE IF NOT EXISTS public.analytics_environment_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  environment text NOT NULL UNIQUE CHECK (environment IN ('production', 'staging', 'development')),
  posthog_project_id text,
  posthog_host text,
  is_isolated boolean DEFAULT false,
  last_verified_at timestamptz,
  verified_by text,
  notes text
);

ALTER TABLE public.analytics_environment_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access analytics_environment_config"
  ON public.analytics_environment_config FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- Insert environment records
INSERT INTO public.analytics_environment_config
  (environment, posthog_project_id, is_isolated, notes)
VALUES
  ('production', '159341', true, 'Primary production PostHog project. Must NOT share with staging.'),
  ('staging', NULL, false, 'P2-10 remediation: staging needs separate PostHog project. Currently may share with production — verify and separate.'),
  ('development', NULL, false, 'Local dev. PostHog disabled or uses separate sandbox project.')
ON CONFLICT (environment) DO NOTHING;

-- Function: Verify PostHog environment isolation
CREATE OR REPLACE FUNCTION public.verify_posthog_isolation()
RETURNS TABLE(
  environment text,
  is_isolated boolean,
  verified_at timestamptz,
  issue text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  RETURN QUERY
  SELECT
    aec.environment,
    aec.is_isolated,
    aec.last_verified_at,
    CASE
      WHEN aec.is_isolated IS NULL OR aec.is_isolated = false THEN
        'NOT ISOLATED: PostHog project may be shared across environments.'
      WHEN aec.last_verified_at IS NULL THEN
        'ISOLATED (unverified): Claimed isolation has not been tested.'
      WHEN aec.last_verified_at < now() - interval '90 days' THEN
        'ISOLATED (stale): Last verification older than 90 days.'
      ELSE
        NULL
    END AS issue
  FROM public.analytics_environment_config aec
  ORDER BY aec.environment;
END;
$$;

REVOKE ALL ON FUNCTION public.verify_posthog_isolation() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.verify_posthog_isolation() TO service_role;
