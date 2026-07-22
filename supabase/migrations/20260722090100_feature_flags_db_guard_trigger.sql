-- Migration: 20260722090100_feature_flags_db_guard_trigger.sql
-- Purpose: Phase 0 (Master Action Plan, item 0.2). Closes the direct-Postgres
--          gap left by the application-layer protected-flag guardrail: a
--          BEFORE UPDATE trigger on public.feature_flags that blocks any
--          transition making a REGISTERED-protected flag (per
--          public.protected_feature_flags, migration 20260722090000) MORE
--          enabled, unless the session GUC `app.protected_flag_ack` equals
--          the flag's name.
--
-- ─── Why a GUC and not just "block all direct writes" ────────────────────────
-- The admin_flip_feature_flag RPC (migration 20260722090200) is the ONLY
-- intended writer for a protected-row enable/re-gate. It sets
-- `SET LOCAL app.protected_flag_ack = p_flag_name` (validated against a typed
-- `p_confirm` parameter first) immediately before performing the UPDATE, all
-- inside one transaction. `SET LOCAL` scopes the GUC to the current
-- transaction only, so it can never leak to a later, unrelated statement or
-- session. A raw `UPDATE feature_flags ...` issued from the Supabase SQL
-- editor, a one-off psql session, or any other direct-Postgres client will
-- NOT have this GUC set, and the trigger raises an exception before the row
-- is written.
--
-- ─── Mirrors apps/host/src/app/api/super-admin/feature-flags/route.ts PATCH ──
-- (read in full before writing this trigger, per the architect task). The
-- route's guardrail logic (see the "Protected-flag guardrail" comment block
-- there):
--   makingMoreEnabled = updates.enabled === true
--                        OR (typeof updates.rollout_percentage === 'number'
--                            AND updates.rollout_percentage > 0)
--   disableGated = updates.enabled === false
--                  AND protection.tier IN ('special_do_not_touch', 'p11_payment')
--   requireAck = makingMoreEnabled OR disableGated
-- This trigger reproduces the SAME two conditions at the row-transition level
-- (OLD vs NEW), so the DB and the API layer can never disagree about which
-- transitions are gated:
--   making_more_enabled := (COALESCE(OLD.is_enabled, false) = false
--                              AND NEW.is_enabled = true)
--                        OR (COALESCE(OLD.rollout_percentage, 0) = 0
--                              AND COALESCE(NEW.rollout_percentage, 0) > 0)
--   disable_gated := (COALESCE(OLD.is_enabled, false) = true
--                        AND NEW.is_enabled = false)
--                    AND tier IN ('special_do_not_touch', 'p11_payment')
-- Kill switches stay fast for every other tier: disabling a p0_outage /
-- ai_provider / constitution_pinned / staged_rollout flag is NEVER gated,
-- exactly like the route.
--
-- The trigger only evaluates when is_enabled or rollout_percentage actually
-- change (WHEN clause), so a description/target_* edit on a protected flag
-- never touches this path -- same behavior as the route's
-- "description-only update on a PROTECTED flag needs no confirm" contract
-- (pinned by feature-flags-protected-guardrail.test.ts).
--
-- ─── SECURITY DEFINER justification (required by house rule) ─────────────────
-- SECURITY DEFINER is required because `protected_feature_flags` is
-- service-role-only RLS (migration 20260722090000: no SELECT policy for
-- authenticated/anon at all). The trigger function must be able to read that
-- table regardless of which role fires the UPDATE on `feature_flags`, so that
-- the guard cannot be silently defeated by simply not being service_role.
-- Without DEFINER, an authenticated-role UPDATE (currently impossible via RLS
-- on feature_flags itself, but this is defense in depth against a future RLS
-- relaxation) would see ZERO rows in protected_feature_flags and the trigger
-- would incorrectly treat every flag as unprotected -- the exact failure mode
-- SECURITY DEFINER exists to close. The function is STABLE-shaped read-only
-- logic (no writes), `SET search_path = public` pins object resolution, and
-- the only externally observable effect is an exception message that echoes
-- back the flag_name and tier already visible to the caller via the
-- feature_flags row itself -- no new information is disclosed (no
-- enumeration oracle: the caller already knows the flag_name because they are
-- the one updating that row).
--
-- ─── Safety / house style ────────────────────────────────────────────────────
--   * Single transaction (BEGIN/COMMIT).
--   * Idempotent: CREATE OR REPLACE FUNCTION; DROP TRIGGER IF EXISTS before
--     CREATE TRIGGER.
--   * to_regclass fresh-DB guards: no-ops cleanly if feature_flags or
--     protected_feature_flags do not yet exist (out-of-order apply / fresh DB
--     before 20260722090000 in the same batch -- in practice Supabase applies
--     migrations in filename order so this should never trip, but the guard
--     costs nothing and matches the house convention in
--     20260720150000_get_admin_level_rpc.sql).
--   * Additive only: no DROP TABLE/COLUMN, no data changes beyond the trigger
--     itself. feature_flags keeps its existing baseline RLS posture
--     unchanged (service_role ALL + authenticated SELECT-only).
--
-- ─── Reversible (manual DOWN) ────────────────────────────────────────────────
--   DROP TRIGGER IF EXISTS trg_protect_feature_flags ON public.feature_flags;
--   DROP FUNCTION IF EXISTS public.protect_feature_flags_guard();
-- Dropping the trigger returns feature_flags to its pre-hardening posture
-- (app-layer guardrail only) -- a legitimate emergency rollback if the trigger
-- itself is ever found to wrongly block a valid operator action.
--
-- Owner: architect. Reviewers (P14 -- RBAC/auth chain): backend, frontend,
--        ops, testing.
-- Added: 2026-07-22

BEGIN;

DO $feature_flags_db_guard$
BEGIN
  IF to_regclass('public.feature_flags') IS NULL
     OR to_regclass('public.protected_feature_flags') IS NULL THEN
    RAISE NOTICE 'feature_flags or protected_feature_flags absent; skipping DB guard trigger creation (fresh/out-of-order DB).';
    RETURN;
  END IF;

  EXECUTE $create_fn$
    CREATE OR REPLACE FUNCTION public.protect_feature_flags_guard()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    -- SECURITY DEFINER: protected_feature_flags is service-role-only RLS; see
    -- migration header for the full justification.
    SET search_path = public
    AS $fn_body$
    DECLARE
      v_tier text;
      v_making_more_enabled boolean;
      v_disable_gated boolean;
      v_ack text;
    BEGIN
      -- Look up protection for the row's (pre-update) flag_name. NULL = not
      -- protected -- allow unconditionally, matching getProtection() returning
      -- null in the TS registry for unprotected flags.
      SELECT tier INTO v_tier
        FROM public.protected_feature_flags
       WHERE flag_name = OLD.flag_name;

      IF v_tier IS NULL THEN
        RETURN NEW;
      END IF;

      -- Same two conditions as the route.ts PATCH guardrail (see migration
      -- header). COALESCE treats a NULL is_enabled/rollout_percentage as the
      -- "off" starting point (the DB DEFAULTs are false / 0, so NULL should
      -- not normally occur, but this keeps the guard fail-safe either way).
      v_making_more_enabled :=
        (COALESCE(OLD.is_enabled, false) = false AND NEW.is_enabled = true)
        OR (COALESCE(OLD.rollout_percentage, 0) = 0
            AND COALESCE(NEW.rollout_percentage, 0) > 0);

      v_disable_gated :=
        (COALESCE(OLD.is_enabled, false) = true AND NEW.is_enabled = false)
        AND v_tier IN ('special_do_not_touch', 'p11_payment');

      IF NOT (v_making_more_enabled OR v_disable_gated) THEN
        RETURN NEW; -- disabling a non-payment-safety tier: always unguarded (fast kill switch)
      END IF;

      -- Gated transition: require the caller to have SET LOCAL the exact
      -- flag_name via the ack GUC (only admin_flip_feature_flag does this,
      -- migration 20260722090200). current_setting(..., true) returns NULL
      -- instead of raising when the GUC was never set in this session/tx.
      v_ack := current_setting('app.protected_flag_ack', true);

      IF v_ack IS NULL OR v_ack <> OLD.flag_name THEN
        RAISE EXCEPTION
          'FLAG_PROTECTED: "%" (tier: %) requires the admin_flip_feature_flag RPC with a matching confirm -- direct UPDATE of feature_flags is blocked for this transition.',
          OLD.flag_name, v_tier
          USING ERRCODE = '42501'; -- insufficient_privilege
      END IF;

      RETURN NEW;
    END;
    $fn_body$;
  $create_fn$;

  EXECUTE $comment$
    COMMENT ON FUNCTION public.protect_feature_flags_guard() IS
      'BEFORE UPDATE guard on feature_flags: blocks a direct-Postgres transition that makes a row in protected_feature_flags MORE enabled (or, for special_do_not_touch/p11_payment tiers, LESS enabled) unless app.protected_flag_ack (SET LOCAL, transaction-scoped) equals the row''s flag_name. Only admin_flip_feature_flag (migration 20260722090200) sets that GUC. SECURITY DEFINER -- see migration 20260722090100 header for justification. Added 2026-07-22 (Phase 0 flag-governance hardening).'
  $comment$;

  EXECUTE 'DROP TRIGGER IF EXISTS trg_protect_feature_flags ON public.feature_flags';
  EXECUTE $create_trigger$
    CREATE TRIGGER trg_protect_feature_flags
      BEFORE UPDATE ON public.feature_flags
      FOR EACH ROW
      WHEN (
        OLD.is_enabled IS DISTINCT FROM NEW.is_enabled
        OR OLD.rollout_percentage IS DISTINCT FROM NEW.rollout_percentage
      )
      EXECUTE FUNCTION public.protect_feature_flags_guard();
  $create_trigger$;

  RAISE NOTICE 'trg_protect_feature_flags created/replaced on public.feature_flags.';
END $feature_flags_db_guard$;

COMMIT;

-- ─── Verify (manual check after applying) ────────────────────────────────────
-- 1. As service_role, WITHOUT setting the ack GUC:
--      UPDATE feature_flags SET is_enabled = true
--       WHERE flag_name = 'ff_school_pulse_v1';  -- expect: ERROR FLAG_PROTECTED
-- 2. As service_role, WITH the ack GUC set correctly (mirrors what
--    admin_flip_feature_flag does):
--      BEGIN;
--      SET LOCAL app.protected_flag_ack = 'ff_school_pulse_v1';
--      UPDATE feature_flags SET is_enabled = true
--       WHERE flag_name = 'ff_school_pulse_v1';  -- expect: success
--      ROLLBACK;  -- (don't actually leave this enabled in prod!)
-- 3. Disabling any staged_rollout/constitution_pinned/p0_outage/ai_provider
--    flag with NO ack GUC set -- expect: success (fast kill switch).
-- 4. Disabling ff_atomic_subscription_activation (special_do_not_touch) with
--    NO ack GUC set -- expect: ERROR FLAG_PROTECTED.
-- 5. Updating only `description` on any protected flag -- expect: success,
--    trigger does not even fire (WHEN clause excludes it).
-- 6. Updating an UNPROTECTED flag_name to is_enabled = true -- expect:
--    success unconditionally (no row in protected_feature_flags).
