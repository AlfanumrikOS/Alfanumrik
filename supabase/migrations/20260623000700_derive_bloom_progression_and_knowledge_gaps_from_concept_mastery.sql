-- Migration: 20260623000700_derive_bloom_progression_and_knowledge_gaps_from_concept_mastery.sql
-- Purpose: Repoint get_bloom_progression + get_knowledge_gaps to DERIVE from the
--          populated public.concept_mastery instead of reading the (empty)
--          public.bloom_progression / public.knowledge_gaps tables.
--
-- WHY: bloom_progression and knowledge_gaps are never written by the quiz/mastery
--      pipeline, so the two RPCs always returned []. The progress page
--      (MasteryBloomPanel) and KnowledgeGapActions surfaces were therefore dead.
--      concept_mastery IS populated (per student x topic, with bloom_mastery JSONB,
--      mastery_probability, error_count_*) so both surfaces can be derived from it.
--
-- CONTRACT (assessment-authored, consumer-verified):
--   * Signatures are PRESERVED exactly (get_bloom_progression(uuid,text DEFAULT NULL),
--     get_knowledge_gaps(uuid,text DEFAULT NULL,int DEFAULT 10)), RETURNS jsonb.
--   * get_bloom_progression: jsonb ARRAY, one object per practiced SUBJECT; consumer
--     reads b.subject + b.`${level}_mastery` (0..1) at src/app/progress/page.tsx:433-434.
--   * get_knowledge_gaps: jsonb ARRAY, field SUPERSET satisfying all consumers; the
--     progress KnowledgeGapActions reads confidence_score, target_concept_name,
--     missing_prerequisite_name, topic_title?, and re-derives severity via strict ">"
--     thresholds (>0.7 critical, >0.4 high, else medium) from confidence_score.
--
-- POSTURE (preserved): SECURITY DEFINER + SET search_path = 'public' + student-scoped
--   WHERE student_id, mirroring get_mastery_overview / get_due_reviews. The subject
--   join is topic_id -> curriculum_topics.subject_id -> subjects.code, the SAME join
--   get_due_reviews/get_mastery_overview use.
--
-- SINGLE SOURCE OF TRUTH = concept_mastery. This migration does NOT write the empty
-- bloom_progression / knowledge_gaps tables (no DROP, no INSERT into them).
--
-- Idempotent: DROP FUNCTION IF EXISTS (exact signature) + CREATE OR REPLACE.
-- Additive, read-only aggregation. P1/P2/P6 untouched. No schema/RLS change.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- RPC 1: get_bloom_progression  — derive per-subject Bloom averages
-- ─────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.get_bloom_progression(p_student_id uuid, p_subject text);

CREATE OR REPLACE FUNCTION public.get_bloom_progression(
  p_student_id uuid,
  p_subject text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_result jsonb;
BEGIN
  WITH per_subject AS (
    SELECT
      s.code AS subject,
      AVG(COALESCE((cm.bloom_mastery->>'remember')::float,   0)) AS remember_mastery,
      AVG(COALESCE((cm.bloom_mastery->>'understand')::float,  0)) AS understand_mastery,
      AVG(COALESCE((cm.bloom_mastery->>'apply')::float,       0)) AS apply_mastery,
      AVG(COALESCE((cm.bloom_mastery->>'analyze')::float,     0)) AS analyze_mastery,
      AVG(COALESCE((cm.bloom_mastery->>'evaluate')::float,    0)) AS evaluate_mastery,
      AVG(COALESCE((cm.bloom_mastery->>'create')::float,      0)) AS create_mastery,
      MAX(cm.updated_at) AS updated_at
    FROM concept_mastery cm
    JOIN curriculum_topics ct ON ct.id = cm.topic_id
    JOIN subjects s ON s.id = ct.subject_id
    WHERE cm.student_id = p_student_id
      AND COALESCE(cm.attempts, 0) > 0
      AND (p_subject IS NULL OR s.code = p_subject)
    GROUP BY s.code
  ),
  with_levels AS (
    SELECT
      ps.*,
      -- highest Bloom level whose avg mastery >= 0.6, else 'remember'
      CASE
        WHEN ps.create_mastery   >= 0.6 THEN 'create'
        WHEN ps.evaluate_mastery >= 0.6 THEN 'evaluate'
        WHEN ps.analyze_mastery  >= 0.6 THEN 'analyze'
        WHEN ps.apply_mastery    >= 0.6 THEN 'apply'
        WHEN ps.understand_mastery >= 0.6 THEN 'understand'
        ELSE 'remember'
      END AS current_bloom_level
    FROM per_subject ps
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'concept_id', NULL,
      'subject', wl.subject,
      'current_bloom_level', wl.current_bloom_level,
      -- ZPD = current + 1, capped at 'create'
      'zpd_bloom_level', CASE wl.current_bloom_level
        WHEN 'remember'   THEN 'understand'
        WHEN 'understand' THEN 'apply'
        WHEN 'apply'      THEN 'analyze'
        WHEN 'analyze'    THEN 'evaluate'
        WHEN 'evaluate'   THEN 'create'
        WHEN 'create'     THEN 'create'
        ELSE 'understand'
      END,
      'remember_mastery',   ROUND(wl.remember_mastery::numeric,   4),
      'understand_mastery', ROUND(wl.understand_mastery::numeric, 4),
      'apply_mastery',      ROUND(wl.apply_mastery::numeric,      4),
      'analyze_mastery',    ROUND(wl.analyze_mastery::numeric,    4),
      'evaluate_mastery',   ROUND(wl.evaluate_mastery::numeric,   4),
      'create_mastery',     ROUND(wl.create_mastery::numeric,     4),
      'updated_at', wl.updated_at
    )
    ORDER BY wl.updated_at DESC NULLS LAST
  ), '[]'::jsonb)
  INTO v_result
  FROM with_levels wl;

  RETURN v_result;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- RPC 2: get_knowledge_gaps  — derive weak concepts from concept_mastery
-- ─────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.get_knowledge_gaps(p_student_id uuid, p_subject text, p_limit integer);

CREATE OR REPLACE FUNCTION public.get_knowledge_gaps(
  p_student_id uuid,
  p_subject text DEFAULT NULL,
  p_limit integer DEFAULT 10
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_result jsonb;
BEGIN
  WITH weak AS (
    SELECT
      cm.topic_id,
      cm.student_id,
      s.code AS subject,
      ct.title AS topic,
      COALESCE(cm.mastery_probability, 0) AS mastery_probability,
      cm.updated_at,
      (1 - COALESCE(cm.mastery_probability, 0)) AS confidence_score
    FROM concept_mastery cm
    JOIN curriculum_topics ct ON ct.id = cm.topic_id
    JOIN subjects s ON s.id = ct.subject_id
    WHERE cm.student_id = p_student_id
      AND COALESCE(cm.attempts, 0) > 0
      AND (
        COALESCE(cm.mastery_probability, 0) < 0.5
        OR COALESCE(cm.error_count_conceptual, 0) >= 2
      )
      AND (p_subject IS NULL OR s.code = p_subject)
    ORDER BY COALESCE(cm.mastery_probability, 0) ASC
    LIMIT p_limit
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', w.topic_id,
      'student_id', w.student_id,
      'concept_id', w.topic_id,
      'subject', w.subject,
      'topic', w.topic,
      'target_concept_name', w.topic,
      -- No prerequisite graph available; Tier-1 partial reuses the topic title.
      'missing_prerequisite_name', w.topic,
      'detection_method', CASE
        WHEN w.mastery_probability < 0.5 THEN 'low_mastery'
        ELSE 'conceptual_errors'
      END,
      'confidence_score', ROUND(w.confidence_score::numeric, 4),
      'mastery_probability', ROUND(w.mastery_probability::numeric, 4),
      -- strict ">" thresholds computed from confidence_score so it matches the
      -- consumers' own computeSeverity (KnowledgeGapActions.tsx).
      'severity', CASE
        WHEN w.confidence_score > 0.7 THEN 'critical'
        WHEN w.confidence_score > 0.4 THEN 'high'
        ELSE 'medium'
      END,
      'status', 'open',
      'detected_at', w.updated_at
    )
    ORDER BY w.mastery_probability ASC
  ), '[]'::jsonb)
  INTO v_result
  FROM weak w;

  RETURN v_result;
END;
$$;

-- Preserve the security-hardening posture (anon must not invoke definer-rights code).
-- 20260515000002 revoked anon EXECUTE on both; CREATE OR REPLACE keeps existing grants,
-- but DROP+CREATE resets them, so re-assert the default-deny + service_role/auth grants.
REVOKE EXECUTE ON FUNCTION public.get_bloom_progression(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_knowledge_gaps(uuid, text, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_bloom_progression(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_knowledge_gaps(uuid, text, integer) TO authenticated, service_role;

COMMIT;
