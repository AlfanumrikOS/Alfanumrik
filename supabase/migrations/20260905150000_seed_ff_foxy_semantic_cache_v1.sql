-- Migration: 20260905150000_seed_ff_foxy_semantic_cache_v1.sql
-- Purpose: Seed the feature flag `ff_foxy_semantic_cache_v1` (Foxy LLM cost
--          optimization, Phase 2E) so the row EXISTS in public.feature_flags
--          and is auditable + flippable from the super-admin console.
--          Default OFF / 0%.
--
--   ff_foxy_semantic_cache_v1
--     When ON: grounded-answer's pipeline (supabase/functions/grounded-answer/
--     cache-semantic.ts) checks a NEW cosine-similarity cache tier, scoped to
--     caller='foxy' and cache_scope='shared' turns only (i.e. no conversation
--     history and no per-student personalization -- the same fail-closed
--     scope gate that already governs the existing L1/L2/L3 exact-match
--     tiers), positioned AFTER the L3 miss and strictly BEFORE retrieveChunks
--     (same REG-50 sequential-not-parallel position as L1/L2/L3). A hit
--     requires cosine similarity >= 0.95 against foxy_response_cache.
--     question_embedding within the same grade+subject(+chapter_number), AND
--     an exact match on caller/mode/grade/subject_code/chapter_number/
--     gen_ctx_hash (tuplesMatchIgnoringQuery in cache-redis.ts -- the query
--     text itself is deliberately NOT required to match, since tolerating a
--     differently-worded question is the point; gen_ctx_hash already pins the
--     prompt template, model routing rev, generation params, and content
--     version, so a curriculum update or model-routing change is a guaranteed
--     miss). On a miss, a grounded:true response for a shared-scope Foxy turn
--     is written back to foxy_response_cache for future semantic reuse. When
--     OFF: this tier is never read or written; grounded-answer behavior is
--     byte-identical to today (L1/L2/L3 + full pipeline only).
--
-- Context: CEO-approved direction (2026-09-05) to reduce Foxy per-chat LLM
-- cost. This tier deliberately does NOT relax personalization: it reuses the
-- exact 'shared' scope the existing cache tiers already require, rather than
-- serving a cached answer to any student matching chapter+grade regardless of
-- history/mastery/coach-mode -- see the L3 durable cache's caller='ncert-
-- solver'-only design for the same underlying reasoning (grounded-answer/
-- cache-durable.ts). This keeps hit-rate real but modest (most organic Foxy
-- turns carry history) rather than trading personalization for cost.
--
-- ─── Default-OFF contract ─────────────────────────────────────────────────────
-- Seeded DISABLED: is_enabled = FALSE, rollout_percentage = 0.
--
-- Idempotent (ON CONFLICT (flag_name) DO NOTHING), guarded for a fresh DB
-- where feature_flags may not exist yet. No schema changes here (see the
-- separate 20260905140000_foxy_semantic_cache_rpc.sql for the payload column
-- + RPC). Pure data seed.
--
-- ─── Reversible (manual DOWN) ─────────────────────────────────────────────────
--   DELETE FROM feature_flags WHERE flag_name = 'ff_foxy_semantic_cache_v1';
-- A missing flag resolves to OFF (fail-closed), so deletion is silent on the
-- production experience.

DO $foxy_semantic_cache_v1$
BEGIN
  IF to_regclass('public.feature_flags') IS NOT NULL THEN
    INSERT INTO public.feature_flags (
      flag_name,
      is_enabled,
      rollout_percentage,
      description,
      target_roles,
      target_environments,
      target_institutions,
      created_at,
      updated_at
    )
    VALUES (
      'ff_foxy_semantic_cache_v1',
      false,
      0,
      'Foxy LLM cost optimization (Phase 2E): cosine-similarity answer cache tier over foxy_response_cache.question_embedding, scoped to caller=foxy AND cache_scope=shared turns only (no history, no personalization -- same fail-closed gate as the existing L1/L2/L3 exact-match tiers). Hit requires cosine >= 0.95 within the same grade+subject(+chapter_number) plus an exact caller/mode/grade/subject_code/chapter_number/gen_ctx_hash match (query text itself is intentionally not required to match). Default off; see cache-semantic.ts and grounded-answer/pipeline.ts Step 2d.',
      NULL,
      NULL,
      NULL,
      now(),
      now()
    )
    ON CONFLICT (flag_name) DO NOTHING;
  ELSE
    RAISE NOTICE 'feature_flags table absent; skipping ff_foxy_semantic_cache_v1 seed (fresh DB).';
  END IF;
END $foxy_semantic_cache_v1$;
