-- Migration: 20260622050000_restore_compute_post_quiz_action.sql
-- Purpose: PHASE 1 adaptive-loop fix (Part B). Restore compute_post_quiz_action so the
--          post-quiz "next step" (cme_next_action) actually gets computed and stored.
--
-- RCA (confirmed against the linked DB, 2026-06-22):
--   submit_quiz_results_v2 (migration 20260622030000, ~line 411) does:
--       SELECT ca.action_type, ca.concept_id, ca.reason
--         INTO v_cme_action, v_cme_concept_id, v_cme_reason
--         FROM compute_post_quiz_action(p_student_id, p_subject, p_grade) ca;
--       UPDATE quiz_sessions SET cme_next_action=..., cme_next_concept_id=..., cme_reason=...
--   ...all wrapped in BEGIN ... EXCEPTION WHEN OTHERS THEN NULL. On live prod:
--     - compute_post_quiz_action DOES NOT EXIST  -> the SELECT raises 42883
--       (function does not exist), the EXCEPTION swallows it, and 0/82 quiz_sessions
--       ever get a cme_next_action. The post-quiz "next step" never surfaces.
--     - quiz_sessions.cme_next_concept_id and cme_reason columns ALSO DO NOT EXIST
--       (only cme_next_action does), so even with the function restored the UPDATE
--       would still throw + get swallowed. This migration adds those two columns so
--       the wrapped UPDATE can succeed.
--
-- Source adapted from the archived legacy:
--   supabase/migrations/_legacy/timestamped/20260405000002_post_quiz_cme_action.sql
-- with these corrections for the CURRENT live schema (verified):
--   - chapter_topics -> curriculum_topics. The legacy joined chapter_topics ->
--     chapters -> subjects; chapter_topics DOES NOT EXIST on prod. curriculum_topics
--     carries (id, subject_id, grade, chapter_number, title, title_hi) and is the
--     table concept_mastery.topic_id FK-references.
--   - mastery signal uses concept_mastery.mastery_probability (NUMERIC 0..1). The
--     legacy used cm.mastery_level::FLOAT, but mastery_level is a TEXT enum
--     ('developing', ...) on prod -> that cast would THROW. mastery_probability is
--     the numeric BKT estimate (verified present + populated, e.g. 0.45/0.55/0.62).
--   - subject filter via subjects.code (subjects has NO grade column; grade lives on
--     curriculum_topics). error_count_conceptual + current_retention now exist
--     (added by Phase 0 migration 20260622020000).
--
-- Contract: RETURNS TABLE(action_type text, concept_id uuid, reason text) — EXACTLY
--   the 3 columns submit_quiz_results_v2 SELECTs by name. 3 IN params
--   (p_student_id uuid, p_subject text, p_grade text). Grade is TEXT per P5.
--
-- Decision priority (first match wins) — preserved from legacy:
--   1. error_count_conceptual >= 3                 -> 'remediate'
--   2. current_retention < 0.5 AND mastery > 0.4   -> 'revise'
--   3. weakest mastery < 0.3                        -> 'teach'
--   4. weakest mastery < 0.6                        -> 'practice'
--   5. weakest mastery < 0.85                       -> 'challenge'
--   6. otherwise / no data                          -> 'exam_prep'
--
-- Idempotent: ADD COLUMN IF NOT EXISTS (additive, no DROP); DROP FUNCTION IF EXISTS
-- (exact 3-arg sig) + CREATE OR REPLACE. SECURITY DEFINER + SET search_path=public.
-- No RLS change.

BEGIN;

-- ── Add the two missing CME columns to quiz_sessions (additive; cme_next_action
--    already exists on prod). Without these, the wrapped UPDATE in
--    submit_quiz_results_v2 throws + is swallowed and the recommendation is lost.
ALTER TABLE public.quiz_sessions
  ADD COLUMN IF NOT EXISTS cme_next_concept_id uuid,
  ADD COLUMN IF NOT EXISTS cme_reason          text;

COMMENT ON COLUMN public.quiz_sessions.cme_next_concept_id IS
  'CME post-quiz recommendation: target curriculum_topics.id for the next step (nullable).';
COMMENT ON COLUMN public.quiz_sessions.cme_reason IS
  'CME post-quiz recommendation: human-readable reason for the recommended next action.';

-- ── Restore compute_post_quiz_action with the corrected join + signal.
DROP FUNCTION IF EXISTS public.compute_post_quiz_action(uuid, text, text);

CREATE OR REPLACE FUNCTION public.compute_post_quiz_action(
  p_student_id uuid,
  p_subject    text,
  p_grade      text
)
RETURNS TABLE(action_type text, concept_id uuid, reason text)
LANGUAGE plpgsql
SECURITY DEFINER
-- SECURITY DEFINER justified: invoked from submit_quiz_results_v2 (itself SECURITY
-- DEFINER) after the caller has been authorized against students.auth_user_id.
-- Reads concept_mastery rows scoped strictly to p_student_id; no cross-student
-- access and no writes.
SET search_path = public
AS $$
DECLARE
  v_concept_id     uuid;
  v_mastery        double precision;
  v_retention      double precision;
  v_err_conceptual integer;
  v_action         text;
  v_reason         text;
BEGIN
  -- Priority 1: topic with high conceptual error count (>= 3) -> remediate.
  SELECT cm.topic_id,
         COALESCE(cm.mastery_probability, 0),
         cm.error_count_conceptual
    INTO v_concept_id, v_mastery, v_err_conceptual
    FROM concept_mastery cm
    JOIN curriculum_topics ct ON ct.id = cm.topic_id
    JOIN subjects s          ON s.id = ct.subject_id
   WHERE cm.student_id = p_student_id
     AND s.code        = p_subject
     AND ct.grade      = p_grade
     AND COALESCE(cm.error_count_conceptual, 0) >= 3
   ORDER BY cm.error_count_conceptual DESC,
            COALESCE(cm.mastery_probability, 0) ASC
   LIMIT 1;

  IF v_concept_id IS NOT NULL THEN
    RETURN QUERY SELECT
      'remediate'::text,
      v_concept_id,
      ('Deep conceptual gaps detected (' || v_err_conceptual
        || ' conceptual errors). Needs targeted remediation.')::text;
    RETURN;
  END IF;

  -- Priority 2: topic being forgotten (retention decayed despite prior mastery).
  SELECT cm.topic_id,
         COALESCE(cm.mastery_probability, 0),
         COALESCE(cm.current_retention, 0)
    INTO v_concept_id, v_mastery, v_retention
    FROM concept_mastery cm
    JOIN curriculum_topics ct ON ct.id = cm.topic_id
    JOIN subjects s          ON s.id = ct.subject_id
   WHERE cm.student_id = p_student_id
     AND s.code        = p_subject
     AND ct.grade      = p_grade
     AND COALESCE(cm.current_retention, 0) < 0.5
     AND COALESCE(cm.mastery_probability, 0) > 0.4
   ORDER BY cm.current_retention ASC
   LIMIT 1;

  IF v_concept_id IS NOT NULL THEN
    RETURN QUERY SELECT
      'revise'::text,
      v_concept_id,
      ('Retention dropped to ' || ROUND(v_retention::numeric * 100)
        || '% despite prior mastery. Revision needed before it is lost.')::text;
    RETURN;
  END IF;

  -- Priority 3-6: weakest topic by mastery_probability, classified by level.
  SELECT cm.topic_id,
         COALESCE(cm.mastery_probability, 0)
    INTO v_concept_id, v_mastery
    FROM concept_mastery cm
    JOIN curriculum_topics ct ON ct.id = cm.topic_id
    JOIN subjects s          ON s.id = ct.subject_id
   WHERE cm.student_id = p_student_id
     AND s.code        = p_subject
     AND ct.grade      = p_grade
   ORDER BY COALESCE(cm.mastery_probability, 0) ASC
   LIMIT 1;

  IF v_concept_id IS NULL THEN
    -- No mastery rows for this student+subject+grade -> safe default.
    RETURN QUERY SELECT
      'exam_prep'::text,
      NULL::uuid,
      'No mastery data available for this subject. Ready for general practice.'::text;
    RETURN;
  END IF;

  IF v_mastery < 0.3 THEN
    v_action := 'teach';
    v_reason := 'Mastery at ' || ROUND(v_mastery::numeric * 100)
              || '%. This concept needs teaching from scratch.';
  ELSIF v_mastery < 0.6 THEN
    v_action := 'practice';
    v_reason := 'Mastery at ' || ROUND(v_mastery::numeric * 100)
              || '%. More practice needed to build fluency.';
  ELSIF v_mastery < 0.85 THEN
    v_action := 'challenge';
    v_reason := 'Mastery at ' || ROUND(v_mastery::numeric * 100)
              || '%. Ready for harder problems to push toward mastery.';
  ELSE
    v_action := 'exam_prep';
    v_reason := 'All topics above 85% mastery. Ready for exam-level practice.';
  END IF;

  RETURN QUERY SELECT v_action, v_concept_id, v_reason;
  RETURN;
END;
$$;

COMMENT ON FUNCTION public.compute_post_quiz_action(uuid, text, text) IS
  'PHASE 1 (migration 20260622050000): restored from archived legacy '
  '20260405000002 with live-schema corrections. Analyzes concept_mastery for a '
  'student+subject+grade (joined via curriculum_topics -> subjects.code; grade on '
  'curriculum_topics) and returns the recommended next action '
  '(remediate/revise/teach/practice/challenge/exam_prep) + target concept + reason. '
  'Uses mastery_probability (numeric) NOT mastery_level (text enum). Called best-effort '
  'from submit_quiz_results_v2 inside an EXCEPTION wrapper. Grade TEXT per P5. '
  'SECURITY DEFINER + search_path=public.';

GRANT EXECUTE ON FUNCTION public.compute_post_quiz_action(uuid, text, text)
  TO authenticated, service_role;

INSERT INTO public.admin_audit_log (admin_id, action, entity_type, entity_id, details, created_at)
VALUES (
  NULL,
  'data_quality.compute_post_quiz_action_restored',
  'system',
  NULL,
  jsonb_build_object(
    'migrated_at', now(),
    'reason', 'PHASE 1 adaptive-loop fix: restore compute_post_quiz_action (missing on prod -> submit_quiz_results_v2 caught 42883 + 0/82 sessions got cme_next_action). Also adds quiz_sessions.cme_next_concept_id + cme_reason so the wrapped CME UPDATE succeeds.',
    'rca', '2026-06-22',
    'function', 'compute_post_quiz_action',
    'source_legacy', '20260405000002_post_quiz_cme_action.sql',
    'corrections', jsonb_build_array(
      'chapter_topics -> curriculum_topics (chapter_topics absent on prod)',
      'mastery_level::FLOAT -> mastery_probability (mastery_level is TEXT enum)',
      'subject filter via subjects.code; grade via curriculum_topics.grade',
      'added quiz_sessions.cme_next_concept_id + cme_reason columns'
    )
  ),
  now()
);

COMMIT;
