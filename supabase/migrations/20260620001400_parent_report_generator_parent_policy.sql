-- 20260620001400_parent_report_generator_parent_policy.sql
-- Adds the missing `parent` caller policy for parent-report-generator.
-- The bulk seeding migration (20260620001300) seeded teacher+school_admin+internal_service
-- but omitted parent, even though the function authenticates parents (guardians) via JWT.
-- Without this row, parent callers would receive 403 after the security layer integration.

INSERT INTO public.security_quota_profiles (
  name, scope, role, route,
  requests_daily_limit, requests_monthly_limit,
  input_tokens_daily_limit, input_tokens_monthly_limit,
  output_tokens_daily_limit, output_tokens_monthly_limit,
  estimated_cost_daily_limit, estimated_cost_monthly_limit,
  max_concurrent_requests, circuit_breaker_threshold, enforcement_mode
)
VALUES (
  'parent-report-generator-parent',
  'authenticated',
  'parent',
  'parent-report-generator',
  40,          -- 40 req/day (lower than teacher: parents generate ~1 report/student/day)
  1000,        -- 40 * 25 days
  80000,       -- input tokens/day
  2000000,     -- input tokens/month
  60000,       -- output tokens/day
  1500000,     -- output tokens/month
  2.50,        -- $2.50/day
  62.50,       -- $2.50 * 25 days
  2,           -- max concurrent
  3,           -- circuit breaker threshold
  'enforce'
)
ON CONFLICT (name) DO UPDATE SET
  requests_daily_limit = excluded.requests_daily_limit,
  requests_monthly_limit = excluded.requests_monthly_limit,
  input_tokens_daily_limit = excluded.input_tokens_daily_limit,
  input_tokens_monthly_limit = excluded.input_tokens_monthly_limit,
  output_tokens_daily_limit = excluded.output_tokens_daily_limit,
  output_tokens_monthly_limit = excluded.output_tokens_monthly_limit,
  estimated_cost_daily_limit = excluded.estimated_cost_daily_limit,
  estimated_cost_monthly_limit = excluded.estimated_cost_monthly_limit,
  max_concurrent_requests = excluded.max_concurrent_requests,
  circuit_breaker_threshold = excluded.circuit_breaker_threshold,
  enforcement_mode = excluded.enforcement_mode,
  updated_at = now();

INSERT INTO public.security_route_policies (
  route, school_id, role, caller_type, internal_caller_id, quota_profile_id,
  enforcement_mode, allow_signed_internal, allow_jwt, allow_service_role, is_enabled
)
SELECT
  'parent-report-generator',
  NULL,
  'parent',
  'authenticated',
  NULL,
  qp.id,
  'enforce',
  false,   -- JWT callers, not signed internal
  true,    -- allow JWT
  false,   -- not service role
  true
FROM public.security_quota_profiles qp
WHERE qp.name = 'parent-report-generator-parent'
ON CONFLICT (policy_key) DO UPDATE SET
  quota_profile_id = excluded.quota_profile_id,
  enforcement_mode = excluded.enforcement_mode,
  allow_signed_internal = excluded.allow_signed_internal,
  allow_jwt = excluded.allow_jwt,
  allow_service_role = excluded.allow_service_role,
  is_enabled = excluded.is_enabled,
  updated_at = now();
