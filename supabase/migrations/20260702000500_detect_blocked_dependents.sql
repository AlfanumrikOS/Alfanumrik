-- Migration: 20260702000500_detect_blocked_dependents.sql
-- Purpose: Digital Twin Slice 1. RPC detect_blocked_dependents(p_student_id,
--          p_decay_floor, p_mastery_floor) -- surface ADVANCED topics that are
--          blocked because a PREREQUISITE is weak (mastery below floor) or
--          forgotten (decay below floor), by joining the student's latest
--          learner_twin_snapshots against the unified concept_edges graph.
--
-- ─── Thresholds are PARAMETERS, never hardcoded ──────────────────────────────
-- p_mastery_floor and p_decay_floor are passed in by the caller. Assessment owns
-- the canonical values; the TS caller supplies them. This function applies them,
-- it does not define them.
--
-- A prerequisite topic is "blocking" when, in the student's most recent snapshot:
--   mastery_by_topic[prereq] < p_mastery_floor   (weak), OR
--   decay_state[prereq]      < p_decay_floor     (forgotten).
-- Each blocking prerequisite is joined to its DEPENDENTS via concept_edges
-- (edge_type=prerequisite, from=prereq -> to=dependent), which are the blocked
-- advanced topics returned.
--
-- SECURITY INVOKER: learner_twin_snapshots is RLS-scoped, so per-role visibility
-- (student own / parent linked / teacher roster / service-role all) is enforced
-- automatically by the underlying table policies -- no explicit access check is
-- duplicated here. concept_edges is authenticated-read reference data.
--
-- Snapshot jsonb values are documented IDs+numbers only (see 20260702000200), so
-- the ::numeric casts are safe by the writer's contract. Idempotent
-- (CREATE OR REPLACE). No DROP. Additive.

BEGIN;

CREATE OR REPLACE FUNCTION public.detect_blocked_dependents(
  p_student_id   uuid,
  p_decay_floor  numeric,
  p_mastery_floor numeric
)
RETURNS TABLE (
  blocked_topic_id        uuid,
  blocking_prerequisite_id uuid,
  prerequisite_mastery    numeric,
  prerequisite_decay      numeric,
  edge_strength           numeric,
  edge_source             text
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  WITH latest AS (
    SELECT s.mastery_by_topic, s.decay_state
    FROM public.learner_twin_snapshots s
    WHERE s.student_id = p_student_id
    ORDER BY s.snapshot_date DESC
    LIMIT 1
  ),
  topic_keys AS (
    -- Union of topic ids present in either map (a topic may be forgotten without
    -- a current mastery reading, or vice versa). Filter to UUID-shaped keys.
    SELECT DISTINCT k
    FROM latest l
    CROSS JOIN LATERAL (
      SELECT jsonb_object_keys(l.mastery_by_topic) AS k
      UNION
      SELECT jsonb_object_keys(l.decay_state) AS k
    ) u
    WHERE k ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ),
  prereqs AS (
    SELECT
      tk.k::uuid                              AS topic_id,
      (l.mastery_by_topic ->> tk.k)::numeric  AS mastery,
      (l.decay_state      ->> tk.k)::numeric  AS decay
    FROM topic_keys tk
    CROSS JOIN latest l
  ),
  weak_prereqs AS (
    SELECT p.topic_id, p.mastery, p.decay
    FROM prereqs p
    WHERE (p.mastery IS NOT NULL AND p.mastery < p_mastery_floor)
       OR (p.decay   IS NOT NULL AND p.decay   < p_decay_floor)
  )
  SELECT
    ce.to_topic_id   AS blocked_topic_id,
    wp.topic_id      AS blocking_prerequisite_id,
    wp.mastery       AS prerequisite_mastery,
    wp.decay         AS prerequisite_decay,
    ce.strength      AS edge_strength,
    ce.source        AS edge_source
  FROM weak_prereqs wp
  JOIN public.concept_edges ce
    ON ce.from_topic_id = wp.topic_id
   AND ce.edge_type = 'prerequisite';
$$;

COMMENT ON FUNCTION public.detect_blocked_dependents(uuid, numeric, numeric) IS
  'Digital Twin Slice 1: advanced topics blocked by a weak (mastery < '
  'p_mastery_floor) or forgotten (decay < p_decay_floor) prerequisite, from the '
  'student latest learner_twin_snapshots joined to concept_edges. Thresholds are '
  'PARAMETERS (assessment owns canonical values). SECURITY INVOKER; per-role '
  'visibility enforced by learner_twin_snapshots RLS.';

REVOKE ALL ON FUNCTION public.detect_blocked_dependents(uuid, numeric, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.detect_blocked_dependents(uuid, numeric, numeric) TO authenticated, service_role;

COMMIT;
