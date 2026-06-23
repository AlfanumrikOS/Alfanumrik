-- Migration: 20260623000800_derive_dashboard_bloom_and_gaps_from_concept_mastery.sql
-- Purpose: Repoint get_dashboard_data's INLINE bloom + knowledge_gaps reads to DERIVE
--          from the populated public.concept_mastery instead of the (empty)
--          public.bloom_progression / public.knowledge_gaps tables.
--
-- WHY: Sibling migration 20260623000700 already repointed the STANDALONE RPCs
--      get_bloom_progression + get_knowledge_gaps to derive from concept_mastery.
--      But get_dashboard_data (baseline) does NOT call those RPCs — it reads the two
--      empty source tables INLINE (bloom_progression LIMIT 1 -> v_bloom; knowledge_gaps
--      LIMIT 3 -> v_gaps). Those tables are never written by the quiz/mastery pipeline,
--      so the dashboard's 'bloom' and 'knowledge_gaps' keys are dead (null / []).
--      This fixes them the SAME way, from the SAME single source of truth.
--
-- CONTRACT (consumer-preserving — get_dashboard_data's emitted shape is AUTHORITATIVE,
-- NOT the standalone RPCs' shape):
--   * Signature PRESERVED exactly: get_dashboard_data(p_student_id uuid) RETURNS jsonb.
--   * All ~11 top-level keys PRESERVED unchanged: profiles, due_count, unread_count,
--     knowledge_gaps, velocity, bloom, cbse_readiness, exams, nudges, retention_score,
--     error_breakdown. Only the DERIVATION of 'bloom' and 'knowledge_gaps' changes.
--   * 'bloom' shape PRESERVED: a SINGLE jsonb OBJECT (not an array) with keys
--     current_bloom_level, remember_mastery, understand_mastery, apply_mastery,
--     analyze_mastery, evaluate_mastery, create_mastery — or NULL when the student has
--     no practiced concepts (matching the prior inline LIMIT-1 NULL-when-empty behavior).
--     The standalone get_bloom_progression returns an ARRAY-per-subject; we deliberately
--     do NOT adopt that here (consumer-preserving). We DO reuse 000700's averaging logic
--     (AVG of bloom_mastery->>level over practiced concepts) and the SAME
--     current_bloom_level rule (highest level whose avg mastery >= 0.6, else 'remember').
--   * 'knowledge_gaps' shape PRESERVED: a jsonb ARRAY of objects with EXACTLY the prior
--     5 fields { id, target_concept_name, missing_prerequisite_name, status,
--     confidence_score }, ordered confidence_score DESC, LIMIT 3 (the prior inline cap).
--     We reuse 000700's weak-concept derivation (mastery_probability < 0.5 OR
--     error_count_conceptual >= 2; confidence_score = 1 - mastery_probability) so the
--     dashboard tile and the standalone RPC stay consistent. status is mapped to the
--     dashboard's prior domain: the inline read filtered status != 'resolved', so the
--     derived rows emit status = 'open'.
--
-- POSTURE (preserved): SECURITY DEFINER + STABLE + SET search_path = 'public' +
--   student-scoped WHERE (SELECT * INTO v_student FROM students WHERE id = p_student_id,
--   and every derived read is keyed cm.student_id = p_student_id). The subject join is
--   topic_id -> curriculum_topics.subject_id -> subjects, the SAME join
--   get_bloom_progression / get_knowledge_gaps / get_due_reviews use.
--
-- SINGLE SOURCE OF TRUTH = concept_mastery. This migration does NOT write the empty
-- bloom_progression / knowledge_gaps tables (no DROP, no INSERT/UPDATE into them).
--
-- Idempotent: DROP FUNCTION IF EXISTS (exact signature) + CREATE OR REPLACE.
-- Additive, read-only aggregation. P1/P2/P6 untouched. P8 RLS posture unchanged.
-- Re-asserts the deployed grant posture (anon revoked; authenticated+service_role granted).

BEGIN;

DROP FUNCTION IF EXISTS public.get_dashboard_data(p_student_id uuid);

CREATE OR REPLACE FUNCTION public.get_dashboard_data(p_student_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  result jsonb;
  v_student record;
  v_profiles jsonb;
  v_due_count int;
  v_unread_count int;
  v_gaps jsonb;
  v_velocity numeric;
  v_bloom jsonb;
  v_cbse_readiness numeric;
  v_exams jsonb;
  v_nudges jsonb;
  v_retention_score numeric;
  v_error_breakdown jsonb;
BEGIN
  SELECT * INTO v_student FROM students WHERE id = p_student_id;
  IF v_student IS NULL THEN
    RETURN jsonb_build_object('error', 'Student not found');
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(slp)), '[]'::jsonb)
  INTO v_profiles
  FROM student_learning_profiles slp
  WHERE slp.student_id = p_student_id;

  SELECT count(*) INTO v_due_count
  FROM concept_mastery
  WHERE student_id = p_student_id AND next_review_at <= now();

  SELECT count(*) INTO v_unread_count
  FROM notifications
  WHERE recipient_id = p_student_id AND is_read = false;

  -- CHANGED: knowledge_gaps now DERIVED from concept_mastery (weak-concept rule from
  -- migration 20260623000700) instead of the empty knowledge_gaps table.
  -- Shape PRESERVED: array of { id, target_concept_name, missing_prerequisite_name,
  -- status, confidence_score }, ordered confidence_score DESC, LIMIT 3 (prior cap).
  SELECT COALESCE(jsonb_agg(row_to_json(g) ORDER BY g.confidence_score DESC), '[]'::jsonb)
  INTO v_gaps
  FROM (
    SELECT
      cm.topic_id                                        AS id,
      ct.title                                           AS target_concept_name,
      -- No prerequisite graph available; Tier-1 partial reuses the topic title
      -- (same convention as get_knowledge_gaps in 20260623000700).
      ct.title                                           AS missing_prerequisite_name,
      'open'::text                                       AS status,
      ROUND((1 - COALESCE(cm.mastery_probability, 0))::numeric, 4) AS confidence_score
    FROM concept_mastery cm
    JOIN curriculum_topics ct ON ct.id = cm.topic_id
    JOIN subjects s ON s.id = ct.subject_id
    WHERE cm.student_id = p_student_id
      AND COALESCE(cm.attempts, 0) > 0
      AND (
        COALESCE(cm.mastery_probability, 0) < 0.5
        OR COALESCE(cm.error_count_conceptual, 0) >= 2
      )
    ORDER BY COALESCE(cm.mastery_probability, 0) ASC
    LIMIT 3
  ) g;

  SELECT weekly_mastery_rate INTO v_velocity
  FROM learning_velocity
  WHERE student_id = p_student_id
  ORDER BY last_calculated_at DESC LIMIT 1;

  -- CHANGED: bloom now DERIVED from concept_mastery.bloom_mastery (per-level averaging
  -- from migration 20260623000700) instead of the empty bloom_progression table.
  -- Shape PRESERVED: a SINGLE object { current_bloom_level, remember_mastery,
  -- understand_mastery, apply_mastery, analyze_mastery, evaluate_mastery,
  -- create_mastery }, or NULL when the student has no practiced concepts.
  WITH bloom_avg AS (
    SELECT
      AVG(COALESCE((cm.bloom_mastery->>'remember')::float,   0)) AS remember_mastery,
      AVG(COALESCE((cm.bloom_mastery->>'understand')::float,  0)) AS understand_mastery,
      AVG(COALESCE((cm.bloom_mastery->>'apply')::float,       0)) AS apply_mastery,
      AVG(COALESCE((cm.bloom_mastery->>'analyze')::float,     0)) AS analyze_mastery,
      AVG(COALESCE((cm.bloom_mastery->>'evaluate')::float,    0)) AS evaluate_mastery,
      AVG(COALESCE((cm.bloom_mastery->>'create')::float,      0)) AS create_mastery,
      COUNT(*) AS n
    FROM concept_mastery cm
    WHERE cm.student_id = p_student_id
      AND COALESCE(cm.attempts, 0) > 0
  )
  SELECT CASE WHEN ba.n > 0 THEN jsonb_build_object(
    -- highest Bloom level whose avg mastery >= 0.6, else 'remember' (same rule as 000700)
    'current_bloom_level', CASE
      WHEN ba.create_mastery   >= 0.6 THEN 'create'
      WHEN ba.evaluate_mastery >= 0.6 THEN 'evaluate'
      WHEN ba.analyze_mastery  >= 0.6 THEN 'analyze'
      WHEN ba.apply_mastery    >= 0.6 THEN 'apply'
      WHEN ba.understand_mastery >= 0.6 THEN 'understand'
      ELSE 'remember'
    END,
    'remember_mastery',   ROUND(ba.remember_mastery::numeric,   4),
    'understand_mastery', ROUND(ba.understand_mastery::numeric, 4),
    'apply_mastery',      ROUND(ba.apply_mastery::numeric,      4),
    'analyze_mastery',    ROUND(ba.analyze_mastery::numeric,    4),
    'evaluate_mastery',   ROUND(ba.evaluate_mastery::numeric,   4),
    'create_mastery',     ROUND(ba.create_mastery::numeric,     4)
  ) ELSE NULL END
  INTO v_bloom
  FROM bloom_avg ba;

  SELECT cbse_readiness_pct INTO v_cbse_readiness
  FROM adaptive_profile WHERE student_id = p_student_id LIMIT 1;

  SELECT COALESCE(jsonb_agg(row_to_json(e)), '[]'::jsonb) INTO v_exams
  FROM (
    SELECT id, exam_name, exam_type, subject, exam_date
    FROM exam_configs
    WHERE student_id = p_student_id AND is_active = true AND exam_date >= CURRENT_DATE
    ORDER BY exam_date LIMIT 3
  ) e;

  SELECT COALESCE(jsonb_agg(row_to_json(n)), '[]'::jsonb) INTO v_nudges
  FROM (
    SELECT id, nudge_type, message, message_hi, priority
    FROM smart_nudges
    WHERE student_id = p_student_id AND is_read = false AND is_dismissed = false
    ORDER BY priority DESC LIMIT 3
  ) n;

  -- FIXED: retention_tests.score → retention_score_percent (actual column name)
  SELECT ROUND(AVG(retention_score_percent)) INTO v_retention_score
  FROM (
    SELECT retention_score_percent FROM retention_tests
    WHERE student_id = p_student_id AND status = 'completed'
    ORDER BY completed_at DESC LIMIT 10
  ) r;

  -- Error breakdown from recent wrong answers
  WITH recent_errors AS (
    SELECT response_time_seconds
    FROM question_responses
    WHERE student_id = p_student_id AND is_correct = false
    ORDER BY created_at DESC LIMIT 50
  ), stats AS (
    SELECT
      count(*) as total,
      AVG(COALESCE(response_time_seconds, 10)) as avg_time
    FROM recent_errors
  )
  SELECT CASE WHEN s.total > 0 THEN jsonb_build_object(
    'careless', ROUND(100.0 * count(*) FILTER (WHERE COALESCE(re.response_time_seconds, 10) < GREATEST(s.avg_time * 0.3, 3)) / s.total),
    'conceptual', ROUND(100.0 * count(*) FILTER (WHERE COALESCE(re.response_time_seconds, 10) > s.avg_time * 2.5) / s.total),
    'misinterpretation', ROUND(100.0 * (s.total
      - count(*) FILTER (WHERE COALESCE(re.response_time_seconds, 10) < GREATEST(s.avg_time * 0.3, 3))
      - count(*) FILTER (WHERE COALESCE(re.response_time_seconds, 10) > s.avg_time * 2.5)
    ) / s.total)
  ) ELSE NULL END
  INTO v_error_breakdown
  FROM recent_errors re, stats s
  GROUP BY s.total, s.avg_time;

  result := jsonb_build_object(
    'profiles', v_profiles,
    'due_count', COALESCE(v_due_count, 0),
    'unread_count', COALESCE(v_unread_count, 0),
    'knowledge_gaps', v_gaps,
    'velocity', v_velocity,
    'bloom', v_bloom,
    'cbse_readiness', v_cbse_readiness,
    'exams', v_exams,
    'nudges', v_nudges,
    'retention_score', v_retention_score,
    'error_breakdown', v_error_breakdown
  );

  RETURN result;
END;
$$;

-- Preserve the deployed grant posture. The baseline granted authenticated/service_role;
-- migration 20260515000002 REVOKED anon EXECUTE. DROP+CREATE resets grants, so re-assert.
REVOKE EXECUTE ON FUNCTION public.get_dashboard_data(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_dashboard_data(uuid) TO authenticated, service_role;

COMMIT;
