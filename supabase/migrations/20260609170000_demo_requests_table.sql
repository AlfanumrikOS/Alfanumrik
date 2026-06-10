-- Migration: 20260609170000_demo_requests_table.sql
-- Date: 2026-06-09
--
-- WHY THIS FILE EXISTS
-- --------------------
-- The marketing demo-booking form at /demo has always written to demo_requests
-- but the table was never in the active migration chain (not in any file under
-- supabase/migrations/). On production the table existed from a direct SQL
-- execution; on every other environment (CI, DR, new staging) it was absent.
-- The form catch block silently swallowed the error so leads were lost with no
-- visibility. This migration adds the table to the reproducible schema.
--
-- RISKS: LOW — new table, no impact on existing tables or RPCs.
-- IDEMPOTENCY: YES — CREATE TABLE IF NOT EXISTS.
-- EXECUTION ORDER: Independent. No dependencies.
--
-- IDEMPOTENCY REPAIR (2026-06-10, cross-layer gap audit): a read-only prod
-- check confirmed the out-of-repo DDL that created the table ALSO created the
-- two policies below with the same names. The original body used bare
-- CREATE POLICY / CREATE TRIGGER, which aborts with 42710 duplicate_object on
-- any environment where those objects pre-exist (prod, if this version is
-- still pending there) — and one failed file blocks every later migration in
-- the same `supabase db push`. Policies and the trigger are now
-- DROP ... IF EXISTS + CREATE (the repo's established drop+create pattern;
-- see the baseline). Environments that already recorded this version are
-- unaffected — the CLI tracks applied migrations by version, not checksum.
-- Companion convergence file: 20260610100000_reconcile_demo_requests_table.sql.

CREATE TABLE IF NOT EXISTS public.demo_requests (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT        NOT NULL,
  email          TEXT        NOT NULL,
  phone          TEXT        NULL,
  role           TEXT        NOT NULL,
  school_name    TEXT        NOT NULL,
  student_count  TEXT        NULL,
  message        TEXT        NULL,
  status         TEXT        NOT NULL DEFAULT 'new'
                   CHECK (status IN ('new', 'contacted', 'scheduled', 'closed')),
  notes          TEXT        NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Auto-update updated_at on row changes
CREATE OR REPLACE FUNCTION public.tg_demo_requests_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_demo_requests_updated_at ON public.demo_requests;
CREATE TRIGGER trg_demo_requests_updated_at
  BEFORE UPDATE ON public.demo_requests
  FOR EACH ROW EXECUTE FUNCTION public.tg_demo_requests_updated_at();

-- Index for ops triage: newest leads first, uncontacted leads first
CREATE INDEX IF NOT EXISTS idx_demo_requests_status_created
  ON public.demo_requests (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_demo_requests_email
  ON public.demo_requests (email);

-- RLS
ALTER TABLE public.demo_requests ENABLE ROW LEVEL SECURITY;

-- Public INSERT: the /demo marketing page is unauthenticated; anyone can submit
-- a demo request. No SELECT/UPDATE/DELETE for anon.
DROP POLICY IF EXISTS "demo_requests_public_insert" ON public.demo_requests;
CREATE POLICY "demo_requests_public_insert"
  ON public.demo_requests
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- Service role reads everything (for super-admin ops panel)
DROP POLICY IF EXISTS "demo_requests_service_role_all" ON public.demo_requests;
CREATE POLICY "demo_requests_service_role_all"
  ON public.demo_requests
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Verification
DO $verify$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count
    FROM pg_tables
   WHERE schemaname = 'public'
     AND tablename  = 'demo_requests';

  IF v_count = 0 THEN
    RAISE WARNING '[20260609170000] demo_requests table not created — check CREATE TABLE statement';
  ELSE
    RAISE NOTICE '[20260609170000] demo_requests table present. RLS policies applied. COMPLETE.';
  END IF;
END $verify$;
