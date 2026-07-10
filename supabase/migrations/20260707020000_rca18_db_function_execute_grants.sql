-- Migration: 20260707020000_rca18_db_function_execute_grants.sql
-- Purpose: RCA-18 hardening for high-risk SECURITY DEFINER RPC execute grants.

BEGIN;

REVOKE EXECUTE ON FUNCTION public.submit_quiz_results(
  uuid,
  text,
  text,
  text,
  integer,
  jsonb,
  integer
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.submit_quiz_results(
  uuid,
  text,
  text,
  text,
  integer,
  jsonb,
  integer
) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.submit_quiz_results_v2(
  uuid,
  uuid,
  text,
  text,
  text,
  integer,
  jsonb,
  integer,
  uuid
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.submit_quiz_results_v2(
  uuid,
  uuid,
  text,
  text,
  text,
  integer,
  jsonb,
  integer,
  uuid
) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.match_rag_chunks_ncert(
  text,
  text,
  text,
  integer,
  integer,
  text,
  text,
  text,
  double precision,
  double precision,
  public.vector
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.match_rag_chunks_ncert(
  text,
  text,
  text,
  integer,
  integer,
  text,
  text,
  text,
  double precision,
  double precision,
  public.vector
) TO authenticated, service_role;

COMMIT;
