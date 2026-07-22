-- Migration: 20260722090200_admin_flip_feature_flag_rpc.sql
-- Purpose: Phase 0 (Master Action Plan, item 0.3). The sanctioned WRITE path
--          for flipping a protected feature flag: `public.admin_flip_feature_flag`.
--          This is the ONLY caller that legitimately sets the
--          `app.protected_flag_ack` GUC the BEFORE UPDATE trigger
--          (migration 20260722090100) requires for a gated transition, so it
--          is also the only path that can actually make a protected flag more
--          enabled (or gate-disable a payment-safety-tier flag) without the
--          trigger raising FLAG_PROTECTED.
--
-- ─── Contract ────────────────────────────────────────────────────────────────
--   admin_flip_feature_flag(p_flag_name text, p_updates jsonb, p_confirm text,
--                            p_actor_id uuid)
--     RETURNS jsonb  -- the updated feature_flags row, as jsonb
--   (a) Validates p_confirm = p_flag_name (typed-confirmation, mirrors the
--       route.ts `confirm === flag_name` contract) -- 42501 exception on
--       mismatch, BEFORE any read/write.
--   (b) `PERFORM set_config('app.protected_flag_ack', p_flag_name, true)` --
--       the `true` (is_local) argument scopes this to the CURRENT
--       TRANSACTION ONLY (equivalent to `SET LOCAL`), so the ack can never
--       leak into a later, unrelated statement.
--   (c) UPDATE feature_flags (only the keys present in p_updates are
--       touched; matches the app-layer FIELD_MAP-then-COALESCE pattern in
--       route.ts's PATCH handler) + an INSERT into admin_audit_log, in the
--       SAME transaction as the function body (Postgres wraps the whole
--       function execution atomically by default -- a mid-function
--       exception rolls back both the UPDATE and the audit INSERT together).
--   (d) Returns the updated row so the calling route can relay it to the
--       caller without a second SELECT round-trip.
--
-- ─── flag_name rename — deliberately UNSUPPORTED, FINAL (2026-07-22) ────────
-- This RPC's UPDATE has no CASE for `flag_name` and never will. The calling
-- route (apps/host/src/app/api/super-admin/feature-flags/route.ts) permanently
-- blocks any PATCH that both renames a protected flag AND changes
-- enabled/rollout state, returning 409 FLAG_RENAME_BLOCKED before this RPC is
-- ever invoked with a rename. This is a settled architect decision, not an
-- open follow-up:
--   1. protected_feature_flags.flag_name is the join key the BEFORE UPDATE
--      trigger (trg_protect_feature_flags, migration 20260722090100) uses to
--      decide whether a row is protected. Renaming feature_flags.flag_name
--      without ALSO renaming the protected_feature_flags row in the same
--      transaction would let the row escape protection entirely -- the exact
--      bypass this guard exists to prevent.
--   2. Even a correctly-cascaded rename (both tables, one transaction) would
--      desync every application-code call site that references the flag by
--      its old string constant (e.g. ADAPTIVE_REMEDIATION_FLAGS.V1 in
--      packages/lib/src/feature-flags.ts) -- those readers would silently
--      evaluate against a name that no longer exists. Flag identity is a
--      code-and-data contract, not data alone, so a rename must ship as a
--      migration + code PR together, never as a live admin action.
--   3. No protected tier (p0_outage, p11_payment, ai_provider,
--      constitution_pinned, staged_rollout, special_do_not_touch) has a
--      legitimate need to be renamed at runtime; a genuine correction (e.g. a
--      pre-launch typo) should go through the same review rigor as the
--      original protection.
-- See the matching FINAL note in route.ts's FLAG_RENAME_BLOCKED branch for
-- the full write-up. Do not add flag_name support to this RPC without a new,
-- explicit architect review overturning this decision.
--
-- Not found (no feature_flags row for p_flag_name) raises FLAG_NOT_FOUND.
-- Confirm mismatch raises FLAG_CONFIRM_MISMATCH. Both are plain RAISE
-- EXCEPTION (42501 insufficient_privilege for the confirm mismatch, P0002
-- no_data_found for the not-found case) -- the calling Next.js route is
-- expected to catch the PostgREST error and translate it to the existing
-- 409 FLAG_PROTECTED / 404 shapes so the console UX is unchanged.
--
-- ─── SECURITY DEFINER justification (required by house rule) ─────────────────
-- SECURITY DEFINER is required because this function performs THREE
-- privileged actions no ordinary caller should be able to do directly:
--   1. Set the `app.protected_flag_ack` GUC that disarms
--      trg_protect_feature_flags -- if any authenticated caller could set
--      this GUC directly, the entire DB-layer guardrail (migration
--      20260722090100) would be worthless (anyone could
--      `SET LOCAL app.protected_flag_ack = 'anything'` themselves and then
--      issue a raw UPDATE). Routing the ack exclusively through a
--      SECURITY DEFINER function that ALSO independently validates
--      `p_confirm = p_flag_name` first is what makes the ack trustworthy.
--   2. Read/write `admin_audit_log`, which has no RLS SELECT policy for
--      authenticated (it is written by the application's service-role-keyed
--      admin-auth helpers only -- see packages/lib/src/admin-auth.ts
--      logAdminAudit/logAdminAction). A non-DEFINER function running as an
--      authenticated caller could not insert this audit row.
--   3. Write feature_flags.updated_by/is_enabled/rollout_percentage/etc,
--      columns whose direct UPDATE this same migration REVOKEs from
--      `authenticated` (see below) precisely so that this RPC -- with its
--      confirm + audit + ack sequencing -- is the only route to a protected
--      flip.
-- The function does NOT amplify data exposure: it returns only the single
-- feature_flags row the caller named by p_flag_name (a name they already
-- possess and are the ones mutating), and it accepts no wildcard/pattern
-- input that could be used to enumerate other rows. `p_actor_id` is written
-- verbatim to updated_by/admin_audit_log.admin_id -- the calling route MUST
-- pass `auth.userId` from its own `authorizeAdmin(request, 'super_admin')`
-- check (already gating every caller of this RPC), so this is not a caller-
-- controlled identity spoof: the DB has no way to independently verify
-- p_actor_id against the invoking Postgres role (the invoking role is always
-- service_role, since only the service-role-keyed route calls this RPC), so
-- the actor-identity guarantee is enforced by the CALLER's auth layer, not
-- by this function -- documented here so a future reviewer does not assume
-- otherwise.
--
-- ─── Column-level lockdown (defense in depth) ────────────────────────────────
-- REVOKE UPDATE (is_enabled, rollout_percentage) ON feature_flags FROM
-- authenticated. `authenticated` already cannot write feature_flags at all
-- today (baseline RLS: `feature_flags_read_authenticated` is SELECT-only;
-- there is no authenticated INSERT/UPDATE/DELETE policy), so this REVOKE is
-- belt-and-suspenders against a FUTURE RLS relaxation that might otherwise
-- silently reopen a client-side write path to these two columns without
-- going through this RPC or the trigger's ack check. `service_role` keeps
-- full table UPDATE -- for NON-protected rows this stays the existing fast
-- path (route.ts's direct PostgREST PATCH, unchanged); for PROTECTED rows a
-- direct service_role UPDATE is now blocked by trg_protect_feature_flags
-- unless the ack GUC is set, which only this RPC does.
--
-- ─── Safety / house style ────────────────────────────────────────────────────
--   * Idempotent: CREATE OR REPLACE FUNCTION; REVOKE/GRANT are re-runnable.
--   * to_regclass fresh-DB guard: no-op cleanly if feature_flags,
--     protected_feature_flags, or admin_audit_log do not yet exist.
--   * Additive only: no DROP TABLE/COLUMN, no other DDL.
--   * `SET search_path = public` pins object resolution (definer-function
--     hygiene, matches 20260720150000_get_admin_level_rpc.sql).
--
-- ─── Reversible (manual DOWN) ────────────────────────────────────────────────
--   DROP FUNCTION IF EXISTS public.admin_flip_feature_flag(text, jsonb, text, uuid);
--   GRANT UPDATE (is_enabled, rollout_percentage) ON public.feature_flags TO authenticated;
--     (only restore the GRANT if a compensating write path is in place --
--      normally leave the REVOKE standing even if the RPC is rolled back.)
--
-- Owner: architect. Reviewers (P14 -- RBAC/auth chain): backend, frontend,
--        ops, testing.
-- Added: 2026-07-22

BEGIN;

DO $admin_flip_rpc$
BEGIN
  IF to_regclass('public.feature_flags') IS NULL
     OR to_regclass('public.protected_feature_flags') IS NULL
     OR to_regclass('public.admin_audit_log') IS NULL THEN
    RAISE NOTICE 'feature_flags, protected_feature_flags, or admin_audit_log absent; skipping admin_flip_feature_flag RPC creation (fresh/out-of-order DB).';
    RETURN;
  END IF;

  EXECUTE $create_fn$
    CREATE OR REPLACE FUNCTION public.admin_flip_feature_flag(
      p_flag_name text,
      p_updates jsonb,
      p_confirm text,
      p_actor_id uuid
    )
    RETURNS jsonb
    LANGUAGE plpgsql
    SECURITY DEFINER
    -- SECURITY DEFINER: see migration header for the full justification
    -- (this function is the only legitimate setter of app.protected_flag_ack
    -- and the only authenticated-role path into admin_audit_log writes).
    SET search_path = public
    AS $fn_body$
    DECLARE
      v_before  jsonb;
      v_after   public.feature_flags;
      v_tier    text;
    BEGIN
      IF p_confirm IS DISTINCT FROM p_flag_name THEN
        RAISE EXCEPTION
          'FLAG_CONFIRM_MISMATCH: confirm must equal the exact flag_name ("%")',
          p_flag_name
          USING ERRCODE = '42501';
      END IF;

      SELECT to_jsonb(f) INTO v_before
        FROM public.feature_flags f
       WHERE f.flag_name = p_flag_name;

      IF v_before IS NULL THEN
        RAISE EXCEPTION 'FLAG_NOT_FOUND: no feature_flags row for "%"', p_flag_name
          USING ERRCODE = 'P0002';
      END IF;

      SELECT pff.tier INTO v_tier
        FROM public.protected_feature_flags pff
       WHERE pff.flag_name = p_flag_name;

      -- Arm the trigger's ack GUC for THIS TRANSACTION ONLY (is_local = true,
      -- equivalent to SET LOCAL). Must happen AFTER the confirm check above so
      -- a mismatched confirm never arms the ack.
      PERFORM set_config('app.protected_flag_ack', p_flag_name, true);

      UPDATE public.feature_flags f
         SET is_enabled          = CASE WHEN p_updates ? 'is_enabled'
                                        THEN (p_updates->>'is_enabled')::boolean
                                        ELSE f.is_enabled END,
             rollout_percentage  = CASE WHEN p_updates ? 'rollout_percentage'
                                        THEN (p_updates->>'rollout_percentage')::integer
                                        ELSE f.rollout_percentage END,
             description         = CASE WHEN p_updates ? 'description'
                                        THEN (p_updates->>'description')
                                        ELSE f.description END,
             target_grades       = CASE WHEN p_updates ? 'target_grades'
                                        THEN ARRAY(SELECT jsonb_array_elements_text(p_updates->'target_grades'))
                                        ELSE f.target_grades END,
             target_institutions = CASE WHEN p_updates ? 'target_institutions'
                                        THEN ARRAY(SELECT (jsonb_array_elements_text(p_updates->'target_institutions'))::uuid)
                                        ELSE f.target_institutions END,
             target_roles        = CASE WHEN p_updates ? 'target_roles'
                                        THEN ARRAY(SELECT jsonb_array_elements_text(p_updates->'target_roles'))
                                        ELSE f.target_roles END,
             target_environments = CASE WHEN p_updates ? 'target_environments'
                                        THEN ARRAY(SELECT jsonb_array_elements_text(p_updates->'target_environments'))
                                        ELSE f.target_environments END,
             updated_by          = p_actor_id,
             updated_at          = now()
       WHERE f.flag_name = p_flag_name
      RETURNING f.* INTO v_after;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'FLAG_NOT_FOUND: no feature_flags row for "%" (race on update)', p_flag_name
          USING ERRCODE = 'P0002';
      END IF;

      INSERT INTO public.admin_audit_log (admin_id, action, entity_type, entity_id, details)
      VALUES (
        p_actor_id,
        'feature_flag.protected_flip_rpc',
        'feature_flags',
        v_after.id::text,
        jsonb_build_object(
          'flag_name', p_flag_name,
          'tier', v_tier,
          'updates', p_updates,
          'before_state', v_before,
          'after_state', to_jsonb(v_after)
        )
      );

      RETURN to_jsonb(v_after);
    END;
    $fn_body$;
  $create_fn$;

  -- Lock down execution: only the service-role-keyed admin console calls
  -- this RPC (route.ts uses the service role key for every PostgREST/RPC
  -- call in this file). No authenticated/anon caller has any business
  -- invoking a flag-flip RPC directly.
  EXECUTE 'REVOKE EXECUTE ON FUNCTION public.admin_flip_feature_flag(text, jsonb, text, uuid) FROM PUBLIC';
  EXECUTE 'REVOKE EXECUTE ON FUNCTION public.admin_flip_feature_flag(text, jsonb, text, uuid) FROM anon';
  EXECUTE 'REVOKE EXECUTE ON FUNCTION public.admin_flip_feature_flag(text, jsonb, text, uuid) FROM authenticated';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.admin_flip_feature_flag(text, jsonb, text, uuid) TO service_role';

  EXECUTE $comment$
    COMMENT ON FUNCTION public.admin_flip_feature_flag(text, jsonb, text, uuid) IS
      'Sanctioned write path for a protected feature-flag flip: validates p_confirm = p_flag_name, arms app.protected_flag_ack for the current transaction (disarming trg_protect_feature_flags), updates feature_flags, and writes an admin_audit_log row atomically. SECURITY DEFINER -- see migration 20260722090200 header for justification. service_role EXECUTE only. Added 2026-07-22 (Phase 0 flag-governance hardening).'
  $comment$;

  -- Column-level defense in depth (see migration header): authenticated can
  -- no longer UPDATE these two columns directly even if a future RLS change
  -- were to add an authenticated write policy on feature_flags.
  EXECUTE 'REVOKE UPDATE (is_enabled, rollout_percentage) ON public.feature_flags FROM authenticated';

  RAISE NOTICE 'admin_flip_feature_flag RPC created/replaced with grants (service_role only); authenticated UPDATE on is_enabled/rollout_percentage revoked.';
END $admin_flip_rpc$;

COMMIT;

-- ─── Verify (manual check after applying) ────────────────────────────────────
-- SELECT admin_flip_feature_flag('ff_demo_v1', '{"description":"copy tweak"}'::jsonb, 'ff_demo_v1', '00000000-0000-0000-0000-000000000001'::uuid);
--   -- expect: success (unprotected flag, description-only update).
-- SELECT admin_flip_feature_flag('ff_school_pulse_v1', '{"enabled":true}'::jsonb, 'wrong-name', '00000000-0000-0000-0000-000000000001'::uuid);
--   -- expect: ERROR FLAG_CONFIRM_MISMATCH.
-- SELECT admin_flip_feature_flag('ff_school_pulse_v1', '{"enabled":true}'::jsonb, 'ff_school_pulse_v1', '00000000-0000-0000-0000-000000000001'::uuid);
--   -- expect: success; SELECT * FROM admin_audit_log WHERE action = 'feature_flag.protected_flip_rpc' ORDER BY created_at DESC LIMIT 1; shows the row.
-- has_column_privilege('authenticated', 'feature_flags', 'is_enabled', 'UPDATE')  -- expect: false
