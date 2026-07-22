-- Migration: 20260722097200_deactivate_legacy_cbse_multisubject_sample_paper.sql
-- Purpose:    Phase 2.2 remediation follow-up to items 4/5 (dynamic
--             cbse_board mock-test assembly, migrations 20260722097000 +
--             20260722097100). Deactivates the ONE pre-existing
--             hand-authored multi-subject CBSE board paper
--             (`sample_cbse_class12_general_v1`, seeded by
--             20260520000009_cbse_board_seed.sql) so it stops routing
--             through the new dynamic-assembly `/start` path.
--
-- The regression (flagged by backend in 20260722097000's own migration
-- comment, "FLAGGED FOR REVIEWER ATTENTION"): the frontend's cbse_board
-- detection (`MockTestRunnerPage`'s `isCbseBoard = paper.exam_family ===
-- 'cbse_board'`) has no subject-count carve-out. ALL cbse_board papers —
-- including this one 4-subject cross-stream paper with `grade IS NULL` —
-- now route through POST /api/exams/papers/[id]/start ->
-- start_mock_test_attempt. That RPC correctly REJECTS any paper whose
-- `subject_scope` has length <> 1 (`array_length(v_paper.subject_scope, 1)
-- <> 1` raises `22023`) rather than silently cherry-picking one subject
-- and serving a physics-only test under a paper code that promises all
-- four subjects. The route surfaces that as { error: 'start_failed' },
-- which the frontend renders as `<StartErrorCard>` (retry card) instead of
-- the paper's original 30 static questions.
--
-- Resolution (architect decision, per explicit user-approved instruction —
-- this is NOT the "teach the frontend a multi-subject carve-out" branch,
-- and NOT the "widen the RPC to handle multi-subject" branch): this legacy
-- paper is functionally redundant. 20260722096200_cbse_board_exam_papers_
-- grade_subject_matrix_seed.sql already seeded 13 separate single-subject
-- grade-12 template rows (physics, chemistry, biology, math, english,
-- economics, accountancy, business_studies, political_science, history_sr,
-- geography, computer_science, coding) that supersede this one paper's
-- coverage (physics/chemistry/biology/math) and then some. Once those 13
-- rows are backed by question_bank content (a separate, already-scoped
-- content-team follow-up — see 20260722096200's own migration comment),
-- CBSE board grade-12 students have strictly MORE single-subject options
-- than this one 4-subject paper ever offered. There is no product reason
-- to keep this paper reachable as a NEW attempt option, and every reason
-- not to (it 500s via the new dynamic-assembly path).
--
-- What this migration does:
--   Sets `is_active = false` on the single exam_papers row where
--   paper_code = 'sample_cbse_class12_general_v1'. Nothing else.
--
-- Why `is_active = false` (not DROP, not DELETE):
--   - No user approval was sought for a destructive op, and none is
--     needed: is_active is a soft, reversible catalog-visibility flag,
--     already respected by every read path (see "safety analysis" below).
--   - Reversible in one line (see Rollback).
--   - Preserves referential integrity for anything that already links to
--     this exam_papers.id (question_bank.exam_paper_id FK, and any
--     mock_test_attempts.exam_paper_id FK from historical attempts against
--     this paper) with zero migration risk.
--
-- Safety analysis — this does NOT orphan or break historical data
-- (verified by reading the actual app code, not assumed):
--   1. Catalog listing (GET /api/exams/papers, backing MockTestCatalog.tsx)
--      filters `.eq('is_active', true)` (apps/host/src/app/api/exams/
--      papers/route.ts:169) — this paper simply stops appearing as a NEW
--      option. Expected and desired.
--   2. Paper detail / runner-start (GET /api/exams/papers/[id], backing
--      the /exams/mock/[paperId] runner page) ALSO filters
--      `.eq('is_active', true)` (route.ts:108) — direct/deep-linked
--      navigation to this paper's URL now 404s (`paper_not_found`), and
--      the runner page's existing 404 handler already redirects to
--      /exams/mock (MockTestRunnerPage's `data.kind === 'not_found'`
--      effect). No new error state needed; this is the SAME code path
--      already used for any invalid/removed paper id.
--   3. Historical results are NOT re-fetched from exam_papers at all: the
--      results page (/exams/mock/[paperId]/results/page.tsx) reads the
--      submitted result from sessionStorage (`RESULT_STORAGE_PREFIX` +
--      attempt_id), stashed at submit time by useMockTestState. It never
--      queries exam_papers or re-derives score. A student who already
--      completed this paper keeps their sessionStorage-cached result
--      exactly as before; deactivating the paper is invisible to that
--      flow. (Confirmed: there is no `/api/exams/attempts/[id]` route yet
--      — the results page's own comment notes this is a known future gap,
--      unrelated to this migration.)
--   4. mock_test_attempts / mock_test_responses rows for this paper are
--      untouched by this migration (no UPDATE/DELETE on those tables) and
--      remain fully queryable — the exam_paper_id FK a completed attempt
--      carries still resolves via `SELECT * FROM exam_papers WHERE id =
--      ...` (is_active does not gate direct-by-id reads at the DB layer;
--      only these two API routes' PostgREST `.eq('is_active', true)`
--      filters do, and neither is on the read path for historical
--      results per point 3).
--   5. RLS is unaffected: `exam_papers_select_authenticated` is
--      `USING (true)` for all authenticated callers (20260520000005) —
--      is_active is not part of the RLS predicate on this table, so this
--      migration changes zero RLS-visible rows.
--   6. question_bank rows still carry `exam_paper_id` pointing at this
--      exam_papers row (the 30 seeded questions from 20260520000009) —
--      those rows are untouched, remain `is_active = true`, and their FK
--      target continues to exist (we did not delete the exam_papers row,
--      only flipped a boolean on it). No dangling FK, no orphan.
--
-- Idempotent: yes — a plain UPDATE ... WHERE is naturally idempotent
--   (re-running sets is_active = false again, a no-op if already false).
--   Wrapped in BEGIN...COMMIT for consistency with this migration chain's
--   convention; a verification block confirms the row landed in the
--   expected state without asserting the previous is_active value (so a
--   third or fourth re-run stays a clean no-op with no WARNING noise).
--
-- Does NOT touch: exam_papers schema, RLS, question_bank, mock_test_
--   attempts / mock_test_responses, start_mock_test_attempt,
--   submit_mock_test_attempt, or any other exam_papers row (including the
--   51 template rows from 20260722096200).
--
-- Owner: architect (Phase 2.2 remediation, schema-visibility decision).
--   Reviewers per P14: backend (confirms the /start 500 regression this
--   closes and that no route needs updating beyond this flag flip),
--   frontend (confirms MockTestRunnerPage's existing 404 handling covers
--   the now-deactivated paper with no code change required), testing
--   (regression: this paper_code no longer appears in GET /api/exams/
--   papers, and GET /api/exams/papers/[id] for its id now 404s), assessment
--   (confirms the 13 single-subject grade-12 template rows are an adequate
--   content-parity replacement once populated).
--
-- Rollback (reversible in one line; requires user approval per CLAUDE.md
--   only if re-activating would resurface the /start 500 regression —
--   re-activation alone is otherwise non-destructive):
--   UPDATE public.exam_papers
--      SET is_active = true
--    WHERE paper_code = 'sample_cbse_class12_general_v1';
--   -- Re-activating alone does NOT fix the underlying dynamic-assembly
--   -- multi-subject rejection — that regression is still live in
--   -- start_mock_test_attempt (by design, per 20260722097000's own
--   -- comment). Do not roll back without also re-solving that routing
--   -- problem (frontend carve-out or RPC change), or this paper will
--   -- immediately 500 again for any student who reaches it.

BEGIN;

-- ───────────────────────────────────────────────────────────────────────
-- 1. Deactivate the legacy multi-subject sample paper.
-- ───────────────────────────────────────────────────────────────────────

UPDATE public.exam_papers
   SET is_active = false
 WHERE paper_code = 'sample_cbse_class12_general_v1';

-- ───────────────────────────────────────────────────────────────────────
-- 2. Verification block — read-only sanity checks.
-- ───────────────────────────────────────────────────────────────────────

DO $verify$
DECLARE
  v_row_exists   boolean;
  v_is_active    boolean;
  v_q_count      integer;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.exam_papers
     WHERE paper_code = 'sample_cbse_class12_general_v1'
  ) INTO v_row_exists;

  SELECT is_active INTO v_is_active
    FROM public.exam_papers
   WHERE paper_code = 'sample_cbse_class12_general_v1';

  SELECT count(*) INTO v_q_count
    FROM public.question_bank qb
    JOIN public.exam_papers ep ON ep.id = qb.exam_paper_id
   WHERE ep.paper_code = 'sample_cbse_class12_general_v1';

  RAISE NOTICE '[p2.2-deactivate-legacy-cbse] row present: % / is_active: % (expect false)',
    v_row_exists, v_is_active;
  RAISE NOTICE '[p2.2-deactivate-legacy-cbse] linked question_bank rows still intact: % (expect 30, untouched by this migration)',
    v_q_count;

  IF NOT v_row_exists THEN
    RAISE WARNING '[p2.2-deactivate-legacy-cbse] exam_papers row for sample_cbse_class12_general_v1 NOT FOUND — nothing to deactivate (unexpected if 20260520000009 has run)';
  ELSIF v_is_active IS DISTINCT FROM false THEN
    RAISE WARNING '[p2.2-deactivate-legacy-cbse] is_active is still % — deactivation did NOT land as expected', v_is_active;
  ELSE
    RAISE NOTICE '[p2.2-deactivate-legacy-cbse] MIGRATION COMPLETE — legacy multi-subject sample paper deactivated; its 30 question_bank rows and any historical mock_test_attempts remain intact and readable.';
  END IF;
END $verify$;

COMMIT;
