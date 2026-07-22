-- Migration: 20260722096000_exam_papers_add_grade_column.sql
-- Purpose:    Phase 2.2 remediation, item 1 of the "Alfanumrik Student
--             Portal — Master Action Plan" (assessment-authored spec).
--             Adds a nullable `grade` text column to public.exam_papers
--             so a paper can be scoped to a single CBSE grade (P5: grade
--             is always a string '6'..'12', never an integer).
--
-- Predecessors:
--   - 20260520000005_exam_papers_and_pyq_import.sql created exam_papers
--     with no per-paper grade column. That was correct at the time: every
--     row was either a multi-subject/multi-grade JEE/NEET/Olympiad paper
--     (no single grade applies) or the one hand-seeded CBSE Class-12
--     sample paper (20260520000009_cbse_board_seed.sql), where "grade"
--     was implicit in source_attribution text rather than a queryable
--     column.
--   - This migration's follow-up, 20260722096200, seeds 51 CBSE board
--     template rows spanning grades 6-12 that need a real `grade` column
--     to be filterable/joinable (e.g. "show me all grade-9 CBSE board
--     papers").
--
-- Why nullable (per spec, verbatim):
--   Non-cbse_board exam families (jee_main, jee_advanced, neet,
--   olympiad_*, kvpy, nsep, nsec, nsejs, nstse, nso, imo, ntse) span
--   multiple grades or are not grade-scoped at all — there is no single
--   grade value that correctly describes those papers. Forcing a NOT
--   NULL grade would require fabricating a value for those families.
--   `grade` therefore stays NULL for every row except cbse_board papers
--   that are genuinely single-grade.
--
-- What this migration does:
--   1. ADD COLUMN grade text (nullable, no default) to public.exam_papers.
--   2. ADD CONSTRAINT chk_exam_papers_grade_p5 CHECK (grade IS NULL OR
--      grade = ANY (ARRAY['6','7','8','9','10','11','12'])) — P5 grade-
--      format compliance: string enum, never an integer, never a value
--      outside CBSE's 6-12 range.
--   3. Column comment documenting the nullability rationale.
--   4. Read-only verification block (RAISE NOTICE/WARNING).
--
-- What this migration does NOT do:
--   - Does NOT backfill grade on any existing row (all pre-existing rows,
--     including the one CBSE sample paper from 20260520000009, keep
--     grade = NULL; backfilling that one row is a content-team follow-up,
--     not a schema concern).
--   - Does NOT touch RLS. Column additions do not change row visibility
--     under Postgres RLS (RLS is row-scoped, not column-scoped), and this
--     repo grants table-level (not column-level) privileges on
--     exam_papers (`GRANT SELECT, INSERT, UPDATE, DELETE ... TO
--     authenticated` in the origin migration), so the existing grant
--     already covers the new column. No new policy or GRANT statement is
--     required. Verified: the two existing policies
--     (exam_papers_select_authenticated USING (true), and
--     exam_papers_admin_write scoped to admin_users) are both unconditional
--     on columns, so they apply to `grade` automatically.
--   - Does NOT alter question_bank, mock_test_attempts, or any other table.
--   - No DROP of any kind.
--
-- Idempotent: yes.
--   - ADD COLUMN IF NOT EXISTS is a no-op on re-run.
--   - CHECK constraint is added inside a DO block guarded by pg_constraint
--     existence, matching the exact convention used by every other CHECK
--     in the origin migration (20260520000005).
--   - COMMENT ON COLUMN re-runs harmlessly.
--
-- Owner: architect (schema). Downstream reviewers per P14 (RBAC/auth n/a
--   here — no auth/middleware change — but per the Master Action Plan
--   review chain this migration should be reviewed by: assessment
--   (grade × subject matrix correctness, since the seed migration
--   20260722096200 depends on this column), backend (any API route that
--   reads/writes exam_papers.grade), testing (regression coverage for
--   the new column + CHECK).
--
-- Rollback (manual, requires user approval per CLAUDE.md — no DROP
--   COLUMN is performed by this migration itself):
--   1. Verify no application code reads exam_papers.grade:
--        grep -r "exam_papers" apps/host/src/app/api | grep -i grade
--   2. ALTER TABLE public.exam_papers DROP CONSTRAINT chk_exam_papers_grade_p5;
--   3. ALTER TABLE public.exam_papers DROP COLUMN grade;   -- requires user approval

BEGIN;

-- ───────────────────────────────────────────────────────────────────────
-- 1. Add the grade column (nullable, no default)
-- ───────────────────────────────────────────────────────────────────────

ALTER TABLE public.exam_papers
  ADD COLUMN IF NOT EXISTS grade text;

-- ───────────────────────────────────────────────────────────────────────
-- 2. CHECK constraint — P5 grade-format compliance
-- ───────────────────────────────────────────────────────────────────────
-- Guarded by pg_constraint existence, matching the exact idempotency
-- pattern used by every other CHECK constraint on this table
-- (chk_exam_papers_family, chk_exam_papers_pattern, etc. in
-- 20260520000005_exam_papers_and_pyq_import.sql).
-- ───────────────────────────────────────────────────────────────────────

DO $chk_grade_p5$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
      JOIN pg_class ON pg_class.oid = pg_constraint.conrelid
     WHERE pg_constraint.conname = 'chk_exam_papers_grade_p5'
       AND pg_class.relname = 'exam_papers'
       AND pg_class.relnamespace = 'public'::regnamespace
  ) THEN
    ALTER TABLE public.exam_papers
      ADD CONSTRAINT chk_exam_papers_grade_p5
      CHECK (grade IS NULL OR grade = ANY (ARRAY[
        '6'::text, '7'::text, '8'::text, '9'::text,
        '10'::text, '11'::text, '12'::text
      ]));
  END IF;
END $chk_grade_p5$;

-- ───────────────────────────────────────────────────────────────────────
-- 3. Column comment
-- ───────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.exam_papers.grade IS
  'CBSE grade this paper is scoped to, as a string ''6''..''12'' (P5: grade is always text, never integer). NULL for exam families spanning multiple grades or not grade-scoped (jee_main, jee_advanced, neet, olympiad_*, kvpy, nsep, nsec, nsejs, nstse, nso, imo, ntse). Populated for cbse_board template rows seeded in 20260722096200_cbse_board_exam_papers_grade_subject_matrix_seed.sql. Constrained by chk_exam_papers_grade_p5.';

-- ───────────────────────────────────────────────────────────────────────
-- 4. Verification block — read-only sanity checks
-- ───────────────────────────────────────────────────────────────────────

DO $verify$
DECLARE
  v_col_exists      boolean;
  v_col_type        text;
  v_chk_exists      boolean;
  v_rls_enabled     boolean;
  v_all_ok          boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'exam_papers'
       AND column_name = 'grade'
  ) INTO v_col_exists;

  SELECT data_type INTO v_col_type
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 'exam_papers'
     AND column_name = 'grade';

  SELECT EXISTS (
    SELECT 1
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
     WHERE c.conname = 'chk_exam_papers_grade_p5'
       AND t.relname = 'exam_papers'
       AND t.relnamespace = 'public'::regnamespace
  ) INTO v_chk_exists;

  SELECT c.relrowsecurity INTO v_rls_enabled
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'exam_papers';

  RAISE NOTICE '[p2.2-item1] exam_papers.grade column exists: % (type: %)', v_col_exists, v_col_type;
  RAISE NOTICE '[p2.2-item1] chk_exam_papers_grade_p5 constraint exists: %', v_chk_exists;
  RAISE NOTICE '[p2.2-item1] exam_papers RLS still enabled: %', v_rls_enabled;

  v_all_ok := v_col_exists
          AND v_col_type = 'text'
          AND v_chk_exists
          AND COALESCE(v_rls_enabled, false);

  IF NOT v_all_ok THEN
    RAISE WARNING '[p2.2-item1] migration did NOT land cleanly — see flags above';
  ELSE
    RAISE NOTICE '[p2.2-item1] MIGRATION COMPLETE — exam_papers.grade column + P5 CHECK installed';
  END IF;
END $verify$;

COMMIT;
