-- 20260618000001_platform_security_layer.sql
--
-- Platform security layer for Edge Functions.
-- Grounded-answer is the first adopter.
--
-- Design goals:
--   - durable quota enforcement in Postgres
--   - role-aware, school-isolated AI budgets
--   - explicit internal caller registration
--   - signed internal requests
--   - audit rows with no prompts / bearer tokens / raw PII

BEGIN;

CREATE TABLE IF NOT EXISTS public.security_quota_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  scope text NOT NULL CHECK (scope IN ('public', 'authenticated', 'internal_service', 'tenant')),
  role text NULL CHECK (role IS NULL OR role IN ('student', 'parent', 'teacher', 'school_admin', 'internal_service')),
  route text NULL,
  requests_daily_limit integer NOT NULL,
  requests_monthly_limit integer NOT NULL,
  input_tokens_daily_limit bigint NOT NULL,
  input_tokens_monthly_limit bigint NOT NULL,
  output_tokens_daily_limit bigint NOT NULL,
  output_tokens_monthly_limit bigint NOT NULL,
  estimated_cost_daily_limit numeric(18,6) NOT NULL,
  estimated_cost_monthly_limit numeric(18,6) NOT NULL,
  max_concurrent_requests integer NOT NULL DEFAULT 1,
  circuit_breaker_threshold integer NOT NULL DEFAULT 3,
  enforcement_mode text NOT NULL DEFAULT 'enforce' CHECK (enforcement_mode IN ('enforce', 'shadow', 'observe', 'disabled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.security_internal_callers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  owner text NOT NULL,
  description text NOT NULL,
  status text NOT NULL CHECK (status IN ('active', 'paused', 'revoked')),
  caller_kind text NOT NULL CHECK (caller_kind IN ('service_name', 'cron_job', 'internal_worker')),
  quota_profile_id uuid NOT NULL REFERENCES public.security_quota_profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.security_route_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  route text NOT NULL,
  school_id uuid NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  role text NULL CHECK (role IS NULL OR role IN ('student', 'parent', 'teacher', 'school_admin', 'internal_service')),
  caller_type text NOT NULL CHECK (caller_type IN ('public', 'authenticated', 'internal_service')),
  internal_caller_id uuid NULL REFERENCES public.security_internal_callers(id) ON DELETE CASCADE,
  quota_profile_id uuid NOT NULL REFERENCES public.security_quota_profiles(id) ON DELETE RESTRICT,
  enforcement_mode text NOT NULL DEFAULT 'enforce' CHECK (enforcement_mode IN ('enforce', 'shadow', 'observe', 'disabled')),
  allow_signed_internal boolean NOT NULL DEFAULT false,
  allow_jwt boolean NOT NULL DEFAULT true,
  allow_service_role boolean NOT NULL DEFAULT false,
  is_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  policy_key text NOT NULL DEFAULT '',
  CONSTRAINT security_route_policies_policy_key_unique UNIQUE (policy_key)
);

CREATE INDEX IF NOT EXISTS idx_security_route_policies_lookup
  ON public.security_route_policies (route, caller_type, school_id, role, internal_caller_id, is_enabled, updated_at DESC);

CREATE OR REPLACE FUNCTION public.security_refresh_composite_keys()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  RETURN NEW;
END;
$$;

CREATE TRIGGER security_route_policies_refresh_keys
BEFORE INSERT OR UPDATE ON public.security_route_policies
FOR EACH ROW EXECUTE FUNCTION public.security_refresh_composite_keys();

CREATE TABLE IF NOT EXISTS public.security_request_usage_daily (
  usage_date date NOT NULL,
  route text NOT NULL,
  school_id uuid NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  user_id uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  role text NOT NULL CHECK (role IN ('student', 'parent', 'teacher', 'school_admin', 'internal_service')),
  caller_type text NOT NULL CHECK (caller_type IN ('public', 'authenticated', 'internal_service')),
  internal_caller_id uuid NULL REFERENCES public.security_internal_callers(id) ON DELETE SET NULL,
  request_ip_hash text NOT NULL DEFAULT '',
  estimated_request_count integer NOT NULL DEFAULT 0,
  estimated_input_tokens bigint NOT NULL DEFAULT 0,
  estimated_output_tokens bigint NOT NULL DEFAULT 0,
  estimated_cost numeric(18,6) NOT NULL DEFAULT 0,
  actual_request_count integer NOT NULL DEFAULT 0,
  actual_input_tokens bigint NOT NULL DEFAULT 0,
  actual_output_tokens bigint NOT NULL DEFAULT 0,
  actual_cost numeric(18,6) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  quota_key text NOT NULL DEFAULT '',
  CONSTRAINT security_request_usage_daily_quota_key_unique UNIQUE (quota_key)
);

CREATE INDEX IF NOT EXISTS idx_security_request_usage_daily_school_route_day
  ON public.security_request_usage_daily (school_id, route, usage_date DESC);

CREATE INDEX IF NOT EXISTS idx_security_request_usage_daily_user_route_day
  ON public.security_request_usage_daily (user_id, route, usage_date DESC)
  WHERE user_id IS NOT NULL;

CREATE TRIGGER security_request_usage_daily_refresh_keys
BEFORE INSERT OR UPDATE ON public.security_request_usage_daily
FOR EACH ROW EXECUTE FUNCTION public.security_refresh_composite_keys();

CREATE TABLE IF NOT EXISTS public.security_request_usage_monthly (
  usage_month date NOT NULL,
  route text NOT NULL,
  school_id uuid NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  user_id uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  role text NOT NULL CHECK (role IN ('student', 'parent', 'teacher', 'school_admin', 'internal_service')),
  caller_type text NOT NULL CHECK (caller_type IN ('public', 'authenticated', 'internal_service')),
  internal_caller_id uuid NULL REFERENCES public.security_internal_callers(id) ON DELETE SET NULL,
  request_ip_hash text NOT NULL DEFAULT '',
  estimated_request_count integer NOT NULL DEFAULT 0,
  estimated_input_tokens bigint NOT NULL DEFAULT 0,
  estimated_output_tokens bigint NOT NULL DEFAULT 0,
  estimated_cost numeric(18,6) NOT NULL DEFAULT 0,
  actual_request_count integer NOT NULL DEFAULT 0,
  actual_input_tokens bigint NOT NULL DEFAULT 0,
  actual_output_tokens bigint NOT NULL DEFAULT 0,
  actual_cost numeric(18,6) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  quota_key text NOT NULL DEFAULT '',
  CONSTRAINT security_request_usage_monthly_quota_key_unique UNIQUE (quota_key)
);

CREATE INDEX IF NOT EXISTS idx_security_request_usage_monthly_school_route_month
  ON public.security_request_usage_monthly (school_id, route, usage_month DESC);

CREATE INDEX IF NOT EXISTS idx_security_request_usage_monthly_user_route_month
  ON public.security_request_usage_monthly (user_id, route, usage_month DESC)
  WHERE user_id IS NOT NULL;

CREATE TRIGGER security_request_usage_monthly_refresh_keys
BEFORE INSERT OR UPDATE ON public.security_request_usage_monthly
FOR EACH ROW EXECUTE FUNCTION public.security_refresh_composite_keys();

CREATE TABLE IF NOT EXISTS public.security_tenant_ai_usage_daily (
  usage_date date NOT NULL,
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  route text NOT NULL,
  estimated_request_count integer NOT NULL DEFAULT 0,
  estimated_input_tokens bigint NOT NULL DEFAULT 0,
  estimated_output_tokens bigint NOT NULL DEFAULT 0,
  estimated_cost numeric(18,6) NOT NULL DEFAULT 0,
  actual_request_count integer NOT NULL DEFAULT 0,
  actual_input_tokens bigint NOT NULL DEFAULT 0,
  actual_output_tokens bigint NOT NULL DEFAULT 0,
  actual_cost numeric(18,6) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  quota_key text NOT NULL DEFAULT '',
  CONSTRAINT security_tenant_ai_usage_daily_quota_key_unique UNIQUE (quota_key)
);

CREATE INDEX IF NOT EXISTS idx_security_tenant_ai_usage_daily_school_route_day
  ON public.security_tenant_ai_usage_daily (school_id, route, usage_date DESC);

CREATE TRIGGER security_tenant_ai_usage_daily_refresh_keys
BEFORE INSERT OR UPDATE ON public.security_tenant_ai_usage_daily
FOR EACH ROW EXECUTE FUNCTION public.security_refresh_composite_keys();

CREATE TABLE IF NOT EXISTS public.security_tenant_ai_usage_monthly (
  usage_month date NOT NULL,
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  route text NOT NULL,
  estimated_request_count integer NOT NULL DEFAULT 0,
  estimated_input_tokens bigint NOT NULL DEFAULT 0,
  estimated_output_tokens bigint NOT NULL DEFAULT 0,
  estimated_cost numeric(18,6) NOT NULL DEFAULT 0,
  actual_request_count integer NOT NULL DEFAULT 0,
  actual_input_tokens bigint NOT NULL DEFAULT 0,
  actual_output_tokens bigint NOT NULL DEFAULT 0,
  actual_cost numeric(18,6) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  quota_key text NOT NULL DEFAULT '',
  CONSTRAINT security_tenant_ai_usage_monthly_quota_key_unique UNIQUE (quota_key)
);

CREATE INDEX IF NOT EXISTS idx_security_tenant_ai_usage_monthly_school_route_month
  ON public.security_tenant_ai_usage_monthly (school_id, route, usage_month DESC);

CREATE TRIGGER security_tenant_ai_usage_monthly_refresh_keys
BEFORE INSERT OR UPDATE ON public.security_tenant_ai_usage_monthly
FOR EACH ROW EXECUTE FUNCTION public.security_refresh_composite_keys();

CREATE TABLE IF NOT EXISTS public.security_circuit_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  route text NOT NULL,
  school_id uuid NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  role text NULL CHECK (role IS NULL OR role IN ('student', 'parent', 'teacher', 'school_admin', 'internal_service')),
  caller_type text NOT NULL CHECK (caller_type IN ('public', 'authenticated', 'internal_service')),
  internal_caller_id uuid NULL REFERENCES public.security_internal_callers(id) ON DELETE CASCADE,
  state text NOT NULL DEFAULT 'closed' CHECK (state IN ('closed', 'open', 'half_open')),
  failure_count integer NOT NULL DEFAULT 0,
  probe_success_count integer NOT NULL DEFAULT 0,
  opened_at timestamptz NULL,
  last_failure_at timestamptz NULL,
  last_success_at timestamptz NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  circuit_key text NOT NULL DEFAULT '',
  CONSTRAINT security_circuit_state_circuit_key_unique UNIQUE (circuit_key)
);

CREATE INDEX IF NOT EXISTS idx_security_circuit_state_route_school
  ON public.security_circuit_state (route, school_id, caller_type, state);

CREATE INDEX IF NOT EXISTS idx_security_circuit_state_lookup
  ON public.security_circuit_state (route, caller_type, school_id, role, internal_caller_id, updated_at DESC);

CREATE TRIGGER security_circuit_state_refresh_keys
BEFORE INSERT OR UPDATE ON public.security_circuit_state
FOR EACH ROW EXECUTE FUNCTION public.security_refresh_composite_keys();

CREATE TABLE IF NOT EXISTS public.security_request_audit (
  request_id uuid PRIMARY KEY,
  timestamp timestamptz NOT NULL DEFAULT now(),
  route text NOT NULL,
  school_id uuid NULL REFERENCES public.schools(id) ON DELETE SET NULL,
  user_id uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  role text NULL CHECK (role IS NULL OR role IN ('student', 'parent', 'teacher', 'school_admin', 'internal_service')),
  caller_type text NOT NULL CHECK (caller_type IN ('public', 'authenticated', 'internal_service')),
  service_name text NULL,
  cron_job text NULL,
  internal_worker text NULL,
  internal_caller_id uuid NULL REFERENCES public.security_internal_callers(id) ON DELETE SET NULL,
  quota_decision text NOT NULL,
  latency_ms integer NOT NULL,
  status_code integer NOT NULL,
  enforcement_mode text NOT NULL CHECK (enforcement_mode IN ('enforce', 'shadow', 'observe', 'disabled')),
  breaker_state text NULL CHECK (breaker_state IS NULL OR breaker_state IN ('closed', 'open', 'half_open')),
  error_code text NULL,
  estimated_input_tokens bigint NULL,
  estimated_output_tokens bigint NULL,
  estimated_cost numeric(18,6) NULL,
  actual_input_tokens bigint NULL,
  actual_output_tokens bigint NULL,
  actual_cost numeric(18,6) NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_security_request_audit_school_created
  ON public.security_request_audit (school_id, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_security_request_audit_route_created
  ON public.security_request_audit (route, timestamp DESC);

CREATE TABLE IF NOT EXISTS public.security_tenant_ai_budgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  route text NOT NULL,
  daily_cost_limit numeric(18,6) NOT NULL,
  monthly_cost_limit numeric(18,6) NOT NULL,
  daily_request_limit integer NOT NULL,
  monthly_request_limit integer NOT NULL,
  daily_input_token_limit bigint NOT NULL,
  monthly_input_token_limit bigint NOT NULL,
  daily_output_token_limit bigint NOT NULL,
  monthly_output_token_limit bigint NOT NULL,
  enforcement_mode text NOT NULL DEFAULT 'enforce' CHECK (enforcement_mode IN ('enforce', 'shadow', 'observe', 'disabled')),
  is_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT security_tenant_ai_budgets_school_route_unique UNIQUE (school_id, route)
);

CREATE INDEX IF NOT EXISTS idx_security_tenant_ai_budgets_school_route
  ON public.security_tenant_ai_budgets (school_id, route, is_enabled);

CREATE OR REPLACE FUNCTION public.security_resolve_user_context(p_auth_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_student_id uuid := NULL;
  v_student_school_id uuid := NULL;
  v_teacher_id uuid := NULL;
  v_teacher_school_id uuid := NULL;
  v_guardian_id uuid := NULL;
  v_admin_id uuid := NULL;
  v_admin_school_id uuid := NULL;
  v_school_id uuid := NULL;
  v_role text := NULL;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role'
     AND p_auth_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'security_resolve_user_context: callers may only query their own identity';
  END IF;

  SELECT s.id, s.school_id
    INTO v_student_id, v_student_school_id
    FROM public.students s
   WHERE s.auth_user_id = p_auth_user_id
   LIMIT 1;

  SELECT t.id, t.school_id
    INTO v_teacher_id, v_teacher_school_id
    FROM public.teachers t
   WHERE t.auth_user_id = p_auth_user_id
   LIMIT 1;

  SELECT g.id
    INTO v_guardian_id
    FROM public.guardians g
   WHERE g.auth_user_id = p_auth_user_id
   LIMIT 1;

  SELECT sa.id, sa.school_id
    INTO v_admin_id, v_admin_school_id
    FROM public.school_admins sa
   WHERE sa.auth_user_id = p_auth_user_id
     AND sa.is_active = true
   LIMIT 1;

  IF FOUND AND v_admin_id IS NOT NULL THEN
    v_role := 'school_admin';
    v_school_id := v_admin_school_id;
  ELSIF v_teacher_id IS NOT NULL THEN
    v_role := 'teacher';
    v_school_id := v_teacher_school_id;
  ELSIF v_guardian_id IS NOT NULL THEN
    v_role := 'parent';
    SELECT s.school_id
      INTO v_school_id
      FROM public.guardian_student_links gsl
      JOIN public.students s ON s.id = gsl.student_id
     WHERE gsl.guardian_id = v_guardian_id
       AND gsl.status = 'active'
       AND s.school_id IS NOT NULL
     ORDER BY gsl.created_at DESC
     LIMIT 1;
  ELSIF v_student_id IS NOT NULL THEN
    v_role := 'student';
    v_school_id := v_student_school_id;
  ELSE
    v_role := 'none';
  END IF;

  RETURN jsonb_build_object(
    'user_id', p_auth_user_id,
    'role', v_role,
    'school_id', v_school_id,
    'student_id', v_student_id,
    'teacher_id', v_teacher_id,
    'guardian_id', v_guardian_id,
    'school_admin_id', v_admin_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.security_resolve_internal_caller(p_caller_name text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_row record;
BEGIN
  SELECT id, name, owner, description, status, caller_kind, quota_profile_id
    INTO v_row
    FROM public.security_internal_callers
   WHERE name = p_caller_name
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  RETURN jsonb_build_object(
    'found', true,
    'id', v_row.id,
    'name', v_row.name,
    'owner', v_row.owner,
    'description', v_row.description,
    'status', v_row.status,
    'caller_kind', v_row.caller_kind,
    'quota_profile_id', v_row.quota_profile_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.security_resolve_route_policy(
  p_route text,
  p_school_id uuid,
  p_role text,
  p_caller_type text,
  p_internal_caller_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_row record;
BEGIN
  SELECT *
    INTO v_row
    FROM public.security_route_policies rp
   WHERE rp.route = p_route
     AND rp.caller_type = p_caller_type
     AND rp.is_enabled = true
     AND (rp.school_id IS NULL OR rp.school_id = p_school_id)
     AND (rp.role IS NULL OR rp.role = p_role)
     AND (rp.internal_caller_id IS NULL OR rp.internal_caller_id = p_internal_caller_id)
   ORDER BY
     (rp.school_id IS NOT NULL) DESC,
     (rp.role IS NOT NULL) DESC,
     (rp.internal_caller_id IS NOT NULL) DESC,
     rp.updated_at DESC
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  RETURN jsonb_build_object(
    'found', true,
    'id', v_row.id,
    'route', v_row.route,
    'school_id', v_row.school_id,
    'role', v_row.role,
    'caller_type', v_row.caller_type,
    'internal_caller_id', v_row.internal_caller_id,
    'quota_profile_id', v_row.quota_profile_id,
    'enforcement_mode', v_row.enforcement_mode,
    'allow_signed_internal', v_row.allow_signed_internal,
    'allow_jwt', v_row.allow_jwt,
    'allow_service_role', v_row.allow_service_role,
    'is_enabled', v_row.is_enabled
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.security_compute_ai_cost(
  p_provider text,
  p_model text,
  p_input_tokens bigint,
  p_output_tokens bigint
)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT round(
    (
      (coalesce(mp.input_usd_per_1m, 0)::numeric * coalesce(p_input_tokens, 0)::numeric / 1000000.0)
      +
      (coalesce(mp.output_usd_per_1m, 0)::numeric * coalesce(p_output_tokens, 0)::numeric / 1000000.0)
    )::numeric,
    6
  )
  FROM public.model_pricing mp
  WHERE mp.provider = p_provider
    AND mp.model = p_model
  ORDER BY mp.effective_from DESC
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.security_reserve_quota(
  p_route text,
  p_school_id uuid,
  p_user_id uuid,
  p_role text,
  p_caller_type text,
  p_internal_caller_id uuid,
  p_request_ip_hash text,
  p_estimated_input_tokens bigint,
  p_estimated_output_tokens bigint,
  p_estimated_cost numeric,
  p_request_count integer DEFAULT 1,
  p_dry_run boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_policy jsonb;
  v_profile record;
  v_quota_profile_id uuid := NULL;
  v_now timestamptz := now();
  v_today date := current_date;
  v_month date := date_trunc('month', current_date)::date;
  v_daily record;
  v_monthly record;
  v_tenant_daily record;
  v_tenant_monthly record;
  v_allowed boolean := true;
  v_decision text := 'allow';
  v_circuit record;
  v_circuit_state text := 'closed';
  v_failure_count integer := 0;
  v_probe_success_count integer := 0;
  v_opened_at timestamptz := NULL;
  v_last_failure_at timestamptz := NULL;
  v_last_success_at timestamptz := NULL;
  v_internal_caller_effective uuid := p_internal_caller_id;
BEGIN
  SELECT security_resolve_route_policy(p_route, p_school_id, p_role, p_caller_type, p_internal_caller_id)
    INTO v_policy;

  IF coalesce(v_policy->>'found', 'false') <> 'true' THEN
    RETURN jsonb_build_object('allowed', false, 'decision', 'deny_policy', 'reason', 'route_policy_missing');
  END IF;

  SELECT *
    INTO v_profile
    FROM public.security_quota_profiles qp
   WHERE qp.id = (v_policy->>'quota_profile_id')::uuid
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('allowed', false, 'decision', 'deny_policy', 'reason', 'quota_profile_missing');
  END IF;
  v_quota_profile_id := v_profile.id;

  SELECT *
    INTO v_circuit
    FROM public.security_circuit_state cs
   WHERE cs.route = p_route
     AND cs.caller_type = p_caller_type
     AND coalesce(cs.school_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(p_school_id, '00000000-0000-0000-0000-000000000000'::uuid)
     AND coalesce(cs.role, '') = coalesce(p_role, '')
     AND coalesce(cs.internal_caller_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(v_internal_caller_effective, '00000000-0000-0000-0000-000000000000'::uuid)
   LIMIT 1;

  IF NOT FOUND THEN
    INSERT INTO public.security_circuit_state (
      route, school_id, role, caller_type, internal_caller_id, state, failure_count,
      probe_success_count, opened_at, last_failure_at, last_success_at, updated_at
    )
    VALUES (
      p_route, p_school_id, p_role, p_caller_type, v_internal_caller_effective, 'closed', 0,
      0, NULL, NULL, NULL, v_now
    )
    RETURNING * INTO v_circuit;
  END IF;

  v_circuit_state := v_circuit.state;
  v_failure_count := coalesce(v_circuit.failure_count, 0);
  v_probe_success_count := coalesce(v_circuit.probe_success_count, 0);
  v_opened_at := v_circuit.opened_at;
  v_last_failure_at := v_circuit.last_failure_at;
  v_last_success_at := v_circuit.last_success_at;

  IF v_circuit_state = 'open' AND v_opened_at IS NOT NULL AND v_now >= v_opened_at + interval '30 seconds' THEN
    v_circuit_state := 'half_open';
    v_probe_success_count := 0;
    UPDATE public.security_circuit_state
       SET state = 'half_open',
           probe_success_count = 0,
           updated_at = v_now
     WHERE id = v_circuit.id;
  ELSIF v_circuit_state = 'open' THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'decision', 'deny_breaker',
      'reason', 'circuit_open',
      'circuit_state', v_circuit_state
    );
  END IF;

  IF NOT p_dry_run THEN
    SELECT *
      INTO v_daily
      FROM public.security_request_usage_daily u
     WHERE u.usage_date = v_today
       AND u.quota_key = concat_ws(
         '|',
         v_today::text,
         p_route,
         coalesce(p_school_id::text, ''),
         coalesce(p_user_id::text, ''),
         p_role,
         p_caller_type,
         coalesce(v_internal_caller_effective::text, ''),
         coalesce(p_request_ip_hash, '')
       )
     LIMIT 1;

    IF NOT FOUND THEN
      INSERT INTO public.security_request_usage_daily (
        usage_date, route, school_id, user_id, role, caller_type, internal_caller_id,
        request_ip_hash, estimated_request_count, estimated_input_tokens, estimated_output_tokens,
        estimated_cost, updated_at
      ) VALUES (
        v_today, p_route, p_school_id, p_user_id, p_role, p_caller_type, v_internal_caller_effective,
        coalesce(p_request_ip_hash, ''), 0, 0, 0, 0, v_now
      )
      RETURNING * INTO v_daily;
    END IF;

    SELECT *
      INTO v_monthly
      FROM public.security_request_usage_monthly u
     WHERE u.usage_month = v_month
       AND u.quota_key = concat_ws(
         '|',
         v_month::text,
         p_route,
         coalesce(p_school_id::text, ''),
         coalesce(p_user_id::text, ''),
         p_role,
         p_caller_type,
         coalesce(v_internal_caller_effective::text, ''),
         coalesce(p_request_ip_hash, '')
       )
     LIMIT 1;

    IF NOT FOUND THEN
      INSERT INTO public.security_request_usage_monthly (
        usage_month, route, school_id, user_id, role, caller_type, internal_caller_id,
        request_ip_hash, estimated_request_count, estimated_input_tokens, estimated_output_tokens,
        estimated_cost, updated_at
      ) VALUES (
        v_month, p_route, p_school_id, p_user_id, p_role, p_caller_type, v_internal_caller_effective,
        coalesce(p_request_ip_hash, ''), 0, 0, 0, 0, v_now
      )
      RETURNING * INTO v_monthly;
    END IF;

    IF p_school_id IS NOT NULL THEN
      SELECT *
        INTO v_tenant_daily
        FROM public.security_tenant_ai_usage_daily t
       WHERE t.usage_date = v_today
         AND t.school_id = p_school_id
         AND t.route = p_route
       LIMIT 1;
      IF NOT FOUND THEN
        INSERT INTO public.security_tenant_ai_usage_daily (
          usage_date, school_id, route, estimated_request_count, estimated_input_tokens,
          estimated_output_tokens, estimated_cost, updated_at
        ) VALUES (
          v_today, p_school_id, p_route, 0, 0, 0, 0, v_now
        )
        RETURNING * INTO v_tenant_daily;
      END IF;

      SELECT *
        INTO v_tenant_monthly
        FROM public.security_tenant_ai_usage_monthly t
       WHERE t.usage_month = v_month
         AND t.school_id = p_school_id
         AND t.route = p_route
       LIMIT 1;
      IF NOT FOUND THEN
        INSERT INTO public.security_tenant_ai_usage_monthly (
          usage_month, school_id, route, estimated_request_count, estimated_input_tokens,
          estimated_output_tokens, estimated_cost, updated_at
        ) VALUES (
          v_month, p_school_id, p_route, 0, 0, 0, 0, v_now
        )
        RETURNING * INTO v_tenant_monthly;
      END IF;
    END IF;

    v_allowed :=
      (coalesce(v_daily.estimated_request_count, 0) + p_request_count) <= v_profile.requests_daily_limit
      AND (coalesce(v_monthly.estimated_request_count, 0) + p_request_count) <= v_profile.requests_monthly_limit
      AND (coalesce(v_daily.estimated_input_tokens, 0) + p_estimated_input_tokens) <= v_profile.input_tokens_daily_limit
      AND (coalesce(v_monthly.estimated_input_tokens, 0) + p_estimated_input_tokens) <= v_profile.input_tokens_monthly_limit
      AND (coalesce(v_daily.estimated_output_tokens, 0) + p_estimated_output_tokens) <= v_profile.output_tokens_daily_limit
      AND (coalesce(v_monthly.estimated_output_tokens, 0) + p_estimated_output_tokens) <= v_profile.output_tokens_monthly_limit
      AND (coalesce(v_daily.estimated_cost, 0) + p_estimated_cost) <= v_profile.estimated_cost_daily_limit
      AND (coalesce(v_monthly.estimated_cost, 0) + p_estimated_cost) <= v_profile.estimated_cost_monthly_limit;

    IF p_school_id IS NOT NULL THEN
      IF EXISTS (
        SELECT 1 FROM public.security_tenant_ai_budgets b
         WHERE b.school_id = p_school_id
           AND b.route = p_route
           AND b.is_enabled = true
      ) THEN
        SELECT *
          INTO STRICT v_profile
          FROM public.security_tenant_ai_budgets b
         WHERE b.school_id = p_school_id
           AND b.route = p_route
           AND b.is_enabled = true
         ORDER BY b.updated_at DESC
         LIMIT 1;

        v_allowed := v_allowed
          AND (coalesce(v_tenant_daily.estimated_request_count, 0) + p_request_count) <= v_profile.daily_request_limit
          AND (coalesce(v_tenant_monthly.estimated_request_count, 0) + p_request_count) <= v_profile.monthly_request_limit
          AND (coalesce(v_tenant_daily.estimated_input_tokens, 0) + p_estimated_input_tokens) <= v_profile.daily_input_token_limit
          AND (coalesce(v_tenant_monthly.estimated_input_tokens, 0) + p_estimated_input_tokens) <= v_profile.monthly_input_token_limit
          AND (coalesce(v_tenant_daily.estimated_output_tokens, 0) + p_estimated_output_tokens) <= v_profile.daily_output_token_limit
          AND (coalesce(v_tenant_monthly.estimated_output_tokens, 0) + p_estimated_output_tokens) <= v_profile.monthly_output_token_limit
          AND (coalesce(v_tenant_daily.estimated_cost, 0) + p_estimated_cost) <= v_profile.daily_cost_limit
          AND (coalesce(v_tenant_monthly.estimated_cost, 0) + p_estimated_cost) <= v_profile.monthly_cost_limit;
      END IF;
    END IF;

    IF NOT v_allowed THEN
      RETURN jsonb_build_object(
        'allowed', false,
        'decision', 'deny_quota',
        'reason', 'quota_exhausted',
        'circuit_state', v_circuit_state
      );
    END IF;

    UPDATE public.security_request_usage_daily
       SET estimated_request_count = estimated_request_count + p_request_count,
           estimated_input_tokens = estimated_input_tokens + p_estimated_input_tokens,
           estimated_output_tokens = estimated_output_tokens + p_estimated_output_tokens,
           estimated_cost = estimated_cost + p_estimated_cost,
           updated_at = v_now
     WHERE quota_key = v_daily.quota_key;

    UPDATE public.security_request_usage_monthly
       SET estimated_request_count = estimated_request_count + p_request_count,
           estimated_input_tokens = estimated_input_tokens + p_estimated_input_tokens,
           estimated_output_tokens = estimated_output_tokens + p_estimated_output_tokens,
           estimated_cost = estimated_cost + p_estimated_cost,
           updated_at = v_now
     WHERE quota_key = v_monthly.quota_key;

    IF p_school_id IS NOT NULL THEN
      UPDATE public.security_tenant_ai_usage_daily
         SET estimated_request_count = estimated_request_count + p_request_count,
             estimated_input_tokens = estimated_input_tokens + p_estimated_input_tokens,
             estimated_output_tokens = estimated_output_tokens + p_estimated_output_tokens,
             estimated_cost = estimated_cost + p_estimated_cost,
             updated_at = v_now
       WHERE quota_key = v_tenant_daily.quota_key;

      UPDATE public.security_tenant_ai_usage_monthly
         SET estimated_request_count = estimated_request_count + p_request_count,
             estimated_input_tokens = estimated_input_tokens + p_estimated_input_tokens,
             estimated_output_tokens = estimated_output_tokens + p_estimated_output_tokens,
             estimated_cost = estimated_cost + p_estimated_cost,
             updated_at = v_now
       WHERE quota_key = v_tenant_monthly.quota_key;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'allowed', true,
    'decision', 'allow',
    'policy_id', v_policy->>'id',
    'quota_profile_id', v_quota_profile_id,
    'enforcement_mode', v_policy->>'enforcement_mode',
    'circuit_state', v_circuit_state
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.security_settle_quota(
  p_route text,
  p_school_id uuid,
  p_user_id uuid,
  p_role text,
  p_caller_type text,
  p_internal_caller_id uuid,
  p_request_ip_hash text,
  p_actual_input_tokens bigint,
  p_actual_output_tokens bigint,
  p_actual_cost numeric,
  p_request_count integer DEFAULT 1
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_today date := current_date;
  v_month date := date_trunc('month', current_date)::date;
  v_now timestamptz := now();
  v_daily record;
  v_monthly record;
  v_tenant_daily record;
  v_tenant_monthly record;
BEGIN
  SELECT *
    INTO v_daily
    FROM public.security_request_usage_daily u
   WHERE u.quota_key = concat_ws(
     '|',
     v_today::text,
     p_route,
     coalesce(p_school_id::text, ''),
     coalesce(p_user_id::text, ''),
     p_role,
     p_caller_type,
     coalesce(p_internal_caller_id::text, ''),
     coalesce(p_request_ip_hash, '')
   )
   LIMIT 1;

  IF NOT FOUND THEN
    INSERT INTO public.security_request_usage_daily (
      usage_date, route, school_id, user_id, role, caller_type, internal_caller_id,
      request_ip_hash, actual_request_count, actual_input_tokens, actual_output_tokens,
      actual_cost, updated_at
    ) VALUES (
      v_today, p_route, p_school_id, p_user_id, p_role, p_caller_type, p_internal_caller_id,
      coalesce(p_request_ip_hash, ''), p_request_count, p_actual_input_tokens, p_actual_output_tokens,
      p_actual_cost, v_now
    );
  ELSE
    UPDATE public.security_request_usage_daily
       SET actual_request_count = actual_request_count + p_request_count,
           actual_input_tokens = actual_input_tokens + p_actual_input_tokens,
           actual_output_tokens = actual_output_tokens + p_actual_output_tokens,
           actual_cost = actual_cost + p_actual_cost,
           updated_at = v_now
     WHERE quota_key = v_daily.quota_key;
  END IF;

  SELECT *
    INTO v_monthly
    FROM public.security_request_usage_monthly u
   WHERE u.quota_key = concat_ws(
     '|',
     v_month::text,
     p_route,
     coalesce(p_school_id::text, ''),
     coalesce(p_user_id::text, ''),
     p_role,
     p_caller_type,
     coalesce(p_internal_caller_id::text, ''),
     coalesce(p_request_ip_hash, '')
   )
   LIMIT 1;

  IF NOT FOUND THEN
    INSERT INTO public.security_request_usage_monthly (
      usage_month, route, school_id, user_id, role, caller_type, internal_caller_id,
      request_ip_hash, actual_request_count, actual_input_tokens, actual_output_tokens,
      actual_cost, updated_at
    ) VALUES (
      v_month, p_route, p_school_id, p_user_id, p_role, p_caller_type, p_internal_caller_id,
      coalesce(p_request_ip_hash, ''), p_request_count, p_actual_input_tokens, p_actual_output_tokens,
      p_actual_cost, v_now
    );
  ELSE
    UPDATE public.security_request_usage_monthly
       SET actual_request_count = actual_request_count + p_request_count,
           actual_input_tokens = actual_input_tokens + p_actual_input_tokens,
           actual_output_tokens = actual_output_tokens + p_actual_output_tokens,
           actual_cost = actual_cost + p_actual_cost,
           updated_at = v_now
     WHERE quota_key = v_monthly.quota_key;
  END IF;

  IF p_school_id IS NOT NULL THEN
    SELECT *
      INTO v_tenant_daily
      FROM public.security_tenant_ai_usage_daily t
     WHERE t.quota_key = concat_ws('|', v_today::text, p_school_id::text, p_route)
     LIMIT 1;
    IF NOT FOUND THEN
      INSERT INTO public.security_tenant_ai_usage_daily (
        usage_date, school_id, route, actual_request_count, actual_input_tokens,
        actual_output_tokens, actual_cost, updated_at
      ) VALUES (
        v_today, p_school_id, p_route, p_request_count, p_actual_input_tokens,
        p_actual_output_tokens, p_actual_cost, v_now
      );
    ELSE
      UPDATE public.security_tenant_ai_usage_daily
         SET actual_request_count = actual_request_count + p_request_count,
             actual_input_tokens = actual_input_tokens + p_actual_input_tokens,
             actual_output_tokens = actual_output_tokens + p_actual_output_tokens,
             actual_cost = actual_cost + p_actual_cost,
             updated_at = v_now
       WHERE quota_key = v_tenant_daily.quota_key;
    END IF;

    SELECT *
      INTO v_tenant_monthly
      FROM public.security_tenant_ai_usage_monthly t
     WHERE t.quota_key = concat_ws('|', v_month::text, p_school_id::text, p_route)
     LIMIT 1;
    IF NOT FOUND THEN
      INSERT INTO public.security_tenant_ai_usage_monthly (
        usage_month, school_id, route, actual_request_count, actual_input_tokens,
        actual_output_tokens, actual_cost, updated_at
      ) VALUES (
        v_month, p_school_id, p_route, p_request_count, p_actual_input_tokens,
        p_actual_output_tokens, p_actual_cost, v_now
      );
    ELSE
      UPDATE public.security_tenant_ai_usage_monthly
         SET actual_request_count = actual_request_count + p_request_count,
             actual_input_tokens = actual_input_tokens + p_actual_input_tokens,
             actual_output_tokens = actual_output_tokens + p_actual_output_tokens,
             actual_cost = actual_cost + p_actual_cost,
             updated_at = v_now
       WHERE quota_key = v_tenant_monthly.quota_key;
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.security_update_circuit_state(
  p_route text,
  p_school_id uuid,
  p_role text,
  p_caller_type text,
  p_internal_caller_id uuid,
  p_event text,
  p_error_code text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_row record;
  v_now timestamptz := now();
  v_state text := 'closed';
  v_failure_count integer := 0;
  v_probe_success_count integer := 0;
BEGIN
  SELECT *
    INTO v_row
    FROM public.security_circuit_state cs
   WHERE cs.route = p_route
     AND cs.caller_type = p_caller_type
     AND coalesce(cs.school_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(p_school_id, '00000000-0000-0000-0000-000000000000'::uuid)
     AND coalesce(cs.role, '') = coalesce(p_role, '')
     AND coalesce(cs.internal_caller_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(p_internal_caller_id, '00000000-0000-0000-0000-000000000000'::uuid)
   LIMIT 1;

  IF NOT FOUND THEN
    INSERT INTO public.security_circuit_state (
      route, school_id, role, caller_type, internal_caller_id, state, failure_count,
      probe_success_count, opened_at, last_failure_at, last_success_at, updated_at
    ) VALUES (
      p_route, p_school_id, p_role, p_caller_type, p_internal_caller_id, 'closed', 0,
      0, NULL, NULL, NULL, v_now
    )
    RETURNING * INTO v_row;
  END IF;

  v_state := v_row.state;
  v_failure_count := coalesce(v_row.failure_count, 0);
  v_probe_success_count := coalesce(v_row.probe_success_count, 0);

  IF p_event = 'success' THEN
    IF v_state = 'half_open' THEN
      v_probe_success_count := v_probe_success_count + 1;
      IF v_probe_success_count >= 2 THEN
        v_state := 'closed';
        v_failure_count := 0;
        v_probe_success_count := 0;
      END IF;
    ELSE
      v_failure_count := 0;
    END IF;
    UPDATE public.security_circuit_state
       SET state = v_state,
           failure_count = v_failure_count,
           probe_success_count = v_probe_success_count,
           last_success_at = v_now,
           updated_at = v_now
     WHERE id = v_row.id;
  ELSIF p_event = 'failure' THEN
    IF v_state = 'half_open' THEN
      v_state := 'open';
      v_failure_count := 1;
      v_probe_success_count := 0;
    ELSE
      IF v_row.last_failure_at IS NULL OR v_now - v_row.last_failure_at > interval '10 seconds' THEN
        v_failure_count := 0;
      END IF;
      v_failure_count := v_failure_count + 1;
      IF v_failure_count >= 3 THEN
        v_state := 'open';
      END IF;
    END IF;
    UPDATE public.security_circuit_state
       SET state = v_state,
           failure_count = v_failure_count,
           probe_success_count = v_probe_success_count,
           opened_at = CASE WHEN v_state = 'open' THEN coalesce(v_row.opened_at, v_now) ELSE v_row.opened_at END,
           last_failure_at = v_now,
           updated_at = v_now
     WHERE id = v_row.id;
  ELSIF p_event = 'probe' THEN
    IF v_state = 'open' AND v_row.opened_at IS NOT NULL AND v_now >= v_row.opened_at + interval '30 seconds' THEN
      v_state := 'half_open';
      v_probe_success_count := 0;
      UPDATE public.security_circuit_state
         SET state = v_state,
             probe_success_count = 0,
             updated_at = v_now
       WHERE id = v_row.id;
    END IF;
  ELSIF p_event = 'force_open' THEN
    v_state := 'open';
    v_failure_count := greatest(v_failure_count, 3);
    UPDATE public.security_circuit_state
       SET state = v_state,
           failure_count = v_failure_count,
           probe_success_count = 0,
           opened_at = v_now,
           updated_at = v_now
     WHERE id = v_row.id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'state', v_state,
    'failure_count', v_failure_count,
    'probe_success_count', v_probe_success_count
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.security_write_request_audit(
  p_request_id uuid,
  p_route text,
  p_school_id uuid,
  p_user_id uuid,
  p_role text,
  p_caller_type text,
  p_service_name text,
  p_cron_job text,
  p_internal_worker text,
  p_internal_caller_id uuid,
  p_quota_decision text,
  p_latency_ms integer,
  p_status_code integer,
  p_enforcement_mode text,
  p_breaker_state text,
  p_error_code text DEFAULT NULL,
  p_estimated_input_tokens bigint DEFAULT NULL,
  p_estimated_output_tokens bigint DEFAULT NULL,
  p_estimated_cost numeric DEFAULT NULL,
  p_actual_input_tokens bigint DEFAULT NULL,
  p_actual_output_tokens bigint DEFAULT NULL,
  p_actual_cost numeric DEFAULT NULL
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  INSERT INTO public.security_request_audit (
    request_id, route, school_id, user_id, role, caller_type, service_name, cron_job,
    internal_worker, internal_caller_id, quota_decision, latency_ms, status_code,
    enforcement_mode, breaker_state, error_code, estimated_input_tokens,
    estimated_output_tokens, estimated_cost, actual_input_tokens, actual_output_tokens,
    actual_cost
  )
  VALUES (
    p_request_id, p_route, p_school_id, p_user_id, p_role, p_caller_type, p_service_name,
    p_cron_job, p_internal_worker, p_internal_caller_id, p_quota_decision, p_latency_ms,
    p_status_code, p_enforcement_mode, p_breaker_state, p_error_code, p_estimated_input_tokens,
    p_estimated_output_tokens, p_estimated_cost, p_actual_input_tokens, p_actual_output_tokens,
    p_actual_cost
  )
  ON CONFLICT (request_id) DO NOTHING;
$$;

CREATE OR REPLACE FUNCTION public.security_refresh_composite_keys()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF TG_TABLE_NAME = 'security_route_policies' THEN
    NEW.policy_key :=
      coalesce(NEW.route, '') || '|' ||
      coalesce(NEW.school_id::text, '') || '|' ||
      coalesce(NEW.role, '') || '|' ||
      coalesce(NEW.caller_type, '') || '|' ||
      coalesce(NEW.internal_caller_id::text, '');
  ELSIF TG_TABLE_NAME = 'security_request_usage_daily' THEN
    NEW.quota_key :=
      coalesce(NEW.usage_date::text, '') || '|' ||
      coalesce(NEW.route, '') || '|' ||
      coalesce(NEW.school_id::text, '') || '|' ||
      coalesce(NEW.user_id::text, '') || '|' ||
      coalesce(NEW.role, '') || '|' ||
      coalesce(NEW.caller_type, '') || '|' ||
      coalesce(NEW.internal_caller_id::text, '') || '|' ||
      coalesce(NEW.request_ip_hash, '');
  ELSIF TG_TABLE_NAME = 'security_request_usage_monthly' THEN
    NEW.quota_key :=
      coalesce(NEW.usage_month::text, '') || '|' ||
      coalesce(NEW.route, '') || '|' ||
      coalesce(NEW.school_id::text, '') || '|' ||
      coalesce(NEW.user_id::text, '') || '|' ||
      coalesce(NEW.role, '') || '|' ||
      coalesce(NEW.caller_type, '') || '|' ||
      coalesce(NEW.internal_caller_id::text, '') || '|' ||
      coalesce(NEW.request_ip_hash, '');
  ELSIF TG_TABLE_NAME = 'security_tenant_ai_usage_daily' THEN
    NEW.quota_key :=
      coalesce(NEW.usage_date::text, '') || '|' ||
      coalesce(NEW.school_id::text, '') || '|' ||
      coalesce(NEW.route, '');
  ELSIF TG_TABLE_NAME = 'security_tenant_ai_usage_monthly' THEN
    NEW.quota_key :=
      coalesce(NEW.usage_month::text, '') || '|' ||
      coalesce(NEW.school_id::text, '') || '|' ||
      coalesce(NEW.route, '');
  ELSIF TG_TABLE_NAME = 'security_circuit_state' THEN
    NEW.circuit_key :=
      coalesce(NEW.route, '') || '|' ||
      coalesce(NEW.school_id::text, '') || '|' ||
      coalesce(NEW.role, '') || '|' ||
      coalesce(NEW.caller_type, '') || '|' ||
      coalesce(NEW.internal_caller_id::text, '');
  END IF;
  RETURN NEW;
END;
$$;

-- Seed baseline quota profiles and grounded-answer policies.
INSERT INTO public.security_quota_profiles (
  name, scope, role, route,
  requests_daily_limit, requests_monthly_limit,
  input_tokens_daily_limit, input_tokens_monthly_limit,
  output_tokens_daily_limit, output_tokens_monthly_limit,
  estimated_cost_daily_limit, estimated_cost_monthly_limit,
  max_concurrent_requests, circuit_breaker_threshold, enforcement_mode
)
VALUES
  ('grounded-answer-student', 'authenticated', 'student', 'grounded-answer', 100, 2000, 150000, 3000000, 75000, 1500000, 4.00, 80.00, 2, 3, 'enforce'),
  ('grounded-answer-parent', 'authenticated', 'parent', 'grounded-answer', 80, 1600, 120000, 2400000, 60000, 1200000, 3.50, 70.00, 2, 3, 'enforce'),
  ('grounded-answer-teacher', 'authenticated', 'teacher', 'grounded-answer', 150, 3000, 200000, 4000000, 100000, 2000000, 6.00, 120.00, 3, 3, 'enforce'),
  ('grounded-answer-school-admin', 'authenticated', 'school_admin', 'grounded-answer', 200, 4000, 250000, 5000000, 125000, 2500000, 10.00, 200.00, 4, 3, 'enforce'),
  ('grounded-answer-internal-service', 'internal_service', 'internal_service', 'grounded-answer', 2000, 50000, 2000000, 40000000, 1000000, 20000000, 100.00, 2000.00, 8, 3, 'enforce'),
  ('grounded-answer-public', 'public', NULL, 'grounded-answer', 20, 200, 40000, 500000, 20000, 250000, 1.00, 10.00, 1, 3, 'enforce')
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
  caller_name,
  'platform',
  description,
  'active',
  'service_name',
  qp.id
FROM (
  VALUES
    ('foxy', 'Foxy route grounded-answer client'),
    ('ncert-solver', 'NCERT solver grounded-answer client'),
    ('quiz-generator', 'Quiz generator grounded-answer client'),
    ('concept-engine', 'Concept engine grounded-answer client'),
    ('diagnostic', 'Diagnostic grounded-answer client'),
    ('verify-question-bank', 'Question bank verifier grounded-answer client'),
    ('bulk-question-gen', 'Bulk question generation grounded-answer client')
) AS seed(caller_name, description)
JOIN public.security_quota_profiles qp
  ON qp.name = 'grounded-answer-internal-service'
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
  'grounded-answer',
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
    WHEN 'student' THEN 'grounded-answer-student'
    WHEN 'parent' THEN 'grounded-answer-parent'
    WHEN 'teacher' THEN 'grounded-answer-teacher'
    WHEN 'school_admin' THEN 'grounded-answer-school-admin'
  END
ON CONFLICT (policy_key) DO NOTHING;

INSERT INTO public.security_route_policies (
  route, school_id, role, caller_type, internal_caller_id, quota_profile_id,
  enforcement_mode, allow_signed_internal, allow_jwt, allow_service_role, is_enabled
)
SELECT
  'grounded-answer',
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
WHERE qp.name = 'grounded-answer-internal-service'
ON CONFLICT (policy_key) DO NOTHING;

INSERT INTO public.security_route_policies (
  route, school_id, role, caller_type, internal_caller_id, quota_profile_id,
  enforcement_mode, allow_signed_internal, allow_jwt, allow_service_role, is_enabled
)
SELECT
  'grounded-answer',
  NULL,
  NULL,
  'public',
  NULL,
  qp.id,
  'observe',
  false,
  false,
  false,
  false
FROM public.security_quota_profiles qp
WHERE qp.name = 'grounded-answer-public'
ON CONFLICT (policy_key) DO NOTHING;

REVOKE ALL ON FUNCTION public.security_resolve_user_context(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.security_resolve_internal_caller(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.security_resolve_route_policy(text, uuid, text, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.security_compute_ai_cost(text, text, bigint, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.security_reserve_quota(text, uuid, uuid, text, text, uuid, text, bigint, bigint, numeric, integer, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.security_settle_quota(text, uuid, uuid, text, text, uuid, text, bigint, bigint, numeric, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.security_update_circuit_state(text, uuid, text, text, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.security_write_request_audit(uuid, text, uuid, uuid, text, text, text, text, text, uuid, text, integer, integer, text, text, text, bigint, bigint, numeric, bigint, bigint, numeric) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.security_resolve_user_context(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.security_resolve_internal_caller(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.security_resolve_route_policy(text, uuid, text, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.security_compute_ai_cost(text, text, bigint, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.security_reserve_quota(text, uuid, uuid, text, text, uuid, text, bigint, bigint, numeric, integer, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.security_settle_quota(text, uuid, uuid, text, text, uuid, text, bigint, bigint, numeric, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.security_update_circuit_state(text, uuid, text, text, uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.security_write_request_audit(uuid, text, uuid, uuid, text, text, text, text, text, uuid, text, integer, integer, text, text, text, bigint, bigint, numeric, bigint, bigint, numeric) TO service_role;

-- ─── RLS (P8 enforcement added retroactively to satisfy CI gate) ──────────────
-- All security_ tables are internal quota-tracking/circuit-breaker stores.
-- They are accessed ONLY via SECURITY DEFINER functions (security_reserve_quota,
-- security_settle_quota, security_update_circuit_state, security_write_request_audit,
-- etc. — all above). Direct table access from authenticated / anon roles is
-- explicitly blocked; service_role has full access for operational tooling.

ALTER TABLE public.security_quota_profiles          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.security_internal_callers        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.security_route_policies          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.security_request_usage_daily     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.security_request_usage_monthly   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.security_tenant_ai_usage_daily   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.security_tenant_ai_usage_monthly ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.security_circuit_state           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.security_request_audit           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.security_tenant_ai_budgets       ENABLE ROW LEVEL SECURITY;

-- One policy per table: service_role full access. The SECURITY DEFINER functions
-- bypass RLS anyway, but the service_role client used by Edge Functions for
-- direct table access (audit INSERT, circuit_state INSERT) still needs this policy.
-- No authenticated/anon policy: deliberate — zero direct table access for end users.

DROP POLICY IF EXISTS "security_quota_profiles_service_role"          ON public.security_quota_profiles;
CREATE POLICY "security_quota_profiles_service_role"          ON public.security_quota_profiles          TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "security_internal_callers_service_role"        ON public.security_internal_callers;
CREATE POLICY "security_internal_callers_service_role"        ON public.security_internal_callers        TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "security_route_policies_service_role"          ON public.security_route_policies;
CREATE POLICY "security_route_policies_service_role"          ON public.security_route_policies          TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "security_request_usage_daily_service_role"     ON public.security_request_usage_daily;
CREATE POLICY "security_request_usage_daily_service_role"     ON public.security_request_usage_daily     TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "security_request_usage_monthly_service_role"   ON public.security_request_usage_monthly;
CREATE POLICY "security_request_usage_monthly_service_role"   ON public.security_request_usage_monthly   TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "security_tenant_ai_usage_daily_service_role"   ON public.security_tenant_ai_usage_daily;
CREATE POLICY "security_tenant_ai_usage_daily_service_role"   ON public.security_tenant_ai_usage_daily   TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "security_tenant_ai_usage_monthly_service_role" ON public.security_tenant_ai_usage_monthly;
CREATE POLICY "security_tenant_ai_usage_monthly_service_role" ON public.security_tenant_ai_usage_monthly TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "security_circuit_state_service_role"           ON public.security_circuit_state;
CREATE POLICY "security_circuit_state_service_role"           ON public.security_circuit_state           TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "security_request_audit_service_role"           ON public.security_request_audit;
CREATE POLICY "security_request_audit_service_role"           ON public.security_request_audit           TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "security_tenant_ai_budgets_service_role"       ON public.security_tenant_ai_budgets;
CREATE POLICY "security_tenant_ai_budgets_service_role"       ON public.security_tenant_ai_budgets       TO service_role USING (true) WITH CHECK (true);

COMMIT;
