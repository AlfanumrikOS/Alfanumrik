-- Migration: 20260722093000_assignment_submissions_teacher_feedback_hi.sql
-- Purpose: Master Action Plan Phase 3, item 3.10 (migration half only). Adds
--          the Hindi variant column for teacher feedback so
--          assignment_submissions can carry a bilingual (P7) feedback pair,
--          matching the AuthContext.isHi convention used elsewhere in the
--          platform. This migration is SCHEMA ONLY -- it does not touch the
--          teacher-side authoring UI (frontend, separate task) or the
--          student-facing render in
--          apps/host/src/app/(student)/assignments/page.tsx (also frontend,
--          separate task); it also does not touch multi-attempt/due-date
--          logic (backend, separate task in the same Phase 3).
--
-- ─── Current schema (confirmed, baseline_from_prod.sql:9882-9901) ────────────
-- public.assignment_submissions already has a single free-text column:
--   "teacher_feedback" "text"
-- with no Hindi counterpart. The student assignments page renders whatever is
-- in that one column verbatim regardless of the student's isHi preference
-- (P7 gap). This migration adds the missing column; it does not backfill or
-- migrate existing teacher_feedback values into teacher_feedback_hi (no
-- reliable machine translation source -- leaving it NULL for existing rows is
-- correct; a NULL renders as "no Hindi feedback yet", not a broken value).
--
-- ─── RLS verification (why no policy change is needed here) ─────────────────
-- assignment_submissions RLS was checked end-to-end against the FOUR
-- standard patterns before writing this migration:
--   - Student own:    "Students can manage own submissions" (baseline:20068,
--                      ALL, USING/WITH CHECK student_id IN (SELECT id FROM
--                      students WHERE auth_user_id = auth.uid())).
--   - Parent linked:   "assignment_submissions_parent_select"
--                      (20260621000000_phase1_academic_structure_attendance_
--                      boards.sql:567-578, SELECT via guardian_student_links
--                      WHERE status = 'approved').
--   - Teacher assigned: "Teachers can view assignment submissions"
--                      (baseline:20217, SELECT) and "Teachers can grade
--                      submissions" (baseline:20190, UPDATE), both via
--                      assignments JOIN teachers ON teacher_id WHERE
--                      auth_user_id = auth.uid().
--   - Admin:           "Service role full access assignment_submissions" /
--                      "Service role full access on assignment_submissions"
--                      (baseline:19925, 19979 -- two policies, both TO
--                      service_role USING/WITH CHECK true; harmless
--                      duplication predating this migration, left untouched).
-- All four patterns are present and already ENABLE ROW LEVEL SECURITY is set
-- (baseline:20455). PostgreSQL RLS policies operate at ROW granularity, not
-- column granularity: none of the five policies above reference specific
-- columns in their USING/WITH CHECK clauses (they gate on student_id /
-- assignment_id / teacher_id joins only), so a new nullable column is
-- automatically covered by every existing policy with the exact same
-- visibility boundary as every other column on this table, including the
-- pre-existing teacher_feedback column. No new policy, no ALTER POLICY, no
-- GRANT/REVOKE change is required or added by this migration.
--
-- One PRE-EXISTING (not introduced by this migration) observation, noted for
-- completeness: "Students can manage own submissions" is a FOR ALL policy
-- with no column-level restriction, so a student's own UPDATE technically
-- has SQL-level ability to write teacher_feedback (and now
-- teacher_feedback_hi) on their own row -- this is identical to the
-- already-existing exposure on teacher_feedback and is NOT a new gap created
-- here. Whether application code ever lets a student PATCH that column is an
-- API-route/business-logic concern (backend-owned), not something this
-- additive, schema-only migration changes or is scoped to fix.
--
-- ─── Safety properties ───────────────────────────────────────────────────────
--   * Idempotent: ADD COLUMN IF NOT EXISTS.
--   * Additive only: nullable, no DEFAULT-driven backfill, no DROP TABLE /
--     DROP COLUMN, no existing column altered.
--   * No RLS change (verified above): existing policies already cover the
--     new column with no gap.
--
-- Review chain (P14): this is a grading/feedback-adjacent schema change but
-- does NOT touch score/XP/quiz-scoring tables (P1/P2 out of scope) and does
-- not touch RLS. Per this repo's Required Review Triggers, notify frontend
-- (both the teacher-side feedback authoring surface and the student
-- assignments page render, once those UI tasks land) so they know the column
-- now exists; no assessment/ai-engineer notification is required (no
-- scoring/AI table touched).
--
-- Owner: architect. Added: 2026-07-22 (backend completion Phase 3, item 3.10
-- -- migration half only; the teacher-authoring UI and student bilingual
-- render are separate frontend tasks; multi-attempt/due-date logic is a
-- separate backend task).

BEGIN;

ALTER TABLE public.assignment_submissions
  ADD COLUMN IF NOT EXISTS teacher_feedback_hi text;

COMMENT ON COLUMN public.assignment_submissions.teacher_feedback_hi IS
  'Hindi variant of teacher_feedback (P7 bilingual UI). Nullable, not '
  'backfilled -- NULL means no Hindi feedback has been entered yet for this '
  'submission. Covered by the same RLS policies as teacher_feedback (RLS is '
  'row-scoped, not column-scoped) -- see migration '
  '20260722093000_assignment_submissions_teacher_feedback_hi.sql header for '
  'the full verification against all four RLS patterns.';

COMMIT;

-- ─── Verify (manual, after applying) ─────────────────────────────────────────
-- 1. SELECT column_name, is_nullable, data_type
--      FROM information_schema.columns
--     WHERE table_schema = 'public' AND table_name = 'assignment_submissions'
--       AND column_name = 'teacher_feedback_hi';
--    -- expect: teacher_feedback_hi | YES | text
-- 2. SELECT polname, cmd FROM pg_policies
--     WHERE tablename = 'assignment_submissions' ORDER BY polname;
--    -- expect the same 5 policies as before this migration (no new/changed
--    -- policy): "Service role full access assignment_submissions",
--    -- "Service role full access on assignment_submissions",
--    -- "Students can manage own submissions", "Teachers can grade
--    -- submissions", "Teachers can view assignment submissions", plus
--    -- "assignment_submissions_parent_select" from 20260621000000.
-- 3. Confirm a student's own SELECT and a linked-parent's SELECT and an
--    assigned-teacher's SELECT/UPDATE all still succeed unchanged (no
--    regression from adding the column).
