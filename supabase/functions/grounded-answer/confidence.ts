// supabase/functions/grounded-answer/confidence.ts
// Confidence score computation per spec §6.5.
//
// Single responsibility: pure function that turns retrieval + grounding
// signals into a single 0-1 score the caller can gate on (e.g. strict
// mode abstains below STRICT_CONFIDENCE_ABSTAIN_THRESHOLD).
//
// Formula (spec §6.5):
//   0.4 * min(topSim,    1.0)
// + 0.3 * min(top3Avg,   1.0)
// + 0.2 * min(chunks / target, 1.0)
// + 0.1 * groundingCheckPassRatio (0 or 1 in strict; always 1 in soft)
//
// All inputs clamped at [0, 1]. Weights sum to 1.0 so output is naturally
// bounded. We still clamp the final value defensively because floating
// point drift could push a perfect score to 1.0000000002.
//
// IMPORTANT — caller contract (audit 2026-05-10): topSimilarity and
// top3AverageSimilarity MUST be supplied normalized to [0,1]. The RAG
// retriever returns RRF scores in [0, ~0.0328]; pipeline.ts is responsible
// for dividing by RRF_THEORETICAL_MAX before calling. Passing raw RRF
// caps confidence near 0.32 and silently disables every downstream
// threshold (STRICT_CONFIDENCE_ABSTAIN, SOFT_CONFIDENCE_BANNER, etc).

export interface ConfidenceInputs {
  /** Top similarity in [0,1]. Caller normalizes RRF→[0,1] before passing. */
  topSimilarity: number;
  /** Top-3 avg similarity in [0,1]. Caller normalizes RRF→[0,1] before passing. */
  top3AverageSimilarity: number;
  chunksReturned: number;
  matchCountTarget: number;
  groundingCheckPassRatio: number;
}

export function computeConfidence(params: ConfidenceInputs): number {
  const topSim = clamp01(params.topSimilarity);
  const top3 = clamp01(params.top3AverageSimilarity);

  const countCoverage = params.matchCountTarget > 0
    ? clamp01(params.chunksReturned / params.matchCountTarget)
    : 0;

  const groundingPass = clamp01(params.groundingCheckPassRatio);

  const raw = 0.4 * topSim + 0.3 * top3 + 0.2 * countCoverage + 0.1 * groundingPass;
  return clamp01(raw);
}

function clamp01(n: number): number {
  if (!Number.isFinite(n) || n < 0) return 0;
  if (n > 1) return 1;
  return n;
}