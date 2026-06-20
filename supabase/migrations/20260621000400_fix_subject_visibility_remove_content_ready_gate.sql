-- Migration: 20260621000400_fix_subject_visibility_remove_content_ready_gate.sql
-- Hotfix: idempotent re-application of get_available_subjects v1 (board-aware, no is_content_ready gate).
-- Fixes students seeing only Maths when other subjects have not been through nightly recompute.
-- Safe to run on prod: CREATE OR REPLACE is non-destructive.

BEGIN;

-- ─── Re-create get_available_subjects without the is_content_ready gate ────────
-- The baseline RPC (00000000000000_baseline_from_prod.sql) includes the filter:
--   AND sub.is_content_ready
-- which blocks every subject that has not yet passed the nightly
-- recompute_subject_content_readiness_daily() cron.  Migration
-- 20260605000000_fix_board_subject_chapter_gaps.sql shipped the correct version
-- (WHERE sub.is_active only) but may not have executed on prod if the migration
-- was applied to a DB that already had a newer function signature cached.
-- This file is an explicit idempotent re-application of that correct version.

CREATE OR REPLACE FUNCTION public.get_available_subjects(p_student_id UUID)
RETURNS TABLE (
  code TEXT, name TEXT, name_hi TEXT, icon TEXT, color TEXT,
  subject_kind TEXT, is_core BOOLEAN, is_locked BOOLEAN
)
LANGUAGE SQL SECURITY DEFINER STABLE SET search_path = public, auth, pg_catalog AS $$
  WITH s AS (
    SELECT id, grade, stream, COALESCE(board, 'CBSE') AS board FROM public.students
     WHERE (id = p_student_id OR auth_user_id = p_student_id)
       AND (auth.uid() IS NULL OR auth_user_id = auth.uid())
     LIMIT 1
  ),
  p AS (
    SELECT plan_code FROM public.student_subscriptions
     WHERE student_id = (SELECT id FROM s)
       AND status IN ('active','trialing','grace')
     ORDER BY current_period_end DESC NULLS LAST LIMIT 1
  ),
  effective_plan AS (
    SELECT COALESCE((SELECT plan_code FROM p), 'free') AS plan_code
  ),
  grade_valid AS (
    SELECT gsm.subject_code, BOOL_OR(gsm.is_core) AS is_core
      FROM public.grade_subject_map gsm, s
     WHERE gsm.grade = s.grade
       AND (gsm.stream IS NULL OR gsm.stream = s.stream OR s.stream IS NULL)
       AND (
         -- Match student's board specifically
         gsm.board = s.board
         -- Or fallback to CBSE / NULL if no mapping exists for the student's board
         OR (gsm.board IN ('CBSE', 'Other') OR gsm.board IS NULL) AND NOT EXISTS (
           SELECT 1 FROM public.grade_subject_map gsm2
            WHERE gsm2.grade = s.grade
              AND (gsm2.stream IS NULL OR gsm2.stream = s.stream OR s.stream IS NULL)
              AND gsm2.board = s.board
         )
       )
     GROUP BY gsm.subject_code
  ),
  plan_valid AS (
    SELECT psa.subject_code FROM public.plan_subject_access psa, effective_plan ep
     WHERE psa.plan_code = ep.plan_code
  )
  SELECT sub.code, sub.name, COALESCE(sub.name_hi, sub.name), sub.icon, sub.color,
         sub.subject_kind, gv.is_core,
         (gv.subject_code NOT IN (SELECT subject_code FROM plan_valid)) AS is_locked
    FROM public.subjects sub
    JOIN grade_valid gv ON gv.subject_code = sub.code
   WHERE sub.is_active;
$$;

REVOKE ALL ON FUNCTION public.get_available_subjects(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_available_subjects(UUID) TO authenticated, service_role;

-- ─── Immediately recompute content-readiness so subjects with chapters+questions ─
-- appear in the corrected RPC response without waiting for the nightly cron.
-- Wrapped in an exception handler so the migration succeeds even if this helper
-- function does not exist in older environments.
DO $$
BEGIN
  PERFORM public.recompute_subject_content_readiness_daily();
EXCEPTION
  WHEN others THEN
    NULL; -- function absent or errored; non-fatal, nightly cron will catch up
END;
$$;

COMMIT;
