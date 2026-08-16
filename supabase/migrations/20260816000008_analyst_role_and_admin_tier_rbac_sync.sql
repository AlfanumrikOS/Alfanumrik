-- Migration: 20260816000008_analyst_role_and_admin_tier_rbac_sync.sql
-- Purpose: Phase 1 of the CEO-authorized super-admin Mission Control overhaul
--          (auth foundation). Two independent, additive changes:
--            1. Add the `analyst` RBAC role (CEO-approved, tightly-scoped,
--               READ-ONLY) and grant it a minimal reporting/audit permission
--               set.
--            2. Replace the one-time, super_admin-only backfill
--               (20260803140000_reconcile_admin_users_to_rbac_super_admin.sql)
--               with an ONGOING trigger that keeps `user_roles` in sync with
--               `admin_users.admin_level` for ALL SIX tiers (support, analyst,
--               content_manager, finance, admin, super_admin), going forward —
--               plus a one-time backfill statement so existing admin_users
--               rows (which predate the trigger and may never be UPDATEd
--               again) are covered too.
--
-- ─── Why this exists ──────────────────────────────────────────────────────
--   RCA finding: the platform has TWO unsynced privilege models —
--     (a) admin_users.admin_level (6-tier enum), gating ~100
--         /api/super-admin/* routes via authorizeAdmin().
--     (b) RBAC roles/user_roles/role_permissions/permissions, gating
--         /api/internal/admin/* and /api/v1/admin/* via authorizeRequest().
--   The only bridge is the super_admin-only, ONE-TIME backfill in
--   20260803140000. It has no trigger, covers only the super_admin tier, and
--   does nothing for admins promoted/demoted after 2026-08-03 or at any
--   other tier. Architectural mandate (CEO-authorized): RBAC becomes the
--   single authorization source of truth; admin_level must not remain an
--   independent security authority. This migration is the schema half of
--   that mandate — packages/lib/src/admin-auth.ts's new authorizeOperator()
--   (same PR) is the application half, resolving authorization from
--   user_roles/roles (populated here), never from admin_users.admin_level
--   directly.
--
-- ─── Scope / safety contract (HARD CONSTRAINTS) ──────────────────────────
--   - ADDITIVE ONLY. No DROP / DELETE / TRUNCATE anywhere below. The new
--     `analyst` role and its grants are net-new; the trigger only ever
--     writes user_roles rows scoped to (auth_user_id, one of the 6 reserved
--     tier role_ids) — it NEVER touches any other role a user may hold
--     (teacher, tutor, institution_admin, reviewer, or even a same-named
--     tier role a user holds independently of their admin_users row — see
--     the KNOWN LIMITATION note on the trigger function below).
--   - IDEMPOTENT / SAFE TO REPLAY.
--       * roles              -> ON CONFLICT (name) DO NOTHING
--       * role_permissions   -> ON CONFLICT (role_id, permission_id) DO NOTHING
--       * trigger function   -> CREATE OR REPLACE FUNCTION
--       * trigger             -> DROP TRIGGER IF EXISTS + CREATE TRIGGER
--       * backfill INSERT    -> NOT EXISTS guard + ON CONFLICT ON CONSTRAINT
--                                user_roles_auth_user_id_role_id_key DO UPDATE
--                                that only reactivates a STALE (inactive or
--                                expired) row — mirrors 20260803140000
--                                exactly, generalized to all 6 tiers.
--   - RESOLVE BY NAME, NEVER BY HARDCODED UUID (matches 20260612123200 and
--     20260803140000 convention).
--   - NO NEW TABLE. `roles` / `permissions` / `role_permissions` /
--     `user_roles` keep their existing baseline RLS posture; all writes here
--     go through the service-role migration runner (roles/permissions/
--     role_permissions inserts) or a SECURITY DEFINER trigger function
--     (user_roles writes — justified below).
--
-- ─── CEO approval posture ─────────────────────────────────────────────────
--   `analyst` role: CEO-approved verbatim ("APPROVED: analyst RBAC role —
--   tightly scoped, READ-ONLY operational/reporting role. Do not grant it
--   any mutation permission, ever (no *.manage, no role.manage, no
--   system.config, no user.manage)"). The grant set below is exactly:
--   system.audit, analytics.global, support.view_tickets — all `view`/`audit`
--   action permissions, zero `manage`/`create`/`edit`/`delete` actions.
--   Tier-sync trigger: CEO-mandated architectural change (RBAC as sole
--   authorization authority), not a new privilege grant — it reproduces, on
--   an ongoing basis, exactly the grant relationship the ONE-TIME
--   20260803140000 migration already established for super_admin, now
--   extended to the other 5 tiers each admin_users row could already reach
--   via authorizeAdmin(). No operator gains any access via RBAC that they
--   did not already have via admin_users.admin_level.
--
-- ─── TS/DB permission-registry drift note (see also packages/lib/src/rbac.ts) ──
--   Diffing this repo's consolidated matrix migration (20260612123200) against
--   the TS `PERMISSIONS` const found 28 codes present in the DB matrix but
--   MISSING from the TS registry (content.*, finance.*,
--   institution.view_reports, school.*, super_admin.access, and the two
--   support.* codes closed by this PR's companion rbac.ts edit). This
--   migration/PR closes ONLY `support.view_tickets` / `support.manage_tickets`
--   (both already DB-granted to the `support` role only, per 20260612123200
--   lines 291-299 — no grant changed, just the TS declaration added). The
--   remaining 26 are DOCUMENTED HERE for a follow-up reconciliation pass,
--   not fixed now (out of scope per Phase 1 instructions):
--     content.create, content.edit, content.submit_review, content.view_all,
--     content.manage_questions, content.manage_media, content.review,
--     content.approve, content.reject, content.view_drafts,
--     support.view_user_activity, support.fix_relationships,
--     support.resend_invites, support.reset_passwords,
--     finance.view_revenue, finance.view_subscriptions,
--     finance.manage_refunds, finance.export_reports,
--     institution.view_reports, school.manage_branding, school.manage_billing,
--     school.manage_domain, school.export_data, school.manage_settings,
--     school.manage_modules, super_admin.access.
--   The wider 72-vs-~84 prod drift (codes outside the 20260612123200 matrix
--   entirely) is untouched by this migration.

BEGIN;

-- =============================================================================
-- 1. ROLE: analyst (CEO-approved, read-only operational/reporting tier)
-- =============================================================================
-- hierarchy_level=57 sits between support(55) and reviewer(58)/content_manager
-- (60) for display purposes ONLY. `roles.hierarchy_level` is NOT read by any
-- authorization code path in this codebase (verified: the only SQL consumer,
-- get_user_permissions(), returns it inside the `roles` JSON purely for
-- client display — grep confirms no WHERE/ORDER BY/CASE branches on it
-- anywhere in supabase/migrations/). The actual admin-tier rank comparison
-- lives in TS (ADMIN_LEVELS / hasMinimumLevel in admin-auth.ts) and is keyed
-- by role NAME, not by this column — see authorizeOperator()'s own comment
-- for why a raw hierarchy_level comparison would be unsafe here (other RBAC
-- roles' hierarchy_level values interleave with the operator-tier ladder by
-- coincidence, e.g. reviewer=58, institution_admin=70).
INSERT INTO roles (name, display_name, display_name_hi, hierarchy_level, is_system_role, description) VALUES
  ('analyst', 'Analyst', 'विश्लेषक', 57, false,
   'Read-only operational/reporting role: platform analytics + audit-log visibility. Never granted any *.manage, role.manage, system.config, or user.manage permission.')
ON CONFLICT (name) DO NOTHING;

-- =============================================================================
-- 2. ANALYST -> PERMISSION GRANTS (read-only only)
-- =============================================================================
-- Candidates considered and REJECTED (documented per Phase 1 instructions):
--   - report.view_class / institution.view_analytics / institution.view_billing:
--     these are role-scoped to teacher/institution_admin respectively — their
--     consuming routes assume ownership context (an assigned class, or a
--     specific institution_admin's school_id) that a platform-wide analyst
--     does not have. Granting the code without that ownership context would
--     either be meaningless (route still 403s on the ownership check) or, if
--     any future route naively branches on "has the permission code" without
--     re-deriving ownership, a scope-creep risk. Left out.
--   - finance.view_revenue / finance.view_subscriptions: finance is its own
--     adjacent, separately-provisioned operator tier; analyst is not a
--     finance substitute. Left out.
-- Included (both existing permission codes — no new code invented for these
-- two; only the grant is new):
--   - system.audit       ('View audit logs') — read-only.
--   - analytics.global   ('View global platform analytics') — read-only.
--   - support.view_tickets ('View support tickets and requests') — read-only;
--     mirrors real-world admin_users.admin_level='analyst' usage (operational
--     reporting benefits from ticket-volume/trend visibility) without
--     granting support.manage_tickets (no mutation).
-- Plus the same 4 baseline self-service codes every other non-wildcard
-- operational role (support/finance/content_manager/reviewer) already gets
-- in 20260612123200 — own-profile view/update, own-notification view/dismiss.
-- None of these are *.manage / role.manage / system.config / user.manage.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r CROSS JOIN permissions p
WHERE r.name = 'analyst' AND p.code IN (
  'system.audit', 'analytics.global', 'support.view_tickets',
  'profile.view_own', 'profile.update_own', 'notification.view', 'notification.dismiss'
)
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- =============================================================================
-- 3. ONGOING TIER -> RBAC ROLE SYNC TRIGGER
-- =============================================================================
-- Replaces the one-time, super_admin-only 20260803140000 backfill with an
-- ongoing sync covering ALL SIX admin_users.admin_level tiers. Approach (a)
-- from the design brief: a Postgres trigger, chosen over an application-level
-- sync because (per the RCA) direct DB edits are CURRENTLY THE ONLY way to
-- provision a new admin_users row — no route creates one — so an
-- application-level hook on a currently-nonexistent "create admin" route
-- would cover nothing. A trigger catches every path: direct DB edits,
-- PATCH /api/super-admin/users admin_level changes, and any future
-- provisioning route, uniformly.
--
-- RLS interaction check (P8) — CORRECTED 2026-08-16 (quality-review finding
-- on the Phase 1 Mission Control overhaul; verified by architect and fixed
-- in migration 20260816000009_fix_user_roles_admin_rls_write_policy.sql).
-- The paragraph below, AS ORIGINALLY WRITTEN in this migration, was WRONG
-- about one clause and is corrected here rather than left as a false
-- security rationale:
--   admin_users RLS ("service_admins" policy) IS TO service_role
--   USING(true) — that part was accurate. But user_roles RLS did NOT "only
--   ever grant SELECT-shaped access to admins/self" at the time this
--   migration was authored. The baseline policy "user_roles_admin"
--   (00000000000000_baseline_from_prod.sql) was declared with NO `FOR`
--   clause (Postgres defaults to FOR ALL: SELECT/INSERT/UPDATE/DELETE) and
--   NO `WITH CHECK` — so its USING expression governed writes too. That
--   USING predicate checks only "does auth.uid() have ANY active
--   admin_users row" (no tier filter, no reference to the row being
--   written), so it actually granted EVERY active admin_users row —
--   including the lowest tier, `support` — unrestricted RLS-level
--   INSERT/UPDATE/DELETE on the ENTIRE user_roles table via any RLS-scoped
--   (non-service-role) client. That was a genuine self-escalation vector: a
--   support-tier operator could INSERT a row granting themselves (or
--   anyone) the super_admin RBAC role directly, bypassing
--   authorizeOperator()/authorizeAdmin() and this very migration's sync
--   trigger entirely. It was a PRE-EXISTING baseline hole, not introduced
--   by this migration — but this migration's own P8 review sentence
--   incorrectly asserted it did not exist. 20260816000009 closes it by
--   narrowing "user_roles_admin" to FOR SELECT only (same name, same read
--   predicate, zero write grant for `authenticated`) — so as of that
--   migration the ORIGINAL claim ("no INSERT/UPDATE policy on user_roles
--   for `authenticated` at all") is finally true, just not for the reason
--   this paragraph originally gave.
--
-- This trigger's SECURITY DEFINER requirement is UNCHANGED by the
-- correction above — regardless of whether `authenticated` ever held a
-- broad write grant, delegating to a SECURITY DEFINER function is still the
-- correct, least-privilege way for a plain `authenticated` session's
-- admin_users mutation to reliably write user_roles (and after
-- 20260816000009 it is the ONLY way, alongside service_role). SECURITY
-- DEFINER risk is bounded: the function takes no caller-supplied dynamic
-- SQL, and every write is scoped to the exact (row's own auth_user_id, one
-- of 6 reserved tier role_ids) implied by the admin_users row that fired it
-- — mirrors the established public.sync_school_admin_role() pattern (see
-- migration 20260603140000 for the precedent).
--
-- Trigger fires on "AFTER INSERT OR UPDATE OF admin_level, is_active" — the
-- design brief's suggested event list ("AFTER INSERT OR UPDATE OF
-- admin_level") is WIDENED here to also include is_active. Rationale
-- (P8/P9 fail-closed): PATCH /api/super-admin/users can suspend an admin_users
-- row (is_active=false) WITHOUT touching admin_level. If the trigger only
-- fired on admin_level changes, a suspended admin_users row would leave a
-- STALE, still-active RBAC tier-role grant behind — a fail-OPEN gap directly
-- contradicting the "never weaken an existing route's effective access...
-- fail-closed everywhere" constraint. Widening the trigger to also fire on
-- is_active changes closes that gap.
--
-- KNOWN LIMITATION (documented per the design brief's own escape hatch:
-- "simply only touch the exact-match tier role membership and leave
-- everything else alone"): the trigger scopes every write to exactly
-- (this user, this tier's role_id) — it never touches any OTHER role. This
-- fully protects roles outside the 6-tier set (teacher, tutor,
-- institution_admin, reviewer, ...). It does NOT disambiguate a user who
-- holds e.g. the 'finance' RBAC role BOTH via this trigger (because their
-- admin_users.admin_level='finance') AND via a hypothetical independent
-- manual grant of the same 'finance' role for an unrelated reason — those
-- are structurally the SAME (auth_user_id, role_id) row in user_roles (the
-- UNIQUE constraint forbids two rows), so demoting admin_level away from
-- 'finance' will deactivate that shared row. This is an accepted, documented
-- edge case (not a tag-per-row scheme) per the design brief's explicit
-- "or simply..." alternative.
--
-- NOT handled in this pass (documented follow-up, not silently dropped):
-- DELETE on admin_users does not fire this trigger (no admin-provisioning
-- route deletes an admin_users row today, per the RCA). If that ever
-- changes, a companion AFTER DELETE trigger should be added.
CREATE OR REPLACE FUNCTION public.sync_admin_level_to_rbac_role() RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_new_role_name TEXT;
  v_old_role_name TEXT;
  v_new_role_id UUID;
  v_old_role_id UUID;
BEGIN
  -- Fixed tier -> RBAC role-name ladder (mirrors ADMIN_LEVELS in
  -- packages/lib/src/admin-auth.ts: support < analyst < content_manager <
  -- finance < admin < super_admin). Currently an identity map (every
  -- admin_level string equals its RBAC role name) — written as an explicit
  -- CASE rather than relying on that coincidence, so a future divergence
  -- between the two vocabularies fails safe (ELSE NULL => skip) instead of
  -- silently granting a wrong/nonexistent role. Any admin_level outside this
  -- set is a data-quality issue upstream (the API layer's Zod enum already
  -- restricts values) — skipped silently, never aborts the caller's
  -- transaction.
  v_new_role_name := CASE NEW.admin_level
    WHEN 'support'          THEN 'support'
    WHEN 'analyst'           THEN 'analyst'
    WHEN 'content_manager'   THEN 'content_manager'
    WHEN 'finance'           THEN 'finance'
    WHEN 'admin'             THEN 'admin'
    WHEN 'super_admin'       THEN 'super_admin'
    ELSE NULL
  END;

  IF TG_OP = 'UPDATE' THEN
    v_old_role_name := CASE OLD.admin_level
      WHEN 'support'          THEN 'support'
      WHEN 'analyst'           THEN 'analyst'
      WHEN 'content_manager'   THEN 'content_manager'
      WHEN 'finance'           THEN 'finance'
      WHEN 'admin'             THEN 'admin'
      WHEN 'super_admin'       THEN 'super_admin'
      ELSE NULL
    END;

    -- Revoke the PREVIOUS tier-derived role slot when the tier changed, or
    -- when the row was deactivated (fail-closed on suspension). Scoped to
    -- EXACTLY (OLD.auth_user_id, old tier role_id) — see KNOWN LIMITATION
    -- above for what this does and does not disambiguate.
    IF OLD.auth_user_id IS NOT NULL
       AND v_old_role_name IS NOT NULL
       AND (v_old_role_name IS DISTINCT FROM v_new_role_name OR NEW.is_active = false)
    THEN
      SELECT id INTO v_old_role_id FROM roles WHERE name = v_old_role_name AND is_active = true LIMIT 1;
      IF v_old_role_id IS NOT NULL THEN
        UPDATE user_roles
           SET is_active = false
         WHERE auth_user_id = OLD.auth_user_id
           AND role_id = v_old_role_id
           AND is_active = true;
      END IF;
    END IF;
  END IF;

  -- Nothing to grant: inactive row, unlinked admin_users row (auth_user_id
  -- IS NULL — a pre-provisioned row with no auth account yet), or an
  -- admin_level value outside the 6-tier set.
  IF NEW.auth_user_id IS NULL OR NEW.is_active = false OR v_new_role_name IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT id INTO v_new_role_id FROM roles WHERE name = v_new_role_name AND is_active = true LIMIT 1;
  -- Defensive: role not seeded yet on a partially-migrated DB (fresh DB
  -- ordering) — skip silently rather than raising and aborting the parent
  -- admin_users INSERT/UPDATE. RBAC enforcement is the API-layer boundary
  -- (authorizeOperator); this trigger is best-effort role sync.
  IF v_new_role_id IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.user_roles AS tgt (auth_user_id, role_id, is_active, assigned_by, expires_at)
  VALUES (NEW.auth_user_id, v_new_role_id, true, NULL, NULL)
  ON CONFLICT ON CONSTRAINT user_roles_auth_user_id_role_id_key DO UPDATE
    SET is_active = true,
        expires_at = NULL
    -- Reactivate a stale (inactive OR expired) row only; never churn an
    -- already-active grant.
    WHERE tgt.is_active IS NOT TRUE OR tgt.expires_at IS NOT NULL;

  RETURN NEW;
END;
$$;

-- Trigger functions are executable by PUBLIC by default; this one is never
-- meant to be called directly (only fired by the trigger machinery as the
-- table owner). Revoke immediately in the same migration rather than
-- deferring to a later hardening pass.
REVOKE EXECUTE ON FUNCTION public.sync_admin_level_to_rbac_role() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_sync_admin_level_to_rbac_role ON public.admin_users;
CREATE TRIGGER trg_sync_admin_level_to_rbac_role
  AFTER INSERT OR UPDATE OF admin_level, is_active ON public.admin_users
  FOR EACH ROW EXECUTE FUNCTION public.sync_admin_level_to_rbac_role();

-- =============================================================================
-- 4. ONE-TIME BACKFILL: extend the 20260803140000 super_admin-only backfill to
--    ALL 6 tiers, for admin_users rows that predate this trigger (a row whose
--    admin_level/is_active never changes again after this migration applies
--    would otherwise never pass through the trigger). ADDITIVE + IDEMPOTENT —
--    identical NOT EXISTS + ON CONFLICT DO UPDATE contract as 20260803140000,
--    generalized across all 6 tiers via a VALUES map instead of a single
--    hardcoded 'super_admin' filter.
-- =============================================================================
INSERT INTO public.user_roles AS tgt (auth_user_id, role_id, is_active, assigned_by, expires_at)
SELECT a.auth_user_id, r.id, true, NULL, NULL
FROM public.admin_users a
JOIN (VALUES
  ('support',         'support'),
  ('analyst',         'analyst'),
  ('content_manager', 'content_manager'),
  ('finance',         'finance'),
  ('admin',           'admin'),
  ('super_admin',     'super_admin')
) AS tier_map(admin_level, role_name) ON tier_map.admin_level = a.admin_level
JOIN public.roles r ON r.name = tier_map.role_name AND r.is_active = true
WHERE a.is_active = true
  AND a.auth_user_id IS NOT NULL
  -- Only operators who lack an ACTIVE, non-expired grant of their tier role today.
  AND NOT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.auth_user_id = a.auth_user_id
      AND ur.role_id = r.id
      AND ur.is_active = true
      AND (ur.expires_at IS NULL OR ur.expires_at > now())
  )
ON CONFLICT ON CONSTRAINT user_roles_auth_user_id_role_id_key DO UPDATE
  SET is_active = true,
      expires_at = NULL
  WHERE tgt.is_active IS NOT TRUE OR tgt.expires_at IS NOT NULL;

COMMIT;

-- ─── Verify (manual checks after applying) ───────────────────────────────
-- 1. analyst role + grants:
--   SELECT p.code FROM role_permissions rp
--     JOIN roles r ON r.id = rp.role_id JOIN permissions p ON p.id = rp.permission_id
--    WHERE r.name = 'analyst' ORDER BY p.code;
--   -- Expect exactly: analytics.global, notification.dismiss, notification.view,
--   --                 profile.update_own, profile.view_own, support.view_tickets,
--   --                 system.audit  (7 rows, none containing '.manage').
--
-- 2. Every active admin_users row now has a matching active user_roles grant
--    for its own tier (expect 0 rows):
--   SELECT a.auth_user_id, a.admin_level
--   FROM admin_users a
--   JOIN roles r ON r.name = a.admin_level
--   WHERE a.is_active = true AND a.auth_user_id IS NOT NULL
--     AND NOT EXISTS (
--       SELECT 1 FROM user_roles ur
--       WHERE ur.auth_user_id = a.auth_user_id AND ur.role_id = r.id
--         AND ur.is_active = true AND (ur.expires_at IS NULL OR ur.expires_at > now())
--     );
--
-- 3. Trigger fires going forward:
--   UPDATE admin_users SET admin_level = 'finance' WHERE id = '<test-row>';
--   SELECT r.name, ur.is_active FROM user_roles ur JOIN roles r ON r.id = ur.role_id
--    WHERE ur.auth_user_id = (SELECT auth_user_id FROM admin_users WHERE id = '<test-row>');
--   -- Expect: finance/true, and the PREVIOUS tier's row (if any) now is_active=false.
