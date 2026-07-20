-- Migration: 20260720150000_get_admin_level_rpc.sql
-- Purpose: Additive RPC `public.get_admin_level(p_user_id uuid) RETURNS text`
--          so middleware Layer 0.65 role resolution can consult the
--          `admin_users` table (the operational admin roster that
--          `authorizeAdmin()` reads) instead of relying solely on the
--          `get_user_role` RPC + `user_roles` probe.
--
-- ─── RCA reference (2026-07-20 super-admin route-gating RCA) ─────────────────
-- Layer 0.65 (apps/host/src/proxy.ts) resolves roles via
-- packages/lib/src/middleware-helpers.ts, which calls the `get_user_role` RPC
-- (students/teachers/guardians) and probes the RBAC `user_roles` table — it
-- NEVER consults `admin_users`. An admin whose auth user also has a `students`
-- row therefore resolves to 'student' and every /super-admin navigation is
-- bounced to /dashboard. This RPC closes that gap: it surfaces the active
-- `admin_users.admin_level` for an auth user id so the middleware can promote
-- the resolved role to 'admin'/'super_admin' with precedence over
-- student/teacher/guardian. (The companion middleware change also stops
-- caching transient probe failures for 60s — that half is TypeScript-only.)
--
-- ─── SECURITY DEFINER justification (required by house rule) ─────────────────
-- SECURITY DEFINER is required because `admin_users` is RLS-enabled and its
-- SELECT policy (`admin_users_select_merged`, baseline) only exposes rows to
-- the row owner or to already-active admins. The middleware calls this RPC via
-- PostgREST with the service-role key (which would bypass RLS anyway), but the
-- `authenticated` grant below lets a logged-in user resolve their OWN level
-- without an RLS round-trip. To prevent SECURITY DEFINER from becoming an
-- enumeration oracle ("is uuid X an admin?"), the function body restricts
-- non-service-role callers to self-lookup: it returns a row only when the
-- caller IS the service role, or `p_user_id = auth.uid()`. Attack surface is a
-- single text value (`admin_level`) or NULL — no PII columns are readable.
--
-- ─── Contract ────────────────────────────────────────────────────────────────
--   get_admin_level(p_user_id uuid) RETURNS text
--     → `admin_users.admin_level` when an ACTIVE (`is_active = true`) row
--       exists for `auth_user_id = p_user_id` AND the caller is allowed
--       (service_role, or self-lookup for authenticated users);
--     → NULL otherwise (no row, inactive row, or non-self authenticated probe).
--   STABLE (read-only), `SET search_path = public` (definer-function hygiene:
--   pins object resolution so a malicious schema earlier in the caller's
--   search_path cannot shadow `admin_users`).
--
-- ─── Safety / house style ────────────────────────────────────────────────────
--   * Single transaction (BEGIN/COMMIT).
--   * Idempotent: CREATE OR REPLACE + re-runnable GRANT/REVOKE.
--   * to_regclass fresh-DB guard: the whole file is a clean NOTICE no-op where
--     `public.admin_users` does not exist (fresh DB / out-of-order apply), so
--     the live-DB CI test and Supabase preview branches never fail.
--   * Additive only: no data changes, no other DDL, no DROP, no table/RLS
--     changes. `admin_users` keeps its existing baseline RLS posture.
--   * Grants: EXECUTE to `authenticated` + `service_role`; REVOKEd from
--     PUBLIC and `anon` (functions are executable by PUBLIC by default —
--     the REVOKE is load-bearing, not decorative).
--
-- ─── Reversible (manual DOWN) ────────────────────────────────────────────────
--   DROP FUNCTION IF EXISTS public.get_admin_level(uuid);
-- The middleware treats a missing RPC (PostgREST 404 / PGRST202) as
-- "no admin_users signal" and falls back to the legacy get_user_role +
-- user_roles resolution, so dropping the function degrades gracefully.
--
-- Owner: architect. Reviewers (P14 — RBAC/auth chain): backend, frontend,
--        ops, testing.
-- Added: 2026-07-20

BEGIN;

DO $get_admin_level_rpc$
BEGIN
  IF to_regclass('public.admin_users') IS NULL THEN
    RAISE NOTICE 'admin_users table absent; skipping get_admin_level RPC creation (fresh DB).';
    RETURN;
  END IF;

  EXECUTE $create_fn$
    CREATE OR REPLACE FUNCTION public.get_admin_level(p_user_id uuid)
    RETURNS text
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    -- SECURITY DEFINER: admin_users is RLS-enabled; see migration header for
    -- the full justification + the self-lookup / service-role caller guard.
    SET search_path = public
    AS $fn_body$
      SELECT au.admin_level
      FROM public.admin_users au
      WHERE au.auth_user_id = p_user_id
        AND au.is_active = true
        -- Caller guard (anti-enumeration): service_role may look up anyone
        -- (middleware path); authenticated users may only look up themselves.
        AND (
          COALESCE(auth.role(), '') = 'service_role'
          OR p_user_id = auth.uid()
        )
      LIMIT 1;
    $fn_body$;
  $create_fn$;

  -- Lock down execution: default PUBLIC EXECUTE must go; anon has no business
  -- resolving admin levels.
  EXECUTE 'REVOKE EXECUTE ON FUNCTION public.get_admin_level(uuid) FROM PUBLIC';
  EXECUTE 'REVOKE EXECUTE ON FUNCTION public.get_admin_level(uuid) FROM anon';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.get_admin_level(uuid) TO authenticated';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.get_admin_level(uuid) TO service_role';

  EXECUTE $comment$
    COMMENT ON FUNCTION public.get_admin_level(uuid) IS
      'Returns admin_users.admin_level for an ACTIVE admin row (auth_user_id = p_user_id), else NULL. SECURITY DEFINER (admin_users is RLS-gated) with an in-body caller guard: service_role may resolve any user (middleware Layer 0.65 path), authenticated users only themselves. Added 2026-07-20 per the super-admin route-gating RCA.'
  $comment$;

  RAISE NOTICE 'get_admin_level RPC created/replaced with grants (authenticated, service_role).';
END $get_admin_level_rpc$;

COMMIT;
