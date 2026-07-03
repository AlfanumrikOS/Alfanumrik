-- ============================================================================
-- Migration: 20260702180000_certification_tenant_teardown.sql
-- Purpose: Certification-on-staging Environment Readiness Assessment, 2026-07-02
--          (docs/audit/2026-07-02-certification/evidence/wave-2-environment-readiness/
--          01-consolidated-verdict.md, criterion 5 "Test data can be cleaned up").
--
-- Fixes a confirmed gap: there is no single-operation way to delete a
-- certification/demo school tenant and everything under it.
--
-- ─── Root cause (read, do not "fix" by adding a blanket cascade) ────────────
-- `students.school_id` and `teachers.school_id` reference `schools(id)` with
-- NO `ON DELETE CASCADE` (confirmed against
-- 00000000000000_baseline_from_prod.sql:19665 and :19733 — both are plain
-- `REFERENCES public.schools(id)`, i.e. Postgres default `NO ACTION`).
-- Hard-deleting a `schools` row that still has any linked `students`/
-- `teachers` row fails with a Postgres 23503 foreign-key violation. A code
-- comment in src/app/api/super-admin/institutions/route.ts incorrectly
-- claimed a full cascade exists — fixed in the same commit as this migration
-- (comment-only change, no file this migration owns).
--
-- ─── Why this migration does NOT add ON DELETE CASCADE to those two FKs ─────
-- `schools` is a real-tenant table. A blanket cascade on
-- students_school_id_fkey / teachers_school_id_fkey would apply to every
-- school in production, not just certification tenants. If a real school row
-- is ever deleted — by mistake, by a bug in unrelated code, by a compromised
-- credential — a blanket cascade would silently and irrecoverably destroy
-- every student and teacher record under it with no FK-level safety net. The
-- current "no cascade, delete fails loudly" behavior is a safety property
-- protecting real student/teacher data, not a bug, even though it was
-- mislabeled by the comment above. This migration preserves that property
-- for every school and instead builds a purpose-built, explicitly-guarded
-- teardown path scoped ONLY to rows already flagged `is_demo = true`.
-- A future engineer should not "simplify" this by adding a cascade to the
-- two FKs above — that would remove the safety net this migration is
-- designed to preserve.
--
-- ─── What this migration does ────────────────────────────────────────────────
--   1. Extends `purge_demo_account_by_id()` (20260528000004_demo_account_
--      purge_cron.sql) so its `role = 'school_admin'` branch also deletes
--      `teachers` under the school before deleting the `schools` row itself.
--      This closes the exact gap flagged by both the environment-readiness
--      evidence file (§3) and docs/runbooks/certification-traffic-
--      traceability.md ("Gaps to flag to architect", #2). Extending in place
--      (CREATE OR REPLACE, identical signature) rather than writing a sibling
--      function: grepping the codebase for `purge_demo_account_by_id` finds
--      zero live application call sites (its own designed trigger — the
--      `demo-account-purger` Edge Function — was never built; the migration's
--      own pg_cron schedule is commented out). With no live caller depending
--      on today's exact behavior, extending in place is the less invasive
--      change — no second, near-duplicate function to keep in sync.
--   2. Adds `purge_certification_tenant(p_school_id uuid)` — a new,
--      narrowly-scoped tenant-level teardown function. It:
--        (a) hard-fails (RAISE EXCEPTION) if the target `schools` row exists
--            and `is_demo` is not `true` — it can NEVER be pointed at a real
--            school, even by a caller with service-role/elevated privilege,
--            because the guard is inside the function body, not just at the
--            call site;
--        (b) is a no-op success (not an error) if the `schools` row does not
--            exist at all, so a second call after a completed teardown (or a
--            call against an id that never existed) succeeds idempotently;
--        (c) purges every `demo_accounts`-registered student/teacher under
--            the tenant via the existing per-account primitive (students
--            before teachers), then defensively direct-deletes any remaining
--            `is_demo = true` student/teacher rows under the school that
--            were never registered (the codebase has three inconsistent
--            demo-marking conventions today — see
--            docs/runbooks/certification-traffic-traceability.md — so a
--            registry row is not guaranteed for every demo account). Before
--            each students-row delete (registered, via
--            `purge_demo_account_by_id`, and the defensive direct sweep),
--            the 4 per-student RESTRICT/no-cascade child tables from the
--            corrected FK inventory below (items 1-4) are cleared first;
--        (d) clears the school-scoped / B2B-revenue child tables that
--            reference `schools(id)` (or chain through `school_invoices(id)`)
--            without `ON DELETE CASCADE` and are NOT already emptied
--            transitively by a student/teacher cascade — 6 tables total:
--            `payment_reconciliation_queue`, `school_alert_rules`,
--            `school_audit_log`, `school_invoices`, `school_seat_usage`,
--            `school_contracts` (see the corrected FK inventory below, items
--            5-7). `quiz_sessions` and `student_learning_profiles` also
--            reference `schools(id)` without cascade, but both already have
--            `ON DELETE CASCADE` on their `student_id` FK, so they are
--            already empty once step (c) removes every demo student — no
--            separate handling needed;
--        (e) deletes the `demo_accounts` registry rows for the tenant
--            (the column `demo_accounts.school_id` carries no FK constraint,
--            so nothing cleans this up automatically);
--        (f) deletes the `schools` row itself last, once every non-cascading
--            child is gone. Everything else under `schools` already has
--            `ON DELETE CASCADE` (`classes`, `school_admins`,
--            `school_announcements`, `school_api_keys`, `school_exams`,
--            `school_invite_codes`, `school_questions`,
--            `school_subscriptions`, plus every white-label/tenant/security-
--            layer table added after the baseline — see the corrected FK
--            inventory below) and is removed automatically by this one
--            statement.
--
-- ─── Corrected FK inventory (re-derived 2026-07-02, quality-review follow-up) ─
-- A quality review of the first version of this migration found its inventory
-- of non-cascading child tables was stale — inherited unchecked from an
-- already-stale ops FK audit — and missed 4 genuinely-blocking tables that
-- exist in this repo today. This section re-derives the COMPLETE inventory
-- directly from the schema (every `REFERENCES students/teachers/schools(id)`
-- across the full migration chain — `00000000000000_baseline_from_prod.sql`'s
-- `ALTER TABLE ... ADD CONSTRAINT` block for the pre-baseline-consolidation
-- schema, plus every migration filed after it), not by re-trusting the prior
-- narrative list a second time. It is the authoritative reference for both
-- functions below; update it in the same migration/PR whenever a new table
-- adds a `students`/`teachers`/`schools` FK.
--
-- BLOCKING (RESTRICT or no `ON DELETE` clause — Postgres default `NO ACTION`,
-- same blocking effect) — these 7 items are the ones this migration clears
-- explicitly:
--   1. `foxy_chat_messages.student_id` → `students(id)` ON DELETE RESTRICT,
--      NOT NULL. Cleared in `purge_demo_account_by_id` (student + school_admin
--      branches) and in `purge_certification_tenant`'s defensive sweep.
--   2. `foxy_sessions.student_id` → `students(id)` ON DELETE RESTRICT,
--      NOT NULL. Same clearing sites as #1. (`foxy_chat_messages.session_id`
--      → `foxy_sessions(id)` is itself `ON DELETE CASCADE`, so clearing
--      `foxy_chat_messages` first is defensive-explicit, not structurally
--      required — but kept explicit for auditability, matching this
--      migration's existing style, e.g. the `demo_seed_data` comment below.)
--   3. `ai_workflow_traces.student_id` → `students(id)`, no `ON DELETE`
--      clause, nullable column. Nullability does not change the blocking
--      behavior — `NO ACTION` still fails the parent delete while any row
--      references it, whether or not the column is nullable. Same clearing
--      sites as #1.
--   4. `admin_impersonation_sessions.student_id` → `students(id)`, no
--      `ON DELETE` clause, NOT NULL. Same clearing sites as #1.
--   5. `payment_reconciliation_queue.school_id` → `schools(id)` ON DELETE
--      RESTRICT, NOT NULL. Tenant-level (B2B offline-payment queue, not
--      per-account) — cleared only in `purge_certification_tenant`, not in
--      `purge_demo_account_by_id`.
--   6. `payment_reconciliation_queue.invoice_id` → `school_invoices(id)` ON
--      DELETE RESTRICT, NOT NULL. Chained blocker: must be cleared (item 5's
--      delete covers this, same table) BEFORE the existing `school_invoices`
--      delete, or that delete 23503s.
--   7. `school_contracts.school_id` → `schools(id)` ON DELETE RESTRICT, NOT
--      NULL. Tenant-level (B2B contract records) — cleared only in
--      `purge_certification_tenant`. No downstream ordering constraint: its
--      only inbound reference (`institution_entitlements.contract_id`) and
--      its self-reference (`previous_contract_id`) are both `ON DELETE SET
--      NULL`, so a single bulk delete of every contract row for the school is
--      safe regardless of when it runs relative to the other steps.
--
-- CHECKED AND CONFIRMED SAFE — no action needed (recorded here so a future
-- reviewer does not have to re-derive this a third time):
--   * Every other `students(id)` FK found in the full migration-chain search
--     (60+ tables — `adaptive_interactions`, `quiz_responses`, `xp_transactions`,
--     `chat_sessions`, `grounded_ai_traces` (ON DELETE SET NULL), and every
--     `student_*`/`teacher_student_*` table, etc.) is `ON DELETE CASCADE` or
--     `ON DELETE SET NULL`. No blocking behavior.
--   * Every `teachers(id)` FK found (assignments, at_risk_alerts, class_teachers,
--     classroom_polls, hpc_records, teacher_analytics_cache,
--     teacher_student_links, teacher_student_notes, teacher_parent_threads,
--     teacher_remediation_assignments) is `ON DELETE CASCADE` or
--     `ON DELETE SET NULL`. No blocking `teachers(id)` reference exists
--     anywhere in the schema today.
--   * Every other `schools(id)` FK found beyond items 5/7 above (`classes`,
--     `school_admins`, `school_announcements`, `school_api_keys`,
--     `school_exams`, `school_invite_codes`, `school_questions`,
--     `school_subscriptions`, `tenant_modules`, `tenant_configs`,
--     `institution_entitlements`, `school_health_daily`, `school_mrr_daily`,
--     `school_churn_signals`, `principal_ai_sessions`,
--     `synthetic_monitor_results`, `security_tenant_*` tables,
--     `oauth_consents`, legacy `school_api_keys`/`delegation_*`/RBAC
--     phase-2 tables) is `ON DELETE CASCADE`. `foxy_chat_messages.school_id`,
--     `audit_logs.school_id`, `teacher_parent_threads.school_id`,
--     `data_erasure_requests.school_id`, `agent_mesh_*.school_id`,
--     `domain_events_bus`/`state_events_bus.tenant_id`, and the
--     `platform_security_layer` tables' `school_id` columns are all
--     `ON DELETE SET NULL`. No further blocking `schools(id)` reference
--     exists anywhere in the schema today.
--   * `purge_demo_account_by_id`'s `school_admin` branch independently
--     deletes a `schools` row (pre-existing behavior, unrelated to this
--     migration's fix) but is NOT extended with the school-level B2B tables
--     (items 5-7) — it has zero live call sites (see rationale below) and
--     `purge_certification_tenant` never routes a `school_admin` role
--     through it (the tenant function's registry loop only covers
--     `role IN ('student', 'teacher')`). A future engineer must use
--     `purge_certification_tenant`, not `purge_demo_account_by_id` directly,
--     to tear down a school-admin-owned tenant that may have reconciliation-
--     queue or contract rows — calling the per-account function directly for
--     a school_admin will still 23503 on those two tables if they're
--     populated. This is a documented, narrow, intentional non-fix of
--     already-dead code, not a silent gap.
--
-- ─── SECURITY DEFINER justification ─────────────────────────────────────────
-- Both functions must bypass RLS to delete rows across `students`, `teachers`,
-- `schools`, and related tables regardless of which role's policies would
-- normally scope a caller's access — the same justification already accepted
-- for `purge_demo_account_by_id` in 20260528000004_demo_account_purge_cron.sql.
-- Both set `search_path = public` explicitly (mandatory hardening — a prior
-- pass this session flagged a missing-search_path SECURITY DEFINER gap
-- elsewhere in the codebase; this migration does not repeat it). Both REVOKE
-- EXECUTE from public/anon/authenticated and GRANT only to service_role, so
-- these are only reachable from trusted server-side code (super-admin API
-- routes / operator tooling), never directly from a client session. The
-- `is_demo` guard inside `purge_certification_tenant` is a second,
-- independent layer of protection beyond the GRANT — it cannot be turned into
-- a general-purpose school-deletion backdoor even by a service-role caller
-- that points it at the wrong id by mistake.
--
-- ─── Idempotency ─────────────────────────────────────────────────────────────
-- `CREATE OR REPLACE FUNCTION` for both; `REVOKE`/`GRANT` are naturally
-- idempotent. Safe to re-run this file on any environment.
--
-- ─── Safety properties ────────────────────────────────────────────────────────
--   * No DROP TABLE / DROP COLUMN / DROP CONSTRAINT.
--   * No change to the ON DELETE behavior of any existing foreign key.
--   * No RLS change (no new table). No new column.
--   * Both functions only ever touch rows already flagged `is_demo = true`
--     (or rows scoped underneath a `schools` row already confirmed
--     `is_demo = true`) — real tenant data is structurally unreachable.
--
-- Owner: architect. Added: 2026-07-02 (Environment Readiness remediation
-- wave, parallel to ops's Sentry-tagging + traceability-runbook fixes —
-- see docs/runbooks/2026-07-02-environment-readiness-remediation.md).
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Extend purge_demo_account_by_id(): (a) school_admin branch now also
--    purges teachers under the demo school, in the correct order (before the
--    `schools` row delete, matching the existing students handling); (b) the
--    student and school_admin branches now also clear the 4 per-student
--    RESTRICT/no-cascade child tables (foxy_chat_messages, foxy_sessions,
--    ai_workflow_traces, admin_impersonation_sessions — corrected FK
--    inventory above, items 1-4) before each students-row delete.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION purge_demo_account_by_id(p_demo_account_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account   RECORD;
  v_auth_uid  UUID;
  v_school_id UUID;
  v_steps     JSONB := '{}'::JSONB;
BEGIN
  SELECT * INTO v_account FROM demo_accounts WHERE id = p_demo_account_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_found');
  END IF;

  v_auth_uid  := v_account.auth_user_id;
  v_school_id := v_account.school_id;

  -- 1. Subscriptions
  DELETE FROM student_subscriptions
    WHERE is_demo = true
      AND student_id IN (SELECT id FROM students WHERE auth_user_id = v_auth_uid);
  IF v_school_id IS NOT NULL THEN
    DELETE FROM student_subscriptions
      WHERE is_demo = true
        AND student_id IN (SELECT id FROM students WHERE school_id = v_school_id);
    DELETE FROM school_subscriptions
      WHERE is_demo = true AND school_id = v_school_id;
  END IF;
  v_steps := jsonb_set(v_steps, '{subscriptions_deleted}', to_jsonb(true));

  -- 2. Seed data (cascades from FK but be explicit so we can audit)
  DELETE FROM demo_seed_data WHERE demo_account_id = p_demo_account_id;
  v_steps := jsonb_set(v_steps, '{seed_data_deleted}', to_jsonb(true));

  -- 3. Profile row(s)
  IF v_account.role = 'student' THEN
    -- Clear the 4 per-student RESTRICT/no-cascade child tables (corrected FK
    -- inventory in the migration header, items 1-4) before the students-row
    -- delete below, or that delete 23503s on any of them.
    DELETE FROM foxy_chat_messages
      WHERE student_id IN (SELECT id FROM students WHERE auth_user_id = v_auth_uid AND is_demo = true);
    DELETE FROM foxy_sessions
      WHERE student_id IN (SELECT id FROM students WHERE auth_user_id = v_auth_uid AND is_demo = true);
    DELETE FROM ai_workflow_traces
      WHERE student_id IN (SELECT id FROM students WHERE auth_user_id = v_auth_uid AND is_demo = true);
    DELETE FROM admin_impersonation_sessions
      WHERE student_id IN (SELECT id FROM students WHERE auth_user_id = v_auth_uid AND is_demo = true);
    DELETE FROM students WHERE auth_user_id = v_auth_uid AND is_demo = true;
  ELSIF v_account.role = 'teacher' THEN
    DELETE FROM teachers WHERE auth_user_id = v_auth_uid AND is_demo = true;
  ELSIF v_account.role = 'parent' THEN
    DELETE FROM guardian_student_links WHERE guardian_id IN (
      SELECT id FROM guardians WHERE auth_user_id = v_auth_uid AND is_demo = true
    );
    DELETE FROM guardians WHERE auth_user_id = v_auth_uid AND is_demo = true;
  ELSIF v_account.role = 'school_admin' THEN
    -- Order matters: students and teachers must both be cleared before the
    -- schools row delete below, since neither students_school_id_fkey nor
    -- teachers_school_id_fkey has ON DELETE CASCADE (see migration header).
    -- Prior to this migration, only students was handled here — any
    -- certification-seeded teacher would silently block the schools delete
    -- two statements down with a 23503 error. Fixed here.
    --
    -- Same 4 per-student RESTRICT/no-cascade child tables as the student
    -- branch above, scoped by school_id here since this branch bulk-deletes
    -- every demo student under the school in one statement.
    DELETE FROM foxy_chat_messages
      WHERE student_id IN (SELECT id FROM students WHERE school_id = v_school_id AND is_demo = true);
    DELETE FROM foxy_sessions
      WHERE student_id IN (SELECT id FROM students WHERE school_id = v_school_id AND is_demo = true);
    DELETE FROM ai_workflow_traces
      WHERE student_id IN (SELECT id FROM students WHERE school_id = v_school_id AND is_demo = true);
    DELETE FROM admin_impersonation_sessions
      WHERE student_id IN (SELECT id FROM students WHERE school_id = v_school_id AND is_demo = true);
    -- NOTE: this branch does NOT clear payment_reconciliation_queue or
    -- school_contracts (corrected FK inventory items 5/7 — tenant-level B2B
    -- tables). It has zero live call sites today and purge_certification_
    -- tenant never routes a school_admin role through it (see migration
    -- header). Use purge_certification_tenant to tear down a school-admin-
    -- owned tenant; calling this function directly for a school_admin will
    -- still 23503 on those two tables if they are populated.
    DELETE FROM students WHERE school_id = v_school_id AND is_demo = true;
    DELETE FROM teachers WHERE school_id = v_school_id AND is_demo = true;
    DELETE FROM school_admins WHERE auth_user_id = v_auth_uid AND is_demo = true;
    DELETE FROM schools WHERE id = v_school_id AND is_demo = true;
  ELSIF v_account.role = 'super_admin' THEN
    DELETE FROM admin_users WHERE auth_user_id = v_auth_uid AND is_demo = true;
  END IF;
  v_steps := jsonb_set(v_steps, '{profile_deleted}', to_jsonb(true));

  -- 4. Registry row
  DELETE FROM demo_accounts WHERE id = p_demo_account_id;
  v_steps := jsonb_set(v_steps, '{registry_deleted}', to_jsonb(true));

  -- 5. Auth user row deletion is left to the Edge Function (admin API key).
  --    Surface the auth_user_id so the function knows what to delete.
  RETURN jsonb_build_object(
    'success', true,
    'role', v_account.role,
    'auth_user_id', v_auth_uid,
    'school_id', v_school_id,
    'steps', v_steps
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION purge_demo_account_by_id(UUID) FROM public, anon, authenticated;
GRANT  EXECUTE ON FUNCTION purge_demo_account_by_id(UUID) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. New: purge_certification_tenant() — single-operation teardown of a
--    school-scoped demo/certification tenant and everything under it,
--    including the 4 per-student child tables (via step (a)/(b)) and the 6
--    school-scoped/B2B child tables — payment_reconciliation_queue,
--    school_alert_rules, school_audit_log, school_invoices, school_seat_usage,
--    school_contracts — (via step (c)). See corrected FK inventory above.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION purge_certification_tenant(p_school_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_school                  RECORD;
  v_reg                     RECORD;
  v_registry_accounts_purged INT := 0;
  v_students_purged_direct   INT := 0;
  v_teachers_purged_direct   INT := 0;
BEGIN
  SELECT id, is_demo INTO v_school FROM schools WHERE id = p_school_id;

  -- Idempotent no-op: nothing left to tear down. A second call after a prior
  -- successful purge (or any call against a school_id that never existed)
  -- must succeed, not error.
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', true,
      'already_absent', true,
      'school_id', p_school_id
    );
  END IF;

  -- Hard guard: this function may NEVER be pointed at a real school, even
  -- by a service-role caller. This check is inside the function body (not
  -- just enforced by the GRANT below) specifically so it cannot become a
  -- general-purpose school-deletion backdoor.
  IF v_school.is_demo IS NOT TRUE THEN
    RAISE EXCEPTION
      'purge_certification_tenant: refusing to tear down school % — is_demo is not true. '
      'This function only operates on schools explicitly flagged is_demo = true and is '
      'NOT a general-purpose school-deletion path.', p_school_id
      USING ERRCODE = '42501'; -- insufficient_privilege
  END IF;

  -- (a) Purge every demo_accounts-registered student/teacher under this
  --     tenant via the existing per-account primitive. Students first, then
  --     teachers, mirroring the order already used inside
  --     purge_demo_account_by_id's own school_admin branch above.
  FOR v_reg IN
    SELECT id, role
    FROM demo_accounts
    WHERE school_id = p_school_id
      AND role IN ('student', 'teacher')
    ORDER BY CASE role WHEN 'student' THEN 1 WHEN 'teacher' THEN 2 ELSE 3 END
  LOOP
    PERFORM purge_demo_account_by_id(v_reg.id);
    v_registry_accounts_purged := v_registry_accounts_purged + 1;
  END LOOP;

  -- (b) Defensive direct sweep. Not every demo student/teacher is guaranteed
  --     to have a demo_accounts registry row — three inconsistent
  --     demo-marking conventions exist in the codebase today (see
  --     docs/runbooks/certification-traffic-traceability.md, "Why this
  --     exists"). Strictly scoped to school_id + is_demo = true, so this can
  --     never reach a real account regardless of registry-row coverage.
  --
  --     Before the direct students-row delete, also clear the 4 per-student
  --     RESTRICT/no-cascade child tables (corrected FK inventory in the
  --     migration header, items 1-4) for whatever demo students remain.
  --     Registered students already had these cleared inside step (a)'s call
  --     to purge_demo_account_by_id; these un-registered ones never went
  --     through that function, so nothing else clears them, and the direct
  --     DELETE FROM students two lines down would otherwise 23503 on any of
  --     the 4 (most likely foxy_chat_messages/foxy_sessions, since any
  --     certification student who actually used Foxy will have rows there).
  DELETE FROM foxy_chat_messages
    WHERE student_id IN (SELECT id FROM students WHERE school_id = p_school_id AND is_demo = true);
  DELETE FROM foxy_sessions
    WHERE student_id IN (SELECT id FROM students WHERE school_id = p_school_id AND is_demo = true);
  DELETE FROM ai_workflow_traces
    WHERE student_id IN (SELECT id FROM students WHERE school_id = p_school_id AND is_demo = true);
  DELETE FROM admin_impersonation_sessions
    WHERE student_id IN (SELECT id FROM students WHERE school_id = p_school_id AND is_demo = true);

  DELETE FROM students WHERE school_id = p_school_id AND is_demo = true;
  GET DIAGNOSTICS v_students_purged_direct = ROW_COUNT;

  DELETE FROM teachers WHERE school_id = p_school_id AND is_demo = true;
  GET DIAGNOSTICS v_teachers_purged_direct = ROW_COUNT;

  -- (c) Clear the 6 school-scoped / B2B-revenue child tables that reference
  --     schools(id) (or chain through school_invoices(id)) WITHOUT
  --     ON DELETE CASCADE and are NOT already emptied transitively by a
  --     student cascade. (quiz_sessions and student_learning_profiles also FK
  --     to schools(id) without cascade, but both cascade from student_id
  --     already, so they are empty by this point once step (b) has removed
  --     every demo student.) Safe unconditionally here because
  --     v_school.is_demo was already confirmed true above.
  --
  --     Order matters for payment_reconciliation_queue: its invoice_id FK is
  --     ON DELETE RESTRICT against school_invoices (corrected FK inventory
  --     item 6), so it must be cleared BEFORE the school_invoices delete
  --     below, or that delete 23503s.
  DELETE FROM payment_reconciliation_queue WHERE school_id = p_school_id;
  DELETE FROM school_alert_rules WHERE school_id = p_school_id;
  DELETE FROM school_audit_log   WHERE school_id = p_school_id;
  DELETE FROM school_invoices    WHERE school_id = p_school_id;
  DELETE FROM school_seat_usage  WHERE school_id = p_school_id;

  -- school_contracts.school_id is also ON DELETE RESTRICT against schools(id)
  -- (corrected FK inventory item 7). No downstream ordering constraint: its
  -- only inbound reference (institution_entitlements.contract_id) and its
  -- self-reference (previous_contract_id) are both ON DELETE SET NULL, so a
  -- single bulk delete of every contract row for this school is safe.
  DELETE FROM school_contracts WHERE school_id = p_school_id;

  -- (d) Registry cleanup. demo_accounts.school_id carries no FK constraint
  --     (plain nullable uuid), so nothing else cleans this up. Remove every
  --     remaining registration for this tenant (any role, e.g. school_admin)
  --     now that everything each row pointed at is gone.
  DELETE FROM demo_accounts WHERE school_id = p_school_id;

  -- (e) Finally, the schools row itself — only after every non-cascading
  --     child above is confirmed gone. Everything else under schools
  --     (school_admins, classes, school_announcements, school_api_keys,
  --     school_exams, school_invite_codes, school_questions,
  --     school_subscriptions) already has ON DELETE CASCADE and is removed
  --     automatically by this one statement. The is_demo = true guard is
  --     kept here too (belt-and-suspenders) even though it was already
  --     checked above.
  DELETE FROM schools WHERE id = p_school_id AND is_demo = true;

  RETURN jsonb_build_object(
    'success', true,
    'already_absent', false,
    'school_id', p_school_id,
    'registry_accounts_purged', v_registry_accounts_purged,
    'students_purged_direct', v_students_purged_direct,
    'teachers_purged_direct', v_teachers_purged_direct
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION purge_certification_tenant(UUID) FROM public, anon, authenticated;
GRANT  EXECUTE ON FUNCTION purge_certification_tenant(UUID) TO service_role;

COMMENT ON FUNCTION purge_certification_tenant(UUID) IS
  'Single-operation teardown of a demo/certification school tenant (schools '
  'row + every student/teacher/school_admin under it + the 4 non-cascading '
  'per-student child tables [foxy_chat_messages, foxy_sessions, '
  'ai_workflow_traces, admin_impersonation_sessions] + the 6 non-cascading '
  'school-scoped/B2B child tables [payment_reconciliation_queue, '
  'school_alert_rules, school_audit_log, school_invoices, school_seat_usage, '
  'school_contracts] + demo_accounts registry rows). Hard-fails if the '
  'target schools row is not is_demo = true; succeeds as a no-op if the row '
  'is already gone. service_role only. Does NOT alter the ON DELETE behavior '
  'of students_school_id_fkey / teachers_school_id_fkey — those '
  'intentionally remain non-cascading for every real school. See migration '
  '20260702180000_certification_tenant_teardown.sql for the full design '
  'rationale and the corrected FK inventory.';
