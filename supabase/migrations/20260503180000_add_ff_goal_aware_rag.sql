-- Migration: 20260503180000_add_ff_goal_aware_rag.sql
-- Phase 4 of Goal-Adaptive Learning Layers.
-- Seeds ONE flag, ff_goal_aware_rag, as DISABLED on prod + staging.
-- Pure data seed, fully idempotent. NO schema changes.
--
-- The flag gates a TS-side post-rerank step in src/lib/ai/retrieval/ncert-retriever.ts:
-- when on, retrieved chunks are re-ranked by applyGoalRerank() (multiplies
-- similarity by goal-aware source weights from src/lib/goals/rag-source-weights.ts).
-- When off, retrieval order is byte-identical to today (Voyage rerank-2 + RRF only).
--
-- The schema columns this rerank reads (rag_content_chunks.source,
-- rag_content_chunks.exam_relevance) are ALREADY PRESENT in the baseline schema -
-- this migration adds zero columns. The infrastructure is forward-compatible with
-- future content packs (JEE archive, NEET archive, Olympiad) ingested with
-- appropriate source/exam_relevance values.
--
-- Owner: ai-engineer (consumer) + assessment (rules)
-- Added: 2026-05-03
--
-- Rollback: UPDATE feature_flags SET is_enabled=false WHERE flag_name='ff_goal_aware_rag';
-- Operator runbook:
--   1. Enable on staging via super-admin Flags console.
--   2. Verify Foxy retrieval still returns sensible chunks (smoke test).
--   3. Promote to prod with rollout_percentage 10 -> 25 -> 50 -> 100.
--   4. Kill switch: set is_enabled=false; in-process flag cache TTL is 5 min.

INSERT INTO public.feature_flags (
  flag_name,
  is_enabled,
  target_roles,
  target_environments,
  target_institutions,
  rollout_percentage,
  metadata
) VALUES (
  'ff_goal_aware_rag',
  false,
  ARRAY[]::text[],
  ARRAY['production','staging']::text[],
  ARRAY[]::uuid[],
  0,
  jsonb_build_object(
    'description', 'Phase 4 - gates the goal-aware re-ranking step in retrieveNcertChunks. When ON, RetrievedChunk[] is re-sorted by similarity * getRagSourceWeight(goal, chunk). When OFF, retrieval order is identical to today. Schema columns rag_content_chunks.source and exam_relevance are already present (no migration needed); the rerank uses them when available and is a no-op for chunks without those tags.',
    'owner', 'ai-engineer+assessment',
    'added', '2026-05-03',
    'phase', '4',
    'rollout_strategy', 'enable on staging first, verify Foxy retrieval quality vs baseline, then ramp 10/25/50/100 across one week',
    'kill_switch', 'set is_enabled=false to instantly revert; rerank module stays installed and harmless',
    'forward_compatibility', 'when JEE/NEET/Olympiad content packs are ingested with source=jee_archive/neet_archive/olympiad and exam_relevance tags, the rerank automatically applies the goal-aligned boosts without code changes'
  )
)
ON CONFLICT (flag_name) DO NOTHING;

DO $verify$
DECLARE
  v_count   integer;
  v_enabled boolean;
BEGIN
  SELECT count(*) INTO v_count
    FROM public.feature_flags
   WHERE flag_name = 'ff_goal_aware_rag';

  IF v_count = 0 THEN
    RAISE WARNING 'Phase 4: ff_goal_aware_rag flag NOT seeded - investigate.';
  ELSE
    SELECT is_enabled INTO v_enabled
      FROM public.feature_flags
     WHERE flag_name = 'ff_goal_aware_rag';
    RAISE NOTICE 'Phase 4: ff_goal_aware_rag present count=% is_enabled=%', v_count, v_enabled;
    IF v_enabled THEN
      RAISE WARNING 'Phase 4: ff_goal_aware_rag is ENABLED - intent was OFF, verify.';
    END IF;
  END IF;
END $verify$;
