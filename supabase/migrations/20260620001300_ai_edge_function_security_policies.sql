-- Route inventory and quota admission for direct AI Edge Functions.
-- Caller inventory:
-- student: ncert-solver, scan-ocr, alfabot-answer
-- teacher: parent-report-generator, bulk-question-gen, bulk-non-mcq-gen, generate-answers, generate-concepts, extract-ncert-questions, extract-diagrams
-- school_admin: parent-report-generator, all bulk/generate/extract/embed admin routes
-- internal_service: all listed routes for scheduled backfills and signed workers

WITH routes(route, student, teacher, school_admin, internal_service, daily_requests, daily_in, daily_out, daily_cost) AS (
  VALUES
    ('ncert-solver', true, false, false, true, 120, 120000, 90000, 4.00),
    ('scan-ocr', true, false, false, true, 80, 100000, 50000, 3.00),
    ('parent-report-generator', false, true, true, true, 80, 160000, 120000, 5.00),
    ('alfabot-answer', true, false, false, true, 160, 180000, 120000, 6.00),
    ('bulk-question-gen', false, true, true, true, 60, 300000, 220000, 12.00),
    ('bulk-non-mcq-gen', false, true, true, true, 60, 300000, 220000, 12.00),
    ('bulk-jee-neet-import', false, true, true, true, 40, 350000, 250000, 14.00),
    ('generate-answers', false, true, true, true, 80, 280000, 220000, 12.00),
    ('generate-concepts', false, true, true, true, 80, 260000, 180000, 10.00),
    ('extract-ncert-questions', false, true, true, true, 80, 300000, 220000, 12.00),
    ('extract-diagrams', false, true, true, true, 80, 220000, 160000, 9.00),
    ('embed-ncert-qa', false, false, true, true, 100, 220000, 120000, 8.00),
    ('embed-questions', false, false, true, true, 100, 220000, 120000, 8.00),
    ('embed-diagrams', false, false, true, true, 100, 220000, 120000, 8.00)
), profiles AS (
  INSERT INTO public.security_quota_profiles (
    name, scope, role, route,
    requests_daily_limit, requests_monthly_limit,
    input_tokens_daily_limit, input_tokens_monthly_limit,
    output_tokens_daily_limit, output_tokens_monthly_limit,
    estimated_cost_daily_limit, estimated_cost_monthly_limit,
    max_concurrent_requests, circuit_breaker_threshold, enforcement_mode
  )
  SELECT route || '-' || role_name,
         CASE WHEN role_name = 'internal_service' THEN 'internal_service' ELSE 'authenticated' END,
         role_name,
         route,
         CASE WHEN role_name = 'internal_service' THEN daily_requests * 10 ELSE daily_requests END,
         CASE WHEN role_name = 'internal_service' THEN daily_requests * 300 ELSE daily_requests * 30 END,
         CASE WHEN role_name = 'internal_service' THEN daily_in * 10 ELSE daily_in END,
         CASE WHEN role_name = 'internal_service' THEN daily_in * 300 ELSE daily_in * 30 END,
         CASE WHEN role_name = 'internal_service' THEN daily_out * 10 ELSE daily_out END,
         CASE WHEN role_name = 'internal_service' THEN daily_out * 300 ELSE daily_out * 30 END,
         CASE WHEN role_name = 'internal_service' THEN daily_cost * 10 ELSE daily_cost END,
         CASE WHEN role_name = 'internal_service' THEN daily_cost * 300 ELSE daily_cost * 30 END,
         CASE WHEN role_name = 'internal_service' THEN 6 ELSE 3 END,
         3,
         'enforce'
  FROM routes
  CROSS JOIN LATERAL (
    VALUES ('student', student), ('teacher', teacher), ('school_admin', school_admin), ('internal_service', internal_service)
  ) AS allowed(role_name, is_allowed)
  WHERE is_allowed
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
    updated_at = now()
  RETURNING id, name, route, role
)
INSERT INTO public.security_route_policies (
  route, school_id, role, caller_type, internal_caller_id, quota_profile_id,
  enforcement_mode, allow_signed_internal, allow_jwt, allow_service_role, is_enabled
)
SELECT route,
       NULL,
       CASE WHEN role = 'internal_service' THEN NULL ELSE role END,
       CASE WHEN role = 'internal_service' THEN 'internal_service' ELSE 'authenticated' END,
       NULL,
       id,
       'enforce',
       role = 'internal_service',
       role <> 'internal_service',
       role = 'internal_service',
       true
FROM profiles
ON CONFLICT (policy_key) DO UPDATE SET
  quota_profile_id = excluded.quota_profile_id,
  enforcement_mode = excluded.enforcement_mode,
  allow_signed_internal = excluded.allow_signed_internal,
  allow_jwt = excluded.allow_jwt,
  allow_service_role = excluded.allow_service_role,
  is_enabled = excluded.is_enabled,
  updated_at = now();

INSERT INTO public.security_internal_callers (name, owner, description, status, caller_kind, quota_profile_id)
SELECT DISTINCT p.route, 'platform', 'Signed internal caller for ' || p.route, 'active', 'service_name', p.id
FROM public.security_quota_profiles p
WHERE p.name LIKE '%-internal_service'
  AND p.route IN (
    'ncert-solver','scan-ocr','parent-report-generator','alfabot-answer','bulk-question-gen','bulk-non-mcq-gen',
    'bulk-jee-neet-import','generate-answers','generate-concepts','extract-ncert-questions','extract-diagrams',
    'embed-ncert-qa','embed-questions','embed-diagrams'
  )
ON CONFLICT (name) DO UPDATE SET
  description = excluded.description,
  status = excluded.status,
  caller_kind = excluded.caller_kind,
  quota_profile_id = excluded.quota_profile_id,
  updated_at = now();
