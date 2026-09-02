-- P1-11 fix (2026-09-02 launch audit, sub-item). Wires the new
-- api-rate-limit.ts Redis-unavailable signal (category 'infra', source
-- 'api-rate-limit', severity 'warning' — see packages/lib/src/
-- api-rate-limit.ts) into the existing ops-alerting pipeline.
--
-- Context: /api/schools/trial (unauthenticated school-trial provisioning,
-- 5/hour/IP) and other public v1 API-key routes rate-limit via Upstash
-- Redis, falling back to a PROCESS-LOCAL in-memory map when Redis is
-- unreachable or misconfigured. That fallback is real protection on a
-- single instance but is NOT shared across Vercel's concurrent
-- instances/regions, so a sustained Redis outage silently and substantially
-- weakens abuse protection on an unauthenticated, email-sending endpoint —
-- previously with zero signal. evaluate_alert_rules() only fires rules that
-- exist in alert_rules; without this seed the new event would be evaluated
-- (by the */5 pg_cron sweep — 'warning' is below the ops_events critical-
-- insert trigger's threshold, so it is NOT delivered immediately, only on
-- the periodic sweep) and delivered NOWHERE.
--
-- Rule values: min_severity 'warning' (matches the event's own severity —
-- deliberately non-blocking on the hot path, see the code comment), source
-- NULL (wildcards to any future 'infra'-category event, not just this one),
-- count_threshold 10 in window_minutes 15 (a sustained outage crosses this
-- fast on a live-traffic route; a single transient blip does not),
-- cooldown_minutes 60 (avoid repeat-alerting every 5-minute sweep for the
-- length of one outage). Channel: the 'CEO email' notification_channels row
-- (seeded by 20260713160000), matching every other seeded rule.
--
-- Idempotency: alert_rules.name has NO unique constraint, so
--   INSERT ... SELECT ... WHERE NOT EXISTS existence guard. Safe to run twice.
-- Fresh-DB guard: to_regclass checks on both tables; NOTICE + no-op when the
--   alerting schema is absent.

DO $$
BEGIN
  IF to_regclass('public.alert_rules') IS NULL
     OR to_regclass('public.notification_channels') IS NULL THEN
    RAISE NOTICE 'seed_alert_rule_redis_rate_limiter_fallback: alerting tables absent - skipping (fresh-DB guard)';
    RETURN;
  END IF;

  INSERT INTO public.alert_rules (
    name, description, enabled, category, source, min_severity,
    count_threshold, window_minutes, channel_ids, cooldown_minutes
  )
  SELECT
    'Redis rate limiter running on in-memory fallback',
    'checkApiRateLimit() (packages/lib/src/api-rate-limit.ts) could not reach Upstash Redis and fell back to a process-local in-memory rate limiter, which is not shared across Vercel instances/regions. Affects /api/schools/trial and other public v1 API-key routes. Check Upstash status and UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN.',
    true,
    'infra',
    NULL,
    'warning',
    10,
    15,
    ARRAY[(SELECT id FROM public.notification_channels WHERE name = 'CEO email')],
    60
  WHERE NOT EXISTS (
    SELECT 1 FROM public.alert_rules WHERE name = 'Redis rate limiter running on in-memory fallback'
  );
END $$;
