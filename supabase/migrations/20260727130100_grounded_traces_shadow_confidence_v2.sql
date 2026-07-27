-- Migration: 20260727130100_grounded_traces_shadow_confidence_v2.sql
-- Purpose: Shadow confidence instrumentation (Step 2 of 3). Persist a SHADOW
--          confidence score alongside the LIVE one so we can measure, on real
--          traffic, how a relevance-based confidence would have behaved —
--          WITHOUT changing a single gating decision.
--
-- Depends on: 20260727130000_rag_ncert_expose_cosine_similarity.sql (which
--             added the `cosine_similarity` OUTPUT column to
--             public.match_rag_chunks_ncert). This migration is ordered after it.
--
-- ZERO BEHAVIOUR CHANGE. Three ADDITIVE, NULLABLE columns on an existing table.
-- Nothing reads them at runtime:
--   * the strict-mode abstain gate still reads `confidence` (v1),
--   * the soft banner still reads `confidence` (v1),
--   * no view, RPC, RLS policy, index, trigger or constraint elsewhere
--     references the new columns.
-- No column is dropped, renamed, retyped or made NOT NULL. No RLS change is
-- required or made: grounded_ai_traces already has its policies and adding a
-- column does not widen any of them (the table's existing service-role posture
-- governs these columns exactly as it governs `confidence`).
--
-- ───────────────────────────────────────────────────────────────────────────────
-- WHY (read before "simplifying" this away)
-- ───────────────────────────────────────────────────────────────────────────────
-- `confidence` (v1) is computed from an RRF ORDERING STATISTIC, not a relevance
-- measure. In the vector-only regime (92.8% of production) RRF is fixed by
-- construction — ranks 1,2,3 always score 1/61, 1/62, 1/63 — and
-- groundingPassRatio is pinned at 1, so v1 collapses to
--     0.347606 + 0.2 * (chunks / match_count)
-- i.e. THREE reachable values, with 912 of 996 sampled traces landing on exactly
-- 0.647606. It is a chunk counter, not a confidence. These columns capture what
-- the same formula would have produced from an actual relevance signal.
--
-- SCALE HYGIENE: `confidence_v2_source` is NOT decoration. Voyage rerank-2
-- cross-encoder scores and absolute cosines are DIFFERENT measurement scales and
-- MUST NOT be pooled in analysis. Always group by confidence_v2_source.
--   'rerank' — Voyage rerank-2 relevance_score of the top chunk (preferred:
--              when reranking runs, the top chunk's `similarity` is its
--              PRE-rerank RRF, so a correct promotion from vector-rank 8 would
--              make v1 measure LOWER — an inversion v2 must not inherit).
--   'cosine' — absolute cosine 1 - (embedding <=> query_embedding).
--   'none'   — retrieval ran but produced NO relevance evidence at all.
--   NULL     — the request abstained BEFORE retrieval ran (kill switch,
--              circuit breaker, coverage precheck). Distinct from 'none'.
--
-- NULL IN confidence_v2 / top_cosine_similarity IS MEANINGFUL, NOT MISSING: it
-- means "no relevance evidence", which happens for FTS-only tier-1 rows over
-- unembedded chunks, all of tier 2, all of tier 3, and unembedded chunks. Such
-- rows must be EXCLUDED from v2 analysis, never read as 0 — 0 would assert
-- "maximally irrelevant", a different and false claim.
--
-- NOTE for analysis: an FTS-recovered tier-1 row can legitimately carry a
-- top_cosine_similarity BELOW the configured floor. `p_min_similarity` gates
-- only the vector CTE, never the FTS CTE. That is correct, not an anomaly. The
-- production floor is NCERT_MIN_COSINE_SIMILARITY = 0.22, not the RPC's 0.5
-- default.

BEGIN;

DO $shadow$
BEGIN
  -- to_regclass guard: on a fresh DB replayed out of order, skip rather than
  -- abort the chain. Idempotent: ADD COLUMN IF NOT EXISTS is re-runnable.
  IF to_regclass('public.grounded_ai_traces') IS NULL THEN
    RAISE WARNING
      '20260727130100: public.grounded_ai_traces not found; shadow confidence columns skipped.';
    RETURN;
  END IF;

  ALTER TABLE public.grounded_ai_traces
    ADD COLUMN IF NOT EXISTS confidence_v2          numeric(5,4),
    ADD COLUMN IF NOT EXISTS confidence_v2_source   text,
    ADD COLUMN IF NOT EXISTS top_cosine_similarity  numeric(5,4);

  -- Vocabulary guard on the source stamp. NULL is explicitly permitted (it is
  -- the "abstained before retrieval" case). NOT VALID is deliberate: it applies
  -- to all new rows without a full-table scan, and every pre-existing row is
  -- NULL in this column anyway, so there is nothing to validate.
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'public.grounded_ai_traces'::regclass
       AND conname  = 'grounded_ai_traces_confidence_v2_source_chk'
  ) THEN
    ALTER TABLE public.grounded_ai_traces
      ADD CONSTRAINT grounded_ai_traces_confidence_v2_source_chk
      CHECK (
        confidence_v2_source IS NULL
        OR confidence_v2_source IN ('rerank', 'cosine', 'none')
      ) NOT VALID;
  END IF;
END
$shadow$;

DO $comments$
BEGIN
  IF to_regclass('public.grounded_ai_traces') IS NULL THEN
    RETURN;
  END IF;

  COMMENT ON COLUMN public.grounded_ai_traces.confidence_v2 IS
    'SHADOW ONLY (20260727130100). Same weights/clamps as `confidence` (v1), but fed the RELEVANCE signal '
    '(rerank score, else absolute cosine) instead of the RRF ordering statistic. RECORDED, NEVER COMPARED: '
    'no abstain gate, banner or threshold reads this column. NULL = no relevance evidence, or abstained '
    'before retrieval — exclude such rows from analysis, never read NULL as 0. ALWAYS group by '
    'confidence_v2_source: rerank scores and cosines are different scales and must not be pooled.';

  COMMENT ON COLUMN public.grounded_ai_traces.confidence_v2_source IS
    'SHADOW ONLY (20260727130100). Which relevance signal produced confidence_v2: '
    '''rerank'' = Voyage rerank-2 cross-encoder score of the top chunk (preferred — immune to the '
    'rerank/RRF inversion where a correctly promoted chunk carries a LOW pre-rerank RRF); '
    '''cosine'' = absolute cosine 1 - (embedding <=> query_embedding); '
    '''none''  = retrieval ran but yielded no relevance evidence; '
    'NULL     = the request abstained BEFORE retrieval ran. ''none'' and NULL are DIFFERENT.';

  COMMENT ON COLUMN public.grounded_ai_traces.top_cosine_similarity IS
    'SHADOW ONLY (20260727130100). Absolute cosine of the TOP returned chunk, surfaced by '
    'match_rag_chunks_ncert as of 20260727130000. NULL = the row carried no cosine (FTS-only tier-1 over an '
    'unembedded chunk, tier 2, tier 3, or no query embedding) — unknown, NOT irrelevant. Values BELOW the '
    '0.22 production floor (NCERT_MIN_COSINE_SIMILARITY) are legitimate: p_min_similarity gates only the '
    'vector CTE, never the FTS CTE.';
END
$comments$;

COMMIT;
