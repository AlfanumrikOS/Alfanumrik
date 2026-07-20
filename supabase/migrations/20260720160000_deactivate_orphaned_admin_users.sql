-- Migration: 20260720160000_deactivate_orphaned_admin_users.sql
-- Purpose: Data-hygiene UPDATE — flip `is_active = false` on `admin_users`
--          rows whose `auth_user_id` points at an auth.users row that no
--          longer exists (the auth user was deleted).
--
-- ─── RCA reference (2026-07-20 super-admin RCA) ──────────────────────────────
-- The 2026-07-20 super-admin RCA found admin_users rows whose auth_user_id no
-- longer exists in auth.users (two orphaned rows observed in prod at the time
-- of the RCA). Nobody can ever authenticate as these rows — Supabase Auth has
-- no matching identity — so they are functionally dead, but while
-- `is_active = true` they clutter roster audits and confuse identity
-- reasoning (e.g. active-admin counts, `get_admin_level` mental models).
--
-- Deliberately NO hardcoded emails or ids: the PREDICATE is the contract.
-- Any active row whose auth_user_id is set but resolves to no auth.users row
-- is deactivated, whenever this runs. Hardcoding the two observed rows would
-- miss future orphans and leak identity details into the migration chain.
--
-- ─── Predicate note (auth_user_id IS NOT NULL guard) ─────────────────────────
-- `admin_users.auth_user_id` is NULLABLE (baseline). A bare
-- `NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = auth_user_id)` is TRUE
-- for NULL auth_user_id too, which would sweep never-linked (e.g.
-- pre-provisioned) rows into the deactivation. That exceeds the RCA scope
-- ("auth user was DELETED"), so the UPDATE additionally requires
-- `auth_user_id IS NOT NULL`. NULL-linked rows are untouched.
--
-- ─── Reactivation contract ───────────────────────────────────────────────────
-- Reactivation is a DELIBERATE MANUAL act: first repoint `auth_user_id` to a
-- live auth.users id, then set `is_active = true`. Do not blanket-reactivate;
-- rows deactivated here fail the predicate's premise until repointed.
--
-- ─── Safety / house style ────────────────────────────────────────────────────
--   * Single transaction (BEGIN/COMMIT).
--   * Idempotent by construction: the second run matches zero rows
--     (`is_active = true` filter) — safe to re-apply anywhere.
--   * to_regclass fresh-DB guards on BOTH `public.admin_users` AND
--     `auth.users`: the whole file is a clean NOTICE no-op where either table
--     is absent (fresh DB / CI live-DB test / preview branches without the
--     auth schema).
--   * No DDL, no DELETEs, no other tables. `admin_users` keeps its existing
--     baseline RLS posture; this runs as the migration role (bypasses RLS by
--     design, as all migrations do).
--   * GET DIAGNOSTICS row count surfaced via RAISE NOTICE for the apply log.
--
-- ─── Reversible (manual DOWN) ────────────────────────────────────────────────
-- There is no automatic DOWN: the rows this touches are dead by definition.
-- Per the reactivation contract above, recovery = repoint auth_user_id to a
-- live auth user, then `UPDATE public.admin_users SET is_active = true,
-- updated_at = NOW() WHERE id = '<specific id>'` — a per-row manual decision,
-- never a bulk revert.
--
-- Owner: architect. Data-only hygiene; no review chain triggered (no RBAC
--        grant/schema/auth-flow change — the rows were already unusable).
-- Added: 2026-07-20

BEGIN;

DO $deactivate_orphaned_admin_users$
DECLARE
  v_deactivated integer := 0;
BEGIN
  IF to_regclass('public.admin_users') IS NULL THEN
    RAISE NOTICE 'admin_users table absent; skipping orphaned-admin deactivation (fresh DB).';
    RETURN;
  END IF;

  IF to_regclass('auth.users') IS NULL THEN
    RAISE NOTICE 'auth.users table absent; skipping orphaned-admin deactivation (no auth schema in this environment).';
    RETURN;
  END IF;

  EXECUTE $update$
    UPDATE public.admin_users
    SET is_active = false,
        updated_at = NOW()
    WHERE is_active = true
      AND auth_user_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM auth.users u WHERE u.id = admin_users.auth_user_id
      )
  $update$;

  GET DIAGNOSTICS v_deactivated = ROW_COUNT;

  RAISE NOTICE 'Deactivated % orphaned admin_users row(s) (auth_user_id set but absent from auth.users). Reactivation requires repointing auth_user_id to a live auth user first.', v_deactivated;
END $deactivate_orphaned_admin_users$;

COMMIT;
