-- Migration: 20260610100000_reconcile_demo_requests_table.sql
-- Date: 2026-06-10
--
-- PROVENANCE / WHY THIS FILE EXISTS
-- ---------------------------------
-- Reconciliation of out-of-repo DDL discovered 2026-06-10 during the
-- cross-layer gap audit. `public.demo_requests` is written to by the
-- marketing demo-booking form (src/app/demo/page.tsx) but the table was
-- originally created on PROD via direct SQL execution, never through the
-- migration chain. A read-only prod check on 2026-06-10 confirmed the table
-- EXISTS on prod (0 rows) with exactly the shape asserted below, including
-- RLS enabled and the two policies recreated at the bottom of this file.
--
-- This migration makes fresh environments (CI live-DB, staging rebuilds, DR)
-- reproducible: it creates the table where absent and is a converging no-op
-- where the table already exists.
--
-- RELATIONSHIP TO 20260609170000_demo_requests_table.sql
-- ------------------------------------------------------
-- That file (landed 2026-06-09) already adds the table to the chain, but its
-- original body was NOT idempotent against prod's pre-existing state (bare
-- CREATE POLICY / CREATE TRIGGER → 42710 duplicate_object). It received an
-- idempotency repair on 2026-06-10. This file is the convergence layer that
-- runs LAST and asserts the final, prod-parity end state on EVERY environment
-- regardless of which path the environment took:
--   - fresh env:  20260609170000 creates everything → this file no-ops/re-asserts
--   - prod:       table + policies pre-exist via out-of-repo DDL → this file
--                 converges trigger/indexes/policies idempotently
--   - any env where 20260609170000 was pre-marked applied without executing
--                 (repair scenario) → this file creates whatever is missing
--
-- INTENTIONAL POLICY SHAPE (do not "improve")
-- -------------------------------------------
-- 1. NO SELECT policy for anon/authenticated is INTENTIONAL: demo_requests is
--    write-only lead capture from the public /demo page. Reads happen only via
--    the service role (super-admin ops). Adding a SELECT policy would leak
--    other visitors' contact details (names, emails, phones) to any browser.
-- 2. WITH CHECK (true) on the public INSERT policy is kept EXACTLY as prod has
--    it. Parity with prod is the goal of a reconciliation migration; per the
--    repo's RLS-performance convention there are no auth.uid() calls needed
--    here, and any tightening must ship as its own reviewed migration, not be
--    smuggled into a reconcile.
--
-- RISKS: LOW — additive only; no DROP TABLE/COLUMN; no data changes.
-- IDEMPOTENCY: YES — IF NOT EXISTS / OR REPLACE / DO-guarded constraint /
--              DROP POLICY IF EXISTS + CREATE.
-- EXECUTION ORDER: after 20260609170000 (both pipelines run
--              `supabase db push --linked --include-all`, so the mid-chain
--              timestamp is applied even when later versions are recorded).

-- ── Table (exact prod shape: no FKs, no unique on email) ─────────────────────
-- The status CHECK is intentionally NOT inline here; it is added by the guarded
-- DO block below so the constraint path is identical whether the table was just
-- created or pre-existed.

CREATE TABLE IF NOT EXISTS public.demo_requests (
  id             UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name           TEXT        NOT NULL,
  email          TEXT        NOT NULL,
  phone          TEXT        NULL,
  role           TEXT        NOT NULL,
  school_name    TEXT        NOT NULL,
  student_count  TEXT        NULL,
  message        TEXT        NULL,
  status         TEXT        NOT NULL DEFAULT 'new',
  notes          TEXT        NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Status CHECK constraint (guarded — table may pre-exist on prod with the
--    constraint already present under PostgreSQL's default inline name) ───────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'public.demo_requests'::regclass
       AND contype  = 'c'
       AND conname  = 'demo_requests_status_check'
  ) THEN
    ALTER TABLE public.demo_requests
      ADD CONSTRAINT demo_requests_status_check
      CHECK (status IN ('new', 'contacted', 'scheduled', 'closed'));
  END IF;
END $$;

-- ── updated_at trigger ────────────────────────────────────────────────────────
-- SECURITY INVOKER (explicit): this normalizes the SECURITY DEFINER variant
-- first shipped in 20260609170000. A trivial NEW.updated_at stamp needs no
-- elevated privileges, so INVOKER is the least-privilege choice; DEFINER had
-- no justification. search_path stays pinned either way. Because this file
-- runs after 20260609170000 on every environment, all environments converge
-- to the INVOKER definition.

CREATE OR REPLACE FUNCTION public.tg_demo_requests_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
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

-- ── Indexes (re-asserted from 20260609170000 for the repair scenario; prod's
--    confirmed out-of-repo shape did not include them) ────────────────────────

CREATE INDEX IF NOT EXISTS idx_demo_requests_status_created
  ON public.demo_requests (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_demo_requests_email
  ON public.demo_requests (email);

-- ── RLS (prod has it ENABLED; re-running ENABLE is a no-op) ──────────────────

ALTER TABLE public.demo_requests ENABLE ROW LEVEL SECURITY;

-- Public INSERT: the /demo marketing page is unauthenticated; anyone can
-- submit a demo request. Write-only — see INTENTIONAL POLICY SHAPE above.
DROP POLICY IF EXISTS "demo_requests_public_insert" ON public.demo_requests;
CREATE POLICY "demo_requests_public_insert"
  ON public.demo_requests
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- Service role: full access (super-admin ops panel reads/triages leads).
DROP POLICY IF EXISTS "demo_requests_service_role_all" ON public.demo_requests;
CREATE POLICY "demo_requests_service_role_all"
  ON public.demo_requests
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ── Verification ──────────────────────────────────────────────────────────────

DO $verify$
DECLARE
  v_table_count  integer;
  v_check_count  integer;
  v_policy_count integer;
BEGIN
  SELECT count(*) INTO v_table_count
    FROM pg_tables
   WHERE schemaname = 'public'
     AND tablename  = 'demo_requests';

  SELECT count(*) INTO v_check_count
    FROM pg_constraint
   WHERE conrelid = 'public.demo_requests'::regclass
     AND contype  = 'c'
     AND conname  = 'demo_requests_status_check';

  SELECT count(*) INTO v_policy_count
    FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename  = 'demo_requests'
     AND policyname IN ('demo_requests_public_insert', 'demo_requests_service_role_all');

  IF v_table_count = 1 AND v_check_count = 1 AND v_policy_count = 2 THEN
    RAISE NOTICE '[20260610100000] demo_requests reconciled: table + status CHECK + 2 policies present. COMPLETE.';
  ELSE
    RAISE WARNING '[20260610100000] demo_requests reconcile incomplete: table=% check=% policies=% (expected 1/1/2)',
      v_table_count, v_check_count, v_policy_count;
  END IF;
END $verify$;
