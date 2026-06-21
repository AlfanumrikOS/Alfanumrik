-- Migration: 20260621000700_fix_missing_rag_chapters.sql
-- Purpose: RCA 2026-06-21 — promote cbse_syllabus chapters with rag_status = 'missing'
--          to 'partial' where verified questions already exist in question_bank.
--
-- Problem: available_chapters_for_student_subject_v2 (migration 20260512000000)
--          filters to rag_status IN ('partial', 'ready'). Chapters with rag_status
--          = 'missing' are invisible in the learn picker even when they have verified
--          questions, causing 11 chapters to be unreachable for students.
--
-- Fix: UPDATE rag_status missing → partial only where at least one verified,
--      active, non-deleted question_bank row matches on (subject_code, grade,
--      chapter_number). Safe: chapters with no verified questions remain 'missing'.
-- Idempotent: WHERE rag_status = 'missing' guard means re-runs are a no-op.

BEGIN;

UPDATE public.cbse_syllabus cs
SET    rag_status  = 'partial',
       updated_at  = now()
WHERE  cs.rag_status = 'missing'
  AND  cs.board      = 'CBSE'
  AND  EXISTS (
    SELECT 1
    FROM   public.question_bank qb
    WHERE  qb.subject            = cs.subject_code
      AND  qb.grade              = cs.grade
      AND  qb.chapter_number     = cs.chapter_number
      AND  qb.is_active          = true
      AND  qb.deleted_at         IS NULL
      AND  qb.verification_state = 'verified'
  );

INSERT INTO public.admin_audit_log (admin_id, action, entity_type, entity_id, details, created_at)
VALUES (
  NULL,
  'data_quality.cbse_syllabus_rag_status_promoted',
  'system',
  NULL,
  jsonb_build_object(
    'migrated_at', now(),
    'change', 'rag_status missing → partial for chapters with verified questions',
    'reason', 'chapters were invisible in learn picker despite having verified questions',
    'rca', '2026-06-21'
  ),
  now()
);

COMMIT;
