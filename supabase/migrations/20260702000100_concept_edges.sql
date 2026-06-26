-- Migration: 20260702000100_concept_edges.sql
-- Purpose: Digital Twin + Knowledge Graph (Slice 1). Create `concept_edges`,
--          the canonical UNIFIED prerequisite/relationship graph that reconciles
--          the THREE fragmented prerequisite models that exist today:
--            (a) curriculum_topics.prerequisite_topic_ids   uuid[]
--            (b) learning_objectives.prereq_objective_ids   uuid[]
--            (c) concept_graph.prerequisite_codes           text[] (uuid-as-text;
--                detect_knowledge_gaps() already casts these to uuid[])
--          and a NON-DESTRUCTIVE backfill that DERIVES edges from all three
--          WITHOUT touching the sources. CEO-approved.
--
-- ─── Heterogeneous endpoint namespace (deliberate; no FK) ────────────────────
-- from_topic_id / to_topic_id are bare uuids with NO foreign key, because the
-- three source models live in three different tables (curriculum_topics,
-- learning_objectives, concept_graph) with disjoint id spaces. A single FK is
-- impossible; per-source FKs would be wrong (an edge from one source must not be
-- constrained to another's table). The `source` column records which model an
-- edge came from so downstream readers can resolve the endpoint table. This is
-- a documented deviation from the per-table-FK house default for student tables.
--
-- ─── RLS ─────────────────────────────────────────────────────────────────────
-- This is REFERENCE / read-only curriculum-structure data (NOT student data, no
-- PII), so the four student/parent/teacher patterns do not apply. RLS is still
-- ENABLED (P8: every new table gets RLS in the same migration); the policy is a
-- permissive read for authenticated + full access for service_role. Writes are
-- service-role only (the backfill below runs as the migration owner; runtime
-- graph edits go through service-role tooling).
--
-- Idempotent throughout: CREATE TABLE/INDEX IF NOT EXISTS; DROP POLICY IF EXISTS
-- before CREATE POLICY; backfill INSERTs use ON CONFLICT DO NOTHING against a
-- unique edge index. No DROP TABLE/COLUMN. Additive only. Grades untouched
-- (this table carries no grade column; subject_scope is a free-text subject tag).
--
-- Companion files (same slice):
--   20260702000200_learner_twin_snapshots.sql
--   20260702000300_learner_twin_memory.sql
--   20260702000400_traverse_prerequisites.sql
--   20260702000500_detect_blocked_dependents.sql
--   20260702000600_extend_gap_and_path_with_concept_edges.sql
--   20260702000700_seed_ff_digital_twin_v1.sql

BEGIN;

-- ─── 1. Table ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.concept_edges (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_topic_id uuid NOT NULL,
  to_topic_id   uuid NOT NULL,
  edge_type     text NOT NULL DEFAULT 'prerequisite'
                  CHECK (edge_type IN ('prerequisite', 'corequisite', 'transfer')),
  strength      numeric NOT NULL DEFAULT 1.0,
  subject_scope text,
  source        text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT concept_edges_no_self_loop CHECK (from_topic_id <> to_topic_id)
);

COMMENT ON TABLE public.concept_edges IS
  'Digital Twin Slice 1: unified prerequisite/relationship graph reconciling the '
  'three legacy prerequisite models (curriculum_topics.prerequisite_topic_ids, '
  'learning_objectives.prereq_objective_ids, concept_graph.prerequisite_codes). '
  'For edge_type=prerequisite: from_topic_id is a prerequisite OF to_topic_id '
  '(learn from_topic_id first). Endpoints are bare uuids across three disjoint id '
  'spaces (no FK by design); `source` records the origin table. Reference data '
  '(no PII); authenticated read, service-role write.';

COMMENT ON COLUMN public.concept_edges.from_topic_id IS
  'The PREREQUISITE / upstream node (for edge_type=prerequisite). uuid into the '
  'table named by `source` (curriculum_topics | learning_objectives | concept_graph).';
COMMENT ON COLUMN public.concept_edges.to_topic_id IS
  'The DEPENDENT / downstream node. uuid into the table named by `source`.';
COMMENT ON COLUMN public.concept_edges.source IS
  'Origin model the edge was derived from: curriculum_topics | learning_objectives '
  '| concept_graph (or a manual/runtime tag for later edits).';

-- ─── 2. Indexes ──────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_concept_edges_from ON public.concept_edges (from_topic_id);
CREATE INDEX IF NOT EXISTS idx_concept_edges_to   ON public.concept_edges (to_topic_id);

-- Dedupe key for an idempotent, re-runnable backfill (ON CONFLICT target).
CREATE UNIQUE INDEX IF NOT EXISTS concept_edges_unique_edge
  ON public.concept_edges (from_topic_id, to_topic_id, edge_type, source);

-- ─── 3. Row Level Security (P8) ──────────────────────────────────────────────

ALTER TABLE public.concept_edges ENABLE ROW LEVEL SECURITY;

-- (a) Service role: full access (graph maintenance + backfill tooling).
DROP POLICY IF EXISTS concept_edges_service_all ON public.concept_edges;
CREATE POLICY concept_edges_service_all
  ON public.concept_edges
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- (b) Any authenticated user may READ the reference graph (no PII; curriculum
--     structure is non-sensitive). No per-row scoping — this is shared reference
--     data, not student data.
DROP POLICY IF EXISTS concept_edges_authenticated_select ON public.concept_edges;
CREATE POLICY concept_edges_authenticated_select
  ON public.concept_edges
  FOR SELECT TO authenticated
  USING (true);

-- (c) Deliberately NO authenticated INSERT/UPDATE/DELETE policy. Writes are
--     service-role only.

-- ─── 4. Grants (defense in depth under RLS) ──────────────────────────────────
REVOKE ALL ON public.concept_edges FROM PUBLIC;
REVOKE ALL ON public.concept_edges FROM anon;
REVOKE ALL ON public.concept_edges FROM authenticated;

GRANT SELECT ON public.concept_edges TO authenticated;
GRANT ALL    ON public.concept_edges TO service_role;

-- ─── 5. Non-destructive backfill (derive edges from all three sources) ───────
-- Each INSERT reads a source READ-ONLY and is idempotent via ON CONFLICT against
-- concept_edges_unique_edge. Self-loops are filtered (and also blocked by the
-- CHECK). Direction convention: from = prerequisite, to = dependent.

-- (a) curriculum_topics.prerequisite_topic_ids (uuid[] into curriculum_topics).
INSERT INTO public.concept_edges (from_topic_id, to_topic_id, edge_type, strength, subject_scope, source)
SELECT DISTINCT
  pid                 AS from_topic_id,
  ct.id               AS to_topic_id,
  'prerequisite'      AS edge_type,
  1.0                 AS strength,
  s.code              AS subject_scope,
  'curriculum_topics' AS source
FROM public.curriculum_topics ct
LEFT JOIN public.subjects s ON s.id = ct.subject_id
CROSS JOIN LATERAL unnest(ct.prerequisite_topic_ids) AS pid
WHERE ct.prerequisite_topic_ids IS NOT NULL
  AND array_length(ct.prerequisite_topic_ids, 1) > 0
  AND pid IS NOT NULL
  AND pid <> ct.id
ON CONFLICT (from_topic_id, to_topic_id, edge_type, source) DO NOTHING;

-- (b) learning_objectives.prereq_objective_ids (uuid[] into learning_objectives).
INSERT INTO public.concept_edges (from_topic_id, to_topic_id, edge_type, strength, subject_scope, source)
SELECT DISTINCT
  po                    AS from_topic_id,
  lo.id                 AS to_topic_id,
  'prerequisite'        AS edge_type,
  1.0                   AS strength,
  s.code                AS subject_scope,
  'learning_objectives' AS source
FROM public.learning_objectives lo
LEFT JOIN public.chapters ch ON ch.id = lo.chapter_id
LEFT JOIN public.subjects s  ON s.id = ch.subject_id
CROSS JOIN LATERAL unnest(lo.prereq_objective_ids) AS po
WHERE lo.prereq_objective_ids IS NOT NULL
  AND array_length(lo.prereq_objective_ids, 1) > 0
  AND po IS NOT NULL
  AND po <> lo.id
ON CONFLICT (from_topic_id, to_topic_id, edge_type, source) DO NOTHING;

-- (c) concept_graph.prerequisite_codes (uuid-as-text[] into concept_graph).
--     Guard the ::uuid cast with a UUID-shape regex so any non-uuid code is
--     skipped rather than aborting the migration.
INSERT INTO public.concept_edges (from_topic_id, to_topic_id, edge_type, strength, subject_scope, source)
SELECT DISTINCT
  pc::uuid       AS from_topic_id,
  cg.id          AS to_topic_id,
  'prerequisite' AS edge_type,
  1.0            AS strength,
  cg.subject     AS subject_scope,
  'concept_graph' AS source
FROM public.concept_graph cg
CROSS JOIN LATERAL unnest(cg.prerequisite_codes) AS pc
WHERE cg.prerequisite_codes IS NOT NULL
  AND array_length(cg.prerequisite_codes, 1) > 0
  AND pc IS NOT NULL
  AND pc ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  AND cg.id::text <> pc          -- self-loop filter without an unguarded ::uuid cast in WHERE
ON CONFLICT (from_topic_id, to_topic_id, edge_type, source) DO NOTHING;

COMMIT;

-- ─── Verify (manual, after applying) ─────────────────────────────────────────
-- SELECT source, edge_type, count(*) FROM public.concept_edges GROUP BY 1,2;
-- SELECT relrowsecurity FROM pg_class WHERE relname = 'concept_edges';  -- expect t
-- SELECT polname, cmd FROM pg_policies WHERE tablename = 'concept_edges';
