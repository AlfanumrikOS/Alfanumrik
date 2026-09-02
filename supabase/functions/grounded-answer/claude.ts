// supabase/functions/grounded-answer/claude.ts
// Claude API caller with Haiku-primary, Sonnet-fallback routing.
//
// Single responsibility: send a fully-formed prompt to Claude and return
// a discriminated-union result. Never throws. Spec §6.4 step 6.
//
// Design:
//   - modelPreference drives which model(s) to try and in what order.
//   - Per-call timeout capped at min(budget * 0.6, 45s).
//   - HTTP 401/403 skip the rest of THAT provider's rungs (same key, same
//     result) but still fall through to the other provider, which has its own
//     key; only an all-providers auth failure returns reason:'auth_error'.
//   - HTTP 404/429/5xx (incl. 529) or AbortError → try next model.
//   - {{INSUFFICIENT_CONTEXT}} is a first-class sentinel the prompt can emit;
//     we surface it as insufficientContext:true so the caller can abstain
//     on no_supporting_chunks without treating it as an error.
//   - Token usage is surfaced for cost tracking in trace rows.

import { MODEL_FALLBACK_ORDER, CLAUDE_PRIMARY_FALLBACK_ORDER } from './config.ts';
import { shouldUseClaudePrimary } from './_model-rollout-flag.ts';
// 2026-09-01 DIAGNOSTIC (temporary, remove once the anthropic:unknown root
// cause is confirmed and fixed): every 'unknown'-classified Anthropic result
// is currently invisible — mol_request_logs only stores the failure LABEL,
// never the raw response that produced it. This makes the classification
// observable without guessing.
import { logOpsEvent } from '../_shared/ops-events.ts';

const ANTHROPIC_ENDPOINT = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

// Model ids are NOT declared here anymore. The fallback ordering (and the ids
// within it) is the single Deno-side source of truth in ./config.ts
// (MODEL_FALLBACK_ORDER), which mirrors the TS gateway registry. Keeping a
// second copy here would be a drift risk — resolveModelOrder reads the constant.

const INSUFFICIENT_CONTEXT_SENTINEL = '{{INSUFFICIENT_CONTEXT}}';

// ── Fallback-chain time budget ───────────────────────────────────────────
//
// P0 REPAIR 2026-08-31 (part 1). The ORIGINAL rule was
//   perCall = min(timeoutMs * 0.6, 45s)
// applied identically to EVERY rung, with no notion of a chain deadline. With
// MODEL_FALLBACK_ORDER.auto being four rungs long, that promised each caller
// up to 2.4x its own timeout_ms. The rungs past the second were therefore
// never attempted — the transport hop (and, for Foxy, the Vercel function
// itself) aborted first. Cross-provider fallback on a TIMEOUT was dead code:
// the whole OpenAI tier of `auto` was unreachable on every plan.
//
// RECALIBRATION 2026-08-31 (part 2). Part 1 replaced that with a UNIFORM slice,
//   perCall = clamp(chainBudget / PLANNED_FALLBACK_RUNGS, 12s, 45s)
// which made the chain fit but was never validated against real latency. It has
// now been measured — 1000 most recent successful Foxy answers,
// `grounded_ai_traces` where caller='foxy' AND grounded=true:
//
//   p50  5,167ms   p75  7,499ms   p90 11,055ms
//   p95 14,098ms   p99 20,215ms   max 36,627ms
//   >12,000ms: 82/1000 (8.2%)   >14,000ms: 51/1000 (5.1%)
//
// A uniform 12-14s slice severs ~8% of currently-successful answers at rung 1.
// Those turns then retry on Sonnet — SLOWER than Haiku, on a slice that is
// shorter still — so they almost certainly time out again before reaching the
// cross-provider rung. Net effect for that 8%: a substantially longer wait AND
// a worse model, versus simply receiving the Haiku answer they get today. A
// uniform slice is the wrong shape.
//
// The rule is now a NON-UNIFORM LADDER. Rung 1 is not the same kind of thing as
// rungs 2+:
//   * Rung 1 is the attempt that normally succeeds (~92% of turns complete
//     inside 12s, ~99% inside 20s). Cutting it is the expensive mistake, so it
//     gets the LION'S SHARE of the chain budget — sized to cover p99, not p50.
//   * Rungs 2+ are RECOVERY attempts, reached only because rung 1 already
//     failed. Here "an answer, soon" beats "the best answer, eventually", and a
//     deliberately short bound is what makes the cross-provider rung reachable
//     at all. They get a flat RECOVERY_RUNG_TIMEOUT_MS.
//
//   chainBudget   = timeoutMs - CHAIN_RESERVE_MS
//   recoveryCall  = min(RECOVERY_RUNG_TIMEOUT_MS, chainBudget)
//   firstCall     = clamp(chainBudget - (PLANNED_FALLBACK_RUNGS-1) * recoveryCall,
//                         min(chainBudget, FIRST_RUNG_TIMEOUT_FLOOR_MS),
//                         PER_CALL_TIMEOUT_CAP_MS)
//
// The hard chain deadline from part 1 is UNCHANGED and still governs: no rung
// starts past the budget, and no rung may overrun what is left. A rung that
// fails FAST (401/404/429/5xx — sub-second) donates its unused slice to the
// rungs after it, which is how rung 4 stays reachable in the failure mode that
// actually produces it.
//
// "First" means the first rung ACTUALLY ATTEMPTED, not modelOrder[0]. Rungs are
// skipped when the provider has no key or has already returned 401/403, and the
// first attempt a caller really makes is the one carrying the ~92% success
// probability — wherever it happens to sit in the array.
//
// PLANNED_FALLBACK_RUNGS is 3, not 4, on purpose. Three is what
// MODEL_FALLBACK_ORDER.auto needs to reach its FIRST cross-provider rung
// (anthropic haiku -> anthropic sonnet -> openai gpt-4o-mini), which is the
// property that has to hold on a timeout. Rung 4 (gpt-4o) remains best-effort:
// it is reachable when earlier rungs fail fast, not when all three time out.
// Budgeting for 4 would shrink rung 1 to buy a rung whose only distinct value
// is over an already-tried provider.
//
// CHAIN_RESERVE_MS covers the rest of the invocation that shares timeout_ms —
// embedding, vector search, Voyage rerank, prompt assembly, trace writes. NOTE
// when reading the percentiles above against these constants: `latency_ms` is
// stamped from the top of the Edge Function invocation, so the measured
// distribution ALREADY INCLUDES that retrieval time. Rung 1 only has to cover
// latency-minus-retrieval, so every coverage figure quoted here is conservative
// — the true fraction of answers a given rung-1 budget covers is higher.
const CHAIN_RESERVE_MS = 5_000;
const PLANNED_FALLBACK_RUNGS = 3;
// Rungs 2+. Ten seconds sits just under the measured p90 (11.06s): generous
// enough that a healthy recovery model usually finishes, short enough that two
// of them plus a p99-sized rung 1 still fit under a ceiling a student will sit
// through. This is intentionally NOT plan-scaled — a recovery attempt's job is
// identical on every tier.
const RECOVERY_RUNG_TIMEOUT_MS = 10_000;
// Floor for rung 1. Unchanged in value and purpose from the previous
// PER_CALL_TIMEOUT_FLOOR_MS: no caller drops below the per-attempt budget
// Foxy's free tier has been running on in production, so small-budget callers
// (ncert-solver at 30s, quiz verifiers at 15-20s) keep ONE usable attempt
// instead of being sliced into three useless ones. Below this the deadline
// clamp — not the ladder — decides how many rungs actually get tried.
const FIRST_RUNG_TIMEOUT_FLOOR_MS = 12_000;
// Cap unchanged: it only binds for callers with budgets north of ~70s, i.e.
// nobody today. Left in place as a backstop against an unbounded rung 1.
const PER_CALL_TIMEOUT_CAP_MS = 45_000;

/**
 * Whole-chain budget + the two-tier per-rung ladder inside it.
 *
 * Returned together because every caller needs all three: `firstCallMs` for the
 * first attempt actually made, `recoveryCallMs` for every attempt after it, and
 * `chainBudgetMs` to stop starting attempts it cannot finish.
 */
function planChainBudget(timeoutMs: number): {
  chainBudgetMs: number;
  firstCallMs: number;
  recoveryCallMs: number;
} {
  const chainBudgetMs = Math.max(timeoutMs - CHAIN_RESERVE_MS, 1_000);
  const recoveryCallMs = Math.min(RECOVERY_RUNG_TIMEOUT_MS, chainBudgetMs);
  const recoveryRungs = PLANNED_FALLBACK_RUNGS - 1;
  const firstCallMs = Math.min(
    PER_CALL_TIMEOUT_CAP_MS,
    Math.max(
      chainBudgetMs - recoveryRungs * recoveryCallMs,
      // Small-budget callers: the ladder subtraction can go negative (a 15s
      // caller has a 10s chain budget and cannot host three rungs at all).
      // Give them the whole remaining budget as ONE attempt rather than a
      // nonsensical slice; `Math.min(chainBudgetMs, ...)` keeps this floor from
      // ever exceeding the budget it is floored against.
      Math.min(chainBudgetMs, FIRST_RUNG_TIMEOUT_FLOOR_MS),
    ),
  );
  return { chainBudgetMs, firstCallMs, recoveryCallMs };
}

/**
 * Phase 2 of Foxy continuity fix (2026-05-18): a single prior turn passed
 * natively to Claude. When the pipeline supplies a non-empty
 * `conversationTurns` array, callOnce/streamOnce prepend it to the
 * `messages[]` body. The current `userMessage` is appended as the last turn.
 */
export interface ClaudeConversationTurn {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Normalized generation stop reason, surfaced on the ok-true ClaudeResponse.
 *
 * Providers differ: Anthropic returns `stop_reason` (`end_turn` | `max_tokens`
 * | `stop_sequence` | `tool_use`), OpenAI returns `finish_reason` (`stop` |
 * `length` | `content_filter` | `tool_calls`). We normalize both into this
 * small union so callers can branch on a single vocabulary. `max_tokens` is
 * the one the Foxy bounded-continuation path (Phase 0.2) keys off — it means
 * the model was cut off by the token budget mid-answer.
 */
export type ClaudeStopReason =
  | 'end_turn'
  | 'max_tokens'
  | 'stop_sequence'
  | 'tool_use'
  | 'other';

/** Map Anthropic `stop_reason` → normalized union. Unknown/absent → 'other'. */
function normalizeAnthropicStopReason(raw: unknown): ClaudeStopReason {
  switch (raw) {
    case 'end_turn':
      return 'end_turn';
    case 'max_tokens':
      return 'max_tokens';
    case 'stop_sequence':
      return 'stop_sequence';
    case 'tool_use':
      return 'tool_use';
    default:
      return 'other';
  }
}

/** Map OpenAI `finish_reason` → normalized union. `length` is OpenAI's max_tokens. */
function normalizeOpenAIFinishReason(raw: unknown): ClaudeStopReason {
  switch (raw) {
    case 'length':
      return 'max_tokens';
    case 'stop':
      return 'end_turn';
    default:
      return 'other';
  }
}

/**
 * Response-cache v2 (design item 9): an ordered slice of the system prompt
 * with its Anthropic prompt-cache breakpoint flag. The concatenation of all
 * segment texts MUST equal `systemPrompt` byte-for-byte — buildSystemBlocks
 * verifies this and falls back to the legacy single block on ANY drift, so
 * segmentation can never change the prompt text the model sees.
 */
export interface SystemSegment {
  text: string;
  cacheControl: boolean;
}

/**
 * Anthropic allows at most 4 cache_control breakpoints per request. The
 * pipeline produces exactly 1 by construction ([static head] only — RAG
 * chunks lost their own breakpoint 2026-09-01, see prompts/index.ts); this
 * cap is a hard guard against future segment plans exceeding it.
 */
const MAX_CACHE_CONTROL_BLOCKS = 4;

export interface ClaudeRequest {
  systemPrompt: string;
  userMessage: string;
  maxTokens: number;
  temperature: number;
  timeoutMs: number;
  apiKey: string;
  openaiApiKey?: string;
  modelPreference: 'haiku' | 'sonnet' | 'auto';
  /**
   * Percentage-rollout mechanism (2026-08-03, on top of the 2026-08-02
   * OpenAI-primary swap): opaque per-caller bucketing key for
   * ff_foxy_openai_primary_rollout_v1, forwarded to resolveModelOrder(). In
   * practice this is GroundedRequest.student_id, passed through unchanged by
   * pipeline.ts/pipeline-stream.ts — claude.ts treats it as an opaque string,
   * never inspects or logs it beyond hashing. Absent/null → the rollout
   * mechanism cannot bucket this call and resolves to MODEL_FALLBACK_ORDER
   * (OpenAI-primary), the documented fail-safe direction. See
   * ./_model-rollout-flag.ts for the full precedence.
   */
  callerId?: string | null;
  /**
   * Phase 2 of Foxy continuity fix: prior conversation turns in native shape.
   * When provided and non-empty, the call body becomes
   * `messages: [...conversationTurns, {role:'user', content: userMessage}]`.
   * Absent or empty array → byte-identical legacy behavior (single user turn).
   */
  conversationTurns?: ClaudeConversationTurn[];
  /**
   * Response-cache v2 (design item 9): ordered system-prompt segments for
   * multi-block Anthropic prompt caching ([static template + safety rails +
   * mode directive] cached → per-student sections + RAG chunks uncached).
   * Optional and additive: absent → the legacy single
   * cache_control block, byte-identical to pre-v2 behavior. OpenAI fallback
   * paths ignore this (they take the joined `systemPrompt` string).
   */
  systemSegments?: SystemSegment[];
}

/**
 * Build the Anthropic `system` content-block array. Legacy behavior (no
 * segments): one text block carrying the whole prompt with a cache_control
 * breakpoint at the end. With segments: one block per segment, breakpoints
 * only where `cacheControl` is true.
 *
 * Safety properties (block boundaries only — never prompt-text changes):
 *   1. Byte-identity guard: if the segments do not concatenate to EXACTLY
 *      `systemPrompt`, fall back to the legacy single block.
 *   2. Whitespace coalescing: a segment that is empty/whitespace-only is
 *      prepended to the next segment (or appended to the previous when
 *      last) so no empty/whitespace-only text block is ever sent.
 *   3. Breakpoint cap: never more than MAX_CACHE_CONTROL_BLOCKS
 *      cache_control markers (Anthropic limit is 4; we emit 1 today).
 */
export function buildSystemBlocks(
  systemPrompt: string,
  segments?: SystemSegment[],
): Array<{ type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }> {
  const legacySingleBlock: Array<{ type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }> = [
    { type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } },
  ];
  if (!segments || segments.length === 0) return legacySingleBlock;
  if (segments.map((s) => s.text).join('') !== systemPrompt) {
    // Drift guard — segmentation must never alter the prompt text.
    console.warn('claude: system segments do not concatenate to systemPrompt — using single block');
    return legacySingleBlock;
  }

  // Coalesce empty/whitespace-only segments forward (byte order preserved).
  const merged: SystemSegment[] = [];
  let carry = '';
  for (const seg of segments) {
    const text = carry + seg.text;
    carry = '';
    if (text.trim() === '') {
      carry = text;
      continue;
    }
    merged.push({ text, cacheControl: seg.cacheControl });
  }
  if (carry !== '') {
    if (merged.length === 0) return legacySingleBlock;
    merged[merged.length - 1] = {
      text: merged[merged.length - 1].text + carry,
      cacheControl: merged[merged.length - 1].cacheControl,
    };
  }
  if (merged.length === 0) return legacySingleBlock;

  let breakpoints = 0;
  return merged.map((seg) => {
    const block: { type: 'text'; text: string; cache_control?: { type: 'ephemeral' } } = {
      type: 'text',
      text: seg.text,
    };
    if (seg.cacheControl && breakpoints < MAX_CACHE_CONTROL_BLOCKS) {
      block.cache_control = { type: 'ephemeral' };
      breakpoints++;
    }
    return block;
  });
}

/**
 * 2026-09-01 (cost-visibility fix): one non-final rung of the modelOrder
 * fallback loop that errored before the caller moved to the next model.
 * Token fields are omitted deliberately, not just defaulted — every current
 * failure classification (auth_error/server_error/timeout/unknown) reaches
 * its return point BEFORE a response body is successfully parsed, so there
 * is never real usage data to attach. If a future failure kind captures
 * partial usage, add fields here explicitly rather than guessing at 0 vs
 * real; the adapter treats an absent field as 0 cost, which is accurate
 * today but should stay a documented fact, not an assumption.
 */
export interface FailedAttempt {
  provider: 'openai' | 'anthropic';
  model: string;
  outcome: 'auth_error' | 'server_error' | 'timeout' | 'unknown';
}

export type ClaudeResponse =
  | {
      ok: true;
      content: string;
      model: string;
      provider?: 'openai' | 'anthropic';
      inputTokens: number;
      outputTokens: number;
      /**
       * Anthropic prompt-cache counters (2026-09-01). Optional and additive —
       * OpenAI never reports them and pre-existing consumers ignore them.
       * REQUIRED for correct cost: on a cached turn most of the prompt lives
       * here, not in inputTokens, and pricing only inputTokens under-counted
       * Foxy by ~479x (12-78 logged vs 8,327-12,518 actually sent).
       */
      cacheReadTokens?: number;
      cacheWriteTokens?: number;
      insufficientContext: boolean;
      /**
       * Normalized generation stop reason (Phase 0.2). `max_tokens` signals the
       * model hit the token budget mid-answer — the Foxy structured pipeline
       * uses this to trigger a bounded continuation. Optional/additive: older
       * consumers of the ok-true variant ignore it. Always set by callClaude.
       */
      stopReason?: ClaudeStopReason;
      /**
       * C3 (MOL grounded-answer integration, 2026-05-18): how many non-final
       * models failed before this one succeeded. 0 = the first model in the
       * preference order returned content. 1+ = at least one fallback fired.
       *
       * Optional and additive — older code that destructures the ok-true
       * variant ignores it. Surfaced into mol_request_logs.fallback_count via
       * the mol-telemetry-adapter so cost dashboards can attribute spend
       * accurately when Sonnet handled what Haiku couldn't.
       */
      fallback_count?: number;
      /**
       * C3: human-readable trace of every non-final model failure, in order.
       * Each entry is `'<provider>:<reason>'` (e.g. `'anthropic:timeout'`,
       * `'anthropic:5xx'`, `'anthropic:unknown'`). Empty/undefined when no
       * fallback fired. Mirrors mol_request_logs.failure_chain (joined with
       * '|' at the LogPayload boundary).
       */
      failure_chain?: string[];
      /**
       * 2026-09-01 (cost-visibility fix): structured form of failure_chain
       * above — one entry per non-final rung, for the caller to log as its
       * OWN mol_request_logs row (shadow_role='failed_attempt'). Kept
       * alongside failure_chain rather than replacing it: existing telemetry
       * code already joins failure_chain into a single text column, and
       * duplicating that logic from a richer struct is more surface than
       * this fix needs.
       */
      failedAttempts?: FailedAttempt[];
    }
  | {
      ok: false;
      reason: 'timeout' | 'auth_error' | 'server_error' | 'unknown';
      /** See the ok:true variant's doc comment. Populated even on total failure. */
      failedAttempts?: FailedAttempt[];
    };

/**
 * Streaming variant of ClaudeResponse — yields chunks of decoded text and a
 * final aggregated payload. Used by callClaudeStream() for the Phase 1.1
 * streaming pipeline. Caller iterates the AsyncIterable and accumulates the
 * full text; the closing `final` event includes token usage + model.
 *
 * Errors are surfaced as a `final` event with ok:false (NEVER thrown). This
 * matches callClaude()'s never-throws contract so callers can use one error
 * handler.
 */
export type ClaudeStreamEvent =
  | { type: 'text_delta'; delta: string }
  | {
      type: 'final';
      ok: true;
      fullText: string;
      model: string;
      provider?: 'openai' | 'anthropic';
      inputTokens: number;
      outputTokens: number;
      /** Anthropic prompt-cache counters — see the blocking variant above. */
      cacheReadTokens?: number;
      cacheWriteTokens?: number;
      insufficientContext: boolean;
      /**
       * C3 (MOL grounded-answer integration, 2026-05-18): fallback bookkeeping.
       * Same semantics as ClaudeResponse.fallback_count above; for streaming
       * a fallback can only occur BEFORE any text_delta has shipped (the
       * generator commits to one model once tokens start). Optional and
       * additive — older consumers of the ok-true variant ignore it.
       */
      fallback_count?: number;
      failure_chain?: string[];
      /** See ClaudeResponse's failedAttempts doc comment above. */
      failedAttempts?: FailedAttempt[];
    }
  | {
      type: 'final';
      ok: false;
      reason: 'timeout' | 'auth_error' | 'server_error' | 'unknown';
      // partial text accumulated up to the failure point — may be empty
      partialText: string;
      model: string | null;
      /** See ClaudeResponse's failedAttempts doc comment above. */
      failedAttempts?: FailedAttempt[];
    };

export interface ModelTarget {
  provider: 'openai' | 'anthropic';
  model: string;
}

export async function callClaude(req: ClaudeRequest): Promise<ClaudeResponse> {
  if (!req.apiKey && !req.openaiApiKey) {
    return { ok: false, reason: 'auth_error' };
  }
  const modelOrder = await resolveModelOrder(req.modelPreference, req.callerId);
  const { chainBudgetMs, firstCallMs, recoveryCallMs } = planChainBudget(req.timeoutMs);
  const chainDeadlineAt = Date.now() + chainBudgetMs;
  // Non-uniform ladder bookkeeping. Counts rungs ACTUALLY ATTEMPTED, not array
  // index: skipped rungs (no provider key, provider already 401'd) must not
  // consume the generous first-attempt slice. See planChainBudget's header.
  let attemptsMade = 0;

  let lastReason: 'timeout' | 'server_error' | 'unknown' = 'unknown';
  // C3 fallback bookkeeping: every non-final-model failure pushes an entry
  // onto failureChain and bumps fallbackCount. The successful model returns
  // these counts so downstream telemetry can attribute cost/latency to the
  // model that actually answered, not just the first model tried.
  const failureChain: string[] = [];
  // 2026-09-01 (cost-visibility fix): structured twin of failureChain, pushed
  // at the exact same two sites below. See FailedAttempt's doc comment.
  const failedAttempts: FailedAttempt[] = [];
  // Providers whose credentials have already been rejected this call. An auth
  // failure is only conclusive WITHIN a provider (same key, same result) — it
  // says nothing about the other provider's key, and MODEL_FALLBACK_ORDER is
  // cross-provider. See the auth_error branch below.
  const authFailedProviders = new Set<'openai' | 'anthropic'>();

  for (const [i, target] of modelOrder.entries()) {
    if (target.provider === 'openai' && !req.openaiApiKey) {
      continue;
    }
    if (target.provider === 'anthropic' && !req.apiKey) {
      continue;
    }
    if (authFailedProviders.has(target.provider)) {
      continue;
    }

    // Chain deadline. Starting a rung we cannot finish is worse than not
    // starting it: the caller's hop (and, for Foxy, the Vercel function)
    // aborts mid-attempt, so the student gets a transport error instead of
    // this function's own abstain payload — and, upstream, no quota refund.
    const remainingMs = chainDeadlineAt - Date.now();
    if (remainingMs <= 0) {
      lastReason = 'timeout';
      break;
    }
    // Rung 1 (the first attempt actually made) gets the p99-sized slice; every
    // recovery attempt after it gets the short flat one.
    const perCallMs = attemptsMade === 0 ? firstCallMs : recoveryCallMs;
    const perCallTimeout = Math.min(perCallMs, remainingMs);
    attemptsMade += 1;

    const attempt = target.provider === 'openai'
      ? await callOpenAIOnce({
          model: target.model,
          systemPrompt: req.systemPrompt,
          userMessage: req.userMessage,
          maxTokens: req.maxTokens,
          temperature: req.temperature,
          timeoutMs: perCallTimeout,
          apiKey: req.openaiApiKey!,
          conversationTurns: req.conversationTurns,
        })
      : await callOnce({
          model: target.model,
          systemPrompt: req.systemPrompt,
          userMessage: req.userMessage,
          maxTokens: req.maxTokens,
          temperature: req.temperature,
          timeoutMs: perCallTimeout,
          apiKey: req.apiKey,
          conversationTurns: req.conversationTurns,
          systemSegments: req.systemSegments,
        });

    if (attempt.kind === 'ok') {
      const trimmed = attempt.content.trim();
      return {
        ok: true,
        content: attempt.content,
        model: target.model,
        provider: target.provider,
        inputTokens: attempt.inputTokens,
        outputTokens: attempt.outputTokens,
        cacheReadTokens: attempt.cacheReadTokens ?? 0,
        cacheWriteTokens: attempt.cacheWriteTokens ?? 0,
        insufficientContext: trimmed === INSUFFICIENT_CONTEXT_SENTINEL,
        stopReason: attempt.stopReason,
        fallback_count: failureChain.length,
        failure_chain: failureChain.length > 0 ? failureChain.slice() : undefined,
        failedAttempts: failedAttempts.length > 0 ? failedAttempts.slice() : undefined,
      };
    }

    if (attempt.kind === 'auth_error') {
      // Auth errors don't recover on the next model OF THE SAME PROVIDER —
      // same key, same result. They say nothing about the OTHER provider,
      // whose key is separate: aborting here would strand healthy OpenAI
      // rungs whenever ANTHROPIC_API_KEY is rotated/revoked (and vice versa),
      // taking Foxy fully down while a working key sits unused.
      authFailedProviders.add(target.provider);
      failureChain.push(failureLabel(target.provider, attempt.kind));
      failedAttempts.push({ provider: target.provider, model: target.model, outcome: attempt.kind });
      const hasAlternateProvider = modelOrder.slice(i + 1).some((t) =>
        !authFailedProviders.has(t.provider) &&
        (t.provider === 'openai' ? !!req.openaiApiKey : !!req.apiKey)
      );
      if (!hasAlternateProvider) {
        // P1-4 fix (2026-09-02 launch audit): this was the ONE terminal path
        // with zero ops_events logging in the whole file — every other
        // failure kind ('unknown', unparseable body, network exception) logs
        // via logOpsEvent above; this is the ONLY branch where ALL providers
        // in the fallback chain are simultaneously auth-dead, i.e. Foxy is
        // fully down for every student. That silence is why the 2026-08-26
        // ANTHROPIC_API_KEY outage ran 5 days / 442 errors / 262 users before
        // anyone noticed — nothing existed to alert on. severity:'critical'
        // so alert-deliverer's default rule set fires on it.
        await logOpsEvent({
          category: 'ai',
          source: 'grounded-answer',
          severity: 'critical',
          message: 'All AI providers in the fallback chain returned 401/403 — Foxy is down for every student',
          context: { failedAttempts: failedAttempts.slice() },
        });
        return { ok: false, reason: 'auth_error', failedAttempts: failedAttempts.slice() };
      }
      continue;
    }

    // timeout | server_error | unknown → record + try next model.
    failureChain.push(failureLabel(target.provider, attempt.kind));
    failedAttempts.push({ provider: target.provider, model: target.model, outcome: attempt.kind });
    lastReason = attempt.kind;
  }

  return { ok: false, reason: lastReason, failedAttempts: failedAttempts.length > 0 ? failedAttempts.slice() : undefined };
}

/**
 * C3 (MOL grounded-answer integration, 2026-05-18): map an internal
 * SingleCallResult.kind to a stable 'provider:reason' string for telemetry.
 *
 * Kept narrow on purpose — adding new internal kinds requires explicit
 * mapping here so the telemetry contract never drifts silently.
 */
export function failureLabel(
  provider: 'openai' | 'anthropic',
  kind: 'timeout' | 'server_error' | 'unknown' | 'auth_error',
): string {
  const reason = kind === 'server_error' ? '5xx' : kind;
  return `${provider}:${reason}`;
}

// Deprecated fallback mapping for backwards compatibility
function claudeFailureLabel(kind: 'timeout' | 'server_error' | 'unknown'): string {
  return failureLabel('anthropic', kind);
}

async function resolveModelOrder(
  pref: 'haiku' | 'sonnet' | 'auto',
  callerId?: string | null,
): Promise<ModelTarget[]> {
  // RCA-FIX CRITICAL-1 (2026-06-26): Foxy system prompt, JSON output contract,
  // and CBSE pedagogy decision tree were originally calibrated for Claude
  // behavior — GPT-4o-mini/GPT-4o receive the same prompt verbatim, which can
  // cause format/persona deviations relative to Claude.
  //
  // OpenAI-primary provider swap (CEO-approved, 2026-08-02): Anthropic's
  // per-token cost does not scale with per-student revenue at current volume,
  // so OpenAI models now run FIRST for every preference. Claude is RETAINED as
  // the fallback tier (activates on OpenAI timeout / 5xx / auth failure), not
  // deleted — precisely because of the calibration history above, which is why
  // an output-quality validation pass (eval/openai-migration harness) gates
  // how far the canary ramps before OpenAI output reaches students at volume.
  //
  // Model Gateway parity (2026-07-24): the ORDERING now comes from the shared
  // MODEL_FALLBACK_ORDER constant in ./config.ts (the Deno mirror of the TS
  // gateway registry's LEGACY_FALLBACK_ORDER). The mapping below is unchanged —
  // it just reads the source of truth instead of inlining the targets, so the
  // Deno path and the Node gateway can never drift. Behavior is byte-identical.
  //
  // Percentage-rollout mechanism (2026-08-03): ff_foxy_openai_primary_rollout_v1
  // (see ./_model-rollout-flag.ts) can bucket `callerId` onto the reconstructed
  // CLAUDE_PRIMARY_FALLBACK_ORDER rollback table instead. Seeded disabled
  // (rollout_percentage=0), so shouldUseClaudePrimary resolves false for every
  // caller until an operator deliberately ramps it — this call is then a
  // guaranteed-false no-op read, keeping today's OpenAI-primary resolution
  // byte-identical.
  const table = (await shouldUseClaudePrimary(callerId)) ? CLAUDE_PRIMARY_FALLBACK_ORDER : MODEL_FALLBACK_ORDER;
  return table[pref].map((t) => ({ provider: t.provider, model: t.model }));
}

type SingleCallResult =
  | {
      kind: 'ok';
      content: string;
      inputTokens: number;
      outputTokens: number;
      /** Anthropic cache_read_input_tokens — billed at 0.1x input. 0 on OpenAI. */
      cacheReadTokens?: number;
      /** Anthropic cache_creation_input_tokens — billed at 1.25x input. 0 on OpenAI. */
      cacheWriteTokens?: number;
      stopReason: ClaudeStopReason;
    }
  | { kind: 'timeout' }
  | { kind: 'auth_error' }
  | { kind: 'server_error' }
  | { kind: 'unknown' };

async function callOnce(params: {
  model: string;
  systemPrompt: string;
  userMessage: string;
  maxTokens: number;
  temperature: number;
  timeoutMs: number;
  apiKey: string;
  conversationTurns?: ClaudeConversationTurn[];
  systemSegments?: SystemSegment[];
}): Promise<SingleCallResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), params.timeoutMs);

  try {
    // Phase 2.4: Anthropic prompt caching.
    //
    // The system prompt for Foxy/grounded-answer is large (safety rails +
    // cognitive context + reference material can run 3-6k tokens). Response-
    // cache v2 (design item 9) restructures the previous single monolithic
    // cache_control block into ordered blocks via buildSystemBlocks:
    //   [static template + safety rails + mode directive] (cache_control)
    //   → [per-student sections] (uncached) → [RAG chunks] (uncached —
    //   lost its own breakpoint 2026-09-01; retrieval is per-query and
    //   measured well below the 21.7% cache-hit break-even, see
    //   prompts/index.ts)
    // Block boundaries only — the concatenated text is verified
    // byte-identical to params.systemPrompt (fallback: legacy single
    // block). Callers that don't pass systemSegments keep the legacy single
    // block. See https://docs.anthropic.com/claude/docs/prompt-caching
    //
    // Phase 2 of Foxy continuity fix (2026-05-18): prior turns are now passed
    // natively via `params.conversationTurns` when provided. Anthropic's
    // multi-turn coherence is markedly stronger for native messages[] than for
    // string-interpolated history inside a single user-message blob.
    const systemBlocks = buildSystemBlocks(params.systemPrompt, params.systemSegments);

    // Phase 2: prepend prior turns when supplied. Empty/undefined → byte-
    // identical legacy single-user-message body.
    const messages: ClaudeConversationTurn[] = [];
    if (params.conversationTurns && params.conversationTurns.length > 0) {
      for (const t of params.conversationTurns) {
        messages.push({ role: t.role, content: t.content });
      }
    }
    messages.push({ role: 'user', content: params.userMessage });

    const response = await fetch(ANTHROPIC_ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': params.apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: params.model,
        max_tokens: params.maxTokens,
        temperature: params.temperature,
        system: systemBlocks,
        messages,
      }),
      signal: controller.signal,
    });

    if (response.status === 401 || response.status === 403) {
      await response.text().catch(() => '');
      return { kind: 'auth_error' };
    }

    if (response.status === 404 || response.status === 429 || response.status >= 500) {
      // 404: model decommissioned / typo. 429: rate limited. 5xx (incl. 529
      // anthropic-overloaded): upstream failure. All retriable on the next
      // model in the fallback order. Classification kept identical to the
      // OpenAI branch below so failureLabel() emits 'anthropic:5xx' rather
      // than 'anthropic:unknown' for rate limits and 5xx — dashboards were
      // under-reporting both entirely.
      await response.text().catch(() => '');
      return { kind: 'server_error' };
    }

    if (!response.ok) {
      const rawText = await response.text().catch(() => '');
      console.warn(`claude: unexpected HTTP ${response.status} for model ${params.model}`);
      await logOpsEvent({
        category: 'ai',
        source: 'claude-unknown-diag',
        severity: 'error',
        message: `callOnce unknown: unexpected HTTP status`,
        context: {
          model: params.model,
          status: response.status,
          rawBodyPreview: rawText.slice(0, 500),
        },
      });
      return { kind: 'unknown' };
    }

    const rawText = await response.text().catch(() => '');
    let body: any = null;
    try {
      body = JSON.parse(rawText);
    } catch {
      body = null;
    }
    if (!body) {
      await logOpsEvent({
        category: 'ai',
        source: 'claude-unknown-diag',
        severity: 'error',
        message: `callOnce unknown: 2xx response with unparseable/empty body`,
        context: {
          model: params.model,
          status: response.status,
          rawBodyPreview: rawText.slice(0, 500),
        },
      });
      return { kind: 'unknown' };
    }

    // Anthropic content is an array of blocks; concatenate all text blocks.
    // deno-lint-ignore no-explicit-any
    const blocks: any[] = Array.isArray(body.content) ? body.content : [];
    const text = blocks
      // deno-lint-ignore no-explicit-any
      .filter((b: any) => b?.type === 'text' && typeof b.text === 'string')
      // deno-lint-ignore no-explicit-any
      .map((b: any) => b.text as string)
      .join('');

    const inputTokens = typeof body.usage?.input_tokens === 'number' ? body.usage.input_tokens : 0;
    const outputTokens = typeof body.usage?.output_tokens === 'number' ? body.usage.output_tokens : 0;
    // Prompt-cache counters (2026-09-01). This file sets cache_control in 12
    // places, so on a cached turn Anthropic moves the bulk of the prompt OUT of
    // input_tokens and into these two. Reading only input_tokens is why Foxy
    // logged 12-78 prompt tokens while the SAME task on OpenAI logged
    // 8,327-12,518 (measured over 7 days) — a ~479x under-count, priced at zero.
    const cacheReadTokens = typeof body.usage?.cache_read_input_tokens === 'number'
      ? body.usage.cache_read_input_tokens
      : 0;
    const cacheWriteTokens = typeof body.usage?.cache_creation_input_tokens === 'number'
      ? body.usage.cache_creation_input_tokens
      : 0;
    const stopReason = normalizeAnthropicStopReason(body.stop_reason);

    return { kind: 'ok', content: text, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, stopReason };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return { kind: 'timeout' };
    }
    console.warn(`claude: network error on ${params.model} — ${String(err)}`);
    await logOpsEvent({
      category: 'ai',
      source: 'claude-unknown-diag',
      severity: 'error',
      message: `callOnce unknown: network/fetch exception`,
      context: { model: params.model, error: String(err) },
    });
    return { kind: 'unknown' };
  } finally {
    clearTimeout(timeoutId);
  }
}

// ─── Streaming variant ───────────────────────────────────────────────────────
//
// callClaudeStream(): yields ClaudeStreamEvent values. Mirrors callClaude's
// model-fallback + provider-scoped auth-error policy, but only the FIRST
// model in the order is used for the stream (we cannot retry mid-stream once
// tokens have shipped to the browser). If the chosen model fails BEFORE any
// tokens arrive, we transparently retry with the next model in the order.
//
// Why not full fallback once tokens flow: re-trying a different model
// after partial text would force the browser to either splice two responses
// (confusing) or discard work (wasteful). The first-token wait is short
// (~300-700ms with Haiku); any later failure is surfaced as a final
// `ok:false` event so the caller can show an error toast.

export async function* callClaudeStream(
  req: ClaudeRequest,
): AsyncGenerator<ClaudeStreamEvent, void, unknown> {
  if (!req.apiKey && !req.openaiApiKey) {
    yield { type: 'final', ok: false, reason: 'auth_error', partialText: '', model: null };
    return;
  }
  const modelOrder = await resolveModelOrder(req.modelPreference, req.callerId);
  const { chainBudgetMs, firstCallMs, recoveryCallMs } = planChainBudget(req.timeoutMs);
  const chainDeadlineAt = Date.now() + chainBudgetMs;
  // Ladder bookkeeping — same semantics as callClaude: attempts made, not index.
  let attemptsMade = 0;

  let lastReason: 'timeout' | 'server_error' | 'unknown' = 'unknown';
  // C3 fallback bookkeeping (streaming variant). A fallback can only occur
  // BEFORE any text_delta has shipped — once tokens flow we commit to the
  // current model (see firstTokenSent below). Mirrors callClaude semantics
  // so a single MOL telemetry adapter handles both paths.
  const failureChain: string[] = [];
  // 2026-09-01 (cost-visibility fix): structured twin of failureChain, pushed
  // at the same two sites below. Scoped to rungs that actually get RETRIED
  // (auth_error, and the "no tokens shipped yet" fallback branch) — a
  // post-first-token failure below is terminal, not a retried rung, and is
  // out of scope for this fix. See FailedAttempt's doc comment in
  // ClaudeResponse's definition.
  const failedAttempts: FailedAttempt[] = [];
  // Providers whose credentials have already been rejected this turn. Same
  // reasoning as callClaude: an auth failure is only conclusive WITHIN a
  // provider (same key, same result) and says nothing about the other
  // provider's key. This path carries essentially all web traffic
  // (ff_foxy_streaming is at 100%), so it needs the containment more, not
  // less, than the blocking path.
  const authFailedProviders = new Set<'openai' | 'anthropic'>();

  for (let i = 0; i < modelOrder.length; i++) {
    const target = modelOrder[i];
    if (target.provider === 'openai' && !req.openaiApiKey) {
      continue;
    }
    if (target.provider === 'anthropic' && !req.apiKey) {
      continue;
    }
    if (authFailedProviders.has(target.provider)) {
      continue;
    }

    // Chain deadline — same reasoning as the blocking path above.
    const remainingMs = chainDeadlineAt - Date.now();
    if (remainingMs <= 0) {
      lastReason = 'timeout';
      break;
    }
    // `timeoutMs` bounds the FALLBACK-relevant window only (time to first
    // token) — see streamOnce. `streamBudgetMs` is what the stream may use
    // once it has committed, which is everything left in the chain budget:
    // after the first delta no fallback is possible, so squeezing the stream
    // to the per-rung slice would truncate healthy long answers to buy
    // reachability for a rung that can no longer be taken.
    // Ladder, streaming flavour. Because `timeoutMs` here bounds only the
    // PRE-FIRST-TOKEN window, the practical effect of the recovery slice is
    // "how long we wait for a recovery model to start talking" — once it does,
    // streamBudgetMs (= remainingMs) takes over and the answer is never cut
    // mid-sentence. The generous first-rung slice still matters on this path:
    // it is the window in which a slow-but-alive primary is allowed to begin.
    const perCallMs = attemptsMade === 0 ? firstCallMs : recoveryCallMs;
    const perCallTimeout = Math.min(perCallMs, remainingMs);
    attemptsMade += 1;

    const result = target.provider === 'openai'
      ? yield* streamOpenAIOnce({
          model: target.model,
          systemPrompt: req.systemPrompt,
          userMessage: req.userMessage,
          maxTokens: req.maxTokens,
          temperature: req.temperature,
          timeoutMs: perCallTimeout,
          streamBudgetMs: remainingMs,
          apiKey: req.openaiApiKey!,
          conversationTurns: req.conversationTurns,
        })
      : yield* streamOnce({
          model: target.model,
          systemPrompt: req.systemPrompt,
          userMessage: req.userMessage,
          maxTokens: req.maxTokens,
          temperature: req.temperature,
          timeoutMs: perCallTimeout,
          streamBudgetMs: remainingMs,
          apiKey: req.apiKey,
          conversationTurns: req.conversationTurns,
          systemSegments: req.systemSegments,
        });

    if (result.ok) {
      yield {
        type: 'final',
        ok: true,
        fullText: result.fullText,
        model: target.model,
        provider: target.provider,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        cacheReadTokens: result.cacheReadTokens ?? 0,
        cacheWriteTokens: result.cacheWriteTokens ?? 0,
        insufficientContext: result.fullText.trim() === INSUFFICIENT_CONTEXT_SENTINEL,
        fallback_count: failureChain.length,
        failure_chain: failureChain.length > 0 ? failureChain.slice() : undefined,
        failedAttempts: failedAttempts.length > 0 ? failedAttempts.slice() : undefined,
      };
      return;
    }

    if (result.reason === 'auth_error') {
      // Auth errors don't recover on the next model OF THE SAME PROVIDER —
      // same key, same result. They say nothing about the OTHER provider,
      // whose key is separate: aborting the whole chain here strands healthy
      // OpenAI rungs whenever ANTHROPIC_API_KEY is rotated/revoked (and vice
      // versa), taking Foxy down for every streaming turn — i.e. for
      // essentially every web student — while a working key sits unused.
      //
      // The `result.firstTokenSent` guard keeps the mid-stream boundary a
      // hard wall. streamOnce/streamOpenAIOnce only return auth_error from
      // the pre-stream status check, so it is false here by construction;
      // the guard makes that structural rather than incidental, so a
      // post-first-token failure can never switch providers.
      authFailedProviders.add(target.provider);
      failureChain.push(failureLabel(target.provider, 'auth_error'));
      failedAttempts.push({ provider: target.provider, model: target.model, outcome: 'auth_error' });
      const hasAlternateProvider = modelOrder.slice(i + 1).some((t) =>
        !authFailedProviders.has(t.provider) &&
        (t.provider === 'openai' ? !!req.openaiApiKey : !!req.apiKey)
      );
      if (result.firstTokenSent || !hasAlternateProvider) {
        // P1-4 fix (2026-09-02 launch audit): mirrors the non-streaming
        // callClaude fix above — this file's streaming path had the same
        // zero-logging gap on the terminal auth_error branch. Only the
        // !hasAlternateProvider case is a real all-providers outage
        // (severity:'critical'); the firstTokenSent case is a normal
        // mid-stream provider hiccup where a healthy alternate exists but
        // cannot be used once tokens shipped to the browser — logged at
        // 'warning' so it doesn't spam the same critical alert rule.
        await logOpsEvent({
          category: 'ai',
          source: 'grounded-answer-stream',
          severity: hasAlternateProvider ? 'warning' : 'critical',
          message: hasAlternateProvider
            ? 'Provider auth-failed mid-stream after first token; could not fall back to the alternate provider for this turn'
            : 'All AI providers in the fallback chain returned 401/403 — Foxy streaming is down for every student',
          context: { failedAttempts: failedAttempts.slice() },
        });
        yield {
          type: 'final',
          ok: false,
          reason: 'auth_error',
          partialText: '',
          model: target.model,
          failedAttempts: failedAttempts.slice(),
        };
        return;
      }
      continue;
    }

    if (result.firstTokenSent) {
      // Tokens already streamed — cannot fallback. Surface the failure with
      // whatever partial text the client already has.
      yield {
        type: 'final',
        ok: false,
        reason: result.reason || 'unknown',
        partialText: result.fullText,
        model: target.model,
      };
      return;
    }

    // No tokens shipped yet — record the failure and try the next model.
    failureChain.push(
      failureLabel(target.provider, result.reason as 'timeout' | 'server_error' | 'unknown'),
    );
    failedAttempts.push({
      provider: target.provider,
      model: target.model,
      outcome: result.reason as 'timeout' | 'server_error' | 'unknown',
    });
    lastReason = result.reason as 'timeout' | 'server_error' | 'unknown';
    // Try next model in the order.
  }

  yield {
    type: 'final',
    ok: false,
    reason: lastReason,
    partialText: '',
    model: null,
    failedAttempts: failedAttempts.length > 0 ? failedAttempts.slice() : undefined,
  };
}

interface StreamOnceResult {
  ok: boolean;
  reason?: 'timeout' | 'auth_error' | 'server_error' | 'unknown';
  fullText: string;
  inputTokens: number;
  outputTokens: number;
  /** Anthropic cache_read_input_tokens (0.1x input). Absent on the OpenAI path. */
  cacheReadTokens?: number;
  /** Anthropic cache_creation_input_tokens (1.25x input). Absent on the OpenAI path. */
  cacheWriteTokens?: number;
  firstTokenSent: boolean;
}

/**
 * Stream a single Claude call. Yields text_delta events as they arrive and
 * returns a StreamOnceResult describing the outcome. The caller (above) decides
 * whether to retry or surface the final event based on `firstTokenSent`.
 */
async function* streamOnce(params: {
  model: string;
  systemPrompt: string;
  userMessage: string;
  maxTokens: number;
  temperature: number;
  timeoutMs: number;
  streamBudgetMs?: number;
  apiKey: string;
  conversationTurns?: ClaudeConversationTurn[];
  systemSegments?: SystemSegment[];
}): AsyncGenerator<ClaudeStreamEvent, StreamOnceResult, unknown> {
  const controller = new AbortController();
  const callStartedAt = Date.now();
  let timeoutId = setTimeout(() => controller.abort(), params.timeoutMs);
  // Two-phase timer. `timeoutMs` is the pre-first-token window — the only
  // window in which callClaudeStream can still switch models — and it is
  // deliberately small so three rungs fit the chain budget. Once a delta has
  // shipped the model is committed, so the abort is re-armed to the caller's
  // full remaining budget rather than cutting a healthy answer mid-sentence.
  // Omitting streamBudgetMs reproduces the previous single-timer behaviour.
  const extendOnFirstToken = () => {
    const extra = (params.streamBudgetMs ?? params.timeoutMs) - (Date.now() - callStartedAt);
    if (extra <= 0) return;
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => controller.abort(), extra);
  };

  let fullText = '';
  let inputTokens = 0;
  let outputTokens = 0;
  // Anthropic prompt-cache counters, populated from message_start below.
  let cacheReadTokens = 0;
  let cacheWriteTokens = 0;
  let firstTokenSent = false;

  try {
    // Response-cache v2 (design item 9): same multi-block prompt-cache
    // structure as the blocking path — see buildSystemBlocks (byte-identity
    // guard + whitespace coalescing + ≤4 breakpoints).
    const systemBlocks = buildSystemBlocks(params.systemPrompt, params.systemSegments);

    // Phase 2 of Foxy continuity fix (2026-05-18): prepend native prior
    // turns when provided. Empty/undefined preserves legacy behavior.
    const messages: ClaudeConversationTurn[] = [];
    if (params.conversationTurns && params.conversationTurns.length > 0) {
      for (const t of params.conversationTurns) {
        messages.push({ role: t.role, content: t.content });
      }
    }
    messages.push({ role: 'user', content: params.userMessage });

    const response = await fetch(ANTHROPIC_ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': params.apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: params.model,
        max_tokens: params.maxTokens,
        temperature: params.temperature,
        system: systemBlocks,
        messages,
        stream: true,
      }),
      signal: controller.signal,
    });

    if (response.status === 401 || response.status === 403) {
      await response.body?.cancel().catch(() => {});
      return { ok: false, reason: 'auth_error', fullText, inputTokens, outputTokens, firstTokenSent };
    }
    if (response.status === 404 || response.status === 429 || response.status >= 500) {
      // 404: model decommissioned / typo. 429: rate limited. 5xx (incl. 529
      // anthropic-overloaded): upstream failure. All retriable on the next
      // model in the fallback order. Classification kept identical to the
      // blocking callOnce and to streamOpenAIOnce so failureLabel() emits
      // 'anthropic:5xx' rather than 'anthropic:unknown' for rate limits and
      // 5xx — dashboards were under-reporting both on the streaming path too.
      await response.body?.cancel().catch(() => {});
      return { ok: false, reason: 'server_error', fullText, inputTokens, outputTokens, firstTokenSent };
    }
    if (!response.ok) {
      const rawText = await response.text().catch(() => '');
      console.warn(`claude(stream): unexpected HTTP ${response.status} for ${params.model}`);
      await logOpsEvent({
        category: 'ai',
        source: 'claude-unknown-diag',
        severity: 'error',
        message: `streamOnce unknown: unexpected HTTP status`,
        context: {
          model: params.model,
          status: response.status,
          rawBodyPreview: rawText.slice(0, 500),
        },
      });
      return { ok: false, reason: 'unknown', fullText, inputTokens, outputTokens, firstTokenSent };
    }

    if (!response.body) {
      await logOpsEvent({
        category: 'ai',
        source: 'claude-unknown-diag',
        severity: 'error',
        message: `streamOnce unknown: 2xx response with no readable body`,
        context: { model: params.model, status: response.status },
      });
      return { ok: false, reason: 'unknown', fullText, inputTokens, outputTokens, firstTokenSent };
    }

    // Parse Anthropic SSE stream. Each event is `event: <name>\ndata: <json>\n\n`.
    // We only act on `content_block_delta` (text deltas) and `message_delta`
    // / `message_stop` (final usage). Other event types (ping, content_block_start,
    // message_start) are ignored.
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE events are separated by blank lines (\n\n). Process each complete
      // event in the buffer and keep the trailing partial chunk for next read.
      let sepIdx: number;
      while ((sepIdx = buffer.indexOf('\n\n')) !== -1) {
        const rawEvent = buffer.slice(0, sepIdx);
        buffer = buffer.slice(sepIdx + 2);
        const dataLines = rawEvent
          .split('\n')
          .filter((line) => line.startsWith('data: '))
          .map((line) => line.slice(6));
        if (dataLines.length === 0) continue;
        const dataPayload = dataLines.join('\n');
        if (dataPayload === '[DONE]') continue;
        let parsed: any = null;
        try {
          parsed = JSON.parse(dataPayload);
        } catch {
          continue;
        }
        if (!parsed || typeof parsed !== 'object') continue;

        if (parsed.type === 'content_block_delta') {
          const delta = parsed.delta;
          if (delta && delta.type === 'text_delta' && typeof delta.text === 'string') {
            fullText += delta.text;
            if (!firstTokenSent) extendOnFirstToken();
            firstTokenSent = true;
            yield { type: 'text_delta', delta: delta.text };
          }
        } else if (parsed.type === 'message_start') {
          if (parsed.message?.usage?.input_tokens) {
            inputTokens = parsed.message.usage.input_tokens;
          }
          // Cache counters arrive on message_start alongside input_tokens.
          // Without these the streaming path under-counts a cached prompt
          // exactly as the non-streaming path did — see the note there.
          if (typeof parsed.message?.usage?.cache_read_input_tokens === 'number') {
            cacheReadTokens = parsed.message.usage.cache_read_input_tokens;
          }
          if (typeof parsed.message?.usage?.cache_creation_input_tokens === 'number') {
            cacheWriteTokens = parsed.message.usage.cache_creation_input_tokens;
          }
        } else if (parsed.type === 'message_delta') {
          if (parsed.usage?.output_tokens) {
            outputTokens = parsed.usage.output_tokens;
          }
        }
        // Ignore: ping, content_block_start, content_block_stop, message_stop
      }
    }

    return { ok: true, fullText, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, firstTokenSent };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return { ok: false, reason: 'timeout', fullText, inputTokens, outputTokens, firstTokenSent };
    }
    console.warn(`claude(stream): network error on ${params.model} — ${String(err)}`);
    await logOpsEvent({
      category: 'ai',
      source: 'claude-unknown-diag',
      severity: 'error',
      message: `streamOnce unknown: network/read exception`,
      context: { model: params.model, error: String(err), fullTextSoFarLength: fullText.length },
    });
    return { ok: false, reason: 'unknown', fullText, inputTokens, outputTokens, firstTokenSent };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function callOpenAIOnce(params: {
  model: string;
  systemPrompt: string;
  userMessage: string;
  maxTokens: number;
  temperature: number;
  timeoutMs: number;
  apiKey: string;
  conversationTurns?: ClaudeConversationTurn[];
}): Promise<SingleCallResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), params.timeoutMs);

  try {
    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: params.systemPrompt }
    ];
    if (params.conversationTurns && params.conversationTurns.length > 0) {
      for (const t of params.conversationTurns) {
        messages.push({ role: t.role, content: t.content });
      }
    }
    messages.push({ role: 'user', content: params.userMessage });

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${params.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: params.model,
        messages,
        max_tokens: params.maxTokens,
        temperature: params.temperature,
      }),
      signal: controller.signal,
    });

    if (response.status === 401 || response.status === 403) {
      await response.text().catch(() => '');
      return { kind: 'auth_error' };
    }

    if (response.status === 404 || response.status === 429 || response.status >= 500) {
      await response.text().catch(() => '');
      return { kind: 'server_error' };
    }

    if (!response.ok) {
      await response.text().catch(() => '');
      console.warn(`openai: unexpected HTTP ${response.status} for model ${params.model}`);
      return { kind: 'unknown' };
    }

    const body = await response.json().catch(() => null);
    if (!body) return { kind: 'unknown' };

    const text = (body.choices?.[0]?.message?.content ?? '').trim();
    const inputTokens = body.usage?.prompt_tokens ?? 0;
    const outputTokens = body.usage?.completion_tokens ?? 0;
    const stopReason = normalizeOpenAIFinishReason(body.choices?.[0]?.finish_reason);

    return { kind: 'ok', content: text, inputTokens, outputTokens, stopReason };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return { kind: 'timeout' };
    }
    console.warn(`openai: network error on ${params.model} — ${String(err)}`);
    return { kind: 'unknown' };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function* streamOpenAIOnce(params: {
  model: string;
  systemPrompt: string;
  userMessage: string;
  maxTokens: number;
  temperature: number;
  timeoutMs: number;
  streamBudgetMs?: number;
  apiKey: string;
  conversationTurns?: ClaudeConversationTurn[];
}): AsyncGenerator<ClaudeStreamEvent, StreamOnceResult, unknown> {
  const controller = new AbortController();
  const callStartedAt = Date.now();
  let timeoutId = setTimeout(() => controller.abort(), params.timeoutMs);
  // Two-phase timer — see streamOnce above for the full rationale.
  const extendOnFirstToken = () => {
    const extra = (params.streamBudgetMs ?? params.timeoutMs) - (Date.now() - callStartedAt);
    if (extra <= 0) return;
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => controller.abort(), extra);
  };

  let fullText = '';
  let inputTokens = 0;
  let outputTokens = 0;
  let firstTokenSent = false;

  try {
    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: params.systemPrompt }
    ];
    if (params.conversationTurns && params.conversationTurns.length > 0) {
      for (const t of params.conversationTurns) {
        messages.push({ role: t.role, content: t.content });
      }
    }
    messages.push({ role: 'user', content: params.userMessage });

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${params.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: params.model,
        messages,
        max_tokens: params.maxTokens,
        temperature: params.temperature,
        stream: true,
        stream_options: { include_usage: true },
      }),
      signal: controller.signal,
    });

    if (response.status === 401 || response.status === 403) {
      await response.body?.cancel().catch(() => {});
      return { ok: false, reason: 'auth_error', fullText, inputTokens, outputTokens, firstTokenSent };
    }
    if (response.status === 404 || response.status === 429 || response.status >= 500) {
      await response.body?.cancel().catch(() => {});
      return { ok: false, reason: 'server_error', fullText, inputTokens, outputTokens, firstTokenSent };
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      console.warn(`openai(stream): unexpected HTTP ${response.status} for ${params.model}`);
      return { ok: false, reason: 'unknown', fullText, inputTokens, outputTokens, firstTokenSent };
    }

    if (!response.body) {
      return { ok: false, reason: 'unknown', fullText, inputTokens, outputTokens, firstTokenSent };
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let sepIdx: number;
      while ((sepIdx = buffer.indexOf('\n\n')) !== -1) {
        const rawEvent = buffer.slice(0, sepIdx);
        buffer = buffer.slice(sepIdx + 2);
        const dataLines = rawEvent
          .split('\n')
          .filter((line) => line.startsWith('data: '))
          .map((line) => line.slice(6));
        if (dataLines.length === 0) continue;
        const dataPayload = dataLines.join('\n');
        if (dataPayload.trim() === '[DONE]') continue;
        let parsed: any = null;
        try {
          parsed = JSON.parse(dataPayload);
        } catch {
          continue;
        }
        if (!parsed || typeof parsed !== 'object') continue;

        const deltaText = parsed.choices?.[0]?.delta?.content;
        if (typeof deltaText === 'string') {
          fullText += deltaText;
          if (!firstTokenSent) extendOnFirstToken();
          firstTokenSent = true;
          yield { type: 'text_delta', delta: deltaText };
        }

        if (parsed.usage) {
          inputTokens = parsed.usage.prompt_tokens ?? 0;
          outputTokens = parsed.usage.completion_tokens ?? 0;
        }
      }
    }

    return { ok: true, fullText, inputTokens, outputTokens, firstTokenSent };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return { ok: false, reason: 'timeout', fullText, inputTokens, outputTokens, firstTokenSent };
    }
    console.warn(`openai(stream): network error on ${params.model} — ${String(err)}`);
    return { ok: false, reason: 'unknown', fullText, inputTokens, outputTokens, firstTokenSent };
  } finally {
    clearTimeout(timeoutId);
  }
}