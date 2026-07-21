-- Migration: 20260721000300_assignments_add_chapter_difficulty.sql
-- Purpose: Add the `chapter` and `difficulty` columns to public.assignments
--          that the teacher-facing create-assignment UI has been collecting
--          and writing since Phase B.5 (ADR-005), but which never existed on
--          the table.
--
-- ─── Bug being fixed ──────────────────────────────────────────────────────
-- The live `assignments` table (baseline `00000000000000_baseline_from_prod.sql:9904`)
-- has EXACTLY these columns:
--   id, class_id, teacher_id, title, description, assignment_type
--   (default 'practice'), topic_id, subject, grade, due_date,
--   time_limit_minutes, max_attempts (default 3), passing_score (default 70),
--   is_mandatory, show_answers_after, allow_late_submission,
--   randomize_questions, bloom_level, question_count (default 10),
--   status (default 'active'), created_at, updated_at
--
-- It has NO `chapter`, NO `difficulty`, NO `type`, and NO `is_active` column.
-- `POST /api/teacher/assignments` (src/app/api/teacher/assignments/route.ts)
-- inserted all four phantom columns on every call, and
-- `GET /teacher/submissions` (src/app/teacher/submissions/page.tsx) plus the
-- `teacher-dashboard` Edge Function's `teacherOwnsAssignment()` helper
-- explicitly SELECTed `chapter, difficulty, type` — none of which exist.
-- supabase-js does NOT throw on a write/read referencing a non-existent
-- column; it returns the error in the result object. The insert route
-- checked `insertErr` and correctly surfaced a 500 ("Failed to create
-- assignment") on EVERY call — this is the confirmed root cause of the
-- "Unable to create the assignment" report. The two SELECT sites failed
-- softer (silently degrading to false ownership / omitted fields).
--
-- ─── Fix shape ────────────────────────────────────────────────────────────
-- `chapter` and `difficulty` are genuine product fields the create-assignment
-- form collects (Chapter free-text, Difficulty easy/medium/hard) — added here
-- as real columns. `type` and `is_active` are NOT added: the table already
-- has equivalent columns (`assignment_type`, `status`) and the route/Edge
-- Function reads are updated in the same change to use those instead of
-- inventing redundant columns.
--
-- Additive only: two nullable columns (difficulty has a DEFAULT + CHECK),
-- no data migration, no change to any existing column, index, trigger, or to
-- the table's RLS posture.
--
-- RLS: UNCHANGED — no policy added or altered. `assignments` RLS is enforced
-- at the ROW level (baseline policies incl. "Service role full access on
-- assignments" + teacher/class-scoped policies); a simple ADD COLUMN with a
-- default does not change row visibility, so no new policy is needed.

-- 1. chapter — free-text chapter/topic label from the create-assignment form.
--    Nullable; the UI field is explicitly optional.
ALTER TABLE "public"."assignments"
  ADD COLUMN IF NOT EXISTS "chapter" "text";

-- 2. difficulty — teacher-selected difficulty band for the assignment.
--    Matches the Zod enum in the route (`easy` | `medium` | `hard`) and the
--    UI's three-button selector. Defaults to 'medium' (matches the route's
--    existing `body.difficulty ?? 'medium'` fallback) so any assignment
--    created before a caller sets this explicitly still reads a sane value.
ALTER TABLE "public"."assignments"
  ADD COLUMN IF NOT EXISTS "difficulty" "text" DEFAULT 'medium'::"text";

-- Permissive CHECK on difficulty: allow NULL + the three UI values. Guarded
-- so re-running the migration is a no-op instead of erroring on an
-- already-present constraint.
DO $$
BEGIN
  ALTER TABLE "public"."assignments"
    ADD CONSTRAINT "assignments_difficulty_check"
    CHECK (
      "difficulty" IS NULL OR "difficulty" = ANY (ARRAY[
        'easy'::"text",
        'medium'::"text",
        'hard'::"text"
      ])
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;  -- constraint already present; idempotent no-op
END
$$;

COMMENT ON COLUMN "public"."assignments"."chapter" IS
  'Optional free-text chapter/topic label collected by the teacher create-assignment form (src/app/teacher/assignments/page.tsx). Not FK''d to curriculum_topics — a plain label, parsed heuristically for a leading chapter number by the teacher.assignment_created event publisher.';

COMMENT ON COLUMN "public"."assignments"."difficulty" IS
  'Teacher-selected difficulty band: easy | medium | hard (or NULL). Defaults to medium. Written by POST /api/teacher/assignments; read by /teacher/assignments, /teacher/submissions, and the teacher-dashboard Edge Function teacherOwnsAssignment() helper.';
