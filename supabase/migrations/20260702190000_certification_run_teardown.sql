-- ============================================================================
-- Migration: 20260702190000_certification_run_teardown.sql
-- Purpose: Add purge_certification_run(p_run_id_short text) — a single-call,
--          RUN-scoped teardown that fully cleans ONE certification run,
--          covering BOTH the school-scoped tenant AND the standalone
--          (non-school-scoped) accounts the seed script creates. Closes the
--          Stage-2 coverage gap in Environment Readiness criterion 5 ("test
--          data can be cleaned up") that 20260702180000's
--          purge_certification_tenant left open.
--
-- ─── The gap this closes (found during Stage 2, live staging seed run) ───────
-- scripts/seed-certification-accounts.ts creates SEVEN accounts per run:
--   * School-scoped: student (students), teacher (teachers), school_admin
--     (school_admins) — all carry the run's school_id.
--   * Standalone (NO school_id): parent (guardians), and super_admin /
--     content_author / support_staff (all admin_users rows, distinguished only
--     by admin_level).
--   * Plus a demo_accounts registry row per account whose role is CHECK-legal.
-- purge_certification_tenant(p_school_id) (migration 20260702180000) cleans
-- ONLY the school-scoped accounts + the school. The seed script's own printed
-- teardown hint confirms this: it prints three manual DELETE statements for the
-- standalone accounts because the tenant function does not cover them. So a
-- full run teardown needed the RPC PLUS three ad-hoc DELETEs — not the single
-- accountable operation the Environment Readiness assessment assumed. This
-- migration makes the full-run teardown one call.
--
-- ─── Why a NEW function (Option A), not extending purge_certification_tenant ──
-- A "tenant" purge deleting non-tenant standalone accounts (a parent guardian,
-- platform-wide admin_users rows) is semantically wrong and would contradict
-- the tenant function's own documented, narrow school-scope. The tenant
-- function deliberately never touches admin_users — admin_users is the FK
-- TARGET for admin_impersonation_sessions.admin_id, not a demo-tenant row, and
-- the REG-229 integration test asserts exactly that (it cleans its own
-- admin_users fixture up manually, precisely because the tenant purge must not
-- touch it). Folding standalone-account deletion into purge_certification_tenant
-- would break that invariant and REG-229 with it. So this migration adds a
-- SEPARATE run-scoped entry point that DELEGATES to purge_certification_tenant
-- for the school-scoped part (one shared code path, no duplicated tenant FK
-- logic) and adds only the standalone-account cleanup on top. purge_
-- certification_tenant is unchanged.
--
-- ─── What purge_certification_run does, in FK-safe order ─────────────────────
--   1. Validates p_run_id_short is exactly 8 lowercase hex chars (the seed's
--      runIdShortOf output: first 8 hex of the hyphen-stripped run UUID). This
--      is defense-in-depth: it stops a LIKE-wildcard injection ('%'/'_' would
--      otherwise widen every marker match) and accidental cross-run
--      over-matching. It does NOT replace the domain + is_demo guards below.
--   2. Delegates the school-scoped tenant(s) to purge_certification_tenant:
--      finds the run's school by its EXACT seed name pattern
--      '[CERTIFICATION] cert-<run_id_short>-school-%' (buildSchoolShape +
--      SCHOOL_NAME_PREFIX) AND is_demo = true, and passes each id through the
--      existing function (which re-checks is_demo inside its own body).
--   3. Cleans the standalone accounts, scoped HARD to the
--      @certification.alfanumrik.invalid email domain AND is_demo = true (see
--      the guard section below), in FK-safe order:
--        (a) admin_users first has its 5 blocking (NO ACTION) inbound FKs
--            cleared — see the admin_users(id) inbound-FK inventory below —
--            then the admin_users rows themselves are deleted.
--        (b) guardians: guardian_student_links is cleared explicitly first
--            (defensive-explicit — it is actually ON DELETE CASCADE, as are all
--            other guardians(id) children, so no guardians child blocks; the
--            explicit delete mirrors purge_demo_account_by_id's parent branch
--            for auditability), then the guardians rows are deleted.
--        (c) the demo_accounts registry rows for the run are swept by the same
--            email marker.
--   4. Returns a JSONB summary (mirrors purge_certification_tenant's shape) and
--      SURFACES the deleted standalone accounts' auth_user_id values in
--      `standalone_auth_user_ids` so the caller (operator tooling / an Edge
--      Function holding the GoTrue admin key) can delete the matching
--      auth.users rows — see the auth.users note below.
--
-- ─── HARD certification-domain + is_demo guard (cannot delete a real account) ─
-- Every standalone-account delete is scoped by BOTH:
--   * email LIKE 'cert-<run_id_short>-%@certification.alfanumrik.invalid'
--     (v_email_like) — the certification email domain marker; AND
--   * is_demo = true (guardians and admin_users both have an is_demo column —
--     guardians via migration 20260603150000, admin_users via 20260528000001;
--     verified against the seed script's own column-shape audit).
-- A row that is not BOTH certification-domain AND is_demo = true is therefore
-- structurally unreachable by this function — the same defensive posture as
-- purge_certification_tenant's in-body is_demo guard. The admin_users child
-- tables (which have no is_demo column of their own) are cleared only via
-- `... IN (SELECT id FROM admin_users WHERE <domain> AND is_demo = true)`, so
-- they inherit the same guard transitively and can never reach a real admin's
-- audit/impersonation/announcement/support/pause rows.
-- demo_accounts is the demo registry itself and has no is_demo column (every
-- row is by definition a demo account); it is scoped by the email-domain marker
-- alone — identical to the seed script's own teardown hint and to
-- purge_certification_tenant's school-scoped demo_accounts cleanup.
--
-- ─── admin_users(id) inbound-FK inventory (re-derived 2026-07-02) ────────────
-- Every inbound FK to admin_users(id) across the full chain (baseline
-- 00000000000000_baseline_from_prod.sql ALTER TABLE ADD CONSTRAINT block +
-- every additive migration). ALL FIVE have NO `ON DELETE` clause (Postgres
-- default NO ACTION), so ALL FIVE block a parent admin_users delete while any
-- referencing row exists — nullability does not change this:
--   1. admin_announcements.created_by       → admin_users(id)  (baseline)
--   2. admin_audit_log.admin_id             → admin_users(id)  (baseline)
--   3. admin_impersonation_sessions.admin_id→ admin_users(id)  (baseline, NN)
--   4. admin_support_notes.admin_id         → admin_users(id)  (baseline)
--   5. schools.paused_by_super_admin_id     → admin_users(id)
--        (migration 20260527000011_school_pause_audit.sql — despite the
--         filename, this is a COLUMN ON `schools`, not a `school_pause_audit`
--         table; nullable, NO ON DELETE).
-- Items 1-4 are TABLES whose referencing rows are DELETEd. Item 5 is a nullable
-- audit-pointer COLUMN on `schools`: it is NULLed (UPDATE ... SET NULL), NOT
-- deleted — the row it sits on may be a real school (e.g. a certification
-- super_admin paused a live school during Stage-2 testing), and deleting a
-- school to clear an audit pointer would be wrong. The pointer can only ever
-- reference the demo admin_users rows about to be deleted (it is scoped through
-- the same domain + is_demo subquery), and a NO ACTION FK means the pointer
-- cannot survive that admin's deletion regardless, so NULLing it is both the
-- only FK-safe option and non-destructive to the school itself. All five are
-- cleared/nulled (scoped through the domain + is_demo guard) BEFORE the
-- admin_users rows are deleted. Update this inventory in the same PR whenever a
-- new table/column adds an admin_users(id) FK.
--
-- guardians(id) inbound FKs (re-derived same pass): guardian_student_links,
-- teacher_parent_threads, dpdp_parental_consent, parent_cheers — ALL
-- ON DELETE CASCADE, so none blocks a guardians delete. No pre-clearing is
-- structurally required; the explicit guardian_student_links delete is kept
-- only for parity/auditability with purge_demo_account_by_id's parent branch.
--
-- ─── auth.users cleanup (mirrors the existing design, does NOT orphan) ───────
-- Neither purge_certification_tenant nor purge_demo_account_by_id deletes
-- auth.users rows in SQL. The established codebase pattern (see step 5 of
-- purge_demo_account_by_id: "Auth user row deletion is left to the Edge
-- Function (admin API key) ... Surface the auth_user_id so the function knows
-- what to delete") is to SURFACE the auth_user_id and let a caller holding the
-- GoTrue admin key delete the identity. This function mirrors that: it returns
-- the deleted standalone accounts' auth_user_id values in
-- `standalone_auth_user_ids` so those auth.users rows are not orphaned. It does
-- NOT itself DELETE FROM auth.users — that is deliberately left to the same
-- admin-API path every other purge function in this codebase uses. (The
-- school-scoped accounts' auth_user_ids follow the tenant function's existing
-- posture unchanged — that pre-existing consideration is out of scope here.)
--
-- ─── SECURITY DEFINER justification ─────────────────────────────────────────
-- Same justification as purge_certification_tenant / purge_demo_account_by_id:
-- the function must bypass RLS to delete rows across guardians, admin_users and
-- their child tables regardless of the caller's role scoping. It SET
-- search_path = public explicitly (mandatory hardening), REVOKEs EXECUTE from
-- public/anon/authenticated, and GRANTs only to service_role — so it is only
-- reachable from trusted server-side operator tooling, never a client session.
-- The domain + is_demo guard is a second, independent layer beyond the GRANT.
--
-- ─── Idempotency & safety ────────────────────────────────────────────────────
--   * CREATE OR REPLACE FUNCTION; REVOKE/GRANT are naturally idempotent. Safe
--     to re-run on any environment.
--   * A second call after a completed run teardown matches zero rows on every
--     DELETE and returns success with already_absent = true — no error.
--   * No DROP TABLE/COLUMN/CONSTRAINT. No change to any FK's ON DELETE
--     behavior. No RLS change (no new table). No change to any real (non-demo)
--     account's delete semantics.
--
-- Owner: architect. Added: 2026-07-02 (Stage-2 certification remediation,
-- follow-on to 20260702180000_certification_tenant_teardown.sql).
-- Companion migration: 20260702180000 (purge_certification_tenant). Follow-up
-- for testing: extend src/__tests__/migrations/certification-tenant-teardown-e2e.test.ts
-- (REG-229) to cover this run-scoped function + the standalone-account cleanup.
-- ============================================================================

CREATE OR REPLACE FUNCTION purge_certification_run(p_run_id_short TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email_like        TEXT;
  v_school_name_like  TEXT;
  v_school            RECORD;
  v_schools_purged    JSONB  := '[]'::JSONB;
  v_schools_count     INT    := 0;
  v_guardian_auth_ids UUID[] := ARRAY[]::UUID[];
  v_admin_auth_ids    UUID[] := ARRAY[]::UUID[];
  v_guardians_purged  INT    := 0;
  v_admins_purged     INT    := 0;
  v_demo_accts_purged INT    := 0;
BEGIN
  -- Strict format guard (defense-in-depth; see migration header). Blocks
  -- LIKE-wildcard injection and cross-run over-matching. NOT a replacement for
  -- the domain + is_demo guards baked into every DELETE below.
  IF p_run_id_short IS NULL OR p_run_id_short !~ '^[0-9a-f]{8}$' THEN
    RAISE EXCEPTION
      'purge_certification_run: p_run_id_short (%) must be exactly 8 lowercase '
      'hex characters (the seed script''s run_id_short).', p_run_id_short
      USING ERRCODE = '22023'; -- invalid_parameter_value
  END IF;

  -- Markers — byte-for-byte the seed script's conventions
  -- (CERTIFICATION_EMAIL_DOMAIN, SCHOOL_NAME_PREFIX, buildAccountShape,
  -- buildSchoolShape). Note: Postgres LIKE treats only '%' and '_' as
  -- wildcards; the literal '[CERTIFICATION] ' prefix and the hyphens are all
  -- literal, and p_run_id_short is validated hex (no '_'), so these patterns
  -- match exactly the run's rows and nothing else.
  v_email_like       := 'cert-' || p_run_id_short || '-%@certification.alfanumrik.invalid';
  v_school_name_like := '[CERTIFICATION] cert-' || p_run_id_short || '-school-%';

  -- ── (1) School-scoped tenant(s): delegate to the existing entry point ──
  --     Scoped to the certification school-name prefix AND is_demo = true;
  --     purge_certification_tenant re-checks is_demo inside its own body, so a
  --     mislabeled non-demo school here would hard-fail (42501), not delete.
  FOR v_school IN
    SELECT id
    FROM schools
    WHERE name LIKE v_school_name_like
      AND is_demo = true
  LOOP
    PERFORM purge_certification_tenant(v_school.id);
    v_schools_count  := v_schools_count + 1;
    v_schools_purged := v_schools_purged || to_jsonb(v_school.id);
  END LOOP;

  -- ── (2) Standalone accounts the tenant purge does NOT cover ──
  --
  -- (2a) admin_users (super_admin / content_author / support_staff). Clear all
  --      5 blocking (NO ACTION) inbound FKs FIRST (see the admin_users(id)
  --      inbound-FK inventory in the migration header), each scoped through the
  --      same domain + is_demo guard so a real admin's rows are unreachable.
  DELETE FROM admin_announcements
    WHERE created_by IN (
      SELECT id FROM admin_users WHERE email LIKE v_email_like AND is_demo = true
    );
  DELETE FROM admin_audit_log
    WHERE admin_id IN (
      SELECT id FROM admin_users WHERE email LIKE v_email_like AND is_demo = true
    );
  DELETE FROM admin_impersonation_sessions
    WHERE admin_id IN (
      SELECT id FROM admin_users WHERE email LIKE v_email_like AND is_demo = true
    );
  DELETE FROM admin_support_notes
    WHERE admin_id IN (
      SELECT id FROM admin_users WHERE email LIKE v_email_like AND is_demo = true
    );
  -- Item 5 is a nullable audit-pointer COLUMN on `schools` (NOT a table — the
  -- 20260527000011 filename is misleading). NULL it rather than deleting the
  -- school row it sits on: that row may be a real school this run's super_admin
  -- paused during testing. The pointer can only reference the demo admin_users
  -- rows about to be deleted (same domain + is_demo scope), and a NO ACTION FK
  -- would block the admin delete otherwise. See the migration header.
  UPDATE schools
    SET paused_by_super_admin_id = NULL
    WHERE paused_by_super_admin_id IN (
      SELECT id FROM admin_users WHERE email LIKE v_email_like AND is_demo = true
    );

  --      Now the admin_users rows themselves — capture auth_user_ids so the
  --      caller can delete the matching auth.users identities (see header).
  WITH del_admins AS (
    DELETE FROM admin_users
      WHERE email LIKE v_email_like AND is_demo = true
      RETURNING auth_user_id
  )
  SELECT
    COALESCE(array_agg(auth_user_id) FILTER (WHERE auth_user_id IS NOT NULL), ARRAY[]::UUID[]),
    count(*)::INT
  INTO v_admin_auth_ids, v_admins_purged
  FROM del_admins;

  -- (2b) guardians (parent). guardian_student_links is ON DELETE CASCADE (as
  --      are all guardians(id) children — see header), so the explicit delete
  --      here is defensive-explicit for auditability, not structurally
  --      required. Then delete the guardians rows and capture their auth ids.
  DELETE FROM guardian_student_links
    WHERE guardian_id IN (
      SELECT id FROM guardians WHERE email LIKE v_email_like AND is_demo = true
    );

  WITH del_guardians AS (
    DELETE FROM guardians
      WHERE email LIKE v_email_like AND is_demo = true
      RETURNING auth_user_id
  )
  SELECT
    COALESCE(array_agg(auth_user_id) FILTER (WHERE auth_user_id IS NOT NULL), ARRAY[]::UUID[]),
    count(*)::INT
  INTO v_guardian_auth_ids, v_guardians_purged
  FROM del_guardians;

  -- (2c) demo_accounts registry sweep for the whole run (any role, e.g. the
  --      standalone parent + super_admin registry rows the tenant purge never
  --      saw). School-scoped registry rows for this run were already removed by
  --      the delegated purge_certification_tenant call(s) above, so this
  --      catches only what remains. Scoped by the email-domain marker alone —
  --      demo_accounts is the demo registry itself and has no is_demo column.
  WITH del_demo AS (
    DELETE FROM demo_accounts
      WHERE email LIKE v_email_like
      RETURNING id
  )
  SELECT count(*)::INT INTO v_demo_accts_purged FROM del_demo;

  RETURN jsonb_build_object(
    'success', true,
    'run_id_short', p_run_id_short,
    'already_absent', (
      v_schools_count = 0
      AND v_guardians_purged = 0
      AND v_admins_purged = 0
      AND v_demo_accts_purged = 0
    ),
    'schools_purged', v_schools_purged,
    'schools_purged_count', v_schools_count,
    'guardians_purged', v_guardians_purged,
    'admin_users_purged', v_admins_purged,
    'demo_accounts_purged', v_demo_accts_purged,
    -- Surface for the caller's admin-API auth.users cleanup (see header).
    'standalone_auth_user_ids', to_jsonb(v_guardian_auth_ids || v_admin_auth_ids)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION purge_certification_run(TEXT) FROM public, anon, authenticated;
GRANT  EXECUTE ON FUNCTION purge_certification_run(TEXT) TO service_role;

COMMENT ON FUNCTION purge_certification_run(TEXT) IS
  'Single-call, RUN-scoped teardown of one certification run (run_id_short = '
  'first 8 hex of the seed run UUID). Delegates the school-scoped tenant(s) to '
  'purge_certification_tenant, then cleans the standalone accounts the tenant '
  'purge does not cover: guardians (parent) + admin_users (super_admin / '
  'content_author / support_staff) with their 5 blocking inbound FKs (4 child '
  'tables deleted + schools.paused_by_super_admin_id nulled) + the '
  'demo_accounts registry rows. Hard-scoped to the '
  '@certification.alfanumrik.invalid email domain AND is_demo = true (plus a '
  'strict 8-hex-char run_id_short format guard) so it can never touch a real '
  'account. Surfaces deleted standalone auth_user_ids for the caller''s '
  'auth.users cleanup; does not itself delete auth.users. service_role only. '
  'See migration 20260702190000_certification_run_teardown.sql for the full '
  'design rationale and FK inventories.';
