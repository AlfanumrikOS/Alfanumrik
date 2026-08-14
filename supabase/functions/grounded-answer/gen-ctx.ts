// supabase/functions/grounded-answer/gen-ctx.ts
//
// Response-cache v2 "generation context" (gen_ctx) tuple.
//
// The v1 cache key was (grade, subject_code, mode, caller, normalized-query
// hash). That collapsed requests that share the same query TEXT but produce
// materially different answers — the observed production bug was Foxy's
// learn / practice / quiz_me UI modes: all three arrive as caller='foxy',
// mode='soft' with identical query text, differing ONLY in template
// variables (mode, mode_directive), max_tokens, and sometimes temperature.
// v1 served a practice-shaped MCQ response to a learn turn.
//
// v2 folds EVERYTHING that can change the generated answer for the same
// query into one canonical tuple, hashes it, and makes that hash part of
// BOTH the cache key (12-hex-char fragment, keeps the visible key short)
// and the stored defense-in-depth tuple (full 64-hex-char hash, re-validated
// on every read — mismatch is a miss, never served).
//
// gen_ctx fields (design-approved, response-cache v2):
//   prompt_template     — which registered template renders the system prompt
//   prompt_rev          — config.ts PROMPT_REV (bump on ANY prompt-text change)
//   model_route_rev     — config.ts MODEL_ROUTE_REV (bump on model-routing change)
//   everyday_examples   — ff_foxy_everyday_examples_v1 state; present ONLY when
//                         the flag is ON (a different Foxy system prompt →
//                         a different answer). Omitted when OFF so flag-OFF
//                         requests keep their pre-flag hash. See the field doc.
//   model_preference    — 'haiku' | 'sonnet' | 'auto'
//   max_tokens          — caller-requested generation budget
//   temperature         — caller-requested temperature
//   content_version     — rag_content_versions.version for (grade, subject_code);
//                         bumped by every ingestion writer, so re-ingested NCERT
//                         content invalidates cached answers built on old chunks
//   match_count         — retrieval.match_count: how many chunks feed the
//                         prompt's reference material (changes the answer)
//   min_similarity_override — retrieval.min_similarity_override (null when
//                         absent, so presence/absence hashes deterministically);
//                         changes which chunks qualify → changes the answer
//   template_variables  — the FULL caller-supplied template-variable record
//   conversation_turns  — prior turns (normally empty for cache-eligible
//                         requests — cache_scope:'shared' callers only declare
//                         shared when turns are absent — but included so a
//                         misdeclaring caller can never collide across
//                         different conversations)
//
// Canonicalization: recursive sorted-key JSON so two semantically identical
// contexts always serialize to the same bytes regardless of object key
// insertion order.

import { MODEL_ROUTE_REV, PROMPT_REV } from './config.ts';
import type { ConversationTurn, GroundedRequest, GroundedResponse, ModelOrder } from './types.ts';

// Re-exported for ergonomics: pipeline.ts, cache-redis.ts, and
// cache-durable.ts all already import from this module, so they can pull
// ModelOrder from here too instead of a separate ./types.ts import.
export type { ModelOrder } from './types.ts';

export interface GenCtx {
  prompt_template: string;
  prompt_rev: number;
  model_route_rev: number;
  /**
   * Percentage-rollout mechanism cache-order fix (2026-08-03, assessment
   * finding, REG-335 follow-up). Which model fallback table this request's
   * answer was generated under — see types.ts's ModelOrder doc. Resolved
   * ONCE per pipeline run (pipeline.ts, BEFORE Step 2's cache lookup) from
   * the same shouldUseClaudePrimary() the Claude call itself independently
   * re-resolves at the Claude-call step — both reads hit the same
   * 5-minute in-process-cached flag row within one request's lifetime, so
   * they can never disagree.
   *
   * Folding this into gen_ctx means a caller's bucket flip (a ramp change,
   * or the caller moving in/out of the rollout_percentage window between
   * requests) rotates the gen_ctx hash — embedded in EVERY cache tier's
   * key/tuple (L1 cache.ts, L2 cache-redis.ts, L3 cache-durable.ts) —
   * guaranteeing a cache MISS and a fresh, order-correct generation instead
   * of silently serving a response generated under the caller's PREVIOUS
   * order. This is the fix for the gap flagged in config.ts's
   * MODEL_ROUTE_REV=3 comment ("gen_ctx does not currently record WHICH
   * order a given cached response was generated under").
   */
  model_order: ModelOrder;
  /**
   * ff_foxy_everyday_examples_v1 state for this request (see
   * _everyday-flag.ts). When true, Foxy's structured-output addendum carries
   * EVERYDAY_EXAMPLE_DIRECTIVE (structured-prompt.ts) — a REQUIREMENT for at
   * least one everyday-Indian-life "example" block. That is a different system
   * prompt, and therefore a materially different answer, for the SAME query.
   *
   * EXACTLY the model_order precedent (see its doc immediately above): a
   * percentage/boolean rollout flag changed generation while every other
   * gen_ctx field stayed identical, so the cache key did not rotate and a
   * flagged-ON student could be served an answer generated under the
   * flagged-OFF prompt (and vice versa). Same problem here, same fix — fold
   * the resolved flag state into the tuple that is hashed into EVERY cache
   * tier's key/tuple (L1 cache.ts, L2 cache-redis.ts, L3 cache-durable.ts), so
   * a flag flip is a guaranteed MISS and a fresh, prompt-correct generation.
   *
   * Resolved ONCE per pipeline run, BEFORE the Step-2 cache lookup, and the
   * SAME resolved boolean is threaded into buildStructuredOutputPrompt at the
   * prompt-assembly step — so the prompt the answer was generated under and
   * the key it is cached under can never disagree.
   *
   * PRESENT ONLY WHEN TRUE (deliberate — this is why no PROMPT_REV bump is
   * needed). canonicalJson drops undefined members, so a flag-OFF request
   * serializes byte-identically to a pre-flag request and EVERY existing cache
   * entry (including the DURABLE L3 ncert_solver_solutions store, which has no
   * TTL to age orphans out) stays reachable and valid — correctly, because the
   * flag-OFF prompt is byte-identical to today's. Only flag-ON requests rotate
   * the hash, and they SHOULD. An always-present `false` would have been the
   * more conventional shape but would have orphaned every cached response on
   * deploy for users who see no behavioural change — precisely the needless
   * flush that config.ts's PROMPT_REV comment declines. Note this is the one
   * GenCtx member that may be absent; `min_similarity_override` normalizes to
   * null instead because BOTH of its states are live generation inputs,
   * whereas `everyday_examples: false` IS the pre-existing baseline.
   */
  everyday_examples?: true;
  model_preference: 'haiku' | 'sonnet' | 'auto';
  max_tokens: number;
  temperature: number;
  content_version: number;
  match_count: number;
  /** Normalized to null when the caller omits it (never undefined — undefined
   * members are dropped by canonicalJson, null is stable in the hash). */
  min_similarity_override: number | null;
  template_variables: Record<string, string>;
  conversation_turns: ConversationTurn[];
}

/** Length of the gen_ctx hash fragment embedded in the visible cache key. */
export const GEN_CTX_KEY_FRAGMENT_LENGTH = 12;

/**
 * Build the gen_ctx tuple for a request + the current content version.
 *
 * `modelOrder` defaults to 'openai_primary' — the current global fail-safe
 * default (matches shouldUseClaudePrimary's own documented fail-safe
 * direction and the flag's seeded/disabled posture) — SOLELY so pre-existing
 * and unrelated call sites (tests exercising other gen_ctx fields) keep
 * compiling and hashing without churn (mirrors cache.ts's buildCacheKey
 * `genCtxHash?: string` optional-with-fallback precedent for the same kind
 * of additive fold-in). Any REAL cache-read/write call site on a live
 * request path MUST resolve and pass the caller's ACTUAL current order
 * (see pipeline.ts's Step 2) — relying on this default there would defeat
 * the whole point of this fix.
 *
 * `everydayExamples` defaults to false for the same reason: false is the
 * pre-flag baseline, so every pre-existing call site keeps compiling AND
 * keeps hashing to its existing value (the member is omitted when false —
 * see the GenCtx.everyday_examples doc). Live Foxy call sites MUST pass the
 * value resolved by isEverydayExamplesEnabled (_everyday-flag.ts) before the
 * cache lookup.
 */
export function buildGenCtx(
  request: GroundedRequest,
  contentVersion: number,
  modelOrder: ModelOrder = 'openai_primary',
  everydayExamples = false,
): GenCtx {
  return {
    prompt_template: request.generation.system_prompt_template,
    prompt_rev: PROMPT_REV,
    model_route_rev: MODEL_ROUTE_REV,
    model_order: modelOrder,
    // Conditional spread, NOT `everyday_examples: everydayExamples` — the
    // member must be ABSENT (not `false`) in the flag-OFF case so the canonical
    // JSON is byte-identical to a pre-flag request. See the field's doc.
    ...(everydayExamples ? { everyday_examples: true as const } : {}),
    model_preference: request.generation.model_preference,
    max_tokens: request.generation.max_tokens,
    temperature: request.generation.temperature,
    content_version: contentVersion,
    match_count: request.retrieval.match_count,
    min_similarity_override: request.retrieval.min_similarity_override ?? null,
    template_variables: request.generation.template_variables ?? {},
    conversation_turns: request.generation.conversation_turns ?? [],
  };
}

/**
 * Deterministic JSON: object keys sorted recursively, arrays kept in order.
 * Only JSON-safe values appear in GenCtx so no special handling is needed
 * for undefined/functions (JSON.stringify drops undefined object members —
 * GenCtx never carries undefined members by construction).
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalJson(v)).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

/** Full sha256 hex (64 chars) of the canonical gen_ctx JSON. */
export async function hashGenCtx(genCtx: GenCtx): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(genCtx));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Short fragment of the full hash for the visible cache key. */
export function genCtxKeyFragment(fullHash: string): string {
  return fullHash.slice(0, GEN_CTX_KEY_FRAGMENT_LENGTH);
}

/**
 * Defense-in-depth (assessment finding, REG-335 cache-order-blindness
 * follow-up). Independent SECOND check on cache read, using a DIFFERENT
 * signal than the gen_ctx hash (the PRIMARY fix, above): compares the
 * cached response's OWN recorded model_order (stamped at generation time
 * from the SAME resolution used to build its gen_ctx — see pipeline.ts's
 * finalizeGrounded call) against the order CURRENTLY expected for this
 * caller. Mirrors how tuplesMatch (cache-redis.ts) re-validates the full
 * CacheTuple even though the key itself is already a hash match — this
 * function is a redundant backstop for the hash/tuple check, not a
 * replacement for it.
 *
 * Exact string equality only — deliberately NOT inferring "order" from
 * response.meta.claude_model's provider. That was considered and rejected:
 * claude.ts's per-call fallback can legitimately reach either provider
 * under EITHER order (e.g. an OpenAI outage answered by Claude while still
 * resolved under 'openai_primary'), so a provider-based inference produces
 * false positives on ordinary same-order fallback and would needlessly
 * degrade the cache hit rate. The explicit model_order tag has no such
 * ambiguity.
 *
 * Deliberately PERMISSIVE (returns true = "no mismatch found") whenever the
 * signal is absent: non-grounded responses (never cached in the first
 * place), and responses with no recorded model_order (any entry written
 * before this fix shipped — which the gen_ctx hash rotation this fix
 * causes already makes unreachable under a NEW key, so this branch is a
 * pure safety net, not a live path).
 */
export function cachedResponseMatchesModelOrder(
  response: GroundedResponse,
  expectedModelOrder: ModelOrder,
): boolean {
  if (!response.grounded) return true;
  const recorded = response.meta.model_order;
  if (!recorded) return true;
  return recorded === expectedModelOrder;
}
