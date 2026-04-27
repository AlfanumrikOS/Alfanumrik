-- Migration: 20260427000001_rls_policies_domain_events_webhook_events.sql
-- Purpose: Add explicit RLS policies for two recently-added append-only
--          infrastructure tables that enabled RLS without writing
--          permissive policies. With RLS on and no policies, every
--          non-service-role caller is denied — which is fine for client
--          isolation but means even the super-admin console (which calls
--          via authenticated Supabase clients, not service_role) cannot
--          read these tables. This migration closes that gap by adding:
--
--          - SELECT policies scoped to super_admin/admin via the
--            user_roles + roles join pattern used elsewhere
--            (see 20260428000500_misconception_candidate_view.sql).
--          - INSERT policies scoped to service_role only (defense in
--            depth on top of the existing GRANT).
--          - No UPDATE/DELETE policies — both tables are append-only
--            event logs and the application writes status updates
--            exclusively via SECURITY DEFINER RPCs running as service_role.
--
-- Audit findings closed:
--   - Red #1: domain_events RLS-enabled-without-policies
--             (20260425120000_domain_events_outbox.sql)
--   - Red #2: payment_webhook_events RLS-enabled-without-policies
--             (20260425150000_payment_webhook_events.sql)
--
-- Source of truth for the super_admin RLS pattern:
--   supabase/migrations/20260428000500_misconception_candidate_view.sql
--
-- Safety:
--   - Idempotent: policies guarded by DO $$ ... EXCEPTION WHEN duplicate_object
--   - Additive only: no DROP TABLE / DROP COLUMN / ALTER on existing tables
--     beyond policy DDL
--   - No P-invariant change: this enforces P8 (RLS Boundary) and P9 (RBAC
--     Enforcement) more tightly; does not relax anything

BEGIN;

-- ─── 1. domain_events policies ─────────────────────────────────────────────
-- Super-admin / admin SELECT for ops dashboards and event-replay tooling.
-- The service_role bypasses RLS and continues to read/write directly via
-- the existing GRANT in 20260425120000.

DO $$ BEGIN
  CREATE POLICY "domain_events_super_admin_select"
    ON public.domain_events
    FOR SELECT
    TO authenticated
    USING (
      EXISTS (
        SELECT 1
        FROM user_roles ur
        JOIN roles r ON r.id = ur.role_id
        WHERE ur.auth_user_id = auth.uid()
          AND ur.is_active   = true
          AND (ur.expires_at IS NULL OR ur.expires_at > now())
          AND r.name IN ('super_admin', 'admin')
      )
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_table  THEN
    RAISE NOTICE 'domain_events_super_admin_select: user_roles/roles missing — skipping';
  WHEN undefined_column THEN
    RAISE NOTICE 'domain_events_super_admin_select: column shape mismatch — skipping';
END $$;

-- Explicit service_role INSERT policy. The service_role normally bypasses
-- RLS, so this is defense in depth: if a future migration ever flips the
-- role's BYPASSRLS attribute, the outbox still accepts inserts only from
-- the service role.
DO $$ BEGIN
  CREATE POLICY "domain_events_service_role_insert"
    ON public.domain_events
    FOR INSERT
    TO service_role
    WITH CHECK (true);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- No UPDATE/DELETE policies. Status transitions (pending -> processing ->
-- processed) happen via SECURITY DEFINER functions that execute as the
-- function owner (postgres) and bypass RLS by design. End users — even
-- super-admins — must never mutate event rows directly.

-- ─── 2. payment_webhook_events policies ────────────────────────────────────
-- Super-admin / admin SELECT for webhook-trace audit views in the
-- super-admin console. Service_role bypasses RLS via the existing GRANT
-- in 20260425150000.

DO $$ BEGIN
  CREATE POLICY "payment_webhook_events_super_admin_select"
    ON public.payment_webhook_events
    FOR SELECT
    TO authenticated
    USING (
      EXISTS (
        SELECT 1
        FROM user_roles ur
        JOIN roles r ON r.id = ur.role_id
        WHERE ur.auth_user_id = auth.uid()
          AND ur.is_active   = true
          AND (ur.expires_at IS NULL OR ur.expires_at > now())
          AND r.name IN ('super_admin', 'admin')
      )
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_table  THEN
    RAISE NOTICE 'payment_webhook_events_super_admin_select: user_roles/roles missing — skipping';
  WHEN undefined_column THEN
    RAISE NOTICE 'payment_webhook_events_super_admin_select: column shape mismatch — skipping';
END $$;

DO $$ BEGIN
  CREATE POLICY "payment_webhook_events_service_role_insert"
    ON public.payment_webhook_events
    FOR INSERT
    TO service_role
    WITH CHECK (true);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- No UPDATE/DELETE policies. The webhook handler updates processed_at /
-- outcome via the mark_webhook_event_processed SECURITY DEFINER RPC
-- (running as postgres), which bypasses RLS. P11 (Payment Integrity)
-- requires that nothing else can mutate webhook event rows — particularly
-- not authenticated end users.

COMMIT;
