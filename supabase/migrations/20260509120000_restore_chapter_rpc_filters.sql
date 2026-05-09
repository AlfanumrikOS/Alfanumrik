-- ─── Restore partial+is_in_scope+board filters on chapters v2 RPC ──────────
--
-- Background:
--
-- 20260508140000_subject_governance_rpcs_authuid_check.sql added the
-- auth.uid() guard to available_chapters_for_student_subject_v2 (correct
-- security fix), but rewrote the function body and silently dropped three
-- filters that were live in production (per the legacy hotfix
-- 20260418130000_v2_rpcs_include_partial.sql):
--
--   1. rag_status IN ('partial', 'ready')  ← narrowed to 'ready' only
--   2. is_in_scope = TRUE                  ← dropped
--   3. board = 'CBSE'                      ← dropped
--
-- Effect: the chapter picker on /quiz returns zero rows for grades whose
-- chapters are still in the RAG drain window (mostly 'partial'), so
-- students see "No chapters available for this subject yet" even though
-- cbse_syllabus has rows. Reported by Pradeep 2026-05-09.
--
-- Fix: re-CREATE the function with the original filter set AND the new
-- auth.uid() guard. Keeps the verified_question_count source as a live
-- aggregate from question_bank (introduced by 20260508140000) since the
-- baseline `cs.verified_question_count` column read is not part of the
-- regression — both reads return the same number once the question_bank
-- has been backfilled and is the new source of truth post-Phase 4.
--
-- See file header of 20260418130000_v2_rpcs_include_partial.sql for why
-- 'partial' chapters are picker-visible: AI/quiz surfaces below enforce
-- their own stricter gates (chapter_not_ready abstain, verified-only
-- question selection), so widening the picker is safe.

BEGIN;

CREATE OR REPLACE FUNCTION public.available_chapters_for_student_subject_v2(
  p_student_id   UUID,
  p_subject_code TEXT
)
RETURNS TABLE (
  chapter_number          INTEGER,
  chapter_title           TEXT,
  chapter_title_hi        TEXT,
  verified_question_count INTEGER
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = 'public'
AS $$
DECLARE
  v_student_id UUID;
  v_grade      TEXT;
BEGIN
  IF p_subject_code IS NULL OR LENGTH(p_subject_code) = 0 THEN
    RETURN;
  END IF;

  SELECT id, grade INTO v_student_id, v_grade
    FROM public.students
   WHERE (id = p_student_id OR auth_user_id = p_student_id)
     AND (auth.uid() IS NULL OR auth_user_id = auth.uid())
   LIMIT 1;

  IF v_student_id IS NULL OR v_grade IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    cs.chapter_number,
    cs.chapter_title,
    cs.chapter_title_hi,
    COALESCE((
      SELECT COUNT(*)::INTEGER FROM public.question_bank qb
       WHERE qb.subject = p_subject_code
         AND qb.grade = v_grade
         AND qb.chapter_number = cs.chapter_number
         AND qb.is_active
         AND qb.deleted_at IS NULL
         AND qb.verification_state = 'verified'
    ), 0) AS verified_question_count
  FROM public.cbse_syllabus cs
  WHERE cs.board        = 'CBSE'
    AND cs.grade        = v_grade
    AND cs.subject_code = p_subject_code
    AND cs.rag_status   IN ('partial', 'ready')
    AND cs.is_in_scope  = TRUE
  ORDER BY cs.chapter_number;
END;
$$;

REVOKE ALL ON FUNCTION public.available_chapters_for_student_subject_v2(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.available_chapters_for_student_subject_v2(UUID, TEXT) TO authenticated, service_role;

COMMENT ON FUNCTION public.available_chapters_for_student_subject_v2(UUID, TEXT) IS
  'Layer-2 SSoT read: returns partial+ready chapters in scope. Restored '
  '2026-05-09 after 20260508140000 inadvertently narrowed the filter to '
  'ready-only and dropped is_in_scope/board. Auth.uid() guard preserved. '
  'AI/quiz surfaces below enforce stricter gates per Phase 4 contract.';

-- Audit marker
INSERT INTO admin_audit_log (admin_id, action, entity_type, entity_id, details, created_at)
VALUES (
  NULL,
  'rag_grounding.v2_chapter_rpc_filters_restored',
  'system',
  NULL,
  jsonb_build_object(
    'migrated_at', now(),
    'rpc', 'available_chapters_for_student_subject_v2',
    'restored_filters', jsonb_build_array(
      'rag_status IN (partial, ready)',
      'is_in_scope = TRUE',
      'board = CBSE'
    ),
    'reason', 'security_hardening_migration_dropped_picker_filters',
    'reported_by', 'Pradeep Sharma',
    'reported_at', '2026-05-09'
  ),
  now()
);

COMMIT;
