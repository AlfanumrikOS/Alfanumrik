-- Migration: 20260703000100_concept_edges_seed_from_concept_codes.sql
-- Purpose: Task 0.9 — actually SEED public.concept_edges. The table shipped in
--          20260702000100_concept_edges.sql but its backfill produced 0 rows in
--          prod, because:
--
--            * Source (a) curriculum_topics.prerequisite_topic_ids and source
--              (b) learning_objectives.prereq_objective_ids are EMPTY in prod
--              (learning_objectives has 0 rows; no curriculum_topics row carries
--              a non-empty prerequisite array).
--            * Source (c) concept_graph.prerequisite_codes (lines 163-178 of
--              20260702000100) guarded the `pc::uuid` cast with a UUID-shape
--              regex — but the old header's claim that prerequisite_codes is
--              "uuid-as-text" was WRONG. In prod, concept_graph.prerequisite_codes
--              holds HUMAN concept codes (e.g. 'm7.integers.concept') that
--              resolve via the UNIQUE concept_graph.concept_code key
--              (concept_graph_concept_code_key). The regex therefore filtered
--              ALL 539 prerequisite references and the INSERT was a no-op.
--
--          Prod facts (verified 2026-07-03): concept_graph has 572 rows, 523
--          with non-empty prerequisite_codes (539 refs); 534/539 resolve via
--          concept_code; 5 english chapter codes are unresolved; 0 self-loops.
--
-- This migration adds TWO backfills, both idempotent via ON CONFLICT DO NOTHING
-- against the unique index concept_edges_unique_edge
-- (from_topic_id, to_topic_id, edge_type, source) — verified against
-- 20260702000100 lines 83-84. `edge_type` has a CHECK
-- ('prerequisite','corequisite','transfer') which 'prerequisite' satisfies;
-- `source` has NO CHECK constraint (free text per the column comment), so the
-- new 'concept_graph_topic_projection' tag needs no CHECK extension.
--
--   A. source='concept_graph' (~534 edges expected): edges in the
--      concept_graph.id namespace, resolving each prerequisite code through the
--      UNIQUE concept_graph.concept_code.
--
--   B. source='concept_graph_topic_projection': the SAME prerequisite
--      relationships PROJECTED into the curriculum_topics.id namespace.
--      REQUIRED for Loop D — learner_twin_snapshots.mastery_by_topic is keyed
--      by concept_mastery.topic_id = curriculum_topics.id, so Loop D's
--      traversal only sees edges whose endpoints live in that namespace.
--      Join per endpoint: subjects.code = concept_graph.subject (verified: the
--      baseline view admin_question_verification_status joins
--      cg.subject = question_bank.subject, and 20260621000500 backfills
--      question_bank.topic_id via subjects.code = question_bank.subject — so
--      concept_graph.subject IS the subjects.code vocabulary), plus
--      curriculum_topics.grade = regexp_replace(cg.grade, '^Grade\s+', '')
--      (concept_graph.grade uses the legacy 'Grade 7' format vs P5 '7'
--      elsewhere — normalized IN THE SELECT ONLY; concept_graph rows are never
--      rewritten), plus chapter_number. curriculum_topics is keyed
--      1-per-(subject, grade, chapter) in prod (542 rows). Chapter-level
--      DISTINCT pairs; from=to pairs (intra-chapter prereqs) excluded.
--
-- Also: a WARNING per unresolved prerequisite code (expected: exactly 5 english
-- chapter codes as of 2026-07-03), and a HARD 2-cycle assertion (RAISE
-- EXCEPTION if any A→B + B→A pair exists within the same source) so a cyclic
-- seed can never land silently and break traverse_prerequisites' cycle guard
-- assumptions downstream.
--
-- Additive + idempotent: INSERT ... ON CONFLICT DO NOTHING only. No DDL, no
-- DELETE/UPDATE/DROP, sources read-only. Safe to re-run. RLS posture of
-- concept_edges (authenticated read / service-role write) is unchanged.

BEGIN;

-- ─── A. concept_graph namespace: resolve human prerequisite codes ────────────
-- Direction convention (per 20260702000100): from = prerequisite, to = dependent.

INSERT INTO public.concept_edges (from_topic_id, to_topic_id, edge_type, strength, subject_scope, source)
SELECT DISTINCT pre.id, cg.id, 'prerequisite', 1.0, cg.subject, 'concept_graph'
FROM public.concept_graph cg
CROSS JOIN LATERAL unnest(cg.prerequisite_codes) AS pc
JOIN public.concept_graph pre ON pre.concept_code = pc
WHERE cg.prerequisite_codes IS NOT NULL
  AND array_length(cg.prerequisite_codes, 1) > 0
  AND pre.id <> cg.id
ON CONFLICT (from_topic_id, to_topic_id, edge_type, source) DO NOTHING;

-- ─── B. curriculum_topics projection (Loop D namespace) ──────────────────────
-- Each concept_graph endpoint is mapped to ITS OWN (subject, grade, chapter)
-- topic — prerequisite and dependent may live in different subjects/grades.
-- Grade normalized in the SELECT only ('Grade 7' → '7'); concept_graph is
-- never rewritten. subject_scope carries the DEPENDENT side's subject code,
-- consistent with backfill A.

INSERT INTO public.concept_edges (from_topic_id, to_topic_id, edge_type, strength, subject_scope, source)
SELECT DISTINCT
  ct_pre.id                          AS from_topic_id,
  ct_dep.id                          AS to_topic_id,
  'prerequisite'                     AS edge_type,
  1.0                                AS strength,
  cg.subject                         AS subject_scope,
  'concept_graph_topic_projection'   AS source
FROM public.concept_graph cg
CROSS JOIN LATERAL unnest(cg.prerequisite_codes) AS pc
JOIN public.concept_graph pre ON pre.concept_code = pc
JOIN public.subjects s_dep ON s_dep.code = cg.subject
JOIN public.curriculum_topics ct_dep
  ON  ct_dep.subject_id     = s_dep.id
  AND ct_dep.grade          = regexp_replace(cg.grade, '^Grade\s+', '')
  AND ct_dep.chapter_number = cg.chapter_number
  AND ct_dep.is_active      = true
JOIN public.subjects s_pre ON s_pre.code = pre.subject
JOIN public.curriculum_topics ct_pre
  ON  ct_pre.subject_id     = s_pre.id
  AND ct_pre.grade          = regexp_replace(pre.grade, '^Grade\s+', '')
  AND ct_pre.chapter_number = pre.chapter_number
  AND ct_pre.is_active      = true
WHERE cg.prerequisite_codes IS NOT NULL
  AND array_length(cg.prerequisite_codes, 1) > 0
  AND pre.id <> cg.id
  AND ct_pre.id <> ct_dep.id
ON CONFLICT (from_topic_id, to_topic_id, edge_type, source) DO NOTHING;

-- ─── C. Report unresolved prerequisite codes (expected: exactly 5) ───────────
-- These are legacy english chapter codes with no concept_graph.concept_code
-- match. WARNING (not exception): they are known-dirty source data; edges for
-- them are simply not derivable until the codes are repaired upstream.

DO $$
DECLARE
  r        RECORD;
  v_count  INT := 0;
BEGIN
  FOR r IN
    SELECT DISTINCT pc AS unresolved_code
    FROM public.concept_graph cg
    CROSS JOIN LATERAL unnest(cg.prerequisite_codes) AS pc
    WHERE cg.prerequisite_codes IS NOT NULL
      AND array_length(cg.prerequisite_codes, 1) > 0
      AND NOT EXISTS (
        SELECT 1 FROM public.concept_graph pre WHERE pre.concept_code = pc
      )
    ORDER BY 1
  LOOP
    v_count := v_count + 1;
    RAISE WARNING 'concept_edges seed: unresolved prerequisite code "%" — no concept_graph.concept_code match; edge skipped', r.unresolved_code;
  END LOOP;
  RAISE NOTICE 'concept_edges seed: % unresolved prerequisite code(s) (expected: exactly 5 english chapter codes as of 2026-07-03)', v_count;
END;
$$;

-- ─── D. HARD assertion: no 2-cycles within a source ──────────────────────────
-- A→B + B→A inside the same source would mean the seed manufactured a
-- contradiction that the source data does not contain (prod has 0 self-loops
-- and the DAG is human-curated). Fail the whole transaction rather than land
-- a cyclic prerequisite graph.

DO $$
DECLARE
  v_pairs INT;
BEGIN
  SELECT COUNT(*) INTO v_pairs
  FROM public.concept_edges e1
  JOIN public.concept_edges e2
    ON  e2.from_topic_id = e1.to_topic_id
    AND e2.to_topic_id   = e1.from_topic_id
    AND e2.edge_type     = e1.edge_type
    AND e2.source        = e1.source;
  IF v_pairs > 0 THEN
    RAISE EXCEPTION 'concept_edges seed: % two-cycle edge row(s) detected (A->B and B->A within the same source) — aborting migration', v_pairs;
  END IF;
END;
$$;

COMMIT;

-- ─── Verify (manual, after applying) ─────────────────────────────────────────
-- 1. Count by source (expect concept_graph ≈ 534; topic_projection smaller —
--    chapter-level DISTINCT collapses intra-chapter prereqs):
--      SELECT source, edge_type, count(*) FROM public.concept_edges GROUP BY 1, 2;
--
-- 2. traverse_prerequisites smoke (pick any dependent topic id from backfill B):
--      SELECT * FROM public.traverse_prerequisites(
--        (SELECT to_topic_id FROM public.concept_edges
--          WHERE source = 'concept_graph_topic_projection' LIMIT 1), 3);
--
-- 3. Full-cycle probe (any depth, per source) — expect 0 rows:
--      WITH RECURSIVE walk AS (
--        SELECT e.from_topic_id AS start_id, e.to_topic_id AS node, e.source,
--               ARRAY[e.from_topic_id] AS path, 1 AS depth
--          FROM public.concept_edges e
--        UNION ALL
--        SELECT w.start_id, e.to_topic_id, w.source,
--               w.path || e.from_topic_id, w.depth + 1
--          FROM walk w
--          JOIN public.concept_edges e
--            ON e.from_topic_id = w.node AND e.source = w.source
--         WHERE NOT e.from_topic_id = ANY(w.path)
--           AND w.depth < 50
--      )
--      SELECT DISTINCT start_id, source FROM walk WHERE node = start_id;
--
-- 4. Unresolved codes (expect exactly 5 english chapter codes):
--      SELECT DISTINCT pc FROM public.concept_graph cg
--      CROSS JOIN LATERAL unnest(cg.prerequisite_codes) pc
--      WHERE NOT EXISTS (SELECT 1 FROM public.concept_graph p WHERE p.concept_code = pc);
