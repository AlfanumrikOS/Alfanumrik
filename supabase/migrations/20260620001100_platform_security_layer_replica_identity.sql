-- 20260620001100_platform_security_layer_replica_identity.sql
--
-- Fix replication identity for the Phase 1 platform security layer tables
-- that are updated by RPCs and therefore need stable keys in publication.

ALTER TABLE public.security_quota_profiles
  REPLICA IDENTITY USING INDEX security_quota_profiles_pkey;

ALTER TABLE public.security_internal_callers
  REPLICA IDENTITY USING INDEX security_internal_callers_pkey;

ALTER TABLE public.security_route_policies
  REPLICA IDENTITY USING INDEX security_route_policies_policy_key_unique;

ALTER TABLE public.security_request_usage_daily
  REPLICA IDENTITY USING INDEX security_request_usage_daily_quota_key_unique;

ALTER TABLE public.security_request_usage_monthly
  REPLICA IDENTITY USING INDEX security_request_usage_monthly_quota_key_unique;

ALTER TABLE public.security_tenant_ai_usage_daily
  REPLICA IDENTITY USING INDEX security_tenant_ai_usage_daily_quota_key_unique;

ALTER TABLE public.security_tenant_ai_usage_monthly
  REPLICA IDENTITY USING INDEX security_tenant_ai_usage_monthly_quota_key_unique;

ALTER TABLE public.security_circuit_state
  REPLICA IDENTITY USING INDEX security_circuit_state_circuit_key_unique;
