-- Migration: 20260702000600_extend_gap_and_path_with_concept_edges.sql
-- Purpose: Digital Twin Slice 1. Teach the two existing learning-graph functions
--          to ALSO consider the unified concept_edges graph, WITHOUT changing any
--          existing behavior (backward compatible -- every legacy code path still
--          returns exactly what it did before).
--
--   1. detect_knowledge_gaps(p_student_id, p_subject)
--      Keeps the original concept_graph.prerequisite_codes branch BYTE-IDENTICAL,
--      then UNION ALLs an ADDITIVE branch that surfaces missing prerequisites
--      coming from the OTHER two unified sources (curriculum_topics +
--      learning_objectives) via concept_edges -- i.e. exactly the prerequisites
--      the concept_graph-only logic used to miss. concept_graph-sourced edges are
--      excluded from the new branch (the original branch already returns them) so
--      there is zero double-counting. Same RETURNS shape, same >= 0.3 filter,
--      same ORDER BY. Same signature/attributes (LANGUAGE plpgsql, not SECURITY
--      DEFINER, search_path public, pg_temp) so the existing ACL is preserved.
--
--   2. generate_learning_path(p_student_id, p_subject, p_grade, p_path_type)
--      The three existing path types ('remedial', 'exam_prep', and the 'adaptive'
--      ELSE default) are LEFT BYTE-IDENTICAL. A NEW, OPT-IN path type
--      'prerequisite_aware' is added that orders the same not-yet-mastered topic
--      set by prerequisite depth (foundational topics first) using
--      traverse_prerequisites over concept_edges. Old callers (which never pass
--      'prerequisite_aware') are completely unaffected. Same signature/attributes
--      (SECURITY DEFINER, search_path '') so the existing ACL is preserved.
--
-- Idempotent (CREATE OR REPLACE). No DROP. Additive only. Grades stay text.

BEGIN;

-- ─── 1. detect_knowledge_gaps -- additive edge branch ────────────────────────
CREATE OR REPLACE FUNCTION public.detect_knowledge_gaps(
  p_student_id uuid,
  p_subject text
)
RETURNS TABLE (
  target_concept_id uuid,
  target_concept_name text,
  missing_prerequisite_id uuid,
  missing_prerequisite_name text,
  confidence_score numeric
)
LANGUAGE plpgsql
SET search_path = 'public', 'pg_temp'
AS $$
BEGIN
  RETURN QUERY
  WITH error_patterns AS (
    SELECT qb.concept_id,
           COUNT(*) AS error_count,
           COUNT(*) FILTER (WHERE qr.is_correct) AS correct_count
    FROM question_responses qr
    JOIN question_bank qb ON qr.question_id = qb.id
    WHERE qr.student_id = p_student_id
      AND qb.subject = p_subject
      AND qr.created_at >= NOW() - INTERVAL '30 days'
    GROUP BY qb.concept_id
    HAVING COUNT(*) >= 3
       AND COUNT(*) FILTER (WHERE qr.is_correct) / COUNT(*)::NUMERIC < 0.5
  ),
  -- (unchanged) original concept_graph.prerequisite_codes branch.
  prerequisite_analysis AS (
    SELECT ep.concept_id AS target_concept_id,
           cg1.concept_name AS target_concept_name,
           UNNEST(cg1.prerequisite_codes)::UUID AS missing_prerequisite_id,
           cg2.concept_name AS missing_prerequisite_name,
           LEAST(0.9, ep.error_count / 5.0) AS confidence_score
    FROM error_patterns ep
    JOIN concept_graph cg1 ON ep.concept_id = cg1.id
    JOIN concept_graph cg2 ON cg2.id = ANY(cg1.prerequisite_codes::UUID[])
    WHERE array_length(cg1.prerequisite_codes, 1) > 0
  ),
  -- (additive) prerequisites unified from the OTHER two sources via concept_edges.
  -- concept_graph-sourced edges are excluded -- the original branch covers those.
  edge_prerequisite_analysis AS (
    SELECT ep.concept_id AS target_concept_id,
           cg1.concept_name AS target_concept_name,
           ce.from_topic_id AS missing_prerequisite_id,
           COALESCE(cgp.concept_name, ctp.title) AS missing_prerequisite_name,
           LEAST(0.9, ep.error_count / 5.0) * COALESCE(ce.strength, 1.0) AS confidence_score
    FROM error_patterns ep
    JOIN concept_graph cg1 ON ep.concept_id = cg1.id
    JOIN concept_edges ce
      ON ce.to_topic_id = ep.concept_id
     AND ce.edge_type = 'prerequisite'
     AND ce.source <> 'concept_graph'
    LEFT JOIN concept_graph cgp ON cgp.id = ce.from_topic_id
    LEFT JOIN curriculum_topics ctp ON ctp.id = ce.from_topic_id
  ),
  combined AS (
    SELECT * FROM prerequisite_analysis
    UNION ALL
    SELECT * FROM edge_prerequisite_analysis
  )
  SELECT * FROM combined
  WHERE confidence_score >= 0.3
  ORDER BY confidence_score DESC;
END;
$$;

-- ─── 2. generate_learning_path -- additive 'prerequisite_aware' path type ─────
CREATE OR REPLACE FUNCTION public.generate_learning_path(
  p_student_id uuid,
  p_subject text,
  p_grade text,
  p_path_type text DEFAULT 'adaptive'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_path_id UUID;
  v_topic_ids UUID[];
  v_subj_id UUID;
BEGIN
  SELECT id INTO v_subj_id FROM public.subjects WHERE code = p_subject;

  IF p_path_type = 'remedial' THEN
    SELECT ARRAY_AGG(ct.id ORDER BY COALESCE(cm.mastery_probability, 0) ASC, ct.display_order)
    INTO v_topic_ids
    FROM public.curriculum_topics ct
    LEFT JOIN public.concept_mastery cm ON cm.topic_id = ct.id AND cm.student_id = p_student_id
    WHERE ct.subject_id = v_subj_id AND ct.grade = p_grade
      AND COALESCE(cm.mastery_probability, 0) < 0.4;

  ELSIF p_path_type = 'exam_prep' THEN
    SELECT ARRAY_AGG(ct.id ORDER BY ct.difficulty_level DESC, ct.display_order)
    INTO v_topic_ids
    FROM public.curriculum_topics ct
    WHERE ct.subject_id = v_subj_id AND ct.grade = p_grade AND ct.is_active = TRUE;

  ELSIF p_path_type = 'prerequisite_aware' THEN
    -- ADDITIVE (Digital Twin Slice 1): same not-yet-mastered topic set as the
    -- 'adaptive' default, but ordered by prerequisite depth (foundational topics
    -- first) using the unified concept_edges graph via traverse_prerequisites.
    SELECT ARRAY_AGG(
             ct.id
             ORDER BY COALESCE(pr.prereq_count, 0) ASC,
                      COALESCE(cm.mastery_probability, 0) ASC,
                      ct.display_order
           )
    INTO v_topic_ids
    FROM public.curriculum_topics ct
    LEFT JOIN public.concept_mastery cm ON cm.topic_id = ct.id AND cm.student_id = p_student_id
    LEFT JOIN LATERAL (
      SELECT COUNT(DISTINCT tp.prerequisite_topic_id) AS prereq_count
      FROM public.traverse_prerequisites(ct.id, 5) tp
    ) pr ON TRUE
    WHERE ct.subject_id = v_subj_id AND ct.grade = p_grade AND ct.is_active = TRUE
      AND COALESCE(cm.mastery_level, 'not_started') NOT IN ('mastered');

  ELSE
    SELECT ARRAY_AGG(ct.id ORDER BY ct.display_order)
    INTO v_topic_ids
    FROM public.curriculum_topics ct
    LEFT JOIN public.concept_mastery cm ON cm.topic_id = ct.id AND cm.student_id = p_student_id
    WHERE ct.subject_id = v_subj_id AND ct.grade = p_grade AND ct.is_active = TRUE
      AND COALESCE(cm.mastery_level, 'not_started') NOT IN ('mastered');
  END IF;

  INSERT INTO public.learning_paths (
    student_id, subject, grade, title, path_type, topic_sequence, total_topics
  )
  VALUES (
    p_student_id, p_subject, p_grade,
    CASE p_path_type
      WHEN 'remedial' THEN p_grade || ' ' || p_subject || ' - Remedial Path'
      WHEN 'exam_prep' THEN p_grade || ' ' || p_subject || ' - Exam Prep'
      WHEN 'prerequisite_aware' THEN p_grade || ' ' || p_subject || ' - Prerequisite-Aware Path'
      ELSE p_grade || ' ' || p_subject || ' - Learning Path'
    END,
    p_path_type,
    COALESCE(v_topic_ids, '{}'),
    COALESCE(array_length(v_topic_ids, 1), 0)
  )
  RETURNING id INTO v_path_id;

  RETURN v_path_id;
END;
$$;

COMMIT;
