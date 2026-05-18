-- ============================================================================
-- Migration: 20260528000009_subjects_rpc_stream_aware.sql
-- Phase F.7 follow-up (Super-Admin Production-Readiness Plan, 2026-05-18)
--
-- CEO reported: "demo-student account ... not showing all the subjects as per
-- science side chosen. Many subjects do not have content..."
--
-- Two RPC bugs in get_available_subjects_v2:
--
-- 1. STREAM IGNORED. The function joined grade_subject_map on (subject_code,
--    grade) only, returning EVERY subject across ALL streams for a grade. A
--    grade-12 science student saw commerce + humanities subjects too (14
--    instead of 8). For grade 11/12 the schema requires filtering by stream.
--
-- 2. ONLY 'ready' COUNTED. ready_chapter_count filtered `rag_status = 'ready'`
--    but every cbse_syllabus row in prod today is 'partial' during rollout —
--    so the count returned 0 across the board. The chapters RPC widens to
--    'partial' OR 'ready'; aligning the subjects RPC so the chapter-count
--    badge matches the chapter list the user actually sees on the next click.
--
-- Applied directly to prod 2026-05-18 via MCP (operator was mid-test).
-- This file lands in repo so subsequent staging/CI runs match prod.
-- Idempotent (CREATE OR REPLACE FUNCTION).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_available_subjects_v2(p_student_id uuid)
 RETURNS TABLE(subject_code text, subject_display text, subject_display_hi text, ready_chapter_count integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_student_id UUID;
  v_grade      TEXT;
  v_stream     TEXT;
BEGIN
  SELECT id, grade, stream INTO v_student_id, v_grade, v_stream
    FROM public.students
   WHERE (id = p_student_id OR auth_user_id = p_student_id)
     AND (auth.uid() IS NULL OR auth_user_id = auth.uid())
   LIMIT 1;

  IF v_student_id IS NULL OR v_grade IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    sub.code,
    sub.name,
    COALESCE(sub.name_hi, sub.name),
    COALESCE((
      SELECT COUNT(DISTINCT cs.chapter_number)::INTEGER
        FROM public.cbse_syllabus cs
       WHERE cs.subject_code = sub.code
         AND cs.grade        = v_grade
         AND cs.rag_status   IN ('partial', 'ready')
         AND cs.is_in_scope  = TRUE
    ), 0) AS ready_chapter_count
  FROM public.subjects sub
  JOIN public.grade_subject_map gsm ON gsm.subject_code = sub.code
  WHERE gsm.grade = v_grade
    AND (
      -- Stream-aware: match student's stream, OR rows with NULL stream
      -- (some subjects are common across all streams in the same grade).
      -- For grades 6-10 v_stream is NULL so we match all stream-less rows.
      gsm.stream IS NOT DISTINCT FROM v_stream
      OR gsm.stream IS NULL
    )
    AND sub.is_active
  GROUP BY sub.code, sub.name, sub.name_hi
  ORDER BY sub.name;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_available_subjects_v2(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_available_subjects_v2(uuid) TO authenticated, service_role;
