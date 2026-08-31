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
// NOTE (everyday-Indian-life examples, ff_foxy_everyday_examples_v1): this also
// does NOT bump PROMPT_REV, even though it DOES change prompt text — because it
// only changes it for flag-ON requests. buildStructuredOutputPrompt returns
// FOXY_STRUCTURED_OUTPUT_PROMPT byte-for-byte when the flag is OFF, so every
// cache entry written before this deploy remains CORRECT (it was generated
// under exactly the prompt a flag-OFF request still produces today). The
// flag-ON case is handled by gen_ctx instead: `everyday_examples` is folded
// into the hashed tuple and PRESENT ONLY WHEN TRUE, so flag-ON requests rotate
// the key and miss naturally while flag-OFF requests keep their existing key.
// Bumping would flush every Foxy cache tier — including the DURABLE L3
// ncert_solver_solutions store — for the ~100% of users who see no change,
// which is the same trade this comment block declines above. If the flag is
// ever promoted to unconditional (directive always appended, flag removed),
// THAT change MUST bump PROMPT_REV.
// PROMPT_REV=4 (2026-08-31, safety-rails wiring fix): the Foxy route has been
// sending `foxy_safety_rails` (FOXY_SAFETY_RAILS, packages/lib/src/foxy/
// prompt-sections.ts — rails 1-9: CBSE scope, age-appropriateness, bilingual
// style, honesty, grounding, factual integrity under pressure, the bilingual
// EN/HI RAG-only refusal, the no-fake-actions rail, and the prohibited-
// inferences denylist) on EVERY live turn since the grounded-answer cutover,
// but NO registered template declared a `{{foxy_safety_rails}}` slot.
// resolveTemplate only substitutes tokens that EXIST in the template and
// silently discards the rest, so the rails have never reached the model. A
// `## Safety Rails` section carrying `{{foxy_safety_rails}}` was added
// immediately after the `## Grounding Rules` block of the three LIVE Foxy
// templates — foxy_tutor_teach_v1 (learn/explain), foxy_tutor_exam_v1
// (practice), foxy_tutor_doubt_v1 (doubt/homework) — in BOTH the canonical
// prompts/*.txt and their shipped prompts/inline.ts String.raw twins (the
// loader prefers inline, so a .txt-only edit would have been a no-op).
// Same deploy: `{{mode_instruction}}` was added to foxy_tutor_exam_v1 and
// foxy_tutor_doubt_v1. Those two templates never carried the slot, and the
// pipeline's `if (!vars.mode_directive) vars.mode_directive = vars.mode_
// instruction` fallback only fires when mode_directive is EMPTY — which it
// never is on a Foxy turn (practice always gets an MCQ directive;
// doubt/homework get TEACH_THEN_STOP_DIRECTIVE via ff_foxy_learning_actions_v1,
// enabled at 100% by migration 20260624100000). The service-computed
// soft-mode grounding instruction ("You MUST answer ONLY from the Reference
// Material…" / the empty-corpus fallback) was therefore dropped on every
// doubt/homework/practice turn; it now renders inside the Grounding Rules
// section of both templates.
// foxy_tutor_v1 is deliberately UNCHANGED (byte-for-byte pinned by
// apps/host/src/__tests__/foxy-prompt-pedagogy-v2.test.ts and not selected by
// selectFoxyPromptTemplate).
// Per the bump rule above this IS a text change to registered templates that
// applies to 100% of Foxy requests (no flag gate), so every cached response
// generated under rev 3 must become unreachable — bump is REQUIRED.
export const PROMPT_REV = 4;

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
// Claude runs FIRST for every preference (CEO-approved quality-driven provider
// swap back, 2026-08-26): the Foxy system prompt, JSON output contract, and
// CBSE pedagogy tree were originally calibrated against Claude's behavior
// (RCA-FIX CRITICAL-1, 2026-06-26). Restoring Claude as primary ensures the
// highest answer quality for students. OpenAI is RETAINED as the fallback
// tier, not deleted — activates on Claude timeout / 5xx / auth failure.
export const MODEL_FALLBACK_ORDER: Record<
  'haiku' | 'sonnet' | 'auto',
  ReadonlyArray<{ provider: 'anthropic' | 'openai'; model: string }>
> = {
  haiku: [
    { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' },
    { provider: 'openai', model: 'gpt-4o-mini' },
  ],
  sonnet: [
    { provider: 'anthropic', model: 'claude-sonnet-4-5-20250929' },
    { provider: 'openai', model: 'gpt-4o' },
  ],
  auto: [
    { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' },
    { provider: 'anthropic', model: 'claude-sonnet-4-5-20250929' },
    { provider: 'openai', model: 'gpt-4o-mini' },
    { provider: 'openai', model: 'gpt-4o' },
  ],
};

// ── OpenAI-primary rollback order (percentage-rollout mechanism, 2026-08-03) ──
//
// The pre-2026-08-26 OpenAI-primary order, retained as the ROLLBACK target for
// `_model-rollout-flag.ts`'s percentage-based rollout:
// `ff_foxy_openai_primary_rollout_v1` buckets a caller into this order instead
// of MODEL_FALLBACK_ORDER when the flag is enabled and the caller's hash falls
// inside `rollout_percentage`.
//
// MODEL_FALLBACK_ORDER above is UNCHANGED and stays the fail-safe / seed-state
// default — see _model-rollout-flag.ts's header for the full precedence.
export const CLAUDE_PRIMARY_FALLBACK_ORDER: Record<
  'haiku' | 'sonnet' | 'auto',
  ReadonlyArray<{ provider: 'anthropic' | 'openai'; model: string }>
> = {
  haiku: [
    { provider: 'openai', model: 'gpt-4o-mini' },
    { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' },
  ],
  sonnet: [
    { provider: 'openai', model: 'gpt-4o' },
    { provider: 'anthropic', model: 'claude-sonnet-4-5-20250929' },
  ],
  auto: [
    { provider: 'openai', model: 'gpt-4o-mini' },
    { provider: 'openai', model: 'gpt-4o' },
    { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' },
    { provider: 'anthropic', model: 'claude-sonnet-4-5-20250929' },
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
// MODEL_ROUTE_REV=4 (2026-08-26): Claude-primary provider swap — every
// model_preference now resolves to a Claude model first (OpenAI second).
// Reverses the 2026-08-02 OpenAI-primary swap. Cache entries written under
// rev 3 reflected an OpenAI-primary resolution and must not be served for a
// request made under this new ordering.
// MODEL_ROUTE_REV=5 (2026-08-31): DEAD-PIN REPAIR — the sonnet tier's Anthropic
// id changed from 'claude-sonnet-4-20250514' (RETIRED; the live API now answers
// HTTP 404 not_found_error and GET /v1/models no longer lists it) to the
// verified-available same-generation successor 'claude-sonnet-4-5-20250929', in
// BOTH MODEL_FALLBACK_ORDER and CLAUDE_PRIMARY_FALLBACK_ORDER. Per the bump
// rule this qualifies: the 'sonnet' (and 'auto') preferences now resolve to a
// DIFFERENT model id than they did under rev 4. It is a repair, not an upgrade
// — same generation, so temperature and assistant-prefill still apply and no
// request-shape change accompanies it — but every rev-4 sonnet-tier cache entry
// was produced by whatever the fallback chain degraded to after the dead pin
// 404'd (in practice OpenAI), not by the Sonnet the request asked for, so those
// entries must not be served under the repaired ordering.
export const MODEL_ROUTE_REV = 5;