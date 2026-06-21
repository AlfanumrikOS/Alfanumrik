-- Migration: 20260621000500_backfill_question_bank_topic_id.sql
-- Purpose: RCA 2026-06-21 — backfill question_bank.topic_id from curriculum_topics
--          so that submit_quiz_results_v2's mastery-write guard (IF v_q_topic_id IS NOT NULL)
--          actually fires. Without this, all 37 active students have empty concept_mastery
--          tables despite many quiz completions.
--
-- Join key: (subjects.code = question_bank.subject, curriculum_topics.grade = question_bank.grade,
--            curriculum_topics.chapter_number = question_bank.chapter_number)
-- Tiebreak: ORDER BY ct.display_order ASC LIMIT 1 when multiple topics map to one chapter.
-- Scope:    Only rows where topic_id IS NULL AND is_active = true. Idempotent.
-- Risk:     No schema change. No RLS impact. Pure data repair.

BEGIN;

-- Backfill question_bank.topic_id from curriculum_topics
-- Joins on (subject_code, grade, chapter_number) — the only reliable link
-- since question_bank has no direct topic FK when imported via the bulk pipeline.
-- Safe: UPDATE ... WHERE topic_id IS NULL only. Idempotent.

DO $$
DECLARE
  v_before BIGINT;
  v_updated BIGINT;
BEGIN
  SELECT COUNT(*) INTO v_before FROM public.question_bank WHERE topic_id IS NULL AND is_active = true;

  UPDATE public.question_bank qb
  SET    topic_id = (
    SELECT ct.id
    FROM   public.curriculum_topics ct
    JOIN   public.subjects s ON s.id = ct.subject_id
    WHERE  s.code            = qb.subject
      AND  ct.grade          = qb.grade
      AND  ct.chapter_number = qb.chapter_number
      AND  ct.is_active      = true
    ORDER BY ct.display_order ASC
    LIMIT 1
  ),
  updated_at = now()
  WHERE qb.topic_id IS NULL
    AND qb.is_active = true;

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_before > 0 AND v_updated = 0 THEN
    RAISE WARNING 'backfill_question_bank_topic_id: % questions had NULL topic_id but 0 rows updated — curriculum_topics may not have matching (subject, grade, chapter_number) rows', v_before;
  ELSE
    RAISE NOTICE 'backfill_question_bank_topic_id: updated % / % question rows', v_updated, v_before;
  END IF;
END;
$$;

INSERT INTO public.admin_audit_log (admin_id, action, entity_type, entity_id, details, created_at)
VALUES (
  NULL,
  'data_quality.question_bank_topic_id_backfill',
  'system',
  NULL,
  jsonb_build_object(
    'migrated_at', now(),
    'reason', 'topic_id was NULL for all questions — submit_quiz_results_v2 guard skipped mastery writes for all 37 students',
    'rca', '2026-06-21'
  ),
  now()
);

COMMIT;
