-- Migration: 20260620000300_portal_rbac_remediation_phase3_get_admin_school_id_recognizes_school_admins.sql
-- Purpose: PHASE 3 of the CEO-approved portal RBAC remediation (deferred from
--          Phase 0 — see 20260620000000 header "NOT in scope ... the
--          get_admin_school_id() fix — Phase 3").
--
--          Fix get_admin_school_id() so it ALSO recognizes pure
--          institution_admins via the school_admins table, restoring RLS read
--          access to the school-admin read surface for school admins who have
--          NO teachers row. WIDENING-ONLY: teacher access is preserved
--          byte-for-byte; only NEW (institution_admin) coverage is added.
--
-- ─── GROUND TRUTH (confirmed against PROD, read-only, 2026-06-16) ─────────────
--   PROD (project shktyoxqhundlvkiwguu) queried read-only via PostgREST/service
--   role. Findings that motivate this fix:
--     * get_admin_school_id() body (baseline ~line 8868):
--         RETURN (SELECT school_id FROM teachers WHERE auth_user_id = auth.uid() LIMIT 1);
--       It resolves the admin's school ONLY from the `teachers` table.
--     * 2 active school_admins on prod, BOTH role=institution_admin, and NEITHER
--       has a `teachers` row (auth_user_ids b9e30cfe… / 67268b20…). For both,
--       get_admin_school_id() returns NULL, so every RLS policy of the form
--       `school_id = get_admin_school_id()` denies them — they get ZERO read
--       access to school_announcements / school_exams / school_questions /
--       class_enrollments (and the other dependent tables below).
--     * 0 teachers on prod currently have a non-null `school_id`, and NO user is
--       both an active school_admin AND a teacher (overlap query returned []).
--       => This fix changes the resolved value for exactly the institution_admins
--          who got NULL before; it changes NOTHING for any current teacher.
--
-- ─── WHAT get_admin_school_id() FEEDS (8 dependent SELECT policies) ───────────
--   The single-value helper is referenced by 8 baseline RLS policies (all
--   `... = get_admin_school_id()`), so this ONE function fix widens all 8 for
--   single-school admins, consistently:
--     1. school_announcements  announcements_school_admin_select          (named)
--     2. school_exams          school_exams_school_admin_select           (named)
--     3. school_questions      school_questions_school_admin_select       (named)
--     4. class_enrollments     class_enrollments_school_admin_select      (named, nested via classes)
--     5. school_audit_log      audit_log_admin_select
--     6. school_invoices       invoices_admin_select
--     7. school_api_keys       school_api_keys_admin_select
--     8. school_seat_usage     seat_usage_admin_select
--   The 4 NAMED policies are additionally recreated below to a membership form
--   (OR is_school_admin_of(school_id)) so MULTI-school institution_admins are
--   fully covered, not just their LIMIT-1 "primary" school. (No multi-school
--   admin exists on prod today, but the membership form is the robust contract
--   matching rbac.ts canAccessStudent's cross-school institution_admin handling.)
--
-- ─── WHY THIS IS WIDENING-ONLY (teacher access preserved) ─────────────────────
--   1. get_admin_school_id() keeps the EXIST teacher resolution FIRST and adds
--      school_admins ONLY as a COALESCE fallback when the teacher lookup is NULL.
--      For any user with a teachers.school_id, the returned value is IDENTICAL to
--      before. A user who is both a teacher (school X) and a school_admin
--      (school Y) still resolves to X (teacher-first) — no teacher regression.
--   2. The 4 recreated policies use `OLD_PREDICATE OR is_school_admin_of(...)`.
--      The original predicate is preserved verbatim, so every row a teacher /
--      admin could read before, they can still read; the OR only ADMITS rows
--      (never removes). Postgres has no CREATE OR REPLACE POLICY, so each is
--      DROP POLICY IF EXISTS + CREATE POLICY (idempotent, replayable).
--   3. is_school_admin_of(uuid) is the EXISTING baseline helper (baseline ~line
--      9197): EXISTS over school_admins WHERE school_id = p_school_id AND
--      auth_user_id = auth.uid() AND is_active. Reused, not re-defined here.
--
-- ─── SCOPE / SAFETY CONTRACT (HARD CONSTRAINTS) ──────────────────────────────
--   - ADDITIVE / WIDENING ONLY. No DROP TABLE/COLUMN, no DELETE/UPDATE/TRUNCATE
--     of data. The only DROPs are DROP POLICY IF EXISTS immediately followed by
--     an equivalent-or-wider CREATE POLICY in the same transaction.
--   - NO NEW TABLES => no new RLS posture. ENABLE ROW LEVEL SECURITY already set
--     on all 4 tables in the baseline; this migration does not touch it.
--   - IDEMPOTENT / replayable: CREATE OR REPLACE FUNCTION; DROP POLICY IF EXISTS
--     before each CREATE POLICY. Safe on PROD, main-staging, CI live-DB, fresh.
--   - SECURITY DEFINER unchanged on is_school_admin_of (baseline). The widened
--     get_admin_school_id stays STABLE + SET search_path = public (baseline
--     posture; it reads only teachers/school_admins keyed by auth.uid()).
--   - NO feature flag is enabled here. Self-service billing
--     (ff_school_self_service_billing_v1) and ff_school_admin_rbac remain in
--     whatever state they are in — this migration does not touch feature_flags.
--
-- Owner: architect. Phase 3 of feat/portal-rbac-saas-remediation.

BEGIN;

-- =============================================================================
-- 1. WIDEN get_admin_school_id() — teachers FIRST, school_admins FALLBACK.
-- =============================================================================
-- Preserves the exact prior teacher resolution (LIMIT 1 over teachers) and only
-- falls back to the active school_admins membership when the teacher lookup is
-- NULL. For an institution_admin in multiple schools the fallback picks one
-- deterministically (most-recently-created active membership) — single-value
-- helpers can only return one school; the 4 named policies below use the
-- membership form to cover ALL of a multi-school admin's schools.
CREATE OR REPLACE FUNCTION "public"."get_admin_school_id"() RETURNS "uuid"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public'
    AS $$
BEGIN
  RETURN COALESCE(
    -- Unchanged teacher resolution (byte-identical to the baseline body).
    (SELECT school_id FROM teachers
      WHERE auth_user_id = auth.uid()
      LIMIT 1),
    -- NEW: pure institution_admins (no teachers row) resolve via school_admins.
    (SELECT school_id FROM school_admins
      WHERE auth_user_id = auth.uid()
        AND is_active = true
      ORDER BY created_at DESC NULLS LAST
      LIMIT 1)
  );
END;
$$;

COMMENT ON FUNCTION "public"."get_admin_school_id"() IS
  'Resolves the calling user''s school for school-admin RLS policies. WIDENED '
  '(20260620000300, portal RBAC remediation Phase 3): tries teachers.school_id '
  'FIRST (byte-identical to the original baseline body, so teacher access is '
  'preserved), then falls back to the active school_admins membership so pure '
  'institution_admins (no teachers row) also get a non-null school_id. Single '
  'value (LIMIT 1); the school-admin read policies that must cover MULTI-school '
  'institution_admins use is_school_admin_of(school_id) membership instead. '
  'STABLE, SET search_path = public.';

-- =============================================================================
-- 2. RECREATE the 4 NAMED policies to membership form (multi-school robust).
-- =============================================================================
-- Each is OLD_PREDICATE OR is_school_admin_of(<school_id of the row>). The OR
-- only ADMITS rows, so teacher/single-school-admin reads are unchanged and
-- multi-school institution_admins gain rows for EVERY school they administer.
-- Postgres lacks CREATE OR REPLACE POLICY → DROP IF EXISTS + CREATE (idempotent).

-- 2a. school_announcements — admin read.
DROP POLICY IF EXISTS "announcements_school_admin_select" ON "public"."school_announcements";
CREATE POLICY "announcements_school_admin_select"
  ON "public"."school_announcements"
  FOR SELECT TO "authenticated"
  USING (
    ("school_id" = "public"."get_admin_school_id"())
    OR "public"."is_school_admin_of"("school_id")
  );

-- 2b. school_exams — admin read.
DROP POLICY IF EXISTS "school_exams_school_admin_select" ON "public"."school_exams";
CREATE POLICY "school_exams_school_admin_select"
  ON "public"."school_exams"
  FOR SELECT TO "authenticated"
  USING (
    ("school_id" = "public"."get_admin_school_id"())
    OR "public"."is_school_admin_of"("school_id")
  );

-- 2c. school_questions — admin read.
DROP POLICY IF EXISTS "school_questions_school_admin_select" ON "public"."school_questions";
CREATE POLICY "school_questions_school_admin_select"
  ON "public"."school_questions"
  FOR SELECT TO "authenticated"
  USING (
    ("school_id" = "public"."get_admin_school_id"())
    OR "public"."is_school_admin_of"("school_id")
  );

-- 2d. class_enrollments — admin read (nested via classes.school_id).
-- Original predicate: class_id IN (SELECT id FROM classes WHERE school_id = get_admin_school_id()).
-- Widened twin: also admit enrollments whose class belongs to a school the
-- caller administers (is_school_admin_of on classes.school_id).
DROP POLICY IF EXISTS "class_enrollments_school_admin_select" ON "public"."class_enrollments";
CREATE POLICY "class_enrollments_school_admin_select"
  ON "public"."class_enrollments"
  FOR SELECT TO "authenticated"
  USING (
    "class_id" IN (
      SELECT "classes"."id"
        FROM "public"."classes"
       WHERE ("classes"."school_id" = "public"."get_admin_school_id"())
          OR "public"."is_school_admin_of"("classes"."school_id")
    )
  );

COMMIT;

-- ─── Verify (manual checks after applying) ───────────────────────────────────
-- 1. Function now resolves school for a pure institution_admin (no teachers row).
--    As the institution_admin (authenticated):
--      SELECT public.get_admin_school_id();  -- expect their school_admins.school_id, not NULL
--    As a teacher with a non-null school_id (authenticated):
--      SELECT public.get_admin_school_id();  -- expect the SAME value as before this migration
-- 2. The 4 named policies now admit the institution_admin's rows:
--    As the institution_admin:
--      SELECT count(*) FROM school_announcements;   -- > 0 where rows exist for their school
--      SELECT count(*) FROM school_exams;
--      SELECT count(*) FROM school_questions;
--      SELECT count(*) FROM class_enrollments;       -- their school's class rosters
-- 3. Teacher access unchanged (regression guard):
--    As a teacher: the same set of rows is visible as before (the OR only adds).
-- 4. Cross-tenant denial intact: an admin of school A still sees NO rows of
--    school B (is_school_admin_of(B) is false for them; equality also false).
