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

// ── Per-plan request budget (whole grounded-answer invocation) ───────────────
//
// This number is ONE request's total budget inside the Edge Function:
// retrieval (embed + vector search + rerank) AND every rung of the model
// fallback chain must fit inside it. Two things are sized off it:
//   hop timeout          = this + 2s   (caller aborts the transport)
//   platform maxDuration = 60s         (apps/host/vercel.json pins
//                                       /api/foxy and /api/concept-engine)
//
// P0 REPAIR 2026-08-31 (part 1). These were 20/35/55/75s while `/api/foxy`
// inherited the generic 30s `maxDuration`, so on EVERY PAID plan the hop
// (37/57/77s) outlived the Vercel function itself. Consequences, both observed
// as a student-facing failure rather than a graceful degrade:
//   D1 — the function was killed with FUNCTION_INVOCATION_TIMEOUT before the
//        Edge Function's own abstain payload could return AND before the
//        route's refundQuota ran, so a paying student LOST A QUOTA UNIT for
//        an answer they never received.
//   D2 — MODEL_FALLBACK_ORDER.auto has 4 rungs and claude.ts spent up to 60%
//        of this budget on EACH one, so 4 sequential attempts needed
//        48/84/132/180s against budgets of 20/35/55/75s. The two OpenAI rungs
//        were arithmetically unreachable on a timeout: cross-provider fallback
//        was dead code on every plan.
//
// RECALIBRATION 2026-08-31 (part 2). Part 1 set 41/43/45/47s and had claude.ts
// slice them UNIFORMLY (chainBudget / 3), giving 12.00/12.67/13.33/14.00s per
// rung. That fit the chain but was never checked against production latency.
// Measured since — 1000 most recent successful Foxy answers, `grounded_ai_
// traces` where caller='foxy' AND grounded=true:
//
//   p50  5,167ms   p75  7,499ms   p90 11,055ms
//   p95 14,098ms   p99 20,215ms   max 36,627ms
//   >12,000ms: 82/1000 (8.2%)   >14,000ms: 51/1000 (5.1%)
//
// A uniform ~12-14s slice severs ~8% of answers that succeed TODAY, at rung 1.
// Those turns then fall to Sonnet — slower than Haiku, on an equally short
// slice — so they most likely time out again before the cross-provider rung.
// For that 8% the "fix" traded a working Haiku answer for a longer wait and a
// worse model. That is a regression, so the SHAPE changed, not just the size:
// claude.ts now runs a NON-UNIFORM LADDER (see its planChainBudget header).
//   rung 1   = chainBudget - 2 x 10s  — the attempt that normally succeeds,
//                                       sized to cover ~p99, not ~p90
//   rungs 2+ = 10s flat               — recovery attempts, where "an answer,
//                                       soon" beats "the best answer, later",
//                                       and a short bound is what keeps the
//                                       cross-provider rung reachable at all
//
// Resulting ladder (chain = budget - CHAIN_RESERVE_MS(5s)):
//
//   plan       budget  chain  rung1  rung2+  3 rungs fit  rung1 covers*
//   free       44s     39s    19s    10s     39 <= 39 ok  ~98.2%
//   starter    45s     40s    20s    10s     40 <= 40 ok  ~98.9%
//   pro        46s     41s    21s    10s     41 <= 41 ok  >99%
//   unlimited  47s     42s    22s    10s     42 <= 42 ok  >99%
//
//   * fraction of the measured distribution completing inside the rung-1
//     budget. CONSERVATIVE: `latency_ms` is stamped from the top of the Edge
//     Function invocation, so those percentiles already include the retrieval
//     time that CHAIN_RESERVE_MS pays for separately. Rung 1 only has to cover
//     latency-minus-retrieval, so real coverage is higher than quoted.
//
// Rung 3 is `openai:gpt-4o-mini`, the FIRST cross-provider rung, and it fits on
// every plan — the P0 property (a reachable OpenAI tier on a pure-timeout
// chain) is preserved by the ladder, not merely by the old uniform division.
//
// maxDuration stays 60s deliberately. The ceiling was NOT the binding
// constraint: rung 1 only needs ~p99 (~20s), and 19-22s closes inside 60s with
// 5s of preamble headroom on the worst plan (hop 49s + 6s cleanup reserve =
// 55s). Raising it would only buy a LONGER rung 1 than the distribution asks
// for, which makes the timeout tail worse — a student waits longer before the
// cross-provider rung is even tried. The cost of a bad ladder is paid in
// latency, not in ceiling.
//
// Invariants to preserve when editing: for every plan,
//   CHAIN_RESERVE_MS + rung1 + (PLANNED_RUNGS-1) * RECOVERY_RUNG_TIMEOUT_MS
//                                                     <= PER_PLAN_TIMEOUT_MS
//   rung1                                             >= p95 (14,098ms)
//   PER_PLAN_TIMEOUT_MS + 2_000 + 6_000 cleanup + preamble headroom <= 60_000
// (see claude.ts PLANNED_FALLBACK_RUNGS / CHAIN_RESERVE_MS /
//  RECOVERY_RUNG_TIMEOUT_MS, and apps/host/src/app/api/foxy/route.ts's
//  FOXY_MAX_DURATION_MS / FOXY_CLEANUP_RESERVE_MS.)
export const PER_PLAN_TIMEOUT_MS: Record<string, number> = {
  free: 44_000,
  starter: 45_000,
  pro: 46_000,
  unlimited: 47_000,
};
export const VERIFIER_TIMEOUT_MS = 15_000;

export const CACHE_TTL_MS = 5 * 60_000;

export const VALID_CALLERS = [
  'foxy', 'ncert-solver', 'quiz-generator', 'concept-engine', 'diagnostic', 'lesson', 'content',
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
  // Lesson Generation Agent (GenAI Phase 5b) — structured, NCERT-grounded,
  // bilingual multi-section lesson notes. First student-facing generative
  // artifact; consumed via caller='lesson', cache_scope='none'.
  'lesson_notes_v1',
  // Content Generation Agent (GenAI Phase 5c) — single NCERT-grounded Mermaid
  // diagram spec (flowchart/mindmap/timeline). Student-facing generative
  // artifact; consumed via caller='content', cache_scope='none'. Pure addition
  // (no PROMPT_REV bump — gen_ctx keys on system_prompt_template).
  'diagram_spec_v1',
] as const;

// ── Response-cache v2 generation-context revisions ───────────────────────────
// Mirror of supabase/functions/grounded-answer/config.ts (CI parity check).
// See that file for the authoritative bump rules. Bumping either constant
// invalidates every cached grounded-answer response (L1/L2/L3).
// PROMPT_REV=3 (2026-07-20): LaTeX-in-JSON escaping fix — few-shot JSON
// examples in FOXY_STRUCTURED_OUTPUT_PROMPT now carry doubled backslashes plus
// an explicit JSON-escaping rule; per-surface bullets added to the six
// JSON-output templates. Kept in sync with the authoritative bump in
// supabase/functions/grounded-answer/config.ts.
// NOTE (Lesson Agent, GenAI Phase 5b): adding the 'lesson_notes_v1' template id
// to REGISTERED_PROMPT_TEMPLATES is a PURE ADDITION — it does NOT change any
// existing template's TEXT and does not alter pipeline prompt assembly for any
// existing request, and gen_ctx keys on system_prompt_template so it cannot
// collide with a cached entry. Per the bump rule, this does NOT bump PROMPT_REV
// (a bump would needlessly flush every Foxy cache tier).
// PROMPT_REV=4 (2026-08-31, safety-rails wiring fix): the three LIVE Foxy
// templates (foxy_tutor_teach_v1 / _exam_v1 / _doubt_v1) gained a
// `{{foxy_safety_rails}}` slot — the route had been SENDING FOXY_SAFETY_RAILS on
// every turn since the grounded-answer cutover while no template declared the
// slot, so resolveTemplate silently discarded it and the rails never reached the
// model. Same deploy: `{{mode_instruction}}` was added to _exam_v1 and _doubt_v1
// (the service-computed soft-mode grounding instruction was being dropped on
// every doubt/homework/practice turn). Text changed in BOTH prompts/*.txt and
// the runtime-preferred prompts/inline.ts twins. Kept in sync with the
// authoritative bump in supabase/functions/grounded-answer/config.ts; see that
// file for the full rationale.
// NOTE: this mirror was NOT updated when the authoritative bump landed in
// config.ts on 2026-08-31 and sat stale at 3 within the same day — the SECOND
// time this file silently diverged (see the MODEL_ROUTE_REV=4 note below for the
// first). Both parity mechanisms compared constant NAMES only
// (scripts/pre-rollout-checklist.ts's /^export const ([A-Z_]+)\s*=/ regex; the
// dead scripts/check-config-parity.sh), so neither could ever see a VALUE drift.
// Pinned since 2026-08-31 by apps/host/src/__tests__/grounding/
// config-parity-values.test.ts, which compares parsed VALUES across both files.
export const PROMPT_REV = 4;
// MODEL_ROUTE_REV=2 (2026-08-02): OpenAI-primary provider swap — kept in sync
// with the authoritative bump in supabase/functions/grounded-answer/config.ts
// (see that file for the full cost-driven rationale and RCA-FIX CRITICAL-1
// calibration history).
// MODEL_ROUTE_REV=3 (2026-08-03): percentage-rollout mechanism on top of the
// OpenAI-primary swap (ff_foxy_openai_primary_rollout_v1) — kept in sync with
// the authoritative bump in supabase/functions/grounded-answer/config.ts (see
// that file for the full rationale, including the documented KNOWN LIMITATION
// re: gen_ctx not yet recording which order a cached response was generated
// under).
// MODEL_ROUTE_REV=4 (2026-08-26): Claude-primary provider swap — every
// model_preference resolves to a Claude model first (OpenAI second), reversing
// the 2026-08-02 OpenAI-primary swap. NOTE: this mirror was NOT updated when
// the authoritative bump landed in config.ts on 2026-08-26 and sat stale at 3
// until 2026-08-31. The drift was inert (nothing imports MODEL_ROUTE_REV from
// this file — gen-ctx.ts reads it from the Deno config, and the CI parity check
// compares constant NAMES only, never values), but it is exactly the kind of
// silent divergence this mirror exists to prevent.
// MODEL_ROUTE_REV=5 (2026-08-31): DEAD-PIN REPAIR — the sonnet tier's Anthropic
// id changed from the RETIRED 'claude-sonnet-4-20250514' (live API returns HTTP
// 404 not_found_error) to 'claude-sonnet-4-5-20250929'. Kept in sync with the
// authoritative bump in supabase/functions/grounded-answer/config.ts; see that
// file for the full rationale.
export const MODEL_ROUTE_REV = 5;
