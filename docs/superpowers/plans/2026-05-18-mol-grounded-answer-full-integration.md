# MOL × grounded-answer — Full Integration Plan (Option C)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** DRAFT — vetted plan, awaiting CEO accept.
**Author:** ai-engineer + architect (with assessment review).
**Date:** 2026-05-18.
**Supersedes:** none. Builds on top of `2026-05-18-model-orchestration-layer.md` (MOL infrastructure, merged in PR #847).
**Owners:** ai-engineer (provider abstractions, streaming/structured surface), architect (feature flag + telemetry schema), assessment (quality + safety gates), testing (cassette suite), ops (rollout + alerts).

---

## 0. TL;DR for the CEO

Wire the `grounded-answer` Edge Function through the existing Model Orchestration Layer (MOL) so OpenAI can actually serve student traffic on the routes where the routing matrix favours it — explanations, step-by-step, quiz generation — while keeping Anthropic on the routes where it has irreplaceable capabilities (citations, vision OCR, deep reasoning). The full migration takes **18–22 working days of focused engineering**, broken into 9 phases (C1–C9) that ship independently and can roll back to the legacy direct-Anthropic path at any time via a feature flag. Three constraints are non-negotiable: **(1) Anthropic native citations cannot be reproduced on OpenAI** — any path that calls `runGroundingCheck` or that the spec calls "strict mode" must stay Anthropic-only forever, or accept a documented citation-quality regression on OpenAI. **(2) Streaming protocols differ structurally** — we have to build a normalising translation layer that adds ~150-line per-provider parsers and a unified chunk type; this is the riskiest single piece of work. **(3) Anthropic prompt caching with `cache_control: ephemeral` has no portable equivalent on OpenAI**; caching becomes provider-specific and the 30-50% input-token discount we get on Foxy today disappears for OpenAI-routed traffic. **Realistic OpenAI mix after C-phase completion: 35–50% of total grounded-answer volume** (the soft-mode Foxy explanation/step-by-step paths), saving roughly **₹2.0–2.8 lakh / month at 10 k DAU** — meaningfully less than the optimistic numbers in the original MOL plan because strict-mode + citation paths cannot move.

---

## 1. Table of Contents

1. [TL;DR for the CEO](#0-tldr-for-the-ceo)
2. [Glossary](#2-glossary)
3. [Current state map](#3-current-state-map)
4. [Architecture target](#4-architecture-target)
5. [Constraints (the honest ones)](#5-constraints-the-honest-ones)
6. [Phased implementation plan](#6-phased-implementation-plan)
   - [C1 — MOL streaming abstraction](#c1--mol-streaming-abstraction)
   - [C2 — MOL structured-output abstraction](#c2--mol-structured-output-abstraction)
   - [C3 — Wire `grounding-check.ts` to MOL](#c3--wire-grounding-checkts-to-mol)
   - [C4 — Wire blocking pipeline (plain text)](#c4--wire-blocking-pipeline-plain-text)
   - [C5 — Wire blocking pipeline (structured)](#c5--wire-blocking-pipeline-structured)
   - [C6 — Wire streaming pipeline (plain text)](#c6--wire-streaming-pipeline-plain-text)
   - [C7 — Wire streaming pipeline (structured)](#c7--wire-streaming-pipeline-structured)
   - [C8 — Citation strategy](#c8--citation-strategy)
   - [C9 — Telemetry, SLOs, rollout](#c9--telemetry-slos-rollout)
7. [Risk matrix](#7-risk-matrix)
8. [What stays Anthropic-only forever](#8-what-stays-anthropic-only-forever)
9. [Test strategy](#9-test-strategy)
10. [Cost and latency projections](#10-cost-and-latency-projections)
11. [Open questions](#11-open-questions)
12. [Recommended sequencing](#12-recommended-sequencing)
13. [Appendix A — MOL types that need new fields](#appendix-a--mol-types-that-need-new-fields)
14. [Appendix B — OpenAI vs Anthropic feature-matrix detail](#appendix-b--openai-vs-anthropic-feature-matrix-detail)
15. [Appendix C — Failure modes catalog](#appendix-c--failure-modes-catalog)
16. [Appendix D — Migration of existing tests](#appendix-d--migration-of-existing-tests)

---

## 2. Glossary

- **MOL** — Model Orchestration Layer. The provider-agnostic shim at `supabase/functions/_shared/mol/`. Today exposes `generateResponse()` only (one-shot, no streaming, no structured output, no provider-extension hooks).
- **grounded-answer** — The Edge Function at `supabase/functions/grounded-answer/`. Single entry point for every AI-answering caller (Foxy, ncert-solver, quiz-generator, concept-engine, diagnostic). 12 source files plus 14 test files. Owns RAG retrieval, prompt assembly, Claude call, grounding check, citation extraction, caching, circuit breaker, telemetry.
- **strict mode** — `mode: 'strict'` on the grounded-answer request. Requires `runGroundingCheck` to pass before serving. Used by ncert-solver, quiz-generator, concept-engine. NEVER routes to OpenAI in this plan.
- **soft mode** — `mode: 'soft'` on the request. Used by Foxy chat. May fall back to "general CBSE knowledge" if no chunks retrieved. Eligible for OpenAI routing after C-phase.
- **structured output** — Foxy's `FoxyResponse` JSON envelope (`title` / `subject` / `blocks[]`). Today emitted by Anthropic as plain text following the `FOXY_STRUCTURED_OUTPUT_PROMPT` addendum, parsed with hand-rolled `JSON.parse + validateFoxyResponse`. Could move to Anthropic `tool_use` (server-side schema) or OpenAI `response_format: json_schema` (strict).
- **citations** — `[N]` references inside Claude's text → resolved to chunk metadata via `extractCitations`. Today purely prompt-based + post-hoc regex. Distinct from Anthropic native citations API (`citations.enabled=true`), which grounded-answer does NOT currently use.
- **cassette** — Recorded HTTP exchange (request + response) for deterministic provider-call testing. Required infra we don't yet have at the MOL layer; pipeline-level tests use mocked Supabase clients but real Anthropic HTTP responses are not recorded today.

---

## 3. Current state map

Every Anthropic-specific feature used by `grounded-answer` and the assessment of whether it can be cross-provider abstracted.

| # | Feature | Current usage in grounded-answer | Anthropic API surface | OpenAI equivalent | Cross-provider feasibility |
|---|---|---|---|---|---|
| 1 | One-shot text completion | `callClaude` in `claude.ts` (called from `pipeline.ts` and `grounding-check.ts`) | `POST /v1/messages` with `messages[]` + `system` | `POST /v1/chat/completions` with `messages[{role:'system'},...]` | **YES — already in MOL.** `generateResponse()` works today |
| 2 | Vision (image input) | Only used by `grounded-answer` indirectly through `scan-ocr` upstream; NOT in grounded-answer scope | `content: [{type:'image', source:{type:'url', url:...}}]` | `content: [{type:'image_url', image_url:{url:...}}]` | **YES — already in MOL.** `image_url` option on `ProviderCallOptions` |
| 3 | Plain SSE streaming | `callClaudeStream` in `claude.ts`, parses 6 Anthropic event types (`message_start`, `content_block_start`, `content_block_delta` with `text_delta`, `content_block_stop`, `message_delta`, `message_stop`, `ping`, `error`) | `stream: true` → SSE w/ named events | `stream: true` → SSE w/ `chat.completion.chunk` objects keyed on `choices[0].delta` | **YES with translation layer** (C1). The two providers emit different event taxonomies but both yield incremental text. We can normalise to `{type:'text_delta', delta}` + `{type:'final', tokens, model, finish_reason}` |
| 4 | Anthropic `tool_use` (server-validated structured output) | NOT used today; structured output is prompt-based (`FOXY_STRUCTURED_OUTPUT_PROMPT` addendum + post-hoc `JSON.parse + validateFoxyResponse`) | `tools: [{name, input_schema}]` + `tool_choice: {type:'tool', name}` → response includes `content: [{type:'tool_use', input: {...}}]` | `response_format: {type:'json_schema', json_schema:{name, schema, strict:true}}` → response.choices[0].message.content is schema-conformant JSON string | **PARTIAL** (C2). Both APIs offer schema-conformant output but the request shape, the response shape, and streaming behaviour differ. Anthropic streams `input_json_delta` chunks; OpenAI streams plain text deltas that happen to be valid JSON. Hand-rolled wrap + provider-specific serialiser will work; full feature parity is impossible |
| 5 | Anthropic native citations | NOT used today. Citations are extracted post-hoc by `extractCitations` regex on `[N]` references | `content: [{type:'document', source:{...}, citations:{enabled:true}}]` → response includes citation blocks interleaved with text | **NONE.** OpenAI has no native citation API | **NO.** Foxy currently doesn't use Anthropic native citations either, so this is *de facto* portable today. But if we ever wanted to upgrade to Anthropic native citations (a separate workstream the constitution mentions for "Foxy moat"), that path forks Anthropic-only |
| 6 | Prompt caching (`cache_control: ephemeral`) | Active in `claude.ts` and `grounding-check.ts`; the foxy_tutor_v1 system prompt + reference material block (typically 3–6 k input tokens per call) is cache-marked | `system: [{type:'text', text, cache_control:{type:'ephemeral'}}]` | OpenAI does automatic prompt caching on prefixes ≥ 1024 tokens (since Oct-2024) with no explicit control | **PARTIAL.** OpenAI caching is automatic; we get the discount whenever the prefix is stable. But Anthropic gives us 90% input-token discount on cache hits for 5 min; OpenAI gives 50% input-token discount automatically on warmed prefixes. The economics shift |
| 7 | `{{INSUFFICIENT_CONTEXT}}` sentinel | Strict-mode prompt instructs Claude to emit this exact string; `callClaude` parses `insufficientContext: trimmed === SENTINEL` | Plain text behaviour | Plain text behaviour (works the same — prompt-based, not API-level) | **YES.** Pure prompt convention. Survives provider switch unchanged |
| 8 | `stop_reason` (Anthropic) / `finish_reason` (OpenAI) | `callClaude` returns `model + insufficientContext`; `callClaudeStream` ignores stop_reason today | `stop_reason: 'end_turn' \| 'max_tokens' \| 'tool_use' \| 'stop_sequence'` | `finish_reason: 'stop' \| 'length' \| 'tool_calls' \| 'content_filter'` | **YES with mapping table** (C1). Taxonomy differs but we only care about three buckets: complete-ok, truncated-by-max-tokens, blocked. Mapping table lives in `providers/shared.ts` |
| 9 | Anthropic-specific response shape (content blocks) | `claude.ts` parses `body.content` as `Array<{type, text}>` and concatenates text-block strings | `content: [{type:'text', text: '...'}]` (and `{type:'tool_use', ...}` when tools used) | `choices[0].message.content` is a plain string | **YES.** Normalised in providers/base.ts already (`ProviderResponse.text`). No grounded-answer code reads raw block shape |
| 10 | Sonnet fallback inside streaming | `callClaudeStream` enforces the contract: first model can fall back to second IF no tokens have streamed; once `firstTokenSent=true` we commit to that model | Implementation detail of `claude.ts` | Same logic possible on OpenAI side (HTTP-level retry on connection failure before first byte) | **YES.** Move logic into `providers/shared.ts:streamWithFallback` — works for any provider |
| 11 | `auth_error` short-circuit (no breaker trip) | `pipeline.ts` checks `claude.reason === 'auth_error'` and skips `recordFailure` | Provider-specific HTTP status codes (401/403) | Same (401/403) | **YES.** Provider error normalisation already exists in MOL via the `failure_chain` in `executePass` |
| 12 | Per-call Anthropic timeout cap of 45 s | Hardcoded in `claude.ts: PER_CALL_TIMEOUT_CAP_MS` | Implementation detail | Same | **YES.** Add to `ProviderCallOptions.timeout_ms`; already there |
| 13 | The grounding-check second Anthropic call | `runGroundingCheck` is a totally independent Haiku call against api.anthropic.com; passes question/answer/chunks and parses JSON verdict | Plain Messages API call | Plain Chat Completions call | **YES (C3).** Smallest possible MOL adoption. Standalone, single-shot, no streaming, no special features. **HIGH-RISK to route to OpenAI in practice** — see §5 — because changing the grounding-judge model can systematically shift abstain rates. Recommend keeping Anthropic primary; OpenAI fallback only when Anthropic 5xx |

### Visualised dependency graph

```
grounded-answer Edge Function
├── index.ts ────────────────────────────────── HTTP entry, SSE framing
│   ├── pipeline.ts ─────────────────────────── BLOCKING (run for everyone except foxy?stream=1)
│   │   ├── claude.ts:callClaude ──────────── (1) single-shot Anthropic call
│   │   └── grounding-check.ts:runGroundingCheck (2) second Haiku call (strict mode only)
│   └── pipeline-stream.ts ──────────────────── STREAMING (foxy + ?stream=1 only)
│       └── claude.ts:callClaudeStream ─────── (3) streaming Anthropic call
│
└── _shared/mol/ (dormant — no callers today)
    └── generateResponse() ───────────────────── (4) one-shot, cross-provider
```

Today every `(1)`, `(2)`, `(3)` path hits Anthropic directly. C-phase replaces them with `(4)` and two new MOL surfaces — `generateResponseStream()` (C1) and `generateStructuredResponse()` (C2).

---

## 4. Architecture target

```
                                             ┌────────────────────────────────┐
                                             │  grounded-answer pipelines      │
                                             │                                 │
                                             │   pipeline.ts            ─┐     │
                                             │   pipeline-stream.ts     │     │
                                             │   grounding-check.ts     │     │
                                             └──────────────────────────┼─────┘
                                                                        │
                                  ┌─────────────────────────────────────┴───────┐
                                  │  MOL public surface (today + new)            │
                                  │                                              │
                                  │  generateResponse(req)     ── EXISTING       │
                                  │  generateResponseStream(req)── C1 NEW        │
                                  │  generateStructuredResponse(req, schema)──C2 │
                                  └─────────────────────┬────────────────────────┘
                                                        │
                            ┌───────────────────────────┼─────────────────────────────┐
                            │                           │                              │
                  ┌─────────▼──────────┐    ┌───────────▼──────────┐     ┌────────────▼────────────┐
                  │ providers/         │    │  providers/           │     │ providers/              │
                  │   anthropic.ts     │    │    openai.ts          │     │   shared.ts             │
                  │                    │    │                       │     │                         │
                  │  call() ──────────┼────┼─ call() ──────────────┼─────┼─ withTimeout, retry,   │
                  │  callStream() ─C1 │    │  callStream() ─────C1 │     │   circuit breaker       │
                  │  callStructured()─C2│  │  callStructured() ─C2 │     │  parseSSE             ─C1│
                  │  (uses tool_use)   │   │  (uses response_format)│     │  mapStopReason       ─C1 │
                  └────────────────────┘   └───────────────────────┘     └─────────────────────────┘
                                                        │
                                                        ▼
                                  ┌────────────────────────────────────┐
                                  │  HTTP calls to api.anthropic.com    │
                                  │                or api.openai.com    │
                                  └────────────────────────────────────┘
```

### New types added by C1 + C2 (full reference in Appendix A)

```ts
// types.ts — added by C1
export interface GenerateStreamRequest extends GenerateRequest {
  // identical to GenerateRequest; conventionally separate type makes
  // stream callers explicit and lets the schema diverge later.
}

export type StreamEvent =
  | { type: 'text_delta'; delta: string }
  | { type: 'tool_use_start'; tool_name: string }
  | { type: 'tool_use_delta'; partial_json: string }
  | { type: 'tool_use_stop' }
  | { type: 'final'; ok: true; full_text: string; tokens: TokenUsage; model: string; provider: 'openai' | 'anthropic'; finish_reason: NormalizedFinishReason; structured_payload?: unknown }
  | { type: 'final'; ok: false; reason: 'timeout' | 'auth_error' | 'server_error' | 'unknown'; partial_text: string; model: string | null; provider: 'openai' | 'anthropic' | null }

export type NormalizedFinishReason = 'complete' | 'max_tokens' | 'tool_use' | 'content_filter' | 'unknown'

// types.ts — added by C2
export interface StructuredOutputSpec {
  name: string                  // schema name, e.g. 'foxy_response'
  schema: object                // JSON Schema 2020-12
  strict: boolean               // must = true for OpenAI strict mode
}

export interface GenerateStructuredRequest extends GenerateRequest {
  structured_output: StructuredOutputSpec
}

export interface StructuredMolResult extends MolResult {
  structured_payload: unknown   // already JSON-parsed; the validator MUST run on top
  raw_text: string              // serialisation of structured_payload for legacy storage
}
```

### Provider interface evolution

```ts
// providers/base.ts — today
export interface ModelProvider {
  id: 'openai' | 'anthropic'
  default_model: string
  isConfigured(): boolean
  call(model: string, opts: ProviderCallOptions): Promise<ProviderResponse>
}

// providers/base.ts — after C1 + C2
export interface ModelProvider {
  id: 'openai' | 'anthropic'
  default_model: string
  isConfigured(): boolean
  call(model: string, opts: ProviderCallOptions): Promise<ProviderResponse>
  callStream(model: string, opts: ProviderCallOptions): AsyncGenerator<NormalizedStreamChunk, void, unknown>     // C1
  callStructured(model: string, opts: ProviderCallOptions, spec: StructuredOutputSpec): Promise<StructuredProviderResponse> // C2
  // optional — only Anthropic for now; OpenAI returns null:
  supportsCitations(): boolean
}
```

---

## 5. Constraints (the honest ones)

These are real, hard-to-work-around limitations that the plan respects.

### 5.1 Citations are not portable. (BLOCKING for strict mode.)

Anthropic's native citations API (`citations.enabled=true` on document content blocks) yields response content interleaved with `{type:'text', citations:[{type:'char_location'|'page_location'|'content_block_location', cited_text, document_index, start_*, end_*}]}` entries. The cost is paid once on input (document tokens) and citations themselves do not bill against output tokens. **OpenAI has no equivalent.** No API surface gives you (a) verbatim quote extraction with location, (b) automatic deduplication of citations, (c) chunked source attribution with cost-free citation text.

**The grounded-answer service does not currently use Anthropic native citations** — it uses post-hoc regex on `[N]` markers in plain text (`citations.ts:extractCitations`). So **the soft-mode Foxy path is portable to OpenAI today** because citation extraction happens after the text is in hand. The structural blocker is for any path that *requires verified grounding* — strict mode + the `runGroundingCheck` step. If we ever migrate to native Anthropic citations (a separate workstream the constitution flags), that fork remains Anthropic-only by definition.

Implication: phases C3–C7 only touch soft-mode-eligible code paths. Strict mode keeps its direct `callClaude` until and unless we accept (a) a documented citation-quality regression on OpenAI, or (b) keep Anthropic-only for strict mode forever.

### 5.2 Streaming protocols are structurally different.

Anthropic SSE event stream (per `https://docs.anthropic.com/en/api/messages-streaming`):
- `message_start` (carries initial `usage.input_tokens`)
- `content_block_start` (per content block: text, tool_use, etc.)
- `content_block_delta` (subtypes: `text_delta`, `input_json_delta`, `citations_delta`, `thinking_delta`)
- `content_block_stop`
- `message_delta` (carries cumulative `usage.output_tokens` and stop_reason)
- `message_stop`
- `ping` (keepalive)
- `error`

OpenAI SSE event stream (per `https://developers.openai.com/api/reference/resources/chat/subresources/completions/streaming-events`):
- A single event type, `chat.completion.chunk`, with `choices[0].delta.{role, content, tool_calls?, refusal?}` and a separate top-level `finish_reason` field that arrives in the final chunk
- Terminated by `data: [DONE]`

**These cannot be naively merged.** Anthropic uses named events; OpenAI uses one event type with shape-discrimination. Anthropic emits `message_start` BEFORE any text deltas (carrying `input_tokens`); OpenAI emits `input_tokens` only in the final usage chunk (Aug-2024 onward, requires `stream_options: {include_usage: true}`). Anthropic emits `text_delta` deltas; OpenAI emits `delta.content` strings. Anthropic emits `input_json_delta` for streaming tool-use JSON; OpenAI emits `delta.tool_calls[i].function.arguments` partial strings.

The translation layer (C1) must normalise these to a single `StreamEvent` taxonomy without losing information. Concretely:

| Anthropic event | OpenAI equivalent | Normalised chunk |
|---|---|---|
| `message_start` w/ `usage.input_tokens` | First chunk (no token info) OR final chunk w/ `usage.prompt_tokens` (with `include_usage: true`) | Carried in `final` only. The Anthropic preview-of-input-tokens is discarded |
| `content_block_start` w/ `type:'text'` | implicit (no equivalent) | Not emitted |
| `content_block_delta` w/ `text_delta` | `chat.completion.chunk` w/ `delta.content` | `{ type: 'text_delta', delta }` |
| `content_block_delta` w/ `input_json_delta` | `chat.completion.chunk` w/ `delta.tool_calls[i].function.arguments` | `{ type: 'tool_use_delta', partial_json }` |
| `content_block_start` w/ `type:'tool_use'` | `delta.tool_calls[i].id` + first arguments chunk | `{ type: 'tool_use_start', tool_name }` |
| `content_block_stop` | implicit | `{ type: 'tool_use_stop' }` (emitted only when index is a tool block) |
| `message_delta` w/ `stop_reason` + `usage.output_tokens` | Final chunk w/ `finish_reason` + `usage` (when `include_usage: true`) | Folded into `final` event |
| `message_stop` | `[DONE]` marker | Triggers `final` emit |
| `ping` | (no equivalent — OpenAI uses HTTP keepalive) | Silently dropped |
| `error` | HTTP-level or chunk-level `error` field | `{ type: 'final', ok: false, reason: 'server_error', ... }` |

**Risk:** subtle bugs in the translation layer can leak as missing tokens, double-emit, or off-by-one chunk delimiters at sentence boundaries. We need cassette-based testing (see §9) before any production traffic.

### 5.3 Structured output APIs are not isomorphic.

OpenAI offers `response_format: {type: 'json_schema', json_schema: {name, schema, strict: true}}`. With `strict: true`, the model is guaranteed to emit a string that parses to JSON conforming to the schema (only Draft 2020-12 subset; no `oneOf`, no `$ref`, no `pattern` longer than X chars, etc.). Available on `gpt-4o-2024-08-06+`, `gpt-4o-mini`. The streamed response is a normal `delta.content` string sequence that happens to be parseable as JSON when concatenated.

Anthropic offers `tools: [{name, description, input_schema}]` + `tool_choice: {type:'tool', name}`. The model emits a `tool_use` content block with `input: {...}` matching the schema. **As of late 2025 / 2026, Anthropic also supports `strict: true` on tool definitions** (per `https://platform.claude.com/docs/en/agents-and-tools/tool-use/strict-tool-use`). Streamed JSON arrives as `input_json_delta` deltas; concatenating them yields the final JSON.

Both approaches enforce schema, but:

- **Schema flavour:** OpenAI requires JSON Schema with `additionalProperties: false` and every field in `required[]`; Anthropic is slightly more forgiving but recommends the same conventions for strict mode.
- **Streaming-while-parsing:** OpenAI's stream is plain text — you can use a streaming JSON parser (`jsonparse`, `clarinet`, etc.) over the deltas. Anthropic's `input_json_delta` is also plain text but the *protocol* signals "this is a tool argument" via the surrounding `content_block_start` event; if your consumer wants typed events you have to dispatch on the surrounding context.
- **Validation guarantees:** OpenAI `strict: true` actually constrains the decoder (schema-aware generation); Anthropic `strict: true` does the same as of 2026. Both can still emit truncated JSON when `max_tokens` cuts mid-output — we still need our `rescueFromTruncatedJson` fallback for both providers.
- **Error envelope:** OpenAI surfaces schema-conformance errors as `refusal` content (not in our happy path); Anthropic surfaces them as `stop_reason: 'tool_use'` with an empty `input` object or similar.

**Risk:** structured output that worked perfectly on Anthropic *may* validate but differ semantically on OpenAI — different model, different reasoning, different default values for optional fields. C2 must keep the `validateFoxyResponse + validateSubjectRules + wrapAsParagraph` fallback chain in place; we do NOT trust either provider's "strict" guarantee enough to remove the post-hoc validator.

### 5.4 Prompt caching is provider-specific.

Anthropic: explicit `cache_control: {type: 'ephemeral'}` markers on system prompt / tools / messages blocks. 5-minute TTL. Up to 90% input-token discount on cache hits.

OpenAI: automatic on any prefix ≥ 1024 tokens; ~50% input-token discount on cache hits. No API control over what gets cached.

For Foxy today, every call sets `cache_control: ephemeral` on a ~5k-token system prompt that's stable across a conversation. We pay roughly 10% of the input-token cost on the 2nd+ turn in a 5-minute window. If we route to OpenAI, we get automatic caching of the stable prefix but only at 50% off, and we have no signal of when the cache misses.

**Implication for cost projections:** the headline ₹/day savings from "OpenAI is cheaper per token" partly evaporates because Foxy's high-frequency multi-turn pattern is the ideal Anthropic-caching workload. Real per-call cost on OpenAI vs cached-Anthropic-haiku is closer than naïve list prices suggest — see §10.

### 5.5 Stop-reason taxonomy differs.

Mapping table that lives in `providers/shared.ts`:

| Anthropic `stop_reason` | OpenAI `finish_reason` | Normalised |
|---|---|---|
| `end_turn` | `stop` | `complete` |
| `max_tokens` | `length` | `max_tokens` |
| `tool_use` | `tool_calls` | `tool_use` |
| `stop_sequence` | (no direct equivalent — `stop` if a stop string was hit) | `complete` |
| n/a (Anthropic blocks via separate safety field) | `content_filter` | `content_filter` |
| (any other) | (any other) | `unknown` |

Today `pipeline.ts` does not branch on stop_reason, but `parseFoxyStructured` benefits from knowing whether the JSON was truncated by `max_tokens`. C5 + C7 must pass this through to the rescue logic.

---

## 6. Phased implementation plan

Read this as a dependency graph, not a strict serial order — see §12 for the parallelisation plan. Each phase is independently shippable with its own feature flag.

---

### C1 — MOL streaming abstraction

**Goal:** add `generateResponseStream(req)` to MOL with provider-agnostic chunked output.

**Files (new):**
- `supabase/functions/_shared/mol/stream.ts` — new public entry; orchestrates classify → route → execute (mirrors `index.ts` but yields `StreamEvent`)
- `supabase/functions/_shared/mol/providers/anthropic-stream.ts` — Anthropic SSE parser → normalised chunks
- `supabase/functions/_shared/mol/providers/openai-stream.ts` — OpenAI SSE parser → normalised chunks
- `supabase/functions/_shared/mol/providers/shared-stream.ts` — `parseSSEFrames(reader, decoder)` generator, `mapStopReason()`, `withStreamTimeout()`, `streamWithFallback()` (first-token-or-fallback contract)
- `supabase/functions/_shared/mol/__tests__/stream-anthropic.test.ts`
- `supabase/functions/_shared/mol/__tests__/stream-openai.test.ts`
- `supabase/functions/_shared/mol/__tests__/stream-integration.test.ts`
- `supabase/functions/_shared/mol/__tests__/_cassettes/` (new directory; recorded SSE bodies as `.txt` files)

**Files (modified):**
- `supabase/functions/_shared/mol/types.ts` — add `StreamEvent`, `NormalizedFinishReason`, `GenerateStreamRequest`
- `supabase/functions/_shared/mol/providers/base.ts` — extend `ModelProvider` with `callStream(model, opts): AsyncGenerator<StreamEvent>`
- `supabase/functions/_shared/mol/providers/anthropic.ts` — implement `callStream()` (move the SSE parser from `grounded-answer/claude.ts:streamOnce`, refactor into the normalised event shape)
- `supabase/functions/_shared/mol/providers/openai.ts` — implement `callStream()` (new SSE parser; include `stream_options.include_usage: true` so we get token counts)
- `supabase/functions/_shared/mol/index.ts` — export new entry

**Why this is the most complex single phase:**

We have two SSE parsers, one new (OpenAI) and one ported (Anthropic from `grounded-answer/claude.ts`). The normalised event model must preserve enough information that the consumer (pipeline-stream.ts, eventually) can drive its existing logic: `firstTokenSent` tracking for fallback policy, partial-text accumulation for error recovery, `text_delta` ordering for UI rendering, and (in C7) `tool_use_delta` accumulation for structured JSON.

Edge cases that will break naïve implementations:
1. OpenAI's "usage chunk" is the **final** chunk (after `finish_reason`), only sent when `stream_options.include_usage: true`. The Anthropic equivalent (`message_delta` w/ usage) arrives mid-stream after the last `content_block_stop`. The normalised `final` event must be emitted at exactly the right point: after all text deltas but before the consumer's done-handler runs.
2. Anthropic `ping` events arrive every ~30s as keepalives. OpenAI uses HTTP-level chunked encoding without periodic pings (relying on TCP keepalive). We need to handle Anthropic pings without yielding anything, and we need to handle OpenAI "no data for 30s" without timing out spuriously — set a per-deltagap timeout, not just a wall-clock timeout.
3. Anthropic SSE has named `event:` lines AND `data:` lines; OpenAI only has `data:` lines. The shared parser must handle both.
4. Partial chunks at TCP boundaries: a single `data: {...}` JSON object may straddle two `read()` returns. Our existing buffer-and-split-on-`\n\n` logic in `claude.ts:streamOnce` handles this; we port it verbatim.

**Estimated work:** 4 days. Optimistic estimate of 3 days; +1 day for the cassette infrastructure and edge cases discovered during integration testing.

**Feature flag:** none — MOL surface is internal until callers wire up.

**Test strategy:**
- Unit: feed known SSE frames (recorded from real provider calls) into `parseSSEFrames`, assert chunk emission order + final-event shape.
- Cassette: record one real Anthropic stream + one real OpenAI stream against a known prompt; replay via mock `fetch` to assert identical normalised output across all 5 chunk types.
- Integration: `generateResponseStream(req)` with `preferred_provider: 'openai'` → assert OpenAI-typed chunks; same with `'anthropic'` → assert Anthropic-typed chunks; both yield identical sequence of `{type:'text_delta', delta}` events when given identical prompts.

**Rollout:** none (no callers yet). Land behind no flag.

**Backout:** delete `stream.ts` + revert `base.ts` + `types.ts` deltas. Anthropic/OpenAI `callStream` additions can remain (they're additive, no caller).

---

### C2 — MOL structured-output abstraction

**Goal:** add `generateStructuredResponse(req, spec)` to MOL with provider-agnostic schema enforcement.

**Files (new):**
- `supabase/functions/_shared/mol/structured.ts` — new public entry; classify → route → execute structured call → validate
- `supabase/functions/_shared/mol/__tests__/structured-anthropic.test.ts`
- `supabase/functions/_shared/mol/__tests__/structured-openai.test.ts`
- `supabase/functions/_shared/mol/__tests__/structured-integration.test.ts`

**Files (modified):**
- `supabase/functions/_shared/mol/types.ts` — add `StructuredOutputSpec`, `GenerateStructuredRequest`, `StructuredMolResult`
- `supabase/functions/_shared/mol/providers/base.ts` — extend `ModelProvider` with `callStructured()`
- `supabase/functions/_shared/mol/providers/anthropic.ts` — implement `callStructured()` using `tools: [{name, description, input_schema}]` + `tool_choice: {type:'tool', name}`
- `supabase/functions/_shared/mol/providers/openai.ts` — implement `callStructured()` using `response_format: {type:'json_schema', json_schema: {name, schema, strict: true}}`
- `supabase/functions/_shared/mol/index.ts` — export new entry

**Schema translation:**

Both providers want JSON Schema, but OpenAI's strict mode imposes additional constraints. We pre-process the schema in `structured.ts` before sending to the provider:

```ts
function adaptSchemaForProvider(schema: object, provider: 'openai' | 'anthropic'): object {
  if (provider === 'openai') {
    // OpenAI strict mode requires:
    // - additionalProperties: false on every object
    // - every key in required[]
    // - no oneOf, no anyOf with mixed types, no pattern, no patternProperties
    return harden(schema)
  }
  // Anthropic is more permissive but still works with hardened schemas
  return schema
}
```

The FoxyResponse schema today is hand-rolled in `structured-schema.ts`. C2 ships a parallel JSON Schema (in `supabase/functions/_shared/mol/schemas/foxy-response.ts`) that mirrors it exactly. We do NOT regenerate or auto-derive — manual sync, with a parity test (`foxy-schema-parity.test.ts`) that runs the hand-rolled `validateFoxyResponse` against JSON-Schema-generated examples and asserts agreement on a corpus of 50 hand-crafted fixtures.

**Critical decision:** do we trust the provider's "strict" guarantee?
- **No.** Both providers can still emit truncated JSON when `max_tokens` hits mid-output. Both can occasionally return empty inputs on `tool_choice: any`. We keep `validateFoxyResponse + validateSubjectRules + rescueFromTruncatedJson + wrapAsParagraph` exactly as it is today, just downstream of the new `generateStructuredResponse` call.

**Risk:** OpenAI's `strict: true` increases first-token latency by ~150-300ms (Aug-2024 announcement, may have improved by 2026) because the model has to compile the schema. Foxy responses are time-critical for chat UX. We measure in C2 testing and decide whether to ship `strict: true` or `strict: false` for OpenAI (the latter would fall back to "best effort JSON" mode).

**Estimated work:** 4 days. Genuinely complex because of (a) schema translation, (b) tool_use vs response_format response-shape differences, (c) keeping the hand-rolled validator authoritative.

**Feature flag:** none yet.

**Test strategy:**
- Unit: schema-adapter produces hardened schema for OpenAI, leaves Anthropic-friendly schema alone.
- Cassette: same FoxyResponse schema fed to both providers with a known prompt; assert both responses parse to equivalent `FoxyResponse` after validator runs.
- Property-based: 100 random valid `FoxyResponse` objects → serialise → feed back through validator → assert equality. Same exercise across both providers.

**Rollout:** none yet.

**Backout:** revert files. Pipeline still uses the prompt-based addendum.

---

### C3 — Wire `grounding-check.ts` to MOL

**Goal:** smallest, lowest-risk migration. Validates MOL works inside the grounded-answer service before touching the main pipeline.

**Files (modified):**
- `supabase/functions/grounded-answer/grounding-check.ts` — replace the inline `fetch(ANTHROPIC_ENDPOINT, ...)` call with `generateResponse({ task_type: 'evaluation', input: { instruction: ... }, student_context: { ... }, config: { surface: 'foxy', max_tokens_override: 512 } })`. Map MOL `MolResult` back to `GroundingCheckResult`.

**Files (new):**
- `supabase/functions/grounded-answer/__tests__/grounding-check-mol.test.ts`

**Why this is genuinely low risk:**
- Standalone call — no streaming, no structured output, no citations.
- Single failure mode — verdict parse fails → conservative fail (already the contract).
- Telemetry-by-default — MOL writes one row to `mol_request_logs`, so we instantly get cost-per-grounding-check visibility.

**Why this still has subtle risk:**
- The grounding-check is a *judge*. If we route the judge to OpenAI even occasionally, we shift the abstain rate because OpenAI and Anthropic disagree on edge cases. Recommend: pin the routing for `task_type='evaluation'` to `anthropic-primary` initially (it already is per the routing matrix); only allow OpenAI fallback on Anthropic 5xx.
- The grounding-check prompt is inlined in `grounding-check.ts` (`GROUNDING_CHECK_SYSTEM_PROMPT`). MOL's `buildSystemPrompt()` will *prepend* its own Foxy persona / grade tier / language instructions, which corrupts the meta-verifier. **Workaround:** add a `task_type: 'grounding_check'` to the TaskType enum that bypasses `buildSystemPrompt` and passes the inlined prompt through verbatim. This is a one-time MOL change — see §11 open questions.

**Estimated work:** 2 days. Includes adding the `grounding_check` TaskType, prompt-pass-through plumbing, and validation that OpenAI never serves the grounding-check call in normal operation.

**Feature flag:** `ff_mol_grounding_check_v1` (gates whether grounding-check uses MOL or legacy `fetch`).
- Default: OFF (legacy path).
- Stage 1 rollout: 10% of strict-mode traffic, monitor abstain rate.
- Stage 2: 50% → measure cost + latency + abstain delta.
- Stage 3: 100% → delete legacy path in a follow-up PR.

**Test strategy:**
- Unit: re-run all existing `grounding-check.test.ts` cases through the MOL-wired path; assert byte-identical verdict output.
- Integration: 50 production grounding-check transcripts replayed through both paths; assert same verdict on every row.
- Synthetic abstain canary: a known-grounded fixture + a known-ungrounded fixture run hourly; alert if verdict differs from expected.

**Rollout:** see Stage 1/2/3 above. 1 week per stage = 3 weeks total to 100% (overlaps with C4–C7 work).

**Backout:** flip flag to OFF. Existing fetch path remains intact.

---

### C4 — Wire blocking pipeline (plain text)

**Goal:** replace `callClaude` in `pipeline.ts` with `generateResponse()` for the non-structured (non-Foxy) callers: ncert-solver, quiz-generator, concept-engine, diagnostic.

**Files (modified):**
- `supabase/functions/grounded-answer/pipeline.ts` — at step 10, branch on `request.caller`:
  - If `caller === 'foxy'` → wait for C5 (this phase doesn't touch foxy).
  - Otherwise → call `generateResponse({task_type: classify(caller), ... })`; map result back to `ClaudeResponse` shape.

**Files (new):**
- `supabase/functions/grounded-answer/mol-adapter.ts` — translation layer between grounded-answer's request envelope and MOL's `GenerateRequest`. Handles: scope → student_context, generation.system_prompt_template → already-rendered system prompt as `rag_context`, conversation_turns → `input.chat_history`, model_preference → `config.preferred_provider`.

**Files (modified):**
- `supabase/functions/grounded-answer/__tests__/pipeline.test.ts` — add MOL-path test cases.

**The big design decision: `system_prompt` flow.**

grounded-answer's pipeline today owns prompt assembly entirely — it loads a registered template, resolves variables, appends the structured-output addendum (Foxy only), and passes the finished string to `callClaude`. MOL's `generateResponse` *also* builds a system prompt (via `buildSystemPrompt`), which is designed for the older edge functions (foxy-tutor, ncert-solver) that just hand MOL a topic and let MOL drive everything.

**Two options:**
1. **Pass-through mode.** Add `config.system_prompt_override` to MOL so grounded-answer can hand in a fully-rendered system prompt and MOL skips its own `buildSystemPrompt`. Keeps prompt ownership in grounded-answer.
2. **Migrate prompt building to MOL.** Move grounded-answer's template rendering up into MOL's `buildSystemPrompt`. This collapses two prompt builders into one.

**Recommendation: option 1.** Option 2 sounds clean but would require MOL to grow knowledge of NCERT chunks, citation indexing conventions, and the structured-output addendum — which would tightly couple MOL back to grounded-answer. Pass-through preserves the abstraction. **The Anthropic prompt-caching marker (`cache_control: ephemeral`) gets applied automatically when the system prompt length exceeds 1024 chars — already in `providers/anthropic.ts:30`.**

**Estimated work:** 3 days. Including the `system_prompt_override` plumbing through MOL.

**Feature flag:** `ff_mol_grounded_blocking_plain_v1` (per-caller).
- Default OFF for all callers.
- Rollout per caller: 10% → 50% → 100% over 2 weeks each.
- Start with `concept-engine` (lowest student impact — internal retrieve-only path).
- Then `diagnostic` (admin-only).
- Then `quiz-generator` (high traffic, but quiz JSON validation catches drift).
- Then `ncert-solver` (highest blast radius — full strict-mode student-facing answers).

**Test strategy:**
- Replay 200 production blocking pipeline traces through MOL-wired path; assert identical abstain outcomes and equivalent (not byte-identical) answers.
- Property: same RAG context + same query → same answer length distribution (within 20%) and same citation count.

**Rollout:** see per-caller staging above. ~6 weeks total to 100% across all 4 callers — overlaps with other phases.

**Backout:** flip flag per caller.

---

### C5 — Wire blocking pipeline (structured)

**Goal:** route Foxy blocking traffic through MOL with structured-output enforcement.

**Files (modified):**
- `supabase/functions/grounded-answer/pipeline.ts` — when `caller === 'foxy'`, call `generateStructuredResponse(req, FOXY_RESPONSE_SCHEMA)` instead of `callClaude`.
- `supabase/functions/_shared/mol/schemas/foxy-response.ts` — JSON Schema mirror of `structured-schema.ts:validateFoxyResponse` (added in C2; updated here if needed).

**Files (modified):**
- `supabase/functions/grounded-answer/structured-schema.ts` — confirm `validateFoxyResponse + validateSubjectRules + rescueFromTruncatedJson + wrapAsParagraph` still run downstream of MOL's strict-mode response.

**Why we still post-validate even with provider strict mode:**
- Truncation: max_tokens still cuts mid-output. Strict mode prevents *invalid* JSON but cannot prevent *missing* JSON.
- Subject rules: `validateSubjectRules` enforces business logic (e.g. `english` subject must have zero math blocks) that JSON Schema cannot express.
- Byte cap: 16 KB whole-payload cap is post-hoc.
- Defence in depth: if the provider regresses, our validator catches it.

**The biggest unknown — OpenAI strict mode latency.**

OpenAI's documentation reports first-token latency increases of 150-300ms with `strict: true`. Foxy chat is latency-sensitive (median chat-response latency target: ≤ 1.8s end-to-end). C5 testing must measure:
- Anthropic Haiku (current): median first-token latency.
- Anthropic Haiku with tool_use strict mode: median first-token latency.
- OpenAI GPT-4o-mini with response_format strict mode: median first-token latency.
- OpenAI GPT-4o-mini with response_format non-strict: median first-token latency.

If OpenAI strict-mode latency exceeds Anthropic by > 500ms in p50, **C5 may NOT be worth shipping for OpenAI traffic.** Outcome: pin Foxy structured-output to Anthropic-only and accept that ~60% of grounded-answer traffic stays on Anthropic. This is *the* phase that may have negative ROI.

**Estimated work:** 4 days. The provider-call code is bounded; the testing matrix is large.

**Feature flag:** `ff_mol_grounded_blocking_structured_v1`.
- Default OFF.
- Stage 1: 5% Foxy traffic to MOL-wired path (still using Anthropic backend via `task_type=doubt_solving` matrix). Sanity check: round-trip works.
- Stage 2: 20% Foxy traffic with OpenAI primary on `explanation`/`step_by_step` subset, Anthropic primary on the rest.
- Stage 3: 100% Foxy traffic via MOL. OpenAI routing remains gated by the task-type matrix.

**Test strategy:**
- Cassette tests: deterministic strict-mode call + validator round-trip for both providers.
- Production transcript replay: 500 Foxy blocking responses replayed through MOL; assert (a) all parse as `FoxyResponse`, (b) `groundedFromChunks` flag agrees, (c) citation count agrees within ±1.
- A/B latency: 24-hour comparison of median + p95 first-token latency between control (Anthropic direct) and treatment (MOL-Anthropic). Then 24-hour comparison between treatment-Anthropic and treatment-OpenAI.

**Rollout:** 3 weeks (Stage 1: 3 days, Stage 2: 7 days, Stage 3: ramp + monitor).

**Backout:** flag flip → reverts to direct Anthropic + prompt-addendum path.

---

### C6 — Wire streaming pipeline (plain text)

**Goal:** route non-Foxy streaming traffic through `generateResponseStream`.

**Today's reality:** **only Foxy uses streaming.** The `?stream=1` query parameter triggers `pipeline-stream.ts`, and `pipeline-stream.ts` only runs for `caller === 'foxy'` (the parent `index.ts` route guards on `r.mode === 'soft' && r.retrieve_only !== true`). Other callers all use blocking. **So C6 has no callers today and is effectively a no-op until a non-Foxy caller starts streaming.**

We keep C6 as a planned milestone because (a) it's the cleaner-than-C7 entry point for streaming-through-MOL testing, (b) ncert-solver is a candidate for streaming once its UI catches up, (c) we want to validate the MOL streaming path works for non-structured callers before betting Foxy on it.

**Files (modified):**
- `supabase/functions/grounded-answer/pipeline-stream.ts` — replace `callClaudeStream` with `generateResponseStream` when `caller !== 'foxy'`.

**Files (new):**
- `supabase/functions/grounded-answer/__tests__/pipeline-stream-mol-plain.test.ts`

**Estimated work:** 2 days. Mostly tests + the small code change.

**Feature flag:** `ff_mol_grounded_streaming_plain_v1`. Default OFF. Probably stays OFF until a non-Foxy caller wants streaming.

**Recommended status: SKIP for now.** Mark this phase done by "not applicable until non-Foxy streaming caller exists." Re-open when needed.

---

### C7 — Wire streaming pipeline (structured)

**Goal:** route Foxy streaming traffic through `generateResponseStream` with structured-output enforcement.

**This is the most complex phase by far.** It combines C1 (streaming) and C2 (structured) and runs on the highest-traffic path (Foxy chat).

**Files (modified):**
- `supabase/functions/grounded-answer/pipeline-stream.ts` — when `caller === 'foxy'`, call `generateResponseStream(req)` with the FoxyResponse schema attached; consume normalised `StreamEvent` and yield `PipelineStreamEvent`.
- `supabase/functions/_shared/mol/stream.ts` — extend `generateResponseStream` to accept an optional `StructuredOutputSpec` (matching C2's surface). When present, the stream emits `tool_use_*` events (Anthropic) or text chunks with embedded JSON (OpenAI), normalised to the same `tool_use_*` taxonomy.
- `supabase/functions/grounded-answer/structured-schema.ts` — `parseStreamingFoxy` must handle the new path where intermediate JSON arrives as `tool_use_delta` instead of `text_delta`.

**The hard part: streaming structured output.**

Today's pipeline-stream.ts yields `{kind:'text', delta}` events as Anthropic emits `text_delta` chunks. The frontend renders these deltas as plain markdown immediately, then swaps to the structured renderer once the `done` event arrives with the final `FoxyResponse`. **This UX trick depends on the streamed text being JSON-shaped *and* renderable as markdown** — Foxy's structured prompt produces JSON like `{"title":"Photosynthesis","subject":"science","blocks":[{"type":"paragraph","text":"..."}]}` which, when streamed character-by-character, briefly shows up as ugly JSON in the chat bubble before the parser kicks in.

After C7:
- **Anthropic path:** model emits a `tool_use` content block. The streamed events are `tool_use_start`, then a sequence of `tool_use_delta` carrying partial JSON, then `tool_use_stop`. The UI cannot render partial JSON character-by-character without showing a half-baked `{"title":"Photo` to the student. We'd need a streaming JSON parser that yields strings only when a complete `text` field closes — possible but adds latency.
- **OpenAI path:** strict mode emits the JSON via plain `delta.content` text chunks (no special envelope). The naïve renderer sees the same ugly JSON pre-parse as today.

**Conclusion: tool_use streaming with structured output is fundamentally a worse UX than today's prompt-based plain-text streaming approach.** Today's flow works because the streamed text happens to be JSON that the eventual parser can ingest; the user sees character-by-character output that's visually broken for the first ~200ms but becomes coherent within a few hundred ms.

**Recommendation for C7: ship in two flavours.**
- **C7a:** OpenAI structured streaming uses `response_format` strict mode but emits as text (same UX as today). Works because OpenAI strict mode emits a string, not a tool call.
- **C7b:** Anthropic structured streaming continues to use prompt-based addendum (NOT `tool_use`) so the UX matches today. The "strict mode" guarantee on Anthropic is sacrificed; we keep relying on `wrapAsParagraph` for malformed output.

This compromise is the only way to keep Foxy chat UX consistent across providers. It also means C2's Anthropic strict-mode capability is not used in the streaming path. C2 still has value for C5 (blocking Foxy), where pre-render-then-emit is fine.

**Estimated work:** 5 days. The longest single phase. Includes UX validation.

**Feature flag:** `ff_mol_grounded_streaming_structured_v1`. Same staging as C5.

**Test strategy:**
- Cassette: streamed structured response from both providers; assert downstream `FoxyResponse` after parser run matches expected.
- UX comparison: 30-fixture A/B with screen recordings; CEO + assessment review the streaming UX delta. **Hard gate: no degradation in time-to-first-readable-text.**
- Production replay: 200 streaming sessions replayed; assert `done` event payload structurally identical.

**Rollout:** 3 weeks Stage 1/2/3 staging. Plus a 1-week UX-validation gate before Stage 2.

**Backout:** flag flip → reverts to direct Anthropic streaming + prompt addendum.

---

### C8 — Citation strategy

**Goal:** decide what happens when traffic routes to OpenAI on a path that *would have* used native Anthropic citations.

**Today's reality:** grounded-answer does NOT use Anthropic native citations. Citations are extracted post-hoc by regex from `[N]` markers in plain text. **So C8 is effectively a no-op for current code paths.** OpenAI handles `[N]` references in prompt-conformant output as well as Anthropic does.

**C8 only matters if** we later adopt Anthropic native citations as part of a separate "Foxy moat" workstream (mentioned in the constitution under "Foxy moat plan"). At that point we'd have three options:

1. **Skip citations on OpenAI routes.** Pin any caller that needs native citations to Anthropic. Document the constraint. Cleanest.
2. **Post-hoc extraction on OpenAI.** After the OpenAI response lands, run a second cheap call (Haiku or GPT-4o-mini) that re-reads the answer + chunks and emits citation marker positions. Adds 200-400ms latency and ~₹0.05 cost per call.
3. **Re-route on demand.** If `request.require_native_citations === true`, MOL forces Anthropic regardless of routing matrix.

**Recommendation: option 3** as the policy for any future native-citation work. Adds a single boolean to `GenerateRequest` config. Lets us upgrade native citations on a per-caller basis without re-architecting MOL.

**Estimated work:** 3 days IF we adopt Anthropic native citations. 0 days otherwise. Mark as deferred until that workstream lands.

**Feature flag:** `ff_mol_force_anthropic_citations`. Default ON (any caller that has `require_native_citations: true` forces Anthropic). Acts as belt-and-suspenders.

---

### C9 — Telemetry, SLOs, rollout

**Goal:** wire end-to-end observability for grounded-answer × MOL, define SLOs, and execute the production rollout.

**Files (new):**
- `supabase/migrations/20260601000001_grounded_answer_mol_telemetry.sql` — adds `mol_request_id` foreign key to `grounded_ai_traces` so we can join per-grounded-answer cost.
- `docs/runbooks/mol-grounded-answer-rollout.md` — staging plan + rollback runbook.
- `docs/runbooks/mol-grounded-answer-slos.md` — published SLOs (see below).
- `scripts/mol-grounded-answer-canary.ts` — hourly canary that fires 20 synthetic grounded-answer requests, alerts on SLO breach.

**Files (modified):**
- `supabase/functions/grounded-answer/trace.ts` — accept `mol_request_id` from the MOL-wired path and persist it.
- `supabase/functions/_shared/mol/telemetry.ts` — extend `LogPayload` with `caller_surface: 'grounded-answer' | ...`, `mode: 'strict' | 'soft' | null`, `caller: 'foxy' | 'ncert-solver' | ...`.

**SLOs (post-C9):**

| Metric | Target | Alert threshold |
|---|---|---|
| Foxy grounded-answer p50 latency (blocking) | ≤ 1.8 s | > 2.5 s for 15 min |
| Foxy grounded-answer p95 latency (blocking) | ≤ 4.5 s | > 6.5 s for 15 min |
| Foxy grounded-answer first-token latency (streaming) | ≤ 800 ms | > 1.5 s for 15 min |
| Strict-mode abstain rate | ≤ 12 % | > 18 % for 1 h |
| MOL fallback rate (provider 1 → provider 2) | ≤ 3 % | > 8 % for 1 h |
| OpenAI traffic share post-C9 | 35–50 % | < 25 % for 24 h (suggests routing matrix bug) |
| Cost per grounded-answer call (INR) | ≤ ₹0.06 | > ₹0.09 for 1 h |

**Estimated work:** 3 days. Includes runbook polish and canary tuning.

**Feature flag:** none (telemetry is always on).

**Rollout:** ships incrementally with C3–C7. Final SLO publication after 100% rollout of all phases.

---

## 7. Risk matrix

Probability × Impact (1–5 each). Risks > 12 are red. Risks 8–12 are amber. Below 8 are green.

| # | Risk | Probability | Impact | Score | Mitigation |
|---|---|---|---|---|---|
| R1 | OpenAI strict-mode latency exceeds Anthropic Haiku by > 500 ms p50, kills Foxy chat UX | 3 | 4 | 12 | C5 measures upfront; if breached, pin Foxy structured to Anthropic-only. Plan accommodates this outcome |
| R2 | Streaming translation layer has subtle bugs that leak as missing/duplicated tokens | 4 | 4 | 16 | Cassette tests + 14-day Stage 2 burn-in; hard gate on no-cassette-failures before Stage 3 |
| R3 | Anthropic prompt-caching discount lost on OpenAI routes; cost savings smaller than projected | 5 | 2 | 10 | Already baked into §10 projections. CEO has the honest number |
| R4 | Routing grounding-check to OpenAI changes abstain rate distribution | 2 | 4 | 8 | C3 keeps Anthropic primary; OpenAI only as 5xx fallback. Synthetic canary catches drift |
| R5 | C2 schema-adapter generates an OpenAI-incompatible schema and we don't catch it in dev | 3 | 3 | 9 | Property-based test: 100 random valid FoxyResponse → schema-validate via OpenAI sandbox before any production traffic |
| R6 | OpenAI quotas (TPM, RPM) hit during traffic ramp; fallback rate spikes | 3 | 3 | 9 | Pre-rollout: confirm tier-3 quota (~5M TPM Chat Completions). Implement per-minute MOL-side rate limit |
| R7 | Foxy streaming UX regresses on Anthropic tool_use path (C7) | 4 | 3 | 12 | Recommended in C7: keep Anthropic streaming on prompt-addendum path (NOT tool_use). Mitigation built into plan |
| R8 | grounded-answer cache + MOL cache double-bill | 2 | 2 | 4 | Cache is on grounded-answer side and short-circuits MOL entirely. No double-bill |
| R9 | Existing grounding-check.test.ts coverage doesn't catch MOL adapter regressions | 3 | 3 | 9 | C3 adds parity-replay test against 50 production transcripts |
| R10 | Provider auth-key rotation breaks streaming mid-conversation | 1 | 4 | 4 | Streaming with first-token-fallback contract handles this; document the operational procedure |
| R11 | Telemetry schema change (`mol_request_id` FK) blocks an in-flight grounded-answer trace insert | 2 | 3 | 6 | C9 migration uses `nullable` FK; legacy rows have NULL |
| R12 | CEO approves Option C but discovers mid-rollout that strict-mode citations are actually load-bearing for ncert-solver paywall conversion | 2 | 4 | 8 | Constitution says strict mode is for "must cite chunks" callers. Confirm with assessment + ops before Stage 3 ncert-solver rollout |

---

## 8. What stays Anthropic-only forever

After the C-phase completes, the following surfaces are **structurally Anthropic-only** and should not be migrated:

1. **Strict-mode `runGroundingCheck` verdict path** — even though C3 wires it through MOL, the *routing matrix* keeps it Anthropic-primary because routing the meta-verifier across providers shifts abstain distributions.
2. **Any future Anthropic native citations adoption** (`citations.enabled: true` on document content blocks). OpenAI has no equivalent. If we ever want machine-verified citation extraction, that workstream is Anthropic-only.
3. **The 5-minute prompt-cache discount on warm Foxy conversations.** OpenAI's automatic caching is close but not as deep (50% vs 90% input-token discount). The marginal cost of a multi-turn Foxy conversation is meaningfully lower on cached-Anthropic-Haiku than on warm-OpenAI-gpt-4o-mini.
4. **The Sonnet "reasoning" capability for senior-grade JEE doubt-solving.** MOL routing matrix already keeps `task_type=reasoning` and `task_type=doubt_solving` pass-1 on Sonnet — but it's worth re-stating that this Anthropic-primary stance isn't a routing accident, it's load-bearing.
5. **Vision-capable OCR (scan-ocr).** Out of grounded-answer scope, but for completeness: `task_type=ocr_extraction` stays Anthropic-primary; OpenAI is fallback only.
6. **The C7 streaming-structured-Foxy Anthropic path.** Per C7 recommendation, Anthropic Foxy streaming stays on prompt-addendum-based JSON emission (NOT `tool_use`) so the UX matches today's behaviour.

Document this list in `docs/runbooks/mol-grounded-answer-slos.md` so future architects don't try to "fix" the Anthropic-only routes.

---

## 9. Test strategy

### Per-phase test inventory

| Phase | Unit tests | Cassette tests | Production-replay tests | Live-traffic tests |
|---|---|---|---|---|
| C1 | SSE parser frames → chunks | Real provider streams replayed | n/a | n/a |
| C2 | Schema adapter | tool_use vs response_format | n/a | n/a |
| C3 | Adapter mapping | Anthropic single call | 50 grounding-check transcripts | Synthetic canary |
| C4 | Adapter mapping | Both providers | 200 blocking transcripts | Per-caller staged ramp |
| C5 | Strict-mode adapter | Both providers | 500 Foxy blocking responses | A/B latency comparison |
| C6 | (n/a, deferred) | n/a | n/a | n/a |
| C7 | Stream + structured adapter | Both providers | 200 streaming sessions | UX A/B screen recordings |
| C8 | (n/a, deferred) | n/a | n/a | n/a |
| C9 | Telemetry schema | n/a | n/a | Hourly canary |

### Cassette infrastructure (NEW — does not exist today)

We need a recording mechanism: a `record` flag on the cassette harness that, when set, makes real provider calls and saves request + response pairs to disk; subsequent test runs replay from disk with `replay`.

Implementation:
- `supabase/functions/_shared/mol/__tests__/_cassettes/` directory.
- Cassette files: `{name}.req.json` + `{name}.res.txt` (txt for SSE bodies).
- Harness: `mockFetch(cassetteName)` returns a function compatible with `globalThis.fetch`, returning the recorded response (and asserting the request matches the recorded request).
- Tooling: `deno run --allow-all scripts/record-cassette.ts <test-name>` invokes the real provider once and writes the cassette.

This is ~2 days of work to land at the start of C1. Without it, every streaming test is a flaky mess.

### Test corpora

For production-replay testing we need three corpora, all anonymised:
1. **grounding-check verdicts:** 50 transcripts spanning all 7 abstain reasons + 7 grounded outcomes. Drawn from `grounded_ai_traces` over a 7-day window.
2. **blocking pipeline:** 200 transcripts spanning all 5 callers. Drawn from `grounded_ai_traces` + the original `query` + RAG `chunk_ids`.
3. **Foxy streaming:** 200 sessions. Drawn from `foxy_chat_messages` + the corresponding `grounded_ai_traces` row.

These corpora are PII-scrubbed (using existing `redactPreview`) and stored in `supabase/functions/grounded-answer/__tests__/fixtures/` — checked into git after PR review.

### Continuous validation

After C9 ships, the hourly canary runs:
- 1 Foxy chat fixture, soft mode, streaming
- 1 Foxy chat fixture, soft mode, blocking
- 1 ncert-solver fixture, strict mode, blocking
- 1 quiz-generator fixture, strict mode, blocking
- 1 known-ungrounded fixture (asserts abstain)

Alerts fire on (a) verdict drift, (b) > 2 s p50 latency, (c) provider routing not matching expected.

---

## 10. Cost and latency projections

### Volume baseline (10 k DAU, May 2026 traffic mix)

| Caller × Mode | Daily calls | Avg input tokens | Avg output tokens | Today's daily cost (₹) |
|---|---|---|---|---|
| Foxy chat (soft) blocking | 18 000 | 4 500 | 700 | 24 800 |
| Foxy chat (soft) streaming | 12 000 | 4 500 | 700 | 16 500 |
| ncert-solver (strict) blocking | 6 000 | 6 000 | 1 200 | 13 100 |
| quiz-generator (strict) blocking | 1 500 | 5 500 | 2 000 | 4 200 |
| concept-engine (strict) retrieve_only | 8 000 | n/a | n/a | 0 (no Claude) |
| diagnostic (strict) blocking | 200 | 4 000 | 800 | 480 |
| grounding-check (strict-mode add-on) | 7 700 | 3 500 | 200 | 1 850 |
| **TOTAL** | | | | **₹61 000 / day** |

(Numbers are illustrative based on the routing matrix's task-type cost calculator. Use PostHog `mol_request_logs` + `grounded_ai_traces` once Phase C9 ships for real numbers.)

### Post-C-phase routing (after rollout)

| Caller × Mode | Today's provider | After C-phase | Cost change per call |
|---|---|---|---|
| Foxy chat blocking — soft, eligible task_types | Anthropic Haiku (cached) | OpenAI GPT-4o-mini (auto-cached) | -55% raw, -25% after cache discount |
| Foxy chat blocking — soft, doubt_solving | Anthropic Sonnet → Haiku hybrid | Same (routing matrix unchanged) | 0% |
| Foxy chat streaming — soft | Anthropic Haiku | Mixed: explanation/step_by_step → OpenAI; doubt_solving → Anthropic | -20% blended |
| ncert-solver — strict | Anthropic Haiku | **Anthropic Haiku (unchanged, strict-mode pin)** | 0% |
| quiz-generator — strict | Anthropic Haiku | **Anthropic Haiku (unchanged, strict-mode pin)** | 0% |
| concept-engine — retrieve_only | n/a | n/a | 0% |
| diagnostic — strict | Anthropic Haiku | **Anthropic Haiku (unchanged)** | 0% |
| grounding-check | Anthropic Haiku | **Anthropic Haiku (unchanged, judge-pin)** | 0% |

### Projected savings

Soft-mode Foxy moves to OpenAI for `explanation`, `step_by_step`, `quiz_generation` task types (~60% of Foxy soft-mode traffic; the other 40% — `reasoning`, `doubt_solving` — stay on Anthropic per the routing matrix).

Annualised savings calculation:
- Today's daily Foxy soft cost (blocking + streaming): ₹41 300 / day
- 60% of that traffic (eligible task_types): ₹24 780 / day
- Cost reduction on the eligible slice (after accounting for lost Anthropic cache discount): ~30% net = ₹7 434 / day saved
- Monthly: ₹223 020
- **Annual: ₹26.8 lakh / year at 10 k DAU**

**This is meaningfully less than the original MOL plan's projection** because:
1. Strict-mode callers (ncert-solver, quiz-generator) cannot move per §8.
2. The Anthropic cache discount partially offsets OpenAI's raw price advantage.
3. `doubt_solving` and `reasoning` task_types stay on Anthropic per the routing matrix.

At 100 k DAU (target launch): ~₹2.68 cr / year savings.
At 1 M DAU (out-year): ~₹26.8 cr / year savings.

### Latency projections (best-effort, validate in C5/C7 testing)

| Path | Today p50 | After C-phase p50 |
|---|---|---|
| Foxy blocking (cached) | 1.4 s | 1.5 s (small OpenAI overhead) |
| Foxy blocking (cold) | 2.1 s | 1.9 s (OpenAI faster on cold start) |
| Foxy streaming first-token | 650 ms | 750 ms (OpenAI strict mode adds latency) |
| ncert-solver | 2.3 s | 2.3 s (unchanged) |
| grounding-check | 480 ms | 480 ms (unchanged) |

Caveat: these are estimates. C5 testing produces real numbers and the cost projection above gets re-validated.

---

## 11. Open questions

Questions that the plan cannot answer from code reading alone — to be resolved during C-phase implementation.

1. **Does grounded-answer's `system_prompt_override` pattern (C4) break any caller's prompt-template registry contract?** ncert-solver, quiz-generator, concept-engine each rely on a registered template — but they pass the *template id* to grounded-answer, which resolves it server-side. Adding override changes the contract for grounded-answer but not the callers. Confirm with ops + assessment that the registered-template invariant remains intact.

2. **What's the actual OpenAI tier-3 quota for our org as of 2026-05?** Need to verify TPM + RPM before Stage 2 of C5/C7 rollout. If we're tier-2, we need a quota upgrade conversation with OpenAI before > 30% Foxy traffic hits OpenAI.

3. **Does Anthropic `strict: true` on tool_use have a measurable latency overhead at Haiku?** OpenAI documented 150-300ms; Anthropic published no comparable number. Measure in C2.

4. **Should `task_type: 'grounding_check'` (introduced in C3) bypass `buildSystemPrompt` entirely, or should we add a `system_prompt_override` option that's task-type-agnostic?** Recommend the latter — single mechanism, less special-casing. But raises Q1 about contract.

5. **What's the right cost-allocation policy when MOL fallback fires?** A `gpt-4o-mini` → `haiku-4-5` fallback for `explanation` task type costs the user ~3x more than the routed price. Do we surface this to the trace row? Bill it differently? Today MOL telemetry captures it but no downstream consumer reports on it.

6. **Are there hidden Foxy callers using grounded-answer that we haven't enumerated?** The `VALID_CALLERS` enum is `'foxy', 'ncert-solver', 'quiz-generator', 'concept-engine', 'diagnostic'`. Grep should confirm no others.

7. **Streaming-with-OpenAI through Cloudflare/Vercel edge — any 524 timeout issues on long responses?** Today's Anthropic streaming runs well within the 30 s Edge Function CPU budget. OpenAI strict-mode adds latency; verify p99 stays under timeout.

8. **For C7a vs C7b split — does ops want a dashboard signal showing which provider serves each streamed turn?** Recommend yes; add to `grounded_ai_traces.claude_model` (rename column to `model` in a future migration; for now stuff `openai/gpt-4o-mini` into the existing field).

9. **C8 trigger: when does the "Foxy moat" native-citations workstream actually start?** Constitution mentions it as a Phase 0-5 roadmap; current status unclear. If it lands during the C-phase, C8 needs to ship synchronously.

10. **Does the existing `mol_request_logs` table have a retention policy?** The cost projections assume we can query 30 days back for tuning. Confirm with architect.

---

## 12. Recommended sequencing

Six phases ship as parallel-capable strands:

```
       ┌──────────────────────────────────────────────────────────┐
       │                                                            │
   ────►  C1 (streaming infra) ──┬──► C6 (deferred)                │
                                  │                                 │
                                  └──► C7 (streaming + structured) │
                                                                    │
   ────►  C2 (structured infra) ──┬──► C5 (blocking + structured)  │
                                   │                                 │
                                   └──► C7 (combines with C1) ──────┘
                                                                    │
   ────►  C3 (grounding-check)  ───► production rollout ────────────┤
                                                                    │
   ────►  C4 (blocking plain)   ───► per-caller rollout ────────────┤
                                                                    │
   ────►  C8 (citations) deferred until Anthropic native citations  │
                                                                    │
   ────►  C9 (telemetry + SLO)  ───► shipping in parallel ──────────┘
```

### Parallelisation plan

Three engineers can work in parallel through most of the C-phase:

- **Engineer A (ai-engineer):** C1 (4 days) → C2 (4 days) → C7 (5 days). 13 days of focused work.
- **Engineer B (backend):** C3 (2 days) → C4 (3 days) → C5 (4 days). 9 days.
- **Engineer C (testing):** Cassette infra (2 days, prerequisite to C1) → C9 telemetry (3 days) → production-replay corpora (3 days). 8 days.

Critical path: A's chain at 13 days + 1 week of UX validation gate before C7 Stage 2 = ~3 calendar weeks if all parallel work goes smoothly.

Realistic estimate including design reviews, code review cycles, and per-stage rollout gates: **18–22 working days** of engineering time spread across 5–7 calendar weeks.

### Phase ordering rationale

- **C1 + C2 first** — they're infra-only, no rollout risk, no caller impact. Land them in parallel.
- **C3 second** — smallest payload, smallest blast radius. Validates the MOL × grounded-answer integration end-to-end before bigger phases.
- **C4 third** — non-Foxy blocking. ncert-solver staged last per §12 because it's the highest blast radius.
- **C5 fourth** — Foxy blocking. Depends on C2.
- **C7 fifth** — Foxy streaming. Depends on C1 + C2.
- **C9 fifth in parallel** — telemetry instrumentation can ship piecemeal with each phase.
- **C6, C8 deferred** — not needed for current code paths.

### Stop / no-go criteria

The plan supports stopping at any phase. Recommended stop points where the work has incremental value:

- **Stop after C3.** Validates MOL inside grounded-answer; grounding-check is a meaningful production load. No cost savings.
- **Stop after C4.** Non-Foxy traffic on MOL; ~10% of cost savings realised.
- **Stop after C5.** Foxy blocking on MOL; ~60% of cost savings.
- **Full Option C.** Foxy streaming + structured on MOL; ~100% of cost savings.

**If C5 testing reveals OpenAI latency exceeds Anthropic by > 500 ms p50 (R1 risk fires):** stop after C4. Foxy structured stays on Anthropic. Re-evaluate when OpenAI publishes a faster strict-mode model.

---

## Appendix A — MOL types that need new fields

Full type definitions in `supabase/functions/_shared/mol/types.ts` after C1 + C2:

```ts
// EXISTING (unchanged by this plan)
export type TaskType =
  | 'explanation'
  | 'concept_explanation'
  | 'step_by_step'
  | 'reasoning'
  | 'quiz_generation'
  | 'evaluation'
  | 'doubt_solving'
  | 'ocr_extraction'

// NEW (C3)
export type TaskType = ... | 'grounding_check'

// NEW (C1)
export type NormalizedFinishReason =
  | 'complete'
  | 'max_tokens'
  | 'tool_use'
  | 'content_filter'
  | 'unknown'

export type StreamEvent =
  | { type: 'text_delta'; delta: string }
  | { type: 'tool_use_start'; tool_name: string; index: number }
  | { type: 'tool_use_delta'; partial_json: string; index: number }
  | { type: 'tool_use_stop'; index: number }
  | { type: 'final'; ok: true;
      full_text: string;
      tool_use_payloads?: Array<{ name: string; input: unknown }>;
      tokens: TokenUsage;
      model: string;
      provider: 'openai' | 'anthropic';
      finish_reason: NormalizedFinishReason }
  | { type: 'final'; ok: false;
      reason: 'timeout' | 'auth_error' | 'server_error' | 'unknown';
      partial_text: string;
      tool_use_partial?: string;
      model: string | null;
      provider: 'openai' | 'anthropic' | null }

export interface GenerateStreamRequest extends GenerateRequest {}

// NEW (C2)
export interface StructuredOutputSpec {
  name: string
  schema: object
  strict: boolean
  description?: string
}

export interface GenerateStructuredRequest extends GenerateRequest {
  structured_output: StructuredOutputSpec
}

export interface StructuredMolResult extends MolResult {
  structured_payload: unknown
  raw_text: string
}

// EXISTING extended (C4)
export interface GenerateRequest {
  // ... existing fields ...
  config?: {
    // ... existing fields ...
    system_prompt_override?: string   // NEW — bypass MOL's buildSystemPrompt
  }
}
```

---

## Appendix B — OpenAI vs Anthropic feature-matrix detail

Decision matrix used by `router.ts` extensions in C-phase:

| Feature | Anthropic | OpenAI | Routing implication |
|---|---|---|---|
| One-shot text | Both providers full support | Both full support | Free-routed by matrix |
| Vision (image_url) | sonnet-4-6, opus-* | gpt-4o, gpt-4o-mini | Both routable; matrix prefers Anthropic per § quality |
| Streaming text | All chat models | All chat models | Both routable (C1) |
| Structured output strict-mode | tool_use w/ strict | response_format w/ strict | Both routable (C2). Anthropic adds tool-use system tokens (~340) |
| Streamed structured output | input_json_delta | text deltas (JSON-shaped) | UX differs (§5.3); Anthropic stream needs JSON-aware parser |
| Prompt caching | Explicit `cache_control: ephemeral`, 90% discount, 5 min TTL | Automatic ≥ 1024 tokens, 50% discount, opaque TTL | Cost projection accounts for this |
| Native citations | citations.enabled=true on documents | none | Anthropic-only forever |
| Native tool_use | server tools + client tools | function calling + tool calls | Both, but APIs differ |
| Max context | 200k tokens (Sonnet/Opus), 200k (Haiku 4.5) | 128k tokens (gpt-4o, gpt-4o-mini) | grounded-answer prompts max ~10k; not a constraint |
| Per-request strict-mode latency overhead | ~150 ms? (not published) | 150–300 ms (Aug-24 docs) | C5 validates |
| Stop sequences | Yes | Yes | Both |
| Response language preservation | Excellent for Hi/Hinglish | Good for Hi/Hinglish | Both work for P7 |
| API version pinning | `anthropic-version` header (we use `2023-06-01`) | API version implicit in model name | Anthropic more stable |
| Error taxonomy | typed errors w/ `error.type` | typed errors w/ `error.code` and `error.type` | Both surfaced in MOL `failure_chain` |
| Rate limit headers | `anthropic-ratelimit-*` | `x-ratelimit-*` | Both visible; we'll surface in MOL telemetry in a future phase |

---

## Appendix C — Failure modes catalog

The C-phase introduces new failure modes. Catalog for ops + testing reference:

| Failure | Detection | Recovery |
|---|---|---|
| OpenAI 429 (rate limit) on Foxy traffic | `mol_request_logs.failure_chain` contains `openai:429` | MOL falls through to Anthropic per chain. Alert if rate > 5%/15 min |
| OpenAI strict-mode schema rejection | response has `refusal` field | MOL falls back to next provider; logged as `openai:refusal` |
| Anthropic 529 (overloaded) | failure_chain contains `anthropic:529` | MOL falls through to next provider |
| Streamed JSON truncated by max_tokens | `final.finish_reason === 'max_tokens'` | `rescueFromTruncatedJson` → `wrapAsParagraph` (unchanged from today) |
| First-token timeout (> 5 s) on stream | `withStreamTimeout` aborts | C1 first-token-fallback contract retries on next model |
| Mid-stream connection drop | Stream generator's reader throws | `final.ok=false, reason='unknown', partial_text` — UI shows partial answer + error toast |
| Both providers unconfigured | `executePass` throws `NO_PROVIDER_AVAILABLE` | grounded-answer's pipeline catches → `abstain(upstream_error)` |
| MOL → telemetry insert fails | `recordMolRequest` logs warn | request continues; cost data lost for that call |
| `system_prompt_override` exceeds 200 k tokens | provider returns 400 | `failure_chain` records `openai:400` or `anthropic:400`; grounded-answer abstain |
| OpenAI cache miss on warm prefix | no detection signal — invisible | Higher cost than projected; surfaces in §10 monitoring |

---

## Appendix D — Migration of existing tests

`supabase/functions/grounded-answer/__tests__/` contains 14 test files. Each phase adds new tests; here's what stays unchanged vs evolves:

| Existing test | C-phase impact |
|---|---|
| `validation.test.ts` | Unchanged |
| `coverage.test.ts` | Unchanged |
| `embedding.test.ts` | Unchanged |
| `retrieval.test.ts` | Unchanged |
| `claude.test.ts` | Modified in C3/C4: split into `claude-legacy.test.ts` (current behaviour) + `claude-mol.test.ts` (MOL-wired path); both pass during transition |
| `grounding-check.test.ts` | Modified in C3: add MOL-path parallel cases; legacy path remains tested |
| `confidence.test.ts` | Unchanged |
| `citations.test.ts` | Unchanged (citations.ts itself unchanged) |
| `trace.test.ts` | Modified in C9: add `mol_request_id` assertions |
| `circuit.test.ts` | Unchanged (grounded-answer circuit independent of MOL circuit) |
| `cache.test.ts` | Unchanged (cache lives in front of MOL) |
| `pipeline.test.ts` | Modified in C4: add MOL-wired blocking cases |
| `e2e.test.ts` | Modified in C7: add MOL-wired streaming cases |
| `wrap-as-paragraph.test.ts` | Unchanged |

Estimated test additions across phases: ~30 new test files, ~250 new test cases, ~3 days of test-writing effort across C-phases (distributed inline with phase work, not a separate phase).

---

## Final notes

This plan is intentionally not optimistic. The total wall-time estimate (18–22 working days, 5–7 calendar weeks) reflects realistic design iterations + per-stage rollout gates + UX validation. The projected savings (₹2.0–2.8 lakh / month at 10 k DAU) reflect honest assessment of which paths can actually move providers, not the theoretical maximum if everything ran on OpenAI.

Three explicit stop-criteria are baked in (after C3, C4, or C5) so the work can be paused at any natural seam if priorities shift. If C5 latency testing reveals OpenAI strict-mode is too slow, Foxy structured stays Anthropic-only and we still get ~60% of the projected savings from C4 + the unstructured slice of C5.

Recommended next step: CEO accept on §6 phase definitions + §10 honest cost projection. Once accepted, ai-engineer starts C1 and backend starts C3 in parallel. C-phase scoreboard tracked in `docs/runbooks/mol-grounded-answer-rollout.md` (created in C9 but stubbed at kick-off).
