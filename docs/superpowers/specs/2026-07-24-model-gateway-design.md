# Model Gateway — Phase 1 Low-Level Design

**Date:** 2026-07-24
**Owner:** ai-engineer
**Status:** Phase 1 implemented (purely additive, flag-gated, default OFF)
**Reviewers:** assessment (curriculum/model-scope), architect (flag seed + infra), ops (flag registry), testing (parity + routing tests)

---

## 1. Problem

The Alfanumrik AI layer hardcodes model ids and fallback ordering in **four**
independent sites, with **two contradictory orderings** and **single-provider
lock-in** baked into config:

| Site | What it hardcodes |
|---|---|
| `packages/lib/src/ai/config.ts` | HAIKU/SONNET model names + request defaults |
| `packages/lib/src/ai/clients/claude.ts` | Haiku→Sonnet fallback (Anthropic only) |
| `packages/lib/src/ai/clients/openai.ts` | `gpt-4o-mini` / `gpt-4o` ids; throws (no chain) |
| `supabase/functions/grounded-answer/claude.ts` | `resolveModelOrder`: haiku/sonnet/auto across BOTH providers |

Two orderings coexist and can silently drift:
- **Next.js `callClaude`**: Haiku → Sonnet (Anthropic only; OpenAI reachable only
  via the separate reasoning-cascade).
- **Edge `resolveModelOrder`**: haiku→[Haiku, gpt-4o-mini], sonnet→[Sonnet,
  gpt-4o], auto→[Haiku, Sonnet, gpt-4o-mini, gpt-4o] (Anthropic-primary).

Consequences: no single place to (a) add a provider, (b) express a cost/latency/
quality routing preference, (c) attribute spend uniformly, or (d) guarantee the
two hosts agree on ordering.

**Constraint:** the `alfanumrik/no-direct-ai-calls` ESLint rule restricts raw
provider calls to `grounded-answer`. The gateway therefore **wraps the existing
`callClaude`/`callOpenAI` clients** — it never fetches providers directly — so
the circuit breaker, retry/backoff, timeout, and PII posture are preserved.

---

## 2. Goals / Non-goals

**Goals (Phase 1):**
- One registry (catalog) of every model, the single source of model ids.
- One routing decision (`selectModelChain`) with named policies.
- A provider-agnostic `callModel` with adapter-based fallback + uniform telemetry.
- A dormant third-provider seam (Gemini) that compiles but is never selected.
- Edge/Node ordering parity via a shared constant.
- **Zero behavior change by default.** `default` policy == today's chain, and the
  flag is OFF, so nothing changes until an operator opts in.

**Non-goals (Phase 1):** streaming through the gateway (seam only), tool-calling
through the gateway, wiring Gemini, moving any student-facing generation path,
changing quiz/XP/scoring/P1–P6.

---

## 3. Registry schema

`packages/lib/src/ai/gateway/registry.ts` — one `ModelDescriptor` per model:

```
ModelDescriptor {
  id, provider('anthropic'|'openai'|'gemini'), family, tier('small'|'large'),
  contextWindow, maxOutput,
  inputCostPer1M, outputCostPer1M,      // ROUTING ESTIMATES ONLY
  p50LatencyMs,                          // ROUTING ESTIMATE ONLY
  capabilities { json, vision, streaming, tools },
  qualityTier (number, higher=better),
  configured (boolean)                   // router NEVER returns configured:false
}
```

Catalog (Phase 1):

| id | provider | tier | in$/1M | out$/1M | p50ms | qual | configured |
|---|---|---|---|---|---|---|---|
| `claude-haiku-4-5-20251001` | anthropic | small | 1.0 | 5.0 | 800 | 6 | ✅ |
| `claude-sonnet-4-20250514` | anthropic | large | 3.0 | 15.0 | 1500 | 9 | ✅ |
| `gpt-4o-mini` | openai | small | 0.15 | 0.6 | 700 | 5 | ✅ |
| `gpt-4o` | openai | large | 2.5 | 10.0 | 1200 | 8 | ✅ |
| `gemini-1.5-flash` | gemini | small | 0.075 | 0.3 | 600 | 5 | ❌ dormant |
| `gemini-1.5-pro` | gemini | large | 1.25 | 5.0 | 1400 | 8 | ❌ dormant |

> Cost/latency/quality are approximate public figures used only to RANK
> candidates. They are never billed and need not be exact. Model ids are the one
> load-bearing fact; `config.ts` now derives HAIKU/SONNET names from these id
> constants (single source of truth).

`LEGACY_FALLBACK_ORDER` reproduces `resolveModelOrder` exactly:
- `haiku` → [Haiku, gpt-4o-mini]
- `sonnet` → [Sonnet, gpt-4o]
- `auto` → [Haiku, Sonnet, gpt-4o-mini, gpt-4o]

Accessors: `getModel(id)`, `listModels({configuredOnly=true})`, `legacyChain(pref)`,
`estimateCostUsd(desc,in,out)`, `blendedCostPer1M(desc)`.

---

## 4. Routing algorithm + policy table

`selectModelChain(policy, constraints)` is **pure** (no I/O, no flag reads).

1. **Constraint filter** (drop ineligible models): `needsJson`, `needsVision`,
   `minQualityTier`, `maxInputCostPer1M`.
2. **Never** include a `configured:false` model.
3. **Policy sort** (ties break by catalog/declaration order, deterministic):

| Policy | Semantics |
|---|---|
| `default` | Legacy `auto` chain (Haiku→Sonnet→gpt-4o-mini→gpt-4o). Constraints **filter** but never **reorder** ⇒ unconstrained `default` is byte-for-byte the legacy path. |
| `cost` | Ascending `inputCostPer1M + outputCostPer1M`. |
| `latency` | Ascending `p50LatencyMs`. |
| `quality` | Descending `qualityTier`. |
| `balanced` | Descending weighted score (below). |

**Balanced score** — min-max normalized over the candidate set (higher = better);
a zero-width axis contributes neutral `1`:
```
quality term  = norm(qualityTier)                 (higher better)
cost term     = 1 - norm(inputCost+outputCost)    (lower  better)
latency term  = 1 - norm(p50LatencyMs)            (lower  better)
score = 0.5*quality + 0.3*cost + 0.2*latency      (quality-leaning by design)
```

---

## 5. Adapter interface

```
ProviderAdapter {
  provider
  invoke(descriptor, req): Promise<AdapterOutcome>   // ok | error{failFast}
  stream?(...)                                        // Phase 2 seam
}
```

`AdapterOutcome` is a uniform union (`kind:'ok'` with content/tokens/latency, or
`kind:'error'` with `failFast` + message). Adapters return outcomes; the gateway
also try/catches defensively so a thrown error becomes a non-fail-fast attempt.

- **anthropic** (`adapters/anthropic.ts`): delegates to `callClaude`, pinning
  `model: descriptor.id` so the gateway owns cross-model ordering while the
  client's per-model retry/backoff + module circuit breaker still fire. Auth
  (401/403) → `failFast`.
- **openai** (`adapters/openai.ts`): delegates to `callOpenAI` (which throws on
  any failure — its cascade contract) and translates the throw. Auth → `failFast`;
  **missing key is NOT fail-fast** (provider simply unavailable → advance).
- **gemini** (`adapters/gemini.ts`): stub that throws `ProviderNotConfiguredError`
  unless `GEMINI_API_KEY` is set (it isn't in Phase 1). Unreachable on every live
  path because both Gemini descriptors are `configured:false`.

`callModel(req, { policy, constraints, flagContext, adapters })` — the `adapters`
override makes the orchestrator unit-testable with fakes; the router is pure.

---

## 6. ProviderNotConfigured seam (Gemini)

Adding Gemini later is a 3-step, additive change:
1. Flip the two Gemini `configured` flags to `true` in `registry.ts`.
2. Set `GEMINI_API_KEY`.
3. Implement `geminiAdapter.invoke` against a new unified `clients/gemini.ts`
   (delegating, **not** a raw fetch — same ai-boundary rule).

Until then the router never returns Gemini and the stub throws. This proves the
seam without any live surface area.

---

## 7. Telemetry / cost model

`telemetry.ts` reuses the **existing** sinks — no new sink is invented:
- `emitGatewayAttempt` → structured `logger.info('ai_model_gateway_attempt', …)`
  per attempt (cheap, no DB).
- `emitGatewaySummary` → `logOpsEvent({ category:'ai', source:'gateway.ts' })` per
  call (the same `'ai'` ops channel `clients/claude.ts` already writes to).

Uniform fields: `{ modelId, provider, policy, inputTokens, outputTokens,
estimatedCostUsd, latencyMs, fallbackCount, success }`.

**Cost** = `inputTokens/1e6 * inputCostPer1M + outputTokens/1e6 * outputCostPer1M`
(routing estimate; OpenAI client returns total tokens only, surfaced as input).

**P13:** metadata only — never prompts, messages, student ids, or PII.
`logOpsEvent` additionally redacts its context before insert.

---

## 8. Flag / rollout

Flag `ff_model_gateway_v1` — **default OFF** (registry entry owned by ops, seed
migration owned by architect). Gating rule inside `callModel`:

- `policy === 'default'` → always available; never reads the flag; == legacy path.
- `policy !== 'default'` → requires the flag ON; when OFF, **forced to `default`**,
  so `callModel` is identical to the legacy Anthropic-primary chain regardless of
  the requested policy.

Rollout ladder:
1. **Phase 1 (now):** flag OFF. Only new consumer is the LLM **intent classifier**
   `classifyWithLLM` (`workflows/foxy-router.ts`) — non-student-facing, non-grading.
   When ON it routes through `callModel({policy:'default'})`; when OFF it uses
   today's direct `callClaude`. Either way the throw-on-failure contract holds
   (`classifyIntent` catches → mode-default fallback).
2. **Later:** enable non-default policies on internal/eval paths behind the flag.
3. **Later (user approval, P12):** move student-facing generation onto policy-based
   routing. Any change to a live model/provider needs user approval per the
   constitution.

Grounded Foxy generation, quiz scoring, XP, and all P1–P6 logic are **untouched**.

---

## 9. Edge parity

Deno cannot import `packages/lib`. Chosen approach (least invasive):
`grounded-answer/config.ts` gains `MODEL_FALLBACK_ORDER`, the Deno-side mirror of
the TS registry's `LEGACY_FALLBACK_ORDER`. `resolveModelOrder` now **reads** that
constant instead of inlining targets (mapping unchanged, ordering byte-identical),
and the duplicate model-id constants were removed from `grounded-answer/claude.ts`
so no third copy can drift. A parity test (testing agent) asserts the Deno mirror
equals the TS `LEGACY_FALLBACK_ORDER` byte-for-byte.

---

## 10. Test plan (for the testing agent)

Code is written for testability (pure router, injectable `adapters`, pure cost/
registry helpers). Suggested cases:

- **Router**
  - `default` (no constraints) == `[Haiku, Sonnet, gpt-4o-mini, gpt-4o]`.
  - `cost` ascending, `latency` ascending, `quality` descending orderings.
  - `balanced` deterministic order + documented weighting.
  - Constraints filter (`needsJson`/`needsVision`/`minQualityTier`/`maxInputCostPer1M`).
  - **Invariant:** no policy/constraint ever returns a `configured:false` (Gemini) model.
- **Registry**: `getModel`, `listModels({configuredOnly})`, `estimateCostUsd`,
  `LEGACY_FALLBACK_ORDER` shape.
- **Gateway (fake adapters)**
  - Success on first model → `fallbackCount:0`.
  - Advance on transient error → success on later model → correct `fallbackCount`.
  - `failFast` (auth) short-circuits the chain.
  - All-fail → `{ ok:false, error }`, never throws.
  - Flag OFF + non-default policy requested → forced to `default` chain.
- **Parity**: `MODEL_FALLBACK_ORDER` (Deno) === `LEGACY_FALLBACK_ORDER` (TS).
- **Config**: `getAIConfig().primaryModel.name` / `fallbackModel.name` unchanged
  (byte-identical to pre-registry values).
- **Consumer**: `classifyWithLLM` flag ON routes via gateway, flag OFF via
  `callClaude`; both preserve the throw→mode-default fallback.
```
