-- Migration: 20260722096200_cbse_board_exam_papers_grade_subject_matrix_seed.sql
-- Purpose:    Phase 2.2 remediation, item 3 of the "Alfanumrik Student
--             Portal — Master Action Plan" (assessment-authored spec).
--             Seeds 51 TEMPLATE rows into public.exam_papers, one per
--             (grade, subject) combination in the CBSE board matrix:
--               - Grades 6-10 x [math, science, english, hindi,
--                 social_studies]                         = 25 rows
--               - Grades 11-12 x [physics, chemistry, biology, math,
--                 english, economics, accountancy, business_studies,
--                 political_science, history_sr, geography,
--                 computer_science, coding]                = 26 rows
--               TOTAL                                        51 rows
--
-- Predecessors:
--   - 20260722096000_exam_papers_add_grade_column.sql (this same PR)
--     added the `grade` column + chk_exam_papers_grade_p5 CHECK that
--     every row inserted here relies on.
--   - 20260520000005_exam_papers_and_pyq_import.sql created the table
--     and chk_exam_papers_family (already permits 'cbse_board').
--   - 20260520000009_cbse_board_seed.sql seeded ONE hand-authored
--     Class-12 cross-stream sample paper + 30 questions. That migration
--     is untouched by this one — this migration adds 51 NEW template
--     rows alongside it (paper_code namespace does not collide:
--     'sample_cbse_class12_general_v1' vs this migration's
--     'cbse_board_g{grade}_{subject}_v1').
--
-- What "template row" means here (per spec, verbatim):
--   Each row is a per-(grade,subject) CBSE board exam-paper CATALOG
--   ENTRY — paper metadata (pattern, question/mark totals, duration,
--   marking scheme) with NO question_bank content attached yet.
--   question_bank population against these 51 exam_paper_id values is
--   explicitly OUT OF SCOPE for this migration (assessment/content-team
--   follow-up), mirroring how 20260520000005 (PR-2) created exam_papers
--   with zero rows and left seeding to a dedicated follow-up migration.
--
-- Column values (every row, per spec, verbatim):
--   paper_code       = 'cbse_board_g{grade}_{subject}_v1'
--   exam_family      = 'cbse_board'
--   grade            = '{grade}'                      (text, P5)
--   subject_scope    = ARRAY['{subject}']
--   paper_pattern    = 'mcq_single'
--   total_questions  = 39
--   total_marks      = 80
--   duration_minutes = 180
--   marking_scheme   = '{"correct": null, "wrong": 0, "unanswered": 0}'::jsonb
--   is_active        = true
--
-- Columns filled in BEYOND the spec's explicit list, and why (flagged
-- for reviewer attention — these were required to satisfy pre-existing
-- NOT NULL / CHECK constraints on exam_papers that the spec did not
-- address, since the spec is schema-agnostic about columns it doesn't
-- mention):
--   - exam_year (NOT NULL, chk_exam_papers_year BETWEEN 1990 AND 2100):
--     the spec's column list has no exam_year. Set to 2026 (current
--     academic year at authoring time) for every row. This is an
--     assumption, not a spec directive — flagged in the report back to
--     the requesting agent. A template row spanning many future cohorts
--     arguably shouldn't carry a single exam_year at all, but the column
--     is NOT NULL on this table (no migration in this PR relaxes that),
--     so a value is required. 2026 was chosen as the least-surprising
--     default; content/assessment can update it per-row later without a
--     schema change.
--   - exam_month: set to 3 (March), matching the CBSE board exam window,
--     consistent with 20260520000009_cbse_board_seed.sql's convention.
--   - source_attribution / notes: free text documenting these as
--     Phase 2.2 template rows with no question content yet, so a future
--     reader of exam_papers is never confused into thinking these 51
--     rows have real question_bank coverage.
--   - imported_by: left NULL (system seed via migration, no admin
--     attribution), matching 20260520000009's convention.
--
-- Idempotent: yes.
--   - Single INSERT ... SELECT from a generated (grade, subject) matrix,
--     guarded by ON CONFLICT (paper_code) DO NOTHING (paper_code has a
--     UNIQUE constraint from the origin migration). Re-running this
--     migration inserts zero additional rows.
--   - Whole migration wrapped in BEGIN ... COMMIT.
--
-- Constitution compliance:
--   P5  grade is text '6'..'12' throughout, matches
--       chk_exam_papers_grade_p5 (installed in 20260722096000).
--   P6  N/A directly — this migration inserts exam_papers catalog rows,
--       not question_bank rows; no question content is created here, so
--       the question-quality invariant (4 options, correct_answer_index,
--       etc.) does not apply to this migration's inserts.
--
-- RLS: this migration performs a plain SQL INSERT executed by the
--   migration runner (a privileged database role), which is NOT subject
--   to the exam_papers RLS policies — RLS applies to queries issued
--   through PostgREST/the Supabase client using the `authenticated` or
--   `anon` roles, not to migrations run via `supabase db push` / the
--   deploy pipeline. This mirrors the exact precedent of
--   20260520000006_seed_jee_neet_olympiad_papers.sql and
--   20260520000009_cbse_board_seed.sql, both of which insert directly
--   without assuming an admin JWT context. No RLS change is made or
--   needed by this migration. Once seeded, these 51 rows are readable by
--   any authenticated user (exam_papers_select_authenticated: USING
--   (true)) and writable only by admin_users with admin_level IN
--   ('admin','super_admin') (exam_papers_admin_write) — same posture as
--   every other exam_papers row.
--
-- Owner: architect (schema seed). Downstream reviewers per P14:
--   assessment (confirms the grade x subject matrix and the 51-row
--   count, and owns the follow-up to populate question_bank against
--   these paper_ids), backend (any API route surfacing these template
--   papers to students should not present them as "ready to attempt"
--   until question_bank rows exist), testing (regression coverage: row
--   count = 51, all grades in {6..12}, no duplicate paper_code),
--   frontend (if /exams/mock renders these before question_bank is
--   populated, empty-state handling is required).
--
-- Rollback (manual, requires user approval per CLAUDE.md):
--   DELETE FROM public.exam_papers
--    WHERE paper_code LIKE 'cbse_board_g%_v1'
--      AND paper_code NOT IN ('sample_cbse_class12_general_v1');
--   -- Safe only if no mock_test_attempts / question_bank rows reference
--   -- these paper_ids yet (expected to be true immediately after this
--   -- migration, since it inserts zero question_bank rows). Verify first:
--   --   SELECT count(*) FROM question_bank WHERE exam_paper_id IN
--   --     (SELECT id FROM exam_papers WHERE paper_code LIKE 'cbse_board_g%_v1');
--   --   SELECT count(*) FROM mock_test_attempts WHERE exam_paper_id IN
--   --     (SELECT id FROM exam_papers WHERE paper_code LIKE 'cbse_board_g%_v1');

BEGIN;

-- ───────────────────────────────────────────────────────────────────────
-- 1. Seed exam_papers (51 rows — CBSE board grade x subject matrix)
-- ───────────────────────────────────────────────────────────────────────
-- Generated via a CTE cross-joining each grade band with its subject
-- list (grades 6-10 share one 5-subject list; grades 11-12 share a
-- separate 13-subject list), then INSERT ... SELECT into exam_papers.
-- This mirrors the "WITH <cte> AS (...) INSERT ... SELECT ... FROM <cte>"
-- shape already used by 20260520000009_cbse_board_seed.sql, adapted from
-- a literal VALUES list (appropriate there, for 30 bespoke questions) to
-- a generated cross-join (appropriate here, for a regular matrix).
-- ───────────────────────────────────────────────────────────────────────

WITH grade_subject_matrix AS (
  -- Grades 6-10 x 5 core subjects = 25 rows
  SELECT g AS grade, s AS subject
    FROM unnest(ARRAY['6','7','8','9','10']::text[]) AS g
    CROSS JOIN unnest(ARRAY[
      'math','science','english','hindi','social_studies'
    ]::text[]) AS s

  UNION ALL

  -- Grades 11-12 x 13 stream subjects = 26 rows
  SELECT g AS grade, s AS subject
    FROM unnest(ARRAY['11','12']::text[]) AS g
    CROSS JOIN unnest(ARRAY[
      'physics','chemistry','biology','math','english','economics',
      'accountancy','business_studies','political_science',
      'history_sr','geography','computer_science','coding'
    ]::text[]) AS s
)
INSERT INTO public.exam_papers (
  paper_code,
  exam_family,
  grade,
  subject_scope,
  paper_pattern,
  exam_year,
  exam_month,
  total_questions,
  total_marks,
  duration_minutes,
  marking_scheme,
  source_attribution,
  notes,
  imported_by,
  is_active
)
SELECT
  'cbse_board_g' || m.grade || '_' || m.subject || '_v1',
  'cbse_board',
  m.grade,
  ARRAY[m.subject]::text[],
  'mcq_single',
  2026,
  3,
  39,
  80,
  180,
  '{"correct": null, "wrong": 0, "unanswered": 0}'::jsonb,
  'Alfanumrik internal — CBSE board template (Phase 2.2 Master Action Plan)',
  'Template row (grade x subject matrix), Phase 2.2 remediation seed (20260722096200). No question_bank content ingested yet — this is a catalog placeholder, not an attempt-ready paper. exam_year=2026 is an authoring-time default, not a spec-mandated value; update per-cohort as needed.',
  NULL,
  true
FROM grade_subject_matrix m
ON CONFLICT (paper_code) DO NOTHING;

-- ───────────────────────────────────────────────────────────────────────
-- 2. Verification block
-- ───────────────────────────────────────────────────────────────────────

DO $verify$
DECLARE
  v_total_count       integer;
  v_g6_10_count       integer;
  v_g11_12_count      integer;
  v_grade_valid_count integer;
  v_family_valid      integer;
  v_pattern_valid     integer;
  v_duplicate_codes   integer;
  v_all_ok            boolean;
BEGIN
  SELECT count(*) INTO v_total_count
    FROM public.exam_papers
   WHERE paper_code LIKE 'cbse_board_g%_v1';

  SELECT count(*) INTO v_g6_10_count
    FROM public.exam_papers
   WHERE paper_code LIKE 'cbse_board_g%_v1'
     AND grade IN ('6','7','8','9','10');

  SELECT count(*) INTO v_g11_12_count
    FROM public.exam_papers
   WHERE paper_code LIKE 'cbse_board_g%_v1'
     AND grade IN ('11','12');

  SELECT count(*) INTO v_grade_valid_count
    FROM public.exam_papers
   WHERE paper_code LIKE 'cbse_board_g%_v1'
     AND grade = ANY (ARRAY['6','7','8','9','10','11','12']);

  SELECT count(*) INTO v_family_valid
    FROM public.exam_papers
   WHERE paper_code LIKE 'cbse_board_g%_v1'
     AND exam_family = 'cbse_board';

  SELECT count(*) INTO v_pattern_valid
    FROM public.exam_papers
   WHERE paper_code LIKE 'cbse_board_g%_v1'
     AND paper_pattern = 'mcq_single';

  SELECT count(*) - count(DISTINCT paper_code) INTO v_duplicate_codes
    FROM public.exam_papers
   WHERE paper_code LIKE 'cbse_board_g%_v1';

  RAISE NOTICE '[p2.2-item3] total cbse_board template rows: % (expected 51)', v_total_count;
  RAISE NOTICE '[p2.2-item3] grades 6-10 rows: % (expected 25)', v_g6_10_count;
  RAISE NOTICE '[p2.2-item3] grades 11-12 rows: % (expected 26)', v_g11_12_count;
  RAISE NOTICE '[p2.2-item3] rows with grade in (6..12): % / %', v_grade_valid_count, v_total_count;
  RAISE NOTICE '[p2.2-item3] rows with exam_family=cbse_board: % / %', v_family_valid, v_total_count;
  RAISE NOTICE '[p2.2-item3] rows with paper_pattern=mcq_single: % / %', v_pattern_valid, v_total_count;
  RAISE NOTICE '[p2.2-item3] duplicate paper_code count: % (expected 0)', v_duplicate_codes;

  v_all_ok := v_total_count >= 51
          AND v_g6_10_count = 25
          AND v_g11_12_count = 26
          AND v_grade_valid_count = v_total_count
          AND v_family_valid = v_total_count
          AND v_pattern_valid = v_total_count
          AND v_duplicate_codes = 0;

  IF NOT v_all_ok THEN
    RAISE WARNING '[p2.2-item3] migration did NOT land cleanly — see flags above';
  ELSE
    RAISE NOTICE '[p2.2-item3] MIGRATION COMPLETE — 51 CBSE board template rows seeded (25 grades 6-10 + 26 grades 11-12)';
  END IF;
END $verify$;

COMMIT;
