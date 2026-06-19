-- 20260620001200_ncert_question_engine_security_policy.sql
-- Phase 2 rollout: attach ncert-question-engine to the frozen Platform Security Layer.
-- The quota keys include route + school_id + user_id + role, while tenant AI budget
-- rows are keyed by school_id + route. This preserves independent per-school budgets.

INSERT INTO public.security_quota_profiles (
  name, scope, role, route,
  requests_daily_limit, requests_monthly_limit,
  input_tokens_daily_limit, input_tokens_monthly_limit,
  output_tokens_daily_limit, output_tokens_monthly_limit,
  estimated_cost_daily_limit, estimated_cost_monthly_limit,
  max_concurrent_requests, circuit_breaker_threshold, enforcement_mode
)
VALUES
  ('ncert-question-engine-student', 'authenticated', 'student', 'ncert-question-engine', 120, 3000, 120000, 3000000, 80000, 2000000, 3.00, 75.00, 2, 3, 'enforce'),
  ('ncert-question-engine-parent', 'authenticated', 'parent', 'ncert-question-engine', 80, 2000, 80000, 2000000, 50000, 1250000, 2.00, 50.00, 2, 3, 'enforce'),
  ('ncert-question-engine-teacher', 'authenticated', 'teacher', 'ncert-question-engine', 200, 5000, 180000, 4500000, 120000, 3000000, 5.00, 125.00, 3, 3, 'enforce'),
  ('ncert-question-engine-school-admin', 'authenticated', 'school_admin', 'ncert-question-engine', 240, 6000, 220000, 5500000, 140000, 3500000, 6.00, 150.00, 4, 3, 'enforce'),
  ('ncert-question-engine-internal-service', 'internal_service', 'internal_service', 'ncert-question-engine', 1000, 30000, 1000000, 30000000, 600000, 18000000, 50.00, 1500.00, 6, 3, 'enforce')
ON CONFLICT (name) DO UPDATE
  SET scope = excluded.scope,
      role = excluded.role,
      route = excluded.route,
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

INSERT INTO public.security_internal_callers (
  name, owner, description, status, caller_kind, quota_profile_id
)
SELECT
  'ncert-question-engine',
  'platform',
  'NCERT question engine internal caller',
  'active',
  'service_name',
  qp.id
FROM public.security_quota_profiles qp
WHERE qp.name = 'ncert-question-engine-internal-service'
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
  'ncert-question-engine',
  NULL,
  role_name,
  'authenticated',
  NULL,
  qp.id,
  'enforce',
  false,
  true,
  false,
  true
FROM (
  VALUES ('student'), ('parent'), ('teacher'), ('school_admin')
) AS roles(role_name)
JOIN public.security_quota_profiles qp
  ON qp.name = CASE role_name
    WHEN 'student' THEN 'ncert-question-engine-student'
    WHEN 'parent' THEN 'ncert-question-engine-parent'
    WHEN 'teacher' THEN 'ncert-question-engine-teacher'
    WHEN 'school_admin' THEN 'ncert-question-engine-school-admin'
  END
ON CONFLICT (policy_key) DO UPDATE
  SET quota_profile_id = excluded.quota_profile_id,
      enforcement_mode = excluded.enforcement_mode,
      allow_signed_internal = excluded.allow_signed_internal,
      allow_jwt = excluded.allow_jwt,
      allow_service_role = excluded.allow_service_role,
      is_enabled = excluded.is_enabled,
      updated_at = now();

INSERT INTO public.security_route_policies (
  route, school_id, role, caller_type, internal_caller_id, quota_profile_id,
  enforcement_mode, allow_signed_internal, allow_jwt, allow_service_role, is_enabled
)
SELECT
  'ncert-question-engine',
  NULL,
  NULL,
  'internal_service',
  NULL,
  qp.id,
  'enforce',
  true,
  false,
  true,
  true
FROM public.security_quota_profiles qp
WHERE qp.name = 'ncert-question-engine-internal-service'
ON CONFLICT (policy_key) DO UPDATE
  SET quota_profile_id = excluded.quota_profile_id,
      enforcement_mode = excluded.enforcement_mode,
      allow_signed_internal = excluded.allow_signed_internal,
      allow_jwt = excluded.allow_jwt,
      allow_service_role = excluded.allow_service_role,
      is_enabled = excluded.is_enabled,
      updated_at = now();
