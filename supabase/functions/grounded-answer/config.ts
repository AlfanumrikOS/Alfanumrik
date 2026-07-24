// supabase/functions/grounded-answer/config.ts
// IMPORTANT: This file MUST stay in sync with src/lib/grounding-config.ts.
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
  // foxy_tutor_v1 which had three conflicting output-format sections.
  // learn/explain → teach (Socratic Step Cards, no CBSE evaluator persona)
  // practice       → exam  (CBSE board format, marks-based)
  // doubt/homework → doubt (direct Q&A, no Socratic)
  'foxy_tutor_teach_v1',
  'foxy_tutor_exam_v1',
  'foxy_tutor_doubt_v1',
  'quiz_question_generator_v1',
  'quiz_answer_verifier_v1',
  'ncert_solver_v1',
] as const;

// ── Response-cache v2 generation-context revisions ───────────────────────────
// Both revisions are folded into the gen_ctx tuple that is hashed into every
// response-cache key (L1 in-memory, L2 Redis, L3 ncert_solver_solutions).
// Bumping either constant instantly invalidates EVERY cached response — old
// entries become unreachable (new hash) and age out via TTL.
//
// PROMPT_REV bump rule: bump whenever ANY registered prompt template's TEXT
// changes (prompts/*.txt or prompts/inline.ts), OR when pipeline-side prompt
// assembly changes what the model sees for the same request (e.g. new
// service-computed template variable, reference-material formatting change,
// FOXY_STRUCTURED_OUTPUT_PROMPT edit, mode_instruction wording change).
// PROMPT_REV=2 (2026-07-20): foxy_tutor_v1 §8 rewritten per
// docs/math-rendering-spec.md — grade-band step-density deferral (density text
// injected via mode_directive; single source buildMathFormatDirective) + the
// answer-block vs \boxed{} disambiguation (spec §4). Text changed in BOTH
// prompts/foxy_tutor_v1.txt and prompts/inline.ts (kept byte-identical).
// Same deploy (2026-07-20, delimiter-contract closure): the math-notation
// contract (spec §2) + deferential step-density + §4 boxing rules were
// extended to quiz_question_generator_v1, quiz_answer_verifier_v1,
// ncert_solver_v1, foxy_tutor_doubt_v1, and foxy_tutor_exam_v1 (.txt +
// inline.ts twins, byte-identical). Same deploy (2026-07-20, assessment
// review conditions): foxy_tutor_v1 §4 made deferential (never skip a stage;
// density + boxing follow §8, mirroring foxy_tutor_exam_v1 §4) and §8 tightened
// (exponents via LaTeX ^{...} only — the "or x²" Unicode allowance removed per
// spec §2; programming-syntax ban scoped to prose OUTSIDE delimiters). Rev 2
// has never shipped, so the single 1→2 bump covers ALL of these template
// changes — no cache entry was ever written under rev 2 with the older text.
// PROMPT_REV=3 (2026-07-20, LaTeX-in-JSON escaping fix): rev 2 shipped earlier
// today, so this NEW deploy gets its own bump. The structured-output few-shot
// examples (FOXY_STRUCTURED_OUTPUT_PROMPT — schema.ts / structured-prompt.ts /
// foxy_structured_prompt.py) previously showed LaTeX inside JSON strings with
// SINGLE backslashes ("\(", "\frac") — illegal JSON escapes the model imitated,
// crashing JSON.parse on math-bearing blocks. All few-shot JSON examples now
// carry correctly DOUBLED backslashes, an explicit "JSON ESCAPING FOR MATH"
// rule was added, and a per-surface JSON-escaping bullet was added to the six
// JSON-output templates (foxy_tutor_v1/teach/exam/doubt, quiz generator,
// quiz verifier — .txt + inline.ts twins; ncert_solver_v1 is raw-markdown and
// untouched).
export const PROMPT_REV = 3;

// ── Model fallback ordering (edge mirror of the TS gateway registry) ─────────
//
// This constant is the Deno-side mirror of the TS Model Gateway's
// LEGACY_FALLBACK_ORDER (packages/lib/src/ai/gateway/registry.ts). Deno cannot
// import from packages/lib directly, so the ordering is duplicated here as the
// SINGLE source that grounded-answer/claude.ts `resolveModelOrder` reads from.
//
// INVARIANT: this MUST equal the TS registry's LEGACY_FALLBACK_ORDER
// byte-for-byte (same providers, same model ids, same order). A parity test
// (owned by the testing agent) asserts equality across the Deno/Node boundary
// so the two can never silently drift.
//
// Anthropic runs FIRST for every preference — the Foxy system prompt, JSON
// output contract, and CBSE pedagogy tree are calibrated for Claude; the OpenAI
// tiers are availability fallbacks only (RCA-FIX CRITICAL-1, 2026-06-26).
export const MODEL_FALLBACK_ORDER: Record<
  'haiku' | 'sonnet' | 'auto',
  ReadonlyArray<{ provider: 'anthropic' | 'openai'; model: string }>
> = {
  haiku: [
    { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' },
    { provider: 'openai', model: 'gpt-4o-mini' },
  ],
  sonnet: [
    { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
    { provider: 'openai', model: 'gpt-4o' },
  ],
  auto: [
    { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' },
    { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
    { provider: 'openai', model: 'gpt-4o-mini' },
    { provider: 'openai', model: 'gpt-4o' },
  ],
};
// MODEL_ROUTE_REV bump rule: bump whenever model routing changes what model
// (or generation params) a given model_preference resolves to — e.g. a model
// id upgrade in claude.ts (HAIKU_MODEL / SONNET_MODEL / GPT_* constants), a
// change to resolveModelOrder(), or a change to the effective-temperature /
// effective-max_tokens derivation in the pipeline.
export const MODEL_ROUTE_REV = 1;