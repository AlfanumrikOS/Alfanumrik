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
  'foxy', 'ncert-solver', 'quiz-generator', 'concept-engine', 'diagnostic', 'lesson', 'content',
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
// NOTE (Lesson Agent, GenAI Phase 5b): adding the 'lesson_notes_v1' template id
// to REGISTERED_PROMPT_TEMPLATES is a PURE ADDITION — it does NOT change any
// existing template's TEXT and does not alter pipeline prompt assembly for any
// existing request, and gen_ctx keys on system_prompt_template so it cannot
// collide with a cached entry. Per the bump rule above, this does NOT bump
// PROMPT_REV (a bump would needlessly flush every Foxy cache tier).
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
// OpenAI runs FIRST for every preference (CEO-approved cost-driven provider
// swap, 2026-08-02): Anthropic's per-token cost does not scale with
// per-student revenue at current volume. Claude is RETAINED as the fallback
// tier, not deleted — specifically because the Foxy system prompt, JSON
// output contract, and CBSE pedagogy tree were originally calibrated against
// Claude's behavior (RCA-FIX CRITICAL-1, 2026-06-26). That calibration
// history is exactly why an output-quality validation pass (the
// eval/openai-migration harness) gates how far the canary ramps before
// GPT-4o/GPT-4o-mini output reaches students at volume — this reorder makes
// OpenAI primary for cost, it does not certify OpenAI output quality by
// itself.
export const MODEL_FALLBACK_ORDER: Record<
  'haiku' | 'sonnet' | 'auto',
  ReadonlyArray<{ provider: 'anthropic' | 'openai'; model: string }>
> = {
  haiku: [
    { provider: 'openai', model: 'gpt-4o-mini' },
    { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' },
  ],
  sonnet: [
    { provider: 'openai', model: 'gpt-4o' },
    { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
  ],
  auto: [
    { provider: 'openai', model: 'gpt-4o-mini' },
    { provider: 'openai', model: 'gpt-4o' },
    { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' },
    { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
  ],
};

// ── Claude-primary rollback order (percentage-rollout mechanism, 2026-08-03) ─
//
// Reconstructed BYTE-FOR-BYTE from the pre-2026-08-02 order (verified via
// `git show 5e6ffa9f -- supabase/functions/grounded-answer/config.ts` — the
// swap commit simply reversed each two-element array and moved the two
// anthropic entries ahead of the two openai entries in `auto`; nothing else
// changed). This is the ROLLBACK target for `_model-rollout-flag.ts`'s
// percentage-based rollout: `ff_foxy_openai_primary_rollout_v1` buckets a
// caller into this order instead of MODEL_FALLBACK_ORDER when the flag is
// enabled and the caller's hash falls inside `rollout_percentage`.
//
// MODEL_FALLBACK_ORDER above is UNCHANGED and stays the fail-safe / seed-state
// default — see _model-rollout-flag.ts's header for the full precedence.
export const CLAUDE_PRIMARY_FALLBACK_ORDER: Record<
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
// MODEL_ROUTE_REV=2 (2026-08-02): OpenAI-primary provider swap — every
// model_preference now resolves to a GPT model first (Claude second), per the
// rationale above. Cache entries written under rev 1 reflected a
// Claude-primary resolution and must not be served for a request made under
// this new ordering.
// MODEL_ROUTE_REV=3 (2026-08-03): resolveModelOrder() is now rollout-flag-aware
// (see _model-rollout-flag.ts) — it can resolve a preference to
// CLAUDE_PRIMARY_FALLBACK_ORDER instead of MODEL_FALLBACK_ORDER once
// ff_foxy_openai_primary_rollout_v1 is enabled with rollout_percentage>0. The
// flag SEEDS disabled (rollout_percentage=0), so this bump is precautionary —
// today's resolution is byte-identical to rev 2 for every caller. Bumping
// still invalidates rev-2 cache entries per the rule above (defensive, cheap,
// self-healing). KNOWN LIMITATION, not solved by this bump: gen_ctx does not
// currently record WHICH order a given cached response was generated under,
// so once rollout_percentage>0 a response cached from a claude-primary-bucketed
// student could theoretically be served (via L1/L2/L3 hit) to a student
// bucketed to openai-primary, or vice versa. This is a content-mixing
// concern, not a P12 safety violation (both orders produce grounded,
// safety-railed, curriculum-scoped answers) — flagged here for
// testing/architect to assess before any ramp beyond the safe 0% seed.
export const MODEL_ROUTE_REV = 3;