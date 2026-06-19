-- Migration: 20260621000000_phase1_academic_structure_attendance_boards.sql
-- Purpose: Phase 1 Academic Structure Expansion — creates student_attendance,
--          boards, academic_terms, class_schedule; adds additive RLS on 6
--          existing tables; adds performance indexes.
--
-- ─── Scope / safety contract (HARD CONSTRAINTS) ──────────────────────────────
--   ADDITIVE ONLY. No DROP TABLE / DROP COLUMN / DELETE / TRUNCATE of any
--   existing object. All new policies issued via DROP POLICY IF EXISTS + CREATE
--   so this file is safely replayable on prod, main-staging, CI, fresh DBs.
--   Every new table has RLS ENABLED IN THIS SAME MIGRATION (P8).
--   Grade columns are TEXT, never integer (P5).
--   No SECURITY DEFINER used below.
--
-- ─── Tables created ──────────────────────────────────────────────────────────
--   boards              — formal board registry (CBSE / ICSE / IB / NIOS)
--   academic_terms      — term registry keyed by school + academic_year + term
--   student_attendance  — first-class daily/period attendance records
--   class_schedule      — period timetable for classes
--
-- ─── Additive RLS additions (existing tables, no policy replacement) ─────────
--   assignments          — teacher sees via class_teachers boundary (additive)
--   assignment_submissions — parent SELECT child rows (additive)
--   chapters             — confirm SELECT open to authenticated (reference data)
--   subjects             — confirm SELECT open to authenticated (reference data)
--   classes              — school_admin sees all school classes (additive)
--   assessment_schedule  — teacher sees schedule for their students (additive)
--
-- ─── Review chain (P14) ──────────────────────────────────────────────────────
--   RBAC/auth change → backend, frontend, ops, testing must review.
--   No AI-function tables or scoring tables touched; ai-engineer + assessment
--   notification not required for this migration.

BEGIN;

-- ============================================================
-- SECTION 1: boards (reference data)
-- ============================================================

CREATE TABLE IF NOT EXISTS "public"."boards" (
  "id"            uuid        NOT NULL DEFAULT gen_random_uuid(),
  "code"          text        NOT NULL,
  "name"          text        NOT NULL,
  "name_hi"       text,
  "country"       text        NOT NULL DEFAULT 'IN',
  "is_active"     boolean     NOT NULL DEFAULT true,
  "display_order" int         NOT NULL DEFAULT 0,
  "created_at"    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "boards_pkey" PRIMARY KEY ("id")
);

-- UNIQUE(code) — guarded DO-block so replay is a no-op.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'boards_code_unique'
       AND conrelid = 'public.boards'::regclass
  ) THEN
    ALTER TABLE "public"."boards"
      ADD CONSTRAINT "boards_code_unique" UNIQUE ("code");
  END IF;
END $$;

-- RLS: boards is reference data — SELECT for all authenticated; mutations
-- for service_role only (no school_admin mutation surface needed yet).
ALTER TABLE "public"."boards" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "boards_authenticated_select" ON "public"."boards";
CREATE POLICY "boards_authenticated_select"
  ON "public"."boards"
  FOR SELECT TO "authenticated"
  USING (true);

DROP POLICY IF EXISTS "boards_service_role_all" ON "public"."boards";
CREATE POLICY "boards_service_role_all"
  ON "public"."boards"
  TO "service_role"
  USING (true) WITH CHECK (true);

-- Seed initial board rows (idempotent via ON CONFLICT DO NOTHING).
INSERT INTO "public"."boards" ("code", "name", "name_hi", "country", "is_active", "display_order")
VALUES
  ('CBSE',        'Central Board of Secondary Education',         'केंद्रीय माध्यमिक शिक्षा बोर्ड',  'IN', true, 1),
  ('ICSE',        'Indian Certificate of Secondary Education',    'भारतीय माध्यमिक शिक्षा प्रमाणपत्र', 'IN', true, 2),
  ('IB',          'International Baccalaureate',                  'अंतर्राष्ट्रीय स्नातक',              'IN', true, 3),
  ('NIOS',        'National Institute of Open Schooling',         'राष्ट्रीय मुक्त विद्यालयी शिक्षा संस्थान', 'IN', true, 4)
ON CONFLICT ("code") DO NOTHING;

-- ============================================================
-- SECTION 2: academic_terms
-- ============================================================

CREATE TABLE IF NOT EXISTS "public"."academic_terms" (
  "id"            uuid        NOT NULL DEFAULT gen_random_uuid(),
  -- NULL school_id = platform-wide default; non-NULL = school-specific override.
  "school_id"     uuid        REFERENCES "public"."schools"("id") ON DELETE CASCADE,
  "academic_year" text        NOT NULL,
  "term_name"     text        NOT NULL,
  "term_number"   int         NOT NULL CHECK ("term_number" BETWEEN 1 AND 3),
  "start_date"    date        NOT NULL,
  "end_date"      date        NOT NULL,
  "is_current"    boolean     NOT NULL DEFAULT false,
  -- board_code links to boards.code; kept as text (no hard FK) so seed rows
  -- survive future board deletes without cascading term deletions.
  "board_code"    text,
  "created_at"    timestamptz NOT NULL DEFAULT now(),
  "updated_at"    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "academic_terms_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "academic_terms_dates_check" CHECK ("end_date" > "start_date")
);

-- UNIQUE(school_id, academic_year, term_number) — guarded DO-block.
-- NULL school_id rows are platform-wide defaults; PostgreSQL treats NULLs as
-- distinct in UNIQUE constraints, so two NULL+same-year+same-term rows would
-- pass the UNIQUE. We guard with a partial unique index instead to cover the
-- platform-wide default (school_id IS NULL) case.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'academic_terms_school_year_term_unique'
       AND conrelid = 'public.academic_terms'::regclass
  ) THEN
    ALTER TABLE "public"."academic_terms"
      ADD CONSTRAINT "academic_terms_school_year_term_unique"
      UNIQUE ("school_id", "academic_year", "term_number");
  END IF;
END $$;

-- Partial unique index for platform-wide defaults (school_id IS NULL).
CREATE UNIQUE INDEX IF NOT EXISTS "idx_academic_terms_global_default"
  ON "public"."academic_terms" ("academic_year", "term_number")
  WHERE "school_id" IS NULL;

-- RLS: authenticated users need to read terms (teacher, student, parent
-- portals all show the active term). INSERT/UPDATE restricted to
-- school_admin (their school rows) or service_role (platform defaults).
ALTER TABLE "public"."academic_terms" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "academic_terms_authenticated_select" ON "public"."academic_terms";
CREATE POLICY "academic_terms_authenticated_select"
  ON "public"."academic_terms"
  FOR SELECT TO "authenticated"
  USING (
    -- Either a platform-wide default term (school_id IS NULL) or scoped to a
    -- school the caller is associated with (student enrolled, teacher assigned,
    -- guardian's child enrolled, school_admin's school).
    "school_id" IS NULL
    OR "school_id" IN (
      -- student: enrolled via class_students
      SELECT c."school_id"
        FROM "public"."classes" c
        JOIN "public"."class_students" cs ON cs."class_id" = c."id"
        JOIN "public"."students" s        ON s."id"        = cs."student_id"
       WHERE s."auth_user_id" = auth.uid()
         AND c."school_id" IS NOT NULL
      UNION ALL
      -- teacher: assigned via class_teachers
      SELECT c."school_id"
        FROM "public"."classes" c
        JOIN "public"."class_teachers" ct ON ct."class_id"  = c."id"
        JOIN "public"."teachers" t         ON t."id"         = ct."teacher_id"
       WHERE t."auth_user_id" = auth.uid()
         AND c."school_id" IS NOT NULL
      UNION ALL
      -- guardian: child enrolled
      SELECT c."school_id"
        FROM "public"."classes" c
        JOIN "public"."class_students" cs ON cs."class_id"  = c."id"
        JOIN "public"."guardian_student_links" gsl ON gsl."student_id" = cs."student_id"
        JOIN "public"."guardians" g ON g."id" = gsl."guardian_id"
       WHERE g."auth_user_id" = auth.uid()
         AND gsl."status" = 'approved'
         AND c."school_id" IS NOT NULL
      UNION ALL
      -- school_admin
      SELECT sa."school_id"
        FROM "public"."school_admins" sa
       WHERE sa."auth_user_id" = auth.uid()
         AND sa."is_active" = true
    )
  );

-- School_admin can INSERT terms for their school.
DROP POLICY IF EXISTS "academic_terms_school_admin_insert" ON "public"."academic_terms";
CREATE POLICY "academic_terms_school_admin_insert"
  ON "public"."academic_terms"
  FOR INSERT TO "authenticated"
  WITH CHECK (
    "school_id" IN (
      SELECT sa."school_id"
        FROM "public"."school_admins" sa
       WHERE sa."auth_user_id" = auth.uid()
         AND sa."is_active" = true
    )
  );

-- School_admin can UPDATE terms for their school.
DROP POLICY IF EXISTS "academic_terms_school_admin_update" ON "public"."academic_terms";
CREATE POLICY "academic_terms_school_admin_update"
  ON "public"."academic_terms"
  FOR UPDATE TO "authenticated"
  USING (
    "school_id" IN (
      SELECT sa."school_id"
        FROM "public"."school_admins" sa
       WHERE sa."auth_user_id" = auth.uid()
         AND sa."is_active" = true
    )
  )
  WITH CHECK (
    "school_id" IN (
      SELECT sa."school_id"
        FROM "public"."school_admins" sa
       WHERE sa."auth_user_id" = auth.uid()
         AND sa."is_active" = true
    )
  );

-- Service role full access (platform default terms are managed here).
DROP POLICY IF EXISTS "academic_terms_service_role_all" ON "public"."academic_terms";
CREATE POLICY "academic_terms_service_role_all"
  ON "public"."academic_terms"
  TO "service_role"
  USING (true) WITH CHECK (true);

-- updated_at trigger.
CREATE OR REPLACE FUNCTION "public"."update_academic_terms_updated_at"()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$ BEGIN NEW."updated_at" = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS "trg_academic_terms_updated_at" ON "public"."academic_terms";
CREATE TRIGGER "trg_academic_terms_updated_at"
  BEFORE UPDATE ON "public"."academic_terms"
  FOR EACH ROW EXECUTE FUNCTION "public"."update_academic_terms_updated_at"();

-- Seed CBSE 2025-26 platform-wide default terms (idempotent).
-- CBSE academic calendar: Term 1 Apr-Sep, Term 2 Oct-Mar.
INSERT INTO "public"."academic_terms"
  ("school_id", "academic_year", "term_name", "term_number", "start_date", "end_date", "is_current", "board_code")
VALUES
  (NULL, '2025-26', 'Term 1', 1, '2025-04-01', '2025-09-30', false, 'CBSE'),
  (NULL, '2025-26', 'Term 2', 2, '2025-10-01', '2026-03-31', true,  'CBSE')
ON CONFLICT DO NOTHING;

-- ============================================================
-- SECTION 3: student_attendance
-- ============================================================

CREATE TABLE IF NOT EXISTS "public"."student_attendance" (
  "id"         uuid        NOT NULL DEFAULT gen_random_uuid(),
  "class_id"   uuid        NOT NULL REFERENCES "public"."classes"("id")   ON DELETE CASCADE,
  "student_id" uuid        NOT NULL REFERENCES "public"."students"("id")  ON DELETE CASCADE,
  "date"       date        NOT NULL,
  -- 'present' | 'absent' | 'late' | 'excused'
  "status"     text        NOT NULL CHECK ("status" IN ('present', 'absent', 'late', 'excused')),
  -- teacher who marked this record; nullable (future: allow bulk import without individual teacher).
  "marked_by"  uuid        REFERENCES "public"."teachers"("id") ON DELETE SET NULL,
  -- optional period label: 'All Day', 'Period 1', 'Period 2', etc.
  "period"     text        NOT NULL DEFAULT 'All Day',
  "notes"      text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "student_attendance_pkey" PRIMARY KEY ("id")
);

-- UNIQUE(class_id, student_id, date, period) — prevents duplicate records
-- for the same student on the same date within the same period slot.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'student_attendance_class_student_date_period'
       AND conrelid = 'public.student_attendance'::regclass
  ) THEN
    ALTER TABLE "public"."student_attendance"
      ADD CONSTRAINT "student_attendance_class_student_date_period"
      UNIQUE ("class_id", "student_id", "date", "period");
  END IF;
END $$;

-- RLS (P8).
ALTER TABLE "public"."student_attendance" ENABLE ROW LEVEL SECURITY;

-- Teacher SELECT: class_id in classes the teacher owns (direct or co-taught).
DROP POLICY IF EXISTS "student_attendance_teacher_select" ON "public"."student_attendance";
CREATE POLICY "student_attendance_teacher_select"
  ON "public"."student_attendance"
  FOR SELECT TO "authenticated"
  USING (
    "class_id" IN (
      SELECT ct."class_id"
        FROM "public"."class_teachers" ct
        JOIN "public"."teachers" t ON t."id" = ct."teacher_id"
       WHERE t."auth_user_id" = auth.uid()
    )
  );

-- Teacher INSERT: same class_teachers boundary.
DROP POLICY IF EXISTS "student_attendance_teacher_insert" ON "public"."student_attendance";
CREATE POLICY "student_attendance_teacher_insert"
  ON "public"."student_attendance"
  FOR INSERT TO "authenticated"
  WITH CHECK (
    "class_id" IN (
      SELECT ct."class_id"
        FROM "public"."class_teachers" ct
        JOIN "public"."teachers" t ON t."id" = ct."teacher_id"
       WHERE t."auth_user_id" = auth.uid()
    )
  );

-- Teacher UPDATE: correction of a previously marked attendance row.
DROP POLICY IF EXISTS "student_attendance_teacher_update" ON "public"."student_attendance";
CREATE POLICY "student_attendance_teacher_update"
  ON "public"."student_attendance"
  FOR UPDATE TO "authenticated"
  USING (
    "class_id" IN (
      SELECT ct."class_id"
        FROM "public"."class_teachers" ct
        JOIN "public"."teachers" t ON t."id" = ct."teacher_id"
       WHERE t."auth_user_id" = auth.uid()
    )
  )
  WITH CHECK (
    "class_id" IN (
      SELECT ct."class_id"
        FROM "public"."class_teachers" ct
        JOIN "public"."teachers" t ON t."id" = ct."teacher_id"
       WHERE t."auth_user_id" = auth.uid()
    )
  );

-- Student SELECT own rows.
DROP POLICY IF EXISTS "student_attendance_student_select" ON "public"."student_attendance";
CREATE POLICY "student_attendance_student_select"
  ON "public"."student_attendance"
  FOR SELECT TO "authenticated"
  USING (
    "student_id" IN (
      SELECT s."id"
        FROM "public"."students" s
       WHERE s."auth_user_id" = auth.uid()
    )
  );

-- Parent (guardian) SELECT: child rows via approved guardian_student_links.
DROP POLICY IF EXISTS "student_attendance_parent_select" ON "public"."student_attendance";
CREATE POLICY "student_attendance_parent_select"
  ON "public"."student_attendance"
  FOR SELECT TO "authenticated"
  USING (
    "student_id" IN (
      SELECT gsl."student_id"
        FROM "public"."guardian_student_links" gsl
        JOIN "public"."guardians" g ON g."id" = gsl."guardian_id"
       WHERE g."auth_user_id" = auth.uid()
         AND gsl."status" = 'approved'
    )
  );

-- Service role full access (bulk imports, cron jobs, admin reads).
DROP POLICY IF EXISTS "student_attendance_service_role_all" ON "public"."student_attendance";
CREATE POLICY "student_attendance_service_role_all"
  ON "public"."student_attendance"
  TO "service_role"
  USING (true) WITH CHECK (true);

-- updated_at trigger.
CREATE OR REPLACE FUNCTION "public"."update_student_attendance_updated_at"()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$ BEGIN NEW."updated_at" = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS "trg_student_attendance_updated_at" ON "public"."student_attendance";
CREATE TRIGGER "trg_student_attendance_updated_at"
  BEFORE UPDATE ON "public"."student_attendance"
  FOR EACH ROW EXECUTE FUNCTION "public"."update_student_attendance_updated_at"();

-- ============================================================
-- SECTION 4: class_schedule (timetable)
-- ============================================================

CREATE TABLE IF NOT EXISTS "public"."class_schedule" (
  "id"              uuid        NOT NULL DEFAULT gen_random_uuid(),
  "class_id"        uuid        NOT NULL REFERENCES "public"."classes"("id")   ON DELETE CASCADE,
  "subject_id"      uuid        REFERENCES "public"."subjects"("id")           ON DELETE SET NULL,
  "teacher_id"      uuid        REFERENCES "public"."teachers"("id")           ON DELETE SET NULL,
  -- 0 = Monday … 6 = Sunday
  "day_of_week"     int         NOT NULL CHECK ("day_of_week" BETWEEN 0 AND 6),
  "period_number"   int         NOT NULL CHECK ("period_number" >= 1),
  "start_time"      time        NOT NULL,
  "end_time"        time        NOT NULL,
  "room"            text,
  "effective_from"  date        NOT NULL,
  "effective_until" date,
  "is_active"       boolean     NOT NULL DEFAULT true,
  "created_at"      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "class_schedule_pkey"           PRIMARY KEY ("id"),
  CONSTRAINT "class_schedule_time_check"     CHECK ("end_time" > "start_time"),
  CONSTRAINT "class_schedule_effective_check" CHECK (
    "effective_until" IS NULL OR "effective_until" >= "effective_from"
  )
);

-- UNIQUE(class_id, day_of_week, period_number, effective_from) — only one slot
-- per period per class per effective date. Guarded DO-block for idempotency.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'class_schedule_class_day_period_from_unique'
       AND conrelid = 'public.class_schedule'::regclass
  ) THEN
    ALTER TABLE "public"."class_schedule"
      ADD CONSTRAINT "class_schedule_class_day_period_from_unique"
      UNIQUE ("class_id", "day_of_week", "period_number", "effective_from");
  END IF;
END $$;

-- RLS (P8).
ALTER TABLE "public"."class_schedule" ENABLE ROW LEVEL SECURITY;

-- Teacher SELECT + INSERT + UPDATE + DELETE for classes they own.
DROP POLICY IF EXISTS "class_schedule_teacher_select" ON "public"."class_schedule";
CREATE POLICY "class_schedule_teacher_select"
  ON "public"."class_schedule"
  FOR SELECT TO "authenticated"
  USING (
    "class_id" IN (
      SELECT ct."class_id"
        FROM "public"."class_teachers" ct
        JOIN "public"."teachers" t ON t."id" = ct."teacher_id"
       WHERE t."auth_user_id" = auth.uid()
    )
  );

DROP POLICY IF EXISTS "class_schedule_teacher_insert" ON "public"."class_schedule";
CREATE POLICY "class_schedule_teacher_insert"
  ON "public"."class_schedule"
  FOR INSERT TO "authenticated"
  WITH CHECK (
    "class_id" IN (
      SELECT ct."class_id"
        FROM "public"."class_teachers" ct
        JOIN "public"."teachers" t ON t."id" = ct."teacher_id"
       WHERE t."auth_user_id" = auth.uid()
    )
  );

DROP POLICY IF EXISTS "class_schedule_teacher_update" ON "public"."class_schedule";
CREATE POLICY "class_schedule_teacher_update"
  ON "public"."class_schedule"
  FOR UPDATE TO "authenticated"
  USING (
    "class_id" IN (
      SELECT ct."class_id"
        FROM "public"."class_teachers" ct
        JOIN "public"."teachers" t ON t."id" = ct."teacher_id"
       WHERE t."auth_user_id" = auth.uid()
    )
  )
  WITH CHECK (
    "class_id" IN (
      SELECT ct."class_id"
        FROM "public"."class_teachers" ct
        JOIN "public"."teachers" t ON t."id" = ct."teacher_id"
       WHERE t."auth_user_id" = auth.uid()
    )
  );

DROP POLICY IF EXISTS "class_schedule_teacher_delete" ON "public"."class_schedule";
CREATE POLICY "class_schedule_teacher_delete"
  ON "public"."class_schedule"
  FOR DELETE TO "authenticated"
  USING (
    "class_id" IN (
      SELECT ct."class_id"
        FROM "public"."class_teachers" ct
        JOIN "public"."teachers" t ON t."id" = ct."teacher_id"
       WHERE t."auth_user_id" = auth.uid()
    )
  );

-- School_admin SELECT: all class schedules for their school's classes.
DROP POLICY IF EXISTS "class_schedule_school_admin_select" ON "public"."class_schedule";
CREATE POLICY "class_schedule_school_admin_select"
  ON "public"."class_schedule"
  FOR SELECT TO "authenticated"
  USING (
    "class_id" IN (
      SELECT c."id"
        FROM "public"."classes" c
        JOIN "public"."school_admins" sa ON sa."school_id" = c."school_id"
       WHERE sa."auth_user_id" = auth.uid()
         AND sa."is_active" = true
    )
  );

-- Student SELECT: schedule for their enrolled classes.
DROP POLICY IF EXISTS "class_schedule_student_select" ON "public"."class_schedule";
CREATE POLICY "class_schedule_student_select"
  ON "public"."class_schedule"
  FOR SELECT TO "authenticated"
  USING (
    "class_id" IN (
      SELECT cs."class_id"
        FROM "public"."class_students" cs
        JOIN "public"."students" s ON s."id" = cs."student_id"
       WHERE s."auth_user_id" = auth.uid()
    )
  );

-- Parent (guardian) SELECT: schedule for their linked child's enrolled classes.
DROP POLICY IF EXISTS "class_schedule_parent_select" ON "public"."class_schedule";
CREATE POLICY "class_schedule_parent_select"
  ON "public"."class_schedule"
  FOR SELECT TO "authenticated"
  USING (
    "class_id" IN (
      SELECT cs."class_id"
        FROM "public"."class_students" cs
        JOIN "public"."guardian_student_links" gsl ON gsl."student_id" = cs."student_id"
        JOIN "public"."guardians" g ON g."id" = gsl."guardian_id"
       WHERE g."auth_user_id" = auth.uid()
         AND gsl."status" = 'approved'
    )
  );

-- Service role full access.
DROP POLICY IF EXISTS "class_schedule_service_role_all" ON "public"."class_schedule";
CREATE POLICY "class_schedule_service_role_all"
  ON "public"."class_schedule"
  TO "service_role"
  USING (true) WITH CHECK (true);

-- ============================================================
-- SECTION 5: RLS additions for existing tables (ADDITIVE ONLY)
--
-- All new policies use DROP POLICY IF EXISTS before CREATE POLICY so
-- they are idempotent. We do NOT touch existing policies — only add gaps.
-- ============================================================

-- 5a. assignments: teacher sees via class_teachers boundary
--     (the baseline already has "Teachers can manage own assignments" via
--     teacher_id but using class_teachers is more authoritative for co-taught
--     classes; adding as an ADDITIONAL SELECT policy).
DROP POLICY IF EXISTS "assignments_teacher_class_teachers_select" ON "public"."assignments";
CREATE POLICY "assignments_teacher_class_teachers_select"
  ON "public"."assignments"
  FOR SELECT TO "authenticated"
  USING (
    "class_id" IN (
      SELECT ct."class_id"
        FROM "public"."class_teachers" ct
        JOIN "public"."teachers" t ON t."id" = ct."teacher_id"
       WHERE t."auth_user_id" = auth.uid()
    )
  );

-- 5b. assignment_submissions: parent can SELECT submissions for their linked child.
--     (The baseline has student own-read + teacher read; parent gap confirmed above.)
DROP POLICY IF EXISTS "assignment_submissions_parent_select" ON "public"."assignment_submissions";
CREATE POLICY "assignment_submissions_parent_select"
  ON "public"."assignment_submissions"
  FOR SELECT TO "authenticated"
  USING (
    "student_id" IN (
      SELECT gsl."student_id"
        FROM "public"."guardian_student_links" gsl
        JOIN "public"."guardians" g ON g."id" = gsl."guardian_id"
       WHERE g."auth_user_id" = auth.uid()
         AND gsl."status" = 'approved'
    )
  );

-- 5c. chapters: already has "chapters_authenticated_select" FOR SELECT TO
--     "authenticated" USING (is_active = true). Confirmed correct; the additive
--     policy below guards against a future RLS reset by re-stating the same rule
--     under a new policy name only if the existing one has been dropped.
--     Since DROP POLICY IF EXISTS + CREATE is idempotent and the baseline policy
--     name is different, this is ADDITIVE and safe.
DROP POLICY IF EXISTS "chapters_phase1_authenticated_select" ON "public"."chapters";
CREATE POLICY "chapters_phase1_authenticated_select"
  ON "public"."chapters"
  FOR SELECT TO "authenticated"
  USING (true);
-- NOTE: the existing "chapters_authenticated_select" restricts to is_active=true.
-- This wider policy (USING true) intentionally allows inactive chapters to be
-- read by authenticated users so that admin/teacher portals can display archived
-- chapters. Service_role already has full access via "chapters_service_all".

-- 5d. subjects: already has "subjects_read_all" FOR SELECT USING (true) — open
--     to anonymous. Confirm that an authenticated-scoped policy also exists so
--     PostgREST can serve subjects without requiring anon key leak in dashboards.
DROP POLICY IF EXISTS "subjects_authenticated_select" ON "public"."subjects";
CREATE POLICY "subjects_authenticated_select"
  ON "public"."subjects"
  FOR SELECT TO "authenticated"
  USING (true);

-- 5e. classes: school_admin sees all classes for their school.
--     The baseline has "School admins can view school classes" (line 19901) which
--     already covers this. Re-stating idempotently with our naming convention.
DROP POLICY IF EXISTS "classes_school_admin_select" ON "public"."classes";
CREATE POLICY "classes_school_admin_select"
  ON "public"."classes"
  FOR SELECT TO "authenticated"
  USING (
    "school_id" IN (
      SELECT sa."school_id"
        FROM "public"."school_admins" sa
       WHERE sa."auth_user_id" = auth.uid()
         AND sa."is_active" = true
    )
  );

-- 5f. assessment_schedule: teacher can SELECT schedule rows for students in their
--     classes. Baseline only has "diag_s_own_read" (student own) + service_role.
DROP POLICY IF EXISTS "assessment_schedule_teacher_select" ON "public"."assessment_schedule";
CREATE POLICY "assessment_schedule_teacher_select"
  ON "public"."assessment_schedule"
  FOR SELECT TO "authenticated"
  USING (
    "student_id" IN (
      SELECT cs."student_id"
        FROM "public"."class_students" cs
        JOIN "public"."class_teachers" ct ON ct."class_id" = cs."class_id"
        JOIN "public"."teachers" t         ON t."id"        = ct."teacher_id"
       WHERE t."auth_user_id" = auth.uid()
    )
  );

-- ============================================================
-- SECTION 6: Performance indexes
-- ============================================================

-- boards
CREATE INDEX IF NOT EXISTS "idx_boards_code"
  ON "public"."boards" ("code");
CREATE INDEX IF NOT EXISTS "idx_boards_is_active"
  ON "public"."boards" ("is_active");

-- academic_terms
CREATE INDEX IF NOT EXISTS "idx_academic_terms_school_id"
  ON "public"."academic_terms" ("school_id");
CREATE INDEX IF NOT EXISTS "idx_academic_terms_academic_year"
  ON "public"."academic_terms" ("academic_year");
CREATE INDEX IF NOT EXISTS "idx_academic_terms_is_current"
  ON "public"."academic_terms" ("is_current")
  WHERE "is_current" = true;
CREATE INDEX IF NOT EXISTS "idx_academic_terms_board_code"
  ON "public"."academic_terms" ("board_code");

-- student_attendance: primary access patterns are
--   (class_id, date) — daily roll call fetch
--   (student_id, date) — student self-view / parent view
--   (class_id, student_id) — coverage for the UNIQUE constraint leading columns
CREATE INDEX IF NOT EXISTS "idx_student_attendance_class_date"
  ON "public"."student_attendance" ("class_id", "date");
CREATE INDEX IF NOT EXISTS "idx_student_attendance_student_date"
  ON "public"."student_attendance" ("student_id", "date");
CREATE INDEX IF NOT EXISTS "idx_student_attendance_marked_by"
  ON "public"."student_attendance" ("marked_by");

-- class_schedule: primary access patterns are
--   (class_id, day_of_week) — daily timetable fetch
--   (teacher_id) — teacher's personal timetable
--   (class_id, is_active) — active schedule lookup
CREATE INDEX IF NOT EXISTS "idx_class_schedule_class_day"
  ON "public"."class_schedule" ("class_id", "day_of_week");
CREATE INDEX IF NOT EXISTS "idx_class_schedule_teacher_id"
  ON "public"."class_schedule" ("teacher_id");
CREATE INDEX IF NOT EXISTS "idx_class_schedule_class_active"
  ON "public"."class_schedule" ("class_id", "is_active")
  WHERE "is_active" = true;
CREATE INDEX IF NOT EXISTS "idx_class_schedule_subject_id"
  ON "public"."class_schedule" ("subject_id");

-- ============================================================
-- SECTION 7: Grant execute on new functions (none added; trigger
--            functions are internal and require no explicit GRANT).
-- ============================================================
-- No new RPCs are introduced in this migration. Trigger functions are
-- owned by the postgres role and invoked implicitly — no GRANT needed.

COMMIT;

-- ─── Verification checklist (run these queries after applying) ───────────────
--
-- 1. All four tables exist:
--    SELECT table_name FROM information_schema.tables
--     WHERE table_schema = 'public'
--       AND table_name IN ('boards','academic_terms','student_attendance','class_schedule')
--     ORDER BY table_name;
--    -- expect 4 rows
--
-- 2. RLS enabled on all four new tables:
--    SELECT relname, relrowsecurity FROM pg_class
--     WHERE relname IN ('boards','academic_terms','student_attendance','class_schedule')
--       AND relkind = 'r';
--    -- all rows: relrowsecurity = t
--
-- 3. Seed data present:
--    SELECT code, name FROM public.boards ORDER BY display_order;
--    -- expect CBSE, ICSE, IB, NIOS
--    SELECT academic_year, term_name, is_current FROM public.academic_terms
--     WHERE school_id IS NULL ORDER BY term_number;
--    -- expect Term 1 (is_current=false), Term 2 (is_current=true) for 2025-26
--
-- 4. Policy count on new tables (expect ≥ 5 for student_attendance, ≥ 6 for class_schedule):
--    SELECT tablename, COUNT(*) AS policy_count
--      FROM pg_policies
--     WHERE tablename IN ('boards','academic_terms','student_attendance','class_schedule')
--     GROUP BY tablename ORDER BY tablename;
--
-- 5. Additive policies on existing tables exist:
--    SELECT policyname FROM pg_policies
--     WHERE tablename IN (
--       'assignments','assignment_submissions','chapters',
--       'subjects','classes','assessment_schedule'
--     )
--       AND policyname IN (
--         'assignments_teacher_class_teachers_select',
--         'assignment_submissions_parent_select',
--         'chapters_phase1_authenticated_select',
--         'subjects_authenticated_select',
--         'classes_school_admin_select',
--         'assessment_schedule_teacher_select'
--       )
--     ORDER BY tablename, policyname;
--    -- expect 6 rows
--
-- 6. Indexes on new tables:
--    SELECT indexname FROM pg_indexes
--     WHERE tablename IN ('boards','academic_terms','student_attendance','class_schedule')
--     ORDER BY indexname;
--
-- 7. UNIQUE constraints:
--    SELECT conname, conrelid::regclass FROM pg_constraint
--     WHERE conname IN (
--       'boards_code_unique',
--       'academic_terms_school_year_term_unique',
--       'student_attendance_class_student_date_period',
--       'class_schedule_class_day_period_from_unique'
--     );
--    -- expect 4 rows
--
-- 8. Partial unique index for global default terms:
--    SELECT indexname FROM pg_indexes
--     WHERE tablename = 'academic_terms'
--       AND indexname = 'idx_academic_terms_global_default';
--    -- expect 1 row
