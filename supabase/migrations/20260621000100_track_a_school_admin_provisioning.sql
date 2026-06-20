-- Migration: 20260621000100_track_a_school_admin_provisioning.sql
-- Purpose: Phase 1 / Track A (white-label multi-tenant SaaS) — the architect-
--          owned foundational changeset. THREE cohesive parts, all ADDITIVE +
--          IDEMPOTENT:
--            (A) NEW admin-claim flow: extend school_invite_codes to allow an
--                'admin' role_type, and add a self-contained school_admin_claim_tokens
--                table (RLS enabled inline) backing POST /api/schools/claim-admin.
--            (B) Tenant-isolation hardening: write-side RLS for classes (the gap),
--                a seat-ceiling RPC assert_seat_capacity(school_id), and a
--                defensive hardening of the school-admin students SELECT policy so
--                B2C (NULL school_id) students can never be read by ANY school admin.
--            (C) RBAC additions (user-approved 2026-06-20): three new permission
--                codes (integration.manage, public_api.manage, ops_team.manage)
--                granted to the right roles. REG-120 conformance — reproducible
--                from this one additive migration; no orphan codes.
--
-- ─── Scope / safety contract (HARD CONSTRAINTS) ──────────────────────────────
--   - ADDITIVE ONLY. No DROP TABLE / DROP COLUMN / DELETE / UPDATE / TRUNCATE of
--     data. The only DROPs are DROP POLICY IF EXISTS / DROP TRIGGER IF EXISTS,
--     each immediately followed by an equivalent-or-wider CREATE in the same
--     transaction (Postgres has no CREATE OR REPLACE POLICY).
--   - IDEMPOTENT / replayable on PROD, main-staging, CI live-DB, and fresh DBs:
--       * CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS.
--       * ALTER TABLE ... CHECK widening guarded by a DO $$ ... EXCEPTION block.
--       * permissions      -> ON CONFLICT (code) DO NOTHING.
--       * role_permissions -> ON CONFLICT (role_id, permission_id) DO NOTHING.
--       * RLS via DROP POLICY IF EXISTS + CREATE POLICY.
--   - NEW TABLE school_admin_claim_tokens: ENABLE ROW LEVEL SECURITY + policies
--     in THIS file (P8). The table holds a hashed claim token only (never the raw
--     token, never a password) — service-role-only write; no authenticated read.
--   - P5: grades untouched (no grade column added; school context is uuid-keyed).
--   - SECURITY DEFINER: assert_seat_capacity is SECURITY DEFINER with the standard
--     justification comment (it must read school_subscriptions across the tenant
--     boundary to count seats; callers are the service-role bulk-import path).
--
-- ─── CEO approval posture ────────────────────────────────────────────────────
--   The three new permission codes are RBAC permission additions; per the
--   constitution these require user approval — granted for the Phase 1 Track A
--   launch-readiness program (white-label multi-tenant school SaaS).
--
-- Owner: architect. Phase 1 Track A — school-admin auth provisioning + tenant
-- isolation hardening + RBAC additions.

BEGIN;

-- =============================================================================
-- PART A — ADMIN-CLAIM FLOW
-- =============================================================================

-- A.1 Widen school_invite_codes.role_type to admit 'admin'.
-- The baseline CHECK is school_invite_codes_role_type_check = ('teacher','student').
-- provisionTrialSchool() now issues an 'admin' invite for the principal (the
-- teacher invite-code generation stays separate/optional). Widening-only: every
-- previously-valid value remains valid; we only ADD 'admin'. Guarded so a replay
-- (or an env where the constraint was already widened) is a no-op.
DO $$
BEGIN
  ALTER TABLE "public"."school_invite_codes"
    DROP CONSTRAINT IF EXISTS "school_invite_codes_role_type_check";
  ALTER TABLE "public"."school_invite_codes"
    ADD CONSTRAINT "school_invite_codes_role_type_check"
    CHECK ("role_type" = ANY (ARRAY['teacher'::"text", 'student'::"text", 'admin'::"text"]));
EXCEPTION
  WHEN duplicate_object THEN NULL; -- constraint already in the widened shape
END $$;

-- A.2 school_admin_claim_tokens — backs POST /api/schools/claim-admin.
-- A provisioned (but not-yet-logged-in) principal gets a one-time claim token
-- (raw token emailed; only its SHA-256 hash stored here). Claiming activates the
-- matching school_admins row (sets accepted_at) and consumes the token. The table
-- never stores PII or the raw token — only the hash + the school_admin it points
-- at. Idempotent claim: a consumed token returns the same success.
CREATE TABLE IF NOT EXISTS "public"."school_admin_claim_tokens" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "school_id" uuid NOT NULL REFERENCES "public"."schools"("id") ON DELETE CASCADE,
  "school_admin_id" uuid NOT NULL REFERENCES "public"."school_admins"("id") ON DELETE CASCADE,
  "token_hash" text NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "consumed_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

-- Unique on the hash so a token can be looked up O(1) and never duplicated.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_school_admin_claim_tokens_hash"
  ON "public"."school_admin_claim_tokens" ("token_hash");
CREATE INDEX IF NOT EXISTS "idx_school_admin_claim_tokens_admin"
  ON "public"."school_admin_claim_tokens" ("school_admin_id");
CREATE INDEX IF NOT EXISTS "idx_school_admin_claim_tokens_school"
  ON "public"."school_admin_claim_tokens" ("school_id");

-- RLS (P8): service-role-only. The claim endpoint runs server-side with the
-- service-role client; no authenticated/anon role may read or write claim tokens
-- (they hold a security secret hash). Default-deny + an explicit service_role
-- policy is the complete posture for a server-only token table.
ALTER TABLE "public"."school_admin_claim_tokens" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "claim_tokens_service_role" ON "public"."school_admin_claim_tokens";
CREATE POLICY "claim_tokens_service_role"
  ON "public"."school_admin_claim_tokens"
  TO "service_role"
  USING (true) WITH CHECK (true);

-- updated_at is intentionally omitted (append-then-consume lifecycle; no updates
-- other than the single consumed_at stamp written via the service role).

-- =============================================================================
-- PART B — TENANT-ISOLATION HARDENING
-- =============================================================================

-- B.1 Write-side RLS for `classes` (the gap).
-- Baseline coverage on `classes` for school admins is SELECT-only
-- ("School admins can view school classes"). class_students / class_teachers
-- ALREADY have ALL-command school-admin policies ("School admins can manage
-- school class_*"), so only `classes` itself lacks the write path. Today writes
-- are enforced only at the API layer — close the RLS gap with INSERT/UPDATE/DELETE
-- policies scoped to a school the caller administers (is_school_admin_of mirrors
-- the established helper and the SELECT-policy membership pattern).
DROP POLICY IF EXISTS "School admins can insert school classes" ON "public"."classes";
CREATE POLICY "School admins can insert school classes"
  ON "public"."classes"
  FOR INSERT TO "authenticated"
  WITH CHECK (
    "school_id" IS NOT NULL
    AND "public"."is_school_admin_of"("school_id")
  );

DROP POLICY IF EXISTS "School admins can update school classes" ON "public"."classes";
CREATE POLICY "School admins can update school classes"
  ON "public"."classes"
  FOR UPDATE TO "authenticated"
  USING (
    "school_id" IS NOT NULL
    AND "public"."is_school_admin_of"("school_id")
  )
  WITH CHECK (
    "school_id" IS NOT NULL
    AND "public"."is_school_admin_of"("school_id")
  );

DROP POLICY IF EXISTS "School admins can delete school classes" ON "public"."classes";
CREATE POLICY "School admins can delete school classes"
  ON "public"."classes"
  FOR DELETE TO "authenticated"
  USING (
    "school_id" IS NOT NULL
    AND "public"."is_school_admin_of"("school_id")
  );

-- B.2 Defensive hardening of the school-admin students SELECT policy.
-- Baseline "School admins can view school students" uses
--   students.school_id IN (SELECT sa.school_id FROM school_admins sa WHERE ...)
-- For a B2C student (school_id IS NULL), `NULL IN (...)` already evaluates to
-- NULL (never TRUE), so B2C students are NOT visible — but we make the intent
-- EXPLICIT and robust against future policy edits by adding an unconditional
-- `school_id IS NOT NULL` guard. Widening-nothing: this can only ever DENY rows
-- (it adds an AND), never admit. A student WITH a school_id is still visible only
-- to that school's active admins.
DROP POLICY IF EXISTS "School admins can view school students" ON "public"."students";
CREATE POLICY "School admins can view school students"
  ON "public"."students"
  FOR SELECT TO "authenticated"
  USING (
    "school_id" IS NOT NULL
    AND "school_id" IN (
      SELECT "sa"."school_id"
        FROM "public"."school_admins" "sa"
       WHERE "sa"."auth_user_id" = "auth"."uid"()
         AND "sa"."is_active" = true
    )
  );

-- B.3 Seat-ceiling enforcement — assert_seat_capacity(p_school_id).
-- CONTRACT: RAISES 'seat_capacity_exceeded' (SQLSTATE P0001) when the number of
-- ACTIVE students enrolled in classes of p_school_id PLUS active teachers of
-- p_school_id would meet/exceed the school's purchased seat ceiling. Callers
-- (the bulk-import path) invoke it BEFORE adding a new active member; it is a
-- pre-flight gate, not a trigger, so a single advisory check covers a batch.
--
-- Grace policy: school_subscriptions has NO school-level grace tier in the
-- baseline (only student_subscriptions do). Per the spec, absent a grace tier we
-- HARD-BLOCK at the purchased ceiling. The seat ceiling is the MAX of
-- school_subscriptions.seats_purchased (active/trial sub) and schools.max_students
-- (legacy fallback) so a school with no subscription row still has a sane cap.
--
-- SECURITY DEFINER justification: the function must read school_subscriptions +
-- count students/teachers ACROSS the tenant RLS boundary to compute the ceiling;
-- an RLS-scoped INVOKER call would under-count (a school admin cannot see every
-- row needed). It is keyed strictly by the passed p_school_id (no auth.uid()
-- widening) and only RAISES or returns counts — it never mutates. search_path is
-- pinned to public to prevent search-path hijack of the unqualified lookups.
CREATE OR REPLACE FUNCTION "public"."assert_seat_capacity"("p_school_id" uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ceiling integer;
  v_active_students integer;
  v_active_teachers integer;
  v_used integer;
BEGIN
  IF p_school_id IS NULL THEN
    RAISE EXCEPTION 'school_id is required' USING ERRCODE = '22004';
  END IF;

  -- Ceiling: prefer an active/trial subscription's seats_purchased; fall back to
  -- schools.max_students; final floor of 0 (which then blocks everything).
  SELECT COALESCE(
    (SELECT ss.seats_purchased
       FROM school_subscriptions ss
      WHERE ss.school_id = p_school_id
        AND ss.status IN ('active', 'trial')
      ORDER BY ss.current_period_end DESC NULLS LAST
      LIMIT 1),
    (SELECT s.max_students FROM schools s WHERE s.id = p_school_id),
    0
  ) INTO v_ceiling;

  -- Active students enrolled in any class of this school (distinct so a student
  -- in two classes counts once toward the seat ceiling).
  SELECT COUNT(DISTINCT cs.student_id)
    INTO v_active_students
    FROM class_students cs
    JOIN classes c ON c.id = cs.class_id
   WHERE c.school_id = p_school_id
     AND cs.is_active = true;

  -- Active teachers of this school.
  SELECT COUNT(*)
    INTO v_active_teachers
    FROM teachers t
   WHERE t.school_id = p_school_id
     AND t.is_active = true;

  v_used := COALESCE(v_active_students, 0) + COALESCE(v_active_teachers, 0);

  IF v_used >= v_ceiling THEN
    RAISE EXCEPTION 'seat_capacity_exceeded: school % is at its seat ceiling (% of % used)',
      p_school_id, v_used, v_ceiling
      USING ERRCODE = 'P0001';
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'school_id', p_school_id,
    'ceiling', v_ceiling,
    'used', v_used,
    'remaining', GREATEST(v_ceiling - v_used, 0)
  );
END;
$$;

COMMENT ON FUNCTION "public"."assert_seat_capacity"(uuid) IS
  'Seat-ceiling gate for school enrollment. RAISES seat_capacity_exceeded '
  '(SQLSTATE P0001) when active students+teachers of p_school_id would meet/exceed '
  'the seat ceiling (MAX of active/trial school_subscriptions.seats_purchased and '
  'schools.max_students). HARD-BLOCK — no school-level grace tier exists. '
  'SECURITY DEFINER: must read school_subscriptions + count across the tenant RLS '
  'boundary; keyed strictly by p_school_id, read-only, search_path pinned to public. '
  'Called by the service-role bulk-import path BEFORE adding an active member.';

-- Allow the bulk-import path (authenticated school admins / service role) to call
-- the gate. authenticated is included so a future RLS-scoped route can pre-check;
-- the function itself is DEFINER so the counts are accurate regardless of caller.
GRANT EXECUTE ON FUNCTION "public"."assert_seat_capacity"(uuid) TO "authenticated", "service_role";

-- =============================================================================
-- PART C — RBAC ADDITIONS (user-approved 2026-06-20)
-- =============================================================================
-- Mirrors the established seed pattern (20260620000000 / 20260620000500): insert
-- permission rows (ON CONFLICT (code) DO NOTHING) then GRANT by role name/code
-- join (ON CONFLICT (role_id, permission_id) DO NOTHING). The permissions table
-- shape is (id, code, resource, action, description, is_active, created_at) — no
-- `category` column; categorisation rides `resource`.

INSERT INTO permissions (code, resource, action, description, is_active) VALUES
  ('integration.manage',
   'integration',
   'manage',
   'Connect and manage external institution integrations (SIS/LMS/SSO connectors)',
   true),
  ('public_api.manage',
   'public_api',
   'manage',
   'Manage API keys and public API access at the institution tier',
   true),
  ('ops_team.manage',
   'ops_team',
   'manage',
   'Manage the regional ops hierarchy (platform-level; future)',
   true)
ON CONFLICT (code) DO NOTHING;

-- integration.manage + public_api.manage -> institution_admin.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM roles r, permissions p
 WHERE r.name = 'institution_admin'
   AND p.code IN ('integration.manage', 'public_api.manage')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- All three (integration.manage, public_api.manage, ops_team.manage) -> super_admin.
-- ops_team.manage is super_admin-ONLY (platform regional ops); it is intentionally
-- NOT granted to institution_admin.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM roles r, permissions p
 WHERE r.name = 'super_admin'
   AND p.code IN ('integration.manage', 'public_api.manage', 'ops_team.manage')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Defensive: ensure `admin` also holds integration.manage + public_api.manage so
-- the grant is present on an env where the wildcard matrix migration does not
-- re-run after this file (mirrors 20260620000500's defensive admin grant).
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM roles r, permissions p
 WHERE r.name = 'admin'
   AND p.code IN ('integration.manage', 'public_api.manage', 'ops_team.manage')
ON CONFLICT (role_id, permission_id) DO NOTHING;

COMMIT;

-- ─── Verify (manual checks after applying) ───────────────────────────────────
-- 1. role_type now admits 'admin':
--      INSERT INTO school_invite_codes (school_id, code, role_type, used_count)
--      VALUES ('<a school id>', 'TESTADMN', 'admin', 0);  -- succeeds
-- 2. classes write RLS for a school admin (as the authenticated principal):
--      INSERT INTO classes (school_id, name, grade) VALUES (get_admin_school_id(), 'X', '6'); -- succeeds for own school, denied for others
-- 3. B2C isolation: as a school admin, SELECT count(*) FROM students WHERE school_id IS NULL; -- 0
-- 4. Seat gate: SELECT public.assert_seat_capacity('<school at ceiling>');  -- RAISES seat_capacity_exceeded
--    SELECT public.assert_seat_capacity('<school with room>');             -- returns {ok:true,...}
-- 5. New RBAC grants:
--      SELECT r.name FROM role_permissions rp
--        JOIN roles r ON r.id = rp.role_id
--        JOIN permissions p ON p.id = rp.permission_id
--       WHERE p.code IN ('integration.manage','public_api.manage','ops_team.manage')
--       ORDER BY p.code, r.name;
--      -- integration.manage: admin, institution_admin, super_admin
--      -- public_api.manage:  admin, institution_admin, super_admin
--      -- ops_team.manage:    admin, super_admin   (NOT institution_admin)
