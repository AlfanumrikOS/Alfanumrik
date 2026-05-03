-- Migration: 20260428120000_ff_rag_mmr_diversity.sql
-- Purpose: Register the `ff_rag_mmr_diversity` feature flag for Phase 2.B
--          Win 2. When ON (default), the grounded-answer pipeline applies
--          Maximal Marginal Relevance (lambda=0.7) over the reranked
--          top-N chunks to penalise redundant context.
--
-- Why a flag instead of a hard wire-in:
--   MMR is a lightweight in-memory re-ordering — no extra API calls, no
--   schema changes — but it does change the order of chunks Foxy sees. If
--   a regression shows up after deploy (e.g., relevance@1 dropping below
--   the eval threshold) we need to roll back without redeploying. The
--   feature_flag system gives operators a sub-30s rollback path via the
--   super-admin console.
--
-- Default: ENABLED (rollout_percentage=100). The change has been validated
-- against the NCERT eval set; the flag exists purely as a safety valve.
--
-- Code paths that read this flag:
--   - supabase/functions/grounded-answer/_mmr-flag.ts (cached 60s)
--   - supabase/functions/_shared/rag/retrieve.ts WIRES MMR
--     UNCONDITIONALLY (Win 2 says "wire MMR into BOTH" and the unified
--     retrieve interface has no DB access by design — the kill switch
--     only gates the grounded-answer path which is the user-facing one).
--
-- Rollback (operator runbook):
--   To disable MMR globally without a redeploy:
--
--     UPDATE feature_flags
--     SET is_enabled = false,
--         updated_at = now()
--     WHERE flag_name = 'ff_rag_mmr_diversity';
--
--   The 60s cache in _mmr-flag.ts will pick up the change on the next
--   pipeline call.
--
-- Idempotent — uses NOT EXISTS guard like the other ff_* flags.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM feature_flags WHERE flag_name = 'ff_rag_mmr_diversity'
  ) THEN
    INSERT INTO feature_flags (
      flag_name,
      is_enabled,
      rollout_percentage,
      description
    )
    VALUES (
      'ff_rag_mmr_diversity',
      true,                  -- ON by default; flip to false for instant rollback.
      100,
      'Phase 2.B Win 2 — apply Maximal Marginal Relevance (lambda=0.7) over the '
      'reranked top-N chunks in grounded-answer to penalise redundant context. '
      'Pure in-memory reorder; no extra API calls. When disabled, the pipeline '
      'returns Voyage rerank-2 ordering as before. Rollback: set is_enabled=false.'
    );
  END IF;
END $$;
