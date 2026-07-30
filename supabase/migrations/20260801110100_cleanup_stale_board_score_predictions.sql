-- Migration: 20260801110100_cleanup_stale_board_score_predictions.sql
-- Purpose: One-time (and permanently defensive) cleanup of
--   board_score_predictions rows that do not match the owning student's
--   currently selected_subjects — the residue of the pre-fix, all-subjects-
--   at-grade BoardScore compute logic described in docs/superpowers/specs/
--   2026-07-30-boardscore-subject-scoping.md §7.2 item 1.
--
-- WHY THIS EXISTS
-- ────────────────
-- Before the BoardScore subject-scoping fix (backend, same wave, see the spec
-- above), the nightly cron computed a prediction for EVERY subject_code that
-- had active cbse_chapter_weights rows at a student's grade, regardless of
-- what that student actually selected. After the fix ships, new/refreshed
-- rows can only ever be for cbse_core/cbse_elective subjects the student
-- selected — but any pre-existing over-broad rows would keep being served by
-- GET /api/board-score / the Edge Function's `get` action until naturally
-- overwritten by the next nightly run for that exact
-- (student_id, subject_code, grade) key, which for a subject the student
-- never selected may never happen again. This migration removes that residue
-- in one pass.
--
-- CURRENT ACTUAL IMPACT (verified this session, stated plainly)
-- ────────────────────────────────────────────────────────────
-- board_score_predictions has ZERO rows as of this session's investigation.
-- The compute pipeline (Bug 1, the PostGREST embed failure — tracked and
-- fixed separately, out of scope here) has never successfully written a row
-- since the table was created (20260628000000_board_score_v1.sql). This
-- migration is therefore a genuine NO-OP against today's data — it will
-- delete 0 rows in every environment reachable right now.
--
-- WHY SHIP A NO-OP MIGRATION ANYWAY
-- ───────────────────────────────────
-- 1. Deploy-order race: this migration and backend's application-code fix
--    (the cron's getStudentBoardSubjects scoping + the on-demand route's
--    422 guard) ship in the same wave but are applied by independent
--    pipelines (migration via `supabase db push`, app code via Vercel
--    deploy). If Bug 1's compute fix reaches production before this
--    migration runs, or if the cron fires between the two deploys, it is
--    possible for old-logic rows to be written and then survive past this
--    cleanup's intended window. Running this migration defensively (rather
--    than skipping it because "the table is empty today") closes that race
--    instead of assuming deploy ordering will always be clean.
-- 2. Permanent invariant statement: this is not really a "cleanup," it is a
--    standing correctness statement — "a board_score_predictions row must
--    never outlive its student no longer selecting that subject." Keeping it
--    in the migration chain (rather than a one-off manual SQL script run by
--    hand and discarded) means the invariant is codified, reviewable, and
--    reproducible on every fresh environment (new staging, DR restore, CI
--    live-DB test) exactly like every other migration.
--
-- SAFETY
-- ──────
-- - Scope is exact: deletes only rows whose subject_code is absent from the
--   owning student's students.selected_subjects (NULL-safe via COALESCE to
--   '{}', so a NULL selected_subjects student's rows are also removed — no
--   selection means no legitimate prediction, per spec §4).
-- - No DROP, no schema change, no RLS change.
-- - Idempotent by construction: a second run always deletes 0 additional
--   rows (anything left already satisfies the NOT EXISTS predicate is false,
--   i.e. already matches a selected subject, or was already deleted).
--
-- MANUAL DOWN
-- ───────────
-- Not applicable — deleted rows were, by definition, stale predictions for
-- subjects the student did not select. There is no correct "undo" (the
-- nightly cron will regenerate legitimate rows for actually-selected
-- subjects on its next run). If a specific deletion is later found to be
-- wrong, restore from a point-in-time backup for the affected row(s), not a
-- blanket re-insert.

DO $$
DECLARE
  v_deleted_count integer;
BEGIN
  DELETE FROM public.board_score_predictions bsp
  WHERE NOT EXISTS (
    SELECT 1 FROM public.students s
    WHERE s.id = bsp.student_id
      AND bsp.subject_code = ANY(COALESCE(s.selected_subjects, '{}'))
  );

  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;

  RAISE NOTICE 'cleanup_stale_board_score_predictions: deleted % stale board_score_predictions row(s)', v_deleted_count;
END $$;
