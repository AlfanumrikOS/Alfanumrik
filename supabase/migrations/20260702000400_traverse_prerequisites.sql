-- Migration: 20260702000400_traverse_prerequisites.sql
-- Purpose: Digital Twin Slice 1. RPC traverse_prerequisites(p_topic_id, p_max_depth)
--          -- recursive walk of the unified concept_edges graph returning the full
--          prerequisite CHAIN of a topic with depth. Foundation primitive for the
--          digital-twin path planner.
--
-- Direction: for edge_type='prerequisite', from_topic_id is a prerequisite OF
-- to_topic_id. To find the prerequisites of p_topic_id we follow edges where
-- to_topic_id = current node and collect from_topic_id, recursively, up to
-- p_max_depth. A path-accumulator ARRAY guards against cycles (the legacy three
-- models are not guaranteed acyclic once unified).
--
-- SECURITY INVOKER + hardened search_path. concept_edges is reference data
-- (authenticated read), so invoker rights are sufficient and correct. Idempotent
-- (CREATE OR REPLACE). No DROP. Additive.

BEGIN;

CREATE OR REPLACE FUNCTION public.traverse_prerequisites(
  p_topic_id uuid,
  p_max_depth integer DEFAULT 5
)
RETURNS TABLE (
  prerequisite_topic_id uuid,
  depth                 integer,
  edge_type             text,
  strength              numeric,
  source                text
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  WITH RECURSIVE chain AS (
    -- Depth 1: direct prerequisites of p_topic_id.
    SELECT
      ce.from_topic_id                       AS prerequisite_topic_id,
      1                                      AS depth,
      ce.edge_type                           AS edge_type,
      ce.strength                            AS strength,
      ce.source                              AS source,
      ARRAY[ce.to_topic_id, ce.from_topic_id] AS path
    FROM public.concept_edges ce
    WHERE ce.to_topic_id = p_topic_id
      AND ce.edge_type = 'prerequisite'

    UNION ALL

    -- Deeper: prerequisites of the prerequisites.
    SELECT
      ce.from_topic_id,
      c.depth + 1,
      ce.edge_type,
      ce.strength,
      ce.source,
      c.path || ce.from_topic_id
    FROM public.concept_edges ce
    JOIN chain c ON ce.to_topic_id = c.prerequisite_topic_id
    WHERE ce.edge_type = 'prerequisite'
      AND c.depth < p_max_depth
      AND NOT (ce.from_topic_id = ANY(c.path))   -- cycle guard
  )
  SELECT prerequisite_topic_id, depth, edge_type, strength, source
  FROM chain;
$$;

COMMENT ON FUNCTION public.traverse_prerequisites(uuid, integer) IS
  'Digital Twin Slice 1: recursive prerequisite-chain walk over concept_edges '
  '(edge_type=prerequisite). Returns each upstream prerequisite of p_topic_id with '
  'its depth (1 = direct), bounded by p_max_depth, cycle-safe via a path array. '
  'SECURITY INVOKER; relies on concept_edges authenticated-read RLS.';

-- Least-privilege execute grants (the table is reference data; mirror its posture).
REVOKE ALL ON FUNCTION public.traverse_prerequisites(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.traverse_prerequisites(uuid, integer) TO authenticated, service_role;

COMMIT;
