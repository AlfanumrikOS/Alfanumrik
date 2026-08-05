-- Migration: 20260811000001_assignments_open_lookup_index.sql
-- Purpose: Foxy North-Star Phase 4 — targeted indexes to keep the
--   "open assignments per class" and "student-x-assignment submission"
--   lookups fast under the Wave-4 traffic pattern (Foxy /learn context
--   probes + parent/teacher dashboards).
--
-- (1) idx_assignments_class_active_due
--     Partial composite on (class_id, due_date) filtered to
--     status = 'active'. The existing idx_assignments_class_due
--     (baseline_from_prod.sql:16589) is a FULL index on the same
--     columns; the partial variant is ~an order of magnitude smaller
--     because inactive/completed assignments dominate the table over
--     time, and the "list this class's open work" query is the hot
--     path. Both indexes coexist — the planner will choose whichever
--     is cheaper for the predicate.
--
--     TASK-BRIEF NOTE: the brief specified `WHERE is_active`, but the
--     assignments table in the baseline uses a TEXT `status` column
--     with default 'active' (see baseline_from_prod.sql:9904-9927) and
--     has no `is_active` boolean. Pivoted to `WHERE status = 'active'`
--     to match the real schema — deliberate, not a typo; documented
--     here for the review chain.
--
-- (2) idx_assignment_submissions_student_assignment
--     Composite on (student_id, assignment_id). Baseline ships two
--     single-column indexes on this table (idx_submissions_student on
--     student_id, idx_submissions_assignment on assignment_id — see
--     baseline_from_prod.sql:18047,18050) but no composite covering
--     "did student X submit assignment Y" — the exact lookup the
--     assignment-status probe needs. Adds the composite; the
--     single-column indexes stay for other query shapes.
--
-- Both indexes: CREATE INDEX IF NOT EXISTS (idempotent, re-run-safe).
-- No table/RLS/policy change. Owner: architect. Reviewers (P14):
-- backend (query consumers), ops (index bloat monitoring), testing.
-- Added: 2026-08-05.

CREATE INDEX IF NOT EXISTS idx_assignments_class_active_due
  ON public.assignments (class_id, due_date)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_assignment_submissions_student_assignment
  ON public.assignment_submissions (student_id, assignment_id);
