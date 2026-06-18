-- Register service-role cron Edge Functions with the Platform Security Layer.
-- Safe/idempotent: only upserts metadata; does not modify production data rows.

INSERT INTO public.security_quota_profiles (
  name, scope, role, route,
  requests_daily_limit, requests_monthly_limit,
  input_tokens_daily_limit, input_tokens_monthly_limit,
  output_tokens_daily_limit, output_tokens_monthly_limit,
  estimated_cost_daily_limit, estimated_cost_monthly_limit,
  max_concurrent_requests, circuit_breaker_threshold, enforcement_mode
)
SELECT
  route_name || '-internal-cron',
  'internal_service',
  'internal_service',
  route_name,
  10000, 300000,
  0, 0,
  0, 0,
  0, 0,
  4, 3,
  'enforce'
FROM (
  VALUES
    ('data-erasure-purger'),
    ('projector-runner'),
    ('projector-health-check'),
    ('synthetic-host-monitor'),
    ('queue-consumer'),
    ('daily-cron'),
    ('monthly-synthesis-builder'),
    ('verify-question-bank')
) AS cron(route_name)
ON CONFLICT (name) DO UPDATE
  SET scope = excluded.scope,
      role = excluded.role,
      route = excluded.route,
      requests_daily_limit = excluded.requests_daily_limit,
      requests_monthly_limit = excluded.requests_monthly_limit,
      max_concurrent_requests = excluded.max_concurrent_requests,
      circuit_breaker_threshold = excluded.circuit_breaker_threshold,
      enforcement_mode = excluded.enforcement_mode,
      updated_at = now();

INSERT INTO public.security_internal_callers (
  name, owner, description, status, caller_kind, quota_profile_id
)
SELECT
  route_name,
  'platform',
  'Service-role cron Edge Function: ' || route_name,
  'active',
  'cron_job',
  qp.id
FROM (
  VALUES
    ('data-erasure-purger'),
    ('projector-runner'),
    ('projector-health-check'),
    ('synthetic-host-monitor'),
    ('queue-consumer'),
    ('daily-cron'),
    ('monthly-synthesis-builder'),
    ('verify-question-bank')
) AS cron(route_name)
JOIN public.security_quota_profiles qp ON qp.name = route_name || '-internal-cron'
ON CONFLICT (name) DO UPDATE
  SET owner = excluded.owner,
      description = excluded.description,
      status = excluded.status,
      caller_kind = excluded.caller_kind,
      quota_profile_id = excluded.quota_profile_id,
      updated_at = now();

INSERT INTO public.security_route_policies (
  route, school_id, role, caller_type, internal_caller_id, quota_profile_id,
  enforcement_mode, allow_signed_internal, allow_jwt, allow_service_role, is_enabled
)
SELECT
  cron.route_name,
  NULL,
  NULL,
  'internal_service',
  sic.id,
  qp.id,
  'enforce',
  true,
  false,
  true,
  true
FROM (
  VALUES
    ('data-erasure-purger'),
    ('projector-runner'),
    ('projector-health-check'),
    ('synthetic-host-monitor'),
    ('queue-consumer'),
    ('daily-cron'),
    ('monthly-synthesis-builder'),
    ('verify-question-bank')
) AS cron(route_name)
JOIN public.security_internal_callers sic ON sic.name = cron.route_name
JOIN public.security_quota_profiles qp ON qp.name = cron.route_name || '-internal-cron'
ON CONFLICT (policy_key) DO UPDATE
  SET internal_caller_id = excluded.internal_caller_id,
      quota_profile_id = excluded.quota_profile_id,
      enforcement_mode = excluded.enforcement_mode,
      allow_signed_internal = excluded.allow_signed_internal,
      allow_jwt = excluded.allow_jwt,
      allow_service_role = excluded.allow_service_role,
      is_enabled = excluded.is_enabled,
      updated_at = now();
