-- Migration: 20260722096100_mock_test_attempts_add_question_snapshot.sql
-- Purpose:    Phase 2.2 remediation, item 2 of the "Alfanumrik Student
--             Portal — Master Action Plan" (assessment-authored spec).
--             Adds a nullable `question_snapshot` jsonb column to
--             public.mock_test_attempts so a per-attempt snapshot of the
--             served question set (text/options/order at serve time) can
--             be persisted for exam families that need review-mode replay
--             and marking-integrity forensics without re-querying
--             question_bank (which may have since been edited).
--
-- Predecessor: 20260520000008_mock_test_attempts.sql (PR-6) created
--   mock_test_attempts with no snapshot column — the RPC
--   `submit_mock_test_attempt` resolves questions live against
--   question_bank at submit time via `exam_paper_id`-scoped lookups.
--   That is sufficient for statically-linked attempts (today's only
--   caller) but does not capture what the student actually saw if
--   question_bank content is edited after the attempt.
--
-- Why nullable, and why NOT a CHECK constraint (per spec, verbatim):
--   Only the `cbse_board` exam family needs this column populated on new
--   attempts — enforced at the RPC level (a future revision of
--   `submit_mock_test_attempt`, or a new RPC variant, will require
--   p_question_snapshot when the underlying exam_papers.exam_family =
--   'cbse_board'). A database CHECK constraint cannot conditionally
--   require a column based on a JOIN to another table (exam_papers),
--   so this is intentionally left as an application/RPC-level invariant,
--   not a CHECK. All existing rows (and all future non-cbse_board
--   attempts, e.g. jee_main/neet/olympiad_* which stay statically linked)
--   remain valid with question_snapshot = NULL — full backward
--   compatibility, zero backfill required.
--
-- What this migration does:
--   1. ADD COLUMN question_snapshot jsonb (nullable, no default) to
--      public.mock_test_attempts.
--   2. Column comment documenting the RPC-level (not CHECK-level)
--      enforcement plan and the cbse_board-only requirement.
--   3. Read-only verification block (RAISE NOTICE/WARNING).
--
-- What this migration does NOT do:
--   - Does NOT add a CHECK constraint (see rationale above — this is an
--     intentional, spec-directed deviation from the "every new column
--     gets a CHECK" default, since a cross-table conditional requirement
--     cannot be expressed as a CHECK without a helper function; that is
--     deferred to the RPC layer where exam_papers.exam_family is already
--     being read).
--   - Does NOT change submit_mock_test_attempt (PR-6's RPC). Wiring the
--     RPC to accept/require p_question_snapshot for cbse_board attempts
--     is a follow-up (assessment + architect to co-design the RPC
--     signature change; RPC signature changes are backend/architect
--     territory, out of scope for this schema-only migration).
--   - Does NOT touch RLS. Column additions do not change row visibility
--     under Postgres RLS. The existing 4 policies on mock_test_attempts
--     (select_own, insert_own, update_own, admin_all — all row-scoped via
--     student_id / admin_users, none column-restricted) already cover the
--     new column, and the existing table-level GRANT (`GRANT SELECT,
--     INSERT, UPDATE ... TO authenticated`) already covers it too. No new
--     policy or GRANT statement is required.
--   - Does NOT touch mock_test_responses, question_bank, or any other
--     table. No DROP of any kind.
--
-- Idempotent: yes. ADD COLUMN IF NOT EXISTS is a no-op on re-run;
--   COMMENT ON COLUMN re-runs harmlessly.
--
-- Owner: architect (schema). Downstream reviewers per P14: assessment
--   (defines the cbse_board-required-at-RPC-level rule and the snapshot
--   shape), backend (implements the RPC-level enforcement + the
--   /api/exams/mock/submit route), testing (regression coverage for the
--   new column and the eventual RPC-level requirement).
--
-- Rollback (manual, requires user approval per CLAUDE.md — no DROP
--   COLUMN is performed by this migration itself):
--   1. Verify no application code reads mock_test_attempts.question_snapshot:
--        grep -r "question_snapshot" apps/host/src supabase/functions
--   2. ALTER TABLE public.mock_test_attempts DROP COLUMN question_snapshot;
--      -- requires user approval

BEGIN;

-- ───────────────────────────────────────────────────────────────────────
-- 1. Add the question_snapshot column (nullable, no default)
-- ───────────────────────────────────────────────────────────────────────

ALTER TABLE public.mock_test_attempts
  ADD COLUMN IF NOT EXISTS question_snapshot jsonb;

-- ───────────────────────────────────────────────────────────────────────
-- 2. Column comment
-- ───────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.mock_test_attempts.question_snapshot IS
  'Nullable jsonb snapshot of the question set (text/options/order) as served at attempt time, decoupling review-mode replay from live question_bank content. NULL for all existing rows and for statically-linked attempts (today''s jee_main/neet/olympiad_* families, which keep resolving questions live via exam_paper_id). Required (enforced at the submit_mock_test_attempt RPC level, NOT via a CHECK constraint — a cross-table conditional on exam_papers.exam_family cannot be expressed as a plain CHECK) for new attempts against cbse_board papers once the RPC is updated to populate it. MUST NOT contain student-identifying data beyond what already lives in this table (P13).';

-- ───────────────────────────────────────────────────────────────────────
-- 3. Verification block — read-only sanity checks
-- ───────────────────────────────────────────────────────────────────────

DO $verify$
DECLARE
  v_col_exists  boolean;
  v_col_type    text;
  v_rls_enabled boolean;
  v_all_ok      boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'mock_test_attempts'
       AND column_name = 'question_snapshot'
  ) INTO v_col_exists;

  SELECT data_type INTO v_col_type
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 'mock_test_attempts'
     AND column_name = 'question_snapshot';

  SELECT c.relrowsecurity INTO v_rls_enabled
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'mock_test_attempts';

  RAISE NOTICE '[p2.2-item2] mock_test_attempts.question_snapshot column exists: % (type: %)', v_col_exists, v_col_type;
  RAISE NOTICE '[p2.2-item2] mock_test_attempts RLS still enabled: %', v_rls_enabled;

  v_all_ok := v_col_exists
          AND v_col_type = 'jsonb'
          AND COALESCE(v_rls_enabled, false);

  IF NOT v_all_ok THEN
    RAISE WARNING '[p2.2-item2] migration did NOT land cleanly — see flags above';
  ELSE
    RAISE NOTICE '[p2.2-item2] MIGRATION COMPLETE — mock_test_attempts.question_snapshot column installed';
  END IF;
END $verify$;

COMMIT;
