// src/lib/grounding-config.ts
// IMPORTANT: This file MUST stay in sync with supabase/functions/grounded-answer/config.ts.
// CI parity check enforces via scripts/check-config-parity.sh.
export const MIN_CHUNKS_FOR_READY = 50;
export const MIN_QUESTIONS_FOR_READY = 40;
export const RAG_MATCH_COUNT = 5;
// Similarity-floor thresholds calibrated for the RRF (Reciprocal Rank Fusion)
// score returned by `match_rag_chunks_ncert`. RRF score = 1/(60+rank_vec) +
// 1/(60+rank_fts), capped at ~0.033 when a chunk ranks #1 in both lists.
// Vector-only matches (typical for conceptual student queries that don't
// share keywords with NCERT prose) cap at 1/61 ≈ 0.0164.
//
// Pre-2026-05-10 these were 0.75 / 0.55 — left over from when the legacy RPC
// returned cosine similarity in [0, 1]. With the RRF backend that scale is
// wrong: every retrieved chunk was filtered out, leaving Foxy ungrounded.
// Audit 2026-05-10: 110/110 recent foxy traces had chunk_count=0 because of
// this mismatch. New thresholds reflect the RRF scale:
//   STRICT 0.012 — accepts vector-only matches up to rank ~23, OR strong
//                  combined RRF (e.g. rank 5 in vec + present in fts).
//   SOFT   0.005 — generous floor that accepts vector-only matches up to
//                  rank ~140; suitable for soft mode where degraded answers
//                  are preferable to abstain.
export const STRICT_MIN_SIMILARITY = 0.012;
export const SOFT_MIN_SIMILARITY = 0.005;
// Theoretical maximum of the RRF score returned by match_rag_chunks_ncert.
// score = 1/(60+rank_vec) + 1/(60+rank_fts); when a chunk is rank #1 in both
// vector and FTS lists the score peaks at 2/61 ≈ 0.0328. Used by
// pipeline.ts to normalize RRF similarities into [0,1] before passing to
// computeConfidence, whose formula expects normalized inputs. Without this
// normalization the topSim/top3Avg terms contribute at most ~0.023 each,
// capping confidence near 0.32 — which made STRICT_CONFIDENCE_ABSTAIN
// (0.75) and SOFT_CONFIDENCE_BANNER (0.6) structurally unreachable, so
// strict-mode callers always abstained on low_similarity. Audit 2026-05-10.
export const RRF_THEORETICAL_MAX = 2 / 61;
export const SOFT_CONFIDENCE_BANNER_THRESHOLD = 0.6;
export const STRICT_CONFIDENCE_ABSTAIN_THRESHOLD = 0.75;

export const ENFORCEMENT_AUTO_DISABLE_THRESHOLD = 0.85;
export const ENFORCEMENT_ENABLE_THRESHOLD = 0.9;

export const CIRCUIT_BREAKER_FAILURES_TO_TRIP = 3;
export const CIRCUIT_BREAKER_WINDOW_MS = 10_000;
export const CIRCUIT_BREAKER_OPEN_MS = 30_000;
export const CIRCUIT_BREAKER_PROBE_SUCCESS_COUNT = 2;

export const PER_PLAN_TIMEOUT_MS: Record<string, number> = {
  free: 20_000,
  starter: 35_000,
  pro: 55_000,
  unlimited: 75_000,
};
export const VERIFIER_TIMEOUT_MS = 15_000;

export const CACHE_TTL_MS = 5 * 60_000;

export const VALID_CALLERS = [
  'foxy', 'ncert-solver', 'quiz-generator', 'concept-engine', 'diagnostic',
] as const;

export const REGISTERED_PROMPT_TEMPLATES = [
  'foxy_tutor_v1',
  // RCA-FIX RC-1 (2026-06-26): mode-specific prompts replace the monolithic
  // foxy_tutor_v1 for learn/explain, practice, and doubt/homework modes.
  'foxy_tutor_teach_v1',
  'foxy_tutor_exam_v1',
  'foxy_tutor_doubt_v1',
  'quiz_question_generator_v1',
  'quiz_answer_verifier_v1',
  'ncert_solver_v1',
] as const;

// ── Response-cache v2 generation-context revisions ───────────────────────────
// Mirror of supabase/functions/grounded-answer/config.ts (CI parity check).
// See that file for the authoritative bump rules. Bumping either constant
// invalidates every cached grounded-answer response (L1/L2/L3).
export const PROMPT_REV = 1;
export const MODEL_ROUTE_REV = 1;
