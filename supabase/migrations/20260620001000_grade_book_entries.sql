-- Migration: 20260620001000_grade_book_entries.sql
-- Purpose: Teacher-portal completeness FIX 1 — make gradebook cell saves persist.
--
--          Today `set_grade_book_cell` in the teacher-dashboard Edge Function
--          only (a) emits a `teacher.grade_entry_set` state-event and (b) for
--          SUBJECT columns writes a *derived* row into `score_history`. There is
--          no first-class gradebook store, so:
--            * attendance / unit columns are not persisted at all (event only),
--            * a saved subject cell is reconstructed from score_history by
--              get_grade_book, but the saved max_score / column semantics are
--              lost (score_history is normalised 0-100), and
--            * any non-subject cell shows the saved value on the 200 response
--              then VANISHES on reload (get_grade_book rebuilds the matrix purely
--              from score_history / assignment_submissions).
--          This migration introduces the canonical first-class store
--          `grade_book_entries` keyed UNIQUE(class_id, student_id, column_key) so
--          set_grade_book_cell can UPSERT and get_grade_book can merge the saved
--          cell over the derived matrix — closing the "save → reload → gone" bug.
--
-- ─── Column shape aligned to the Edge Function handlers ──────────────────────
--   set_grade_book_cell (UPSERT target): class_id, student_id, column_key, score,
--                                         max_score, teacher_id, updated_at.
--     onConflict:'class_id,student_id,column_key' -> needs the UNIQUE below.
--   get_grade_book (merge read): SELECT student_id, column_key, score, max_score
--                                 WHERE class_id = <class> AND student_id IN (...).
--   Column types verified against the live schema (npx supabase db query --linked):
--     class_students.class_id   uuid, class_students.student_id uuid (the roster
--                               join; there is NO students.class_id column),
--     class_teachers.class_id   uuid, class_teachers.teacher_id uuid,
--     students.id               uuid, teachers.id uuid, classes.id uuid.
--   `column_key` is text (e.g. a lowercased subject code, or the literal
--   'attendance' / a future 'unit:<n>'); `score` / `max_score` are numeric to
--   carry raw points (score_history.score is constrained 0-100; the gradebook
--   stores the teacher's raw points + the column's denominator faithfully).
--
-- ─── Scope / safety contract (HARD CONSTRAINTS) ──────────────────────────────
--   - ADDITIVE ONLY. New table. No DROP / DELETE / UPDATE / TRUNCATE of any
--     existing object. No change to score_history / the event emit (preserved).
--   - IDEMPOTENT / replayable: CREATE TABLE IF NOT EXISTS; the UNIQUE constraint
--     via a guarded DO-block; policies via DROP POLICY IF EXISTS + CREATE;
--     indexes via IF NOT EXISTS; trigger via DROP TRIGGER IF EXISTS + CREATE.
--     Safe to replay on PROD, main-staging, CI live-DB, and fresh DBs.
--   - RLS ENABLED IN THIS SAME MIGRATION (P8). Policies below.
--   - Grades are NOT stored here (P5 N/A); column_key/score are gradebook cells.
--   - No scoring/XP/mastery math touched (P1/P2 unaffected): score/max_score are
--     teacher-entered raw points, not quiz scores; nothing reads them into XP.
--
-- ─── RLS policy design (P8 / P13) ────────────────────────────────────────────
--   This is teacher-owned classroom data keyed by (class_id, student_id,
--   column_key). The single data boundary is "does the calling teacher own this
--   class?" — direct or co-taught ownership lives in `class_teachers`, mirrored
--   exactly from the live `assignments` / `class_teachers` teacher policies:
--     class_id IN (SELECT ct.class_id FROM class_teachers ct
--                    JOIN teachers t ON t.id = ct.teacher_id
--                   WHERE t.auth_user_id = auth.uid())
--   Policies:
--     * teacher SELECT/INSERT/UPDATE/DELETE own class  -> class_teachers boundary
--     * service_role ALL                               -> the Edge Function uses
--                                                         the service-role client
--                                                         (SERVICE_CLIENT) for
--                                                         the UPSERT + merge read,
--                                                         so service_role must
--                                                         have full access; this
--                                                         is the actual runtime
--                                                         path. The teacher-scoped
--                                                         policies additionally
--                                                         permit a direct
--                                                         RLS-respecting client
--                                                         read if ever wired.
--   NOTE: the four-pattern checklist's "student own / parent linked" patterns do
--   NOT apply — gradebook cells are teacher-authored classroom data; students and
--   parents have no write interest and read it only through derived, redacted
--   surfaces. Admin access is via the service_role policy.
--
-- Owner: backend. Teacher-portal completeness FIX 1 (gradebook persistence).
-- NOTE TO ORCHESTRATOR: this migration needs APPLYING and the teacher-dashboard
-- Edge Function needs REDEPLOY on merge (not done here).

BEGIN;

-- =============================================================================
-- 1. TABLE
-- =============================================================================
CREATE TABLE IF NOT EXISTS "public"."grade_book_entries" (
  "id"         uuid        NOT NULL DEFAULT gen_random_uuid(),
  "class_id"   uuid        NOT NULL REFERENCES "public"."classes"("id")   ON DELETE CASCADE,
  "student_id" uuid        NOT NULL REFERENCES "public"."students"("id")  ON DELETE CASCADE,
  "column_key" text        NOT NULL,
  "score"      numeric,
  "max_score"  numeric,
  "teacher_id" uuid        REFERENCES "public"."teachers"("id") ON DELETE SET NULL,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "grade_book_entries_pkey" PRIMARY KEY ("id")
);

-- UNIQUE(class_id, student_id, column_key) — required so the Edge Function's
-- onConflict:'class_id,student_id,column_key' upsert resolves. Added via a
-- guarded DO-block (ADD CONSTRAINT has no IF NOT EXISTS) so replay is a no-op.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'grade_book_entries_class_student_column_key'
       AND conrelid = 'public.grade_book_entries'::regclass
  ) THEN
    ALTER TABLE "public"."grade_book_entries"
      ADD CONSTRAINT "grade_book_entries_class_student_column_key"
      UNIQUE ("class_id", "student_id", "column_key");
  END IF;
END $$;

-- =============================================================================
-- 2. RLS (mandatory — P8)
-- =============================================================================
ALTER TABLE "public"."grade_book_entries" ENABLE ROW LEVEL SECURITY;

-- Teacher reads cells for a class they own (direct or co-taught via
-- class_teachers). Boundary mirrored from the live assignments/class_teachers
-- teacher policies.
DROP POLICY IF EXISTS "grade_book_entries_teacher_select" ON "public"."grade_book_entries";
CREATE POLICY "grade_book_entries_teacher_select"
  ON "public"."grade_book_entries"
  FOR SELECT TO "authenticated"
  USING (
    "class_id" IN (
      SELECT ct."class_id"
        FROM "public"."class_teachers" ct
        JOIN "public"."teachers" t ON t."id" = ct."teacher_id"
       WHERE t."auth_user_id" = auth.uid()
    )
  );

-- Teacher inserts cells for a class they own.
DROP POLICY IF EXISTS "grade_book_entries_teacher_insert" ON "public"."grade_book_entries";
CREATE POLICY "grade_book_entries_teacher_insert"
  ON "public"."grade_book_entries"
  FOR INSERT TO "authenticated"
  WITH CHECK (
    "class_id" IN (
      SELECT ct."class_id"
        FROM "public"."class_teachers" ct
        JOIN "public"."teachers" t ON t."id" = ct."teacher_id"
       WHERE t."auth_user_id" = auth.uid()
    )
  );

-- Teacher updates cells for a class they own (the upsert's UPDATE branch).
DROP POLICY IF EXISTS "grade_book_entries_teacher_update" ON "public"."grade_book_entries";
CREATE POLICY "grade_book_entries_teacher_update"
  ON "public"."grade_book_entries"
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

-- Teacher deletes cells for a class they own (clearing a cell).
DROP POLICY IF EXISTS "grade_book_entries_teacher_delete" ON "public"."grade_book_entries";
CREATE POLICY "grade_book_entries_teacher_delete"
  ON "public"."grade_book_entries"
  FOR DELETE TO "authenticated"
  USING (
    "class_id" IN (
      SELECT ct."class_id"
        FROM "public"."class_teachers" ct
        JOIN "public"."teachers" t ON t."id" = ct."teacher_id"
       WHERE t."auth_user_id" = auth.uid()
    )
  );

-- Service role full access (the Edge Function's actual runtime path: the
-- service-role client UPSERTs the cell and merges on read). Admin access is via
-- the service role.
DROP POLICY IF EXISTS "grade_book_entries_service_role" ON "public"."grade_book_entries";
CREATE POLICY "grade_book_entries_service_role"
  ON "public"."grade_book_entries"
  TO "service_role"
  USING (true) WITH CHECK (true);

-- =============================================================================
-- 3. INDEXES
-- =============================================================================
-- The merge read in get_grade_book filters class_id + student_id IN (...). The
-- UNIQUE(class_id, student_id, column_key) constraint already provides a leading
-- (class_id, student_id) index for that lookup. Add an FK-supporting index on
-- student_id for the ON DELETE CASCADE path, and one on class_id alone.
CREATE INDEX IF NOT EXISTS "idx_grade_book_entries_class"
  ON "public"."grade_book_entries" ("class_id");
CREATE INDEX IF NOT EXISTS "idx_grade_book_entries_student"
  ON "public"."grade_book_entries" ("student_id");

-- =============================================================================
-- 4. updated_at trigger
-- =============================================================================
CREATE OR REPLACE FUNCTION "public"."update_grade_book_entries_updated_at"()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$ BEGIN NEW."updated_at" = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS "trg_grade_book_entries_updated_at" ON "public"."grade_book_entries";
CREATE TRIGGER "trg_grade_book_entries_updated_at"
  BEFORE UPDATE ON "public"."grade_book_entries"
  FOR EACH ROW EXECUTE FUNCTION "public"."update_grade_book_entries_updated_at"();

COMMIT;

-- ─── Verify (manual checks after applying) ───────────────────────────────────
-- 1. Table + unique constraint exist:
--    SELECT conname FROM pg_constraint
--     WHERE conrelid = 'public.grade_book_entries'::regclass ORDER BY conname;
--      -- expect grade_book_entries_pkey + grade_book_entries_class_student_column_key
-- 2. RLS enabled:
--    SELECT relrowsecurity FROM pg_class WHERE relname = 'grade_book_entries';  -- expect t
-- 3. set_grade_book_cell UPSERT resolves (onConflict class_id,student_id,column_key)
--    and a reload of get_grade_book within the term shows the saved cell merged
--    over the derived matrix (status 'graded', the saved score + max_score).
