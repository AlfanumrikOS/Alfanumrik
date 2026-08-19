-- Migration: 20260816000009_fix_user_roles_admin_rls_write_policy.sql
-- Purpose: P8 CRITICAL — close a self-escalation hole on public.user_roles
--          RLS. Quality-review finding on the Phase 1 Mission Control
--          overhaul (2026-08-16), independently verified by architect.
--
-- ─── The hole ─────────────────────────────────────────────────────────────
-- The baseline policy "user_roles_admin" (00000000000000_baseline_from_prod.sql,
-- ~line 22562) was declared with NO `FOR` clause (Postgres defaults to
-- FOR ALL: SELECT/INSERT/UPDATE/DELETE) and NO `WITH CHECK` clause:
--
--   CREATE POLICY "user_roles_admin" ON "public"."user_roles" TO "authenticated"
--     USING (auth.uid() IN (SELECT admin_users.auth_user_id FROM admin_users
--            WHERE admin_users.is_active = true));
--
-- Per Postgres CREATE POLICY semantics: a FOR ALL policy that supplies only
-- USING and no WITH CHECK reuses the USING expression as WITH CHECK for
-- INSERT/UPDATE too. The USING predicate above checks only "does auth.uid()
-- have ANY active admin_users row" — no tier/level filter, and no reference
-- at all to the content of the row being written. Net effect: EVERY active
-- admin_users row, of ANY tier (including the lowest, `support`), had
-- unrestricted RLS-level INSERT/UPDATE/DELETE on the ENTIRE user_roles table
-- via any RLS-scoped (non-service-role) Supabase client — e.g. a
-- support-tier operator could INSERT a row granting themselves (or anyone
-- else) the super_admin RBAC role directly, bypassing
-- authorizeOperator()/authorizeAdmin() and the RBAC-sync trigger from
-- migration 20260816000008 entirely. This directly undermined the CEO
-- architectural mandate (see 20260816000008's header) that "RBAC becomes the
-- single authorization source of truth" — a self-escalation hole in RBAC's
-- own membership table is the worst possible place for this bug class.
--
-- This is a PRE-EXISTING baseline defect, not introduced by Phase 1's own
-- diff — but 20260816000008's own P8 review comment incorrectly asserted
-- "there is no INSERT/UPDATE policy on user_roles for `authenticated` at
-- all", which is corrected in that migration file by this same change.
--
-- ─── Verification performed before this fix (architect, 2026-08-16) ──────
--   1. No other defense-in-depth closes this today. `service_role_user_roles`
--      (service_role, FOR ALL, USING(true)/WITH CHECK(true)) is a separate,
--      unaffected policy. The new sync_admin_level_to_rbac_role() trigger
--      (20260816000008) is SECURITY DEFINER — it writes as the function
--      owner regardless of the caller's RLS-scoped policies, so it neither
--      depends on nor is protected by "user_roles_admin" either way. No
--      BEFORE INSERT/UPDATE trigger validates role_id against the acting
--      user's own tier anywhere in the chain.
--   2. No legitimate application code path writes to user_roles via an
--      RLS-scoped (anon/authenticated) client. Every write site found via
--      `grep -rn "from('user_roles')" apps/host/src` (excluding tests) uses
--      the service-role client:
--        - apps/host/src/app/api/v1/admin/roles/route.ts — supabaseAdmin,
--          SELECT only (cache-invalidation lookup after a role_permissions
--          change), gated by authorizeRequest(request, 'role.manage').
--        - apps/host/src/app/api/super-admin/roles/route.ts —
--          supabaseAdminUrl()/supabaseAdminHeaders() (service-role REST
--          calls) for the actual INSERT (grant) / DELETE (revoke) writes,
--          gated by authorizeAdmin(request, 'admin').
--        - apps/host/src/app/api/super-admin/debug/whoami/route.ts —
--          getSupabaseAdmin(), SELECT only.
--      No route reads/writes user_roles through packages/lib/src/supabase.ts
--      or supabase-server.ts (the RLS-scoped clients). The broad
--      `authenticated` write grant was therefore pure vestigial exposure
--      with zero legitimate dependents — the safest fix (remove write access
--      entirely) applies cleanly.
--
-- ─── The fix ──────────────────────────────────────────────────────────────
-- Narrow "user_roles_admin" from its implicit FOR ALL (no WITH CHECK) to
-- FOR SELECT only, keeping the SAME policy name and the SAME predicate
-- (read scope is completely unchanged — this migration does not touch or
-- weaken read access, and is redundant-but-harmless alongside the sibling
-- "user_roles_select" self-or-admin read policy already in place). No
-- INSERT/UPDATE/DELETE policy is created for `authenticated` at all: every
-- real write path already goes through service_role (bypasses RLS
-- entirely — see "service_role_user_roles") or a SECURITY DEFINER function
-- (sync_admin_level_to_rbac_role, sync_user_roles_on_insert,
-- sync_user_roles_for_user), none of which is affected by removing the
-- `authenticated` write grant.
--
-- Keeping the SAME policy name ("user_roles_admin") is deliberate, not
-- cosmetic: apps/host/src/__tests__/rls-no-cross-table-recursion.test.ts
-- freezes a ledger of policies whose USING/WITH CHECK inlines a FROM/JOIN
-- over a different RLS-enabled table (this policy's `FROM admin_users`
-- subquery is exactly that pattern), keyed "<table>::<policy name>". The
-- predicate below is byte-identical to the baseline's, so
-- 'user_roles::user_roles_admin' remains correctly present (and still
-- correctly detected) in that ledger with NO edit required there — only the
-- FOR clause narrows.
--
-- Idempotent: DROP POLICY IF EXISTS + CREATE POLICY. Additive/corrective —
-- no DROP TABLE/COLUMN, no data loss. Read access is completely unchanged;
-- only the (vestigial, undefended) write grant for `authenticated` is
-- removed.

BEGIN;

DROP POLICY IF EXISTS "user_roles_admin" ON "public"."user_roles";

CREATE POLICY "user_roles_admin" ON "public"."user_roles"
  FOR SELECT
  TO "authenticated"
  USING (
    "auth"."uid"() IN (
      SELECT "admin_users"."auth_user_id"
      FROM "public"."admin_users"
      WHERE ("admin_users"."is_active" = true)
    )
  );

COMMIT;

-- ─── Verify (manual checks after applying) ───────────────────────────────
-- 1. No authenticated-role write policy remains on user_roles:
--   SELECT polname, polcmd,
--          pg_get_expr(polqual, polrelid)     AS using_expr,
--          pg_get_expr(polwithcheck, polrelid) AS with_check_expr
--   FROM pg_policy WHERE polrelid = 'public.user_roles'::regclass;
--   -- Expect: "user_roles_admin" polcmd='r' (SELECT), "user_roles_select"
--   -- polcmd='r', "service_role_user_roles" polcmd='*' (service_role only,
--   -- not authenticated). No 'a'/'w'/'d' policy targets `authenticated`.
--
-- 2. Self-escalation attempt from a support-tier session now fails at the
--    RLS layer (not merely the API layer) — run as a support-tier
--    authenticated session (anon key + that user's JWT):
--   INSERT INTO user_roles (auth_user_id, role_id, is_active)
--   VALUES (auth.uid(), (SELECT id FROM roles WHERE name = 'super_admin'), true);
--   -- Expect: ERROR: new row violates row-level security policy for table "user_roles"
--
-- End of migration: 20260816000009_fix_user_roles_admin_rls_write_policy.sql
