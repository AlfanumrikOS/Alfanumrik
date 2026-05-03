-- Migration: fix_service_role_rls_policies
-- Applied: 2026-04-08 (P4 Sprint)
-- Purpose: All "service role full access" policies were scoped to {public} role,
--          meaning ANY authenticated user could bypass RLS. Fixed to service_role.
--          37 policies across 33 tables corrected dynamically.

DO $$
DECLARE
  v_pol   RECORD;
  v_drop  text;
  v_create text;
BEGIN
  FOR v_pol IN
    SELECT
      schemaname,
      tablename,
      policyname,
      cmd,
      qual,
      with_check
    FROM pg_policies
    WHERE schemaname = 'public'
      AND policyname ILIKE '%service role%'
      AND roles = '{public}'   -- incorrectly scoped to public
  LOOP
    -- Drop the incorrectly-scoped policy
    v_drop := format(
      'DROP POLICY IF EXISTS %I ON %I.%I',
      v_pol.policyname, v_pol.schemaname, v_pol.tablename
    );
    EXECUTE v_drop;

    -- Recreate with TO service_role
    v_create := format(
      'CREATE POLICY %I ON %I.%I AS PERMISSIVE FOR %s TO service_role USING (true) WITH CHECK (true)',
      v_pol.policyname, v_pol.schemaname, v_pol.tablename,
      CASE v_pol.cmd WHEN 'SELECT' THEN 'SELECT' WHEN 'INSERT' THEN 'INSERT'
                     WHEN 'UPDATE' THEN 'UPDATE' WHEN 'DELETE' THEN 'DELETE'
                     ELSE 'ALL' END
    );
    EXECUTE v_create;
  END LOOP;
END;
$$;
