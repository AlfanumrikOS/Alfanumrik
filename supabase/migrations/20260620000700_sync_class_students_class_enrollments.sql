-- Migration: 20260620000700_sync_class_students_class_enrollments.sql
-- Purpose: FIX C (P2) of the portal RBAC SaaS remediation FIX PASS.
--          Resolve the enrollment split-brain between the two roster tables so a
--          student enrolled via EITHER table appears on ALL surfaces:
--            * class_students     — written by the school-admin "add student"
--              path (src/app/api/school-admin/students/route.ts:568) and read by
--              every SECURITY DEFINER roster RPC (get_school_classes student_count,
--              get_school_students p_class_id filter, get_school_teachers
--              student_count, get_teacher_student_ids, ...).
--            * class_enrollments  — written by the self-service enroll/join paths
--              (src/app/api/schools/enroll/route.ts:275, schools/join/route.ts:220)
--              and read by parent/calendar, teacher/lab-leaderboard,
--              school-admin/classes + reports, and the student_skill_state /
--              concept RLS teacher policies.
--          Today neither table mirrors the other, so a student shows up on one
--          set of surfaces and is invisible on the rest.
--
-- ─── COLUMN COMPATIBILITY ASSESSMENT (why auto-sync is SAFE / LOSSLESS) ───────
--   Confirmed against 00000000000000_baseline_from_prod.sql:
--     class_students     (id, class_id, student_id, roll_number, joined_at,
--                         is_active, updated_at)
--                        UNIQUE(class_id, student_id)
--                        class_id NOT NULL, student_id NOT NULL; ALL OTHER columns
--                        nullable or defaulted (roll_number nullable; joined_at
--                        default now(); is_active default true; updated_at default
--                        now()).
--     class_enrollments  (id, class_id, student_id, enrolled_at, is_active,
--                         updated_at)
--                        UNIQUE(class_id, student_id)
--                        class_id NOT NULL, student_id NOT NULL; enrolled_at,
--                        is_active, updated_at are NOT NULL but ALL have defaults
--                        (now() / true / now()).
--   => The natural key (class_id, student_id) is identical and UNIQUE on both,
--      and EVERY non-key column on EITHER side has a safe DB default. The only
--      semantic columns the surfaces query on are exactly class_id + student_id
--      (+ is_active, which both carry). There is NO NOT-NULL column on one side
--      that the other side cannot supply a safe value for. The sync is therefore
--      LOSSLESS: mirroring (class_id, student_id, is_active) is sufficient; the
--      timestamp columns (joined_at / enrolled_at) are independently defaulted on
--      each side and are not cross-read. We carry is_active across so a row
--      inserted inactive on one side does not appear active on the other.
--      DECISION: implement the bidirectional sync (backfill + triggers).
--
-- ─── RECURSION SAFETY ────────────────────────────────────────────────────────
--   Each AFTER INSERT trigger mirrors the new row into the OTHER table with
--   ON CONFLICT (class_id, student_id) DO NOTHING. The mirrored insert into the
--   other table fires THAT table's trigger, which attempts to mirror back into
--   the originating table — but that row already exists, so ON CONFLICT DO NOTHING
--   makes it a no-op INSERT. A no-op (zero-row) INSERT does NOT fire an AFTER
--   INSERT FOR EACH ROW trigger, so the cycle terminates after exactly one bounce.
--   (Postgres fires row triggers per actually-inserted row; a conflict-skipped
--   row inserts nothing, hence no trigger.) No infinite recursion.
--
-- ─── Scope / safety contract (HARD CONSTRAINTS) ──────────────────────────────
--   - ADDITIVE ONLY. No DROP TABLE/COLUMN, no DELETE/UPDATE/TRUNCATE of data.
--     The only DROPs are DROP TRIGGER / DROP FUNCTION IF EXISTS immediately
--     followed by a CREATE in the same transaction (idempotent re-create).
--   - NO NEW TABLES -> no new RLS posture. Both tables already have RLS enabled +
--     policies in the baseline; this migration does not touch their RLS. The
--     trigger functions are SECURITY DEFINER so the mirror write succeeds
--     regardless of which RLS-scoped role performed the originating insert
--     (the originating insert already passed its own table's RLS WITH CHECK; the
--     mirror is a faithful copy of an already-authorized row). search_path pinned.
--   - IDEMPOTENT / replayable: CREATE OR REPLACE FUNCTION; DROP TRIGGER IF EXISTS
--     before CREATE TRIGGER; backfill INSERT ... ON CONFLICT DO NOTHING. Safe on
--     PROD, main-staging, CI live-DB, and fresh DBs.
--   - SECURITY DEFINER justification (required by architect rules): the mirror
--     must write to the sibling roster table on behalf of whichever role inserted
--     the source row (school admin -> class_students; student/self-service ->
--     class_enrollments). Those roles do not necessarily hold an INSERT policy on
--     the OTHER table, but the source row was already authorized by the source
--     table's own RLS. DEFINER lets the faithful mirror proceed without widening
--     any user-facing INSERT policy. The functions copy ONLY class_id/student_id/
--     is_active from NEW (no privilege escalation surface), pin search_path, and
--     perform a single guarded INSERT.
--
-- Owner: architect. Portal RBAC SaaS remediation FIX PASS — FIX C.

BEGIN;

-- =============================================================================
-- 1. ONE-TIME BIDIRECTIONAL BACKFILL (both directions, ON CONFLICT DO NOTHING)
-- =============================================================================
-- 1a. Every class_students row -> class_enrollments (missing rows only).
INSERT INTO "public"."class_enrollments" ("class_id", "student_id", "is_active")
SELECT cs."class_id", cs."student_id", COALESCE(cs."is_active", true)
  FROM "public"."class_students" cs
ON CONFLICT ("class_id", "student_id") DO NOTHING;

-- 1b. Every class_enrollments row -> class_students (missing rows only).
INSERT INTO "public"."class_students" ("class_id", "student_id", "is_active")
SELECT ce."class_id", ce."student_id", COALESCE(ce."is_active", true)
  FROM "public"."class_enrollments" ce
ON CONFLICT ("class_id", "student_id") DO NOTHING;

-- =============================================================================
-- 2. MIRROR TRIGGER FUNCTIONS (SECURITY DEFINER — see header justification)
-- =============================================================================
-- 2a. class_students INSERT -> mirror into class_enrollments.
CREATE OR REPLACE FUNCTION "public"."sync_class_students_to_enrollments"()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
BEGIN
  INSERT INTO public.class_enrollments (class_id, student_id, is_active)
  VALUES (NEW.class_id, NEW.student_id, COALESCE(NEW.is_active, true))
  ON CONFLICT (class_id, student_id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- 2b. class_enrollments INSERT -> mirror into class_students.
CREATE OR REPLACE FUNCTION "public"."sync_class_enrollments_to_students"()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
BEGIN
  INSERT INTO public.class_students (class_id, student_id, is_active)
  VALUES (NEW.class_id, NEW.student_id, COALESCE(NEW.is_active, true))
  ON CONFLICT (class_id, student_id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- =============================================================================
-- 3. AFTER INSERT TRIGGERS (each direction; idempotent re-create)
-- =============================================================================
DROP TRIGGER IF EXISTS "trg_sync_class_students_to_enrollments" ON "public"."class_students";
CREATE TRIGGER "trg_sync_class_students_to_enrollments"
  AFTER INSERT ON "public"."class_students"
  FOR EACH ROW EXECUTE FUNCTION "public"."sync_class_students_to_enrollments"();

DROP TRIGGER IF EXISTS "trg_sync_class_enrollments_to_students" ON "public"."class_enrollments";
CREATE TRIGGER "trg_sync_class_enrollments_to_students"
  AFTER INSERT ON "public"."class_enrollments"
  FOR EACH ROW EXECUTE FUNCTION "public"."sync_class_enrollments_to_students"();

COMMIT;

-- ─── Verify (manual checks after applying) ───────────────────────────────────
-- 1. After backfill the two rosters have the same (class_id, student_id) set:
--    SELECT count(*) FROM (
--      SELECT class_id, student_id FROM class_students
--      EXCEPT SELECT class_id, student_id FROM class_enrollments) d;  -- expect 0
--    SELECT count(*) FROM (
--      SELECT class_id, student_id FROM class_enrollments
--      EXCEPT SELECT class_id, student_id FROM class_students) d;     -- expect 0
-- 2. Insert via class_students -> appears in class_enrollments (and vice versa),
--    with no infinite recursion (insert returns immediately).
-- 3. Re-inserting an existing pair on either table is a harmless no-op (no error,
--    no duplicate, no trigger storm).
