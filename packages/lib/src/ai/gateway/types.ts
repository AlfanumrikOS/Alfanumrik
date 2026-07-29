/**
 * Model Gateway — Core Types (Phase 1)
 *
 * Provider-agnostic vocabulary for describing, selecting, and invoking LLMs.
 * Pure type definitions + a couple of small error classes — NO provider
 * imports, NO fetch, NO side effects. This is the contract the registry,
 * router, adapters, and gateway all speak.
 *
 * Design goal: consolidate the four hardcoded model-call sites (config.ts,
 * clients/claude.ts, clients/openai.ts, grounded-answer/claude.ts) onto ONE
 * catalog + ONE routing decision, WITHOUT changing any live behavior by
 * default. See docs/superpowers/specs/2026-07-24-model-gateway-design.md.
 *
 * Owner: ai-engineer.
 */

// ─── Providers & Tiers ──────────────────────────────────────────────────────

/** Upstream LLM provider. `gemini` is a DORMANT seam (no key wired in Phase 1). */
export type ProviderId = 'anthropic' | 'openai' | 'gemini';

/** Coarse capability class. `small` = fast/cheap, `large` = high-quality/slow. */
export type ModelTier = 'small' | 'large';

/**
 * Routing policy. `default` is special: it MUST reproduce the legacy fallback
 * chain byte-for-byte (Anthropic-primary), and is the ONLY policy available
 * when `ff_model_gateway_v1` is OFF. All other policies are gated behind the
 * flag and degrade to `default` when it is off.
 */
export type RoutingPolicy = 'cost' | 'latency' | 'quality' | 'balanced' | 'default';

// ─── Model Descriptor ───────────────────────────────────────────────────────

export interface ModelCapabilities {
  /** Native JSON / structured-output mode. */
  json: boolean;
  /** Image/vision input. */
  vision: boolean;
  /** Server-Sent-Events token streaming. */
  streaming: boolean;
  /** Tool / function calling. */
  tools: boolean;
}

/**
 * A single entry in the model catalog. One descriptor per concrete model id.
 *
 * Cost/latency/quality numbers are ROUTING ESTIMATES only (approximate public
 * pricing / observed latency). They are used to rank candidates, never billed
 * against — see registry.ts for the sourcing note.
 */
export interface ModelDescriptor {
  /** Concrete provider model id, e.g. `claude-haiku-4-5-20251001`. */
  id: string;
  provider: ProviderId;
  /** Human family label, e.g. `claude-haiku`, `gpt-4o`, `gemini-1.5`. */
  family: string;
  tier: ModelTier;
  /** Max context window in tokens (capability, not a per-request cap). */
  contextWindow: number;
  /** Max output tokens the model can emit (capability). */
  maxOutput: number;
  /** Estimated USD cost per 1,000,000 input tokens (routing estimate only). */
  inputCostPer1M: number;
  /** Estimated USD cost per 1,000,000 output tokens (routing estimate only). */
  outputCostPer1M: number;
  /** Estimated p50 end-to-end latency in ms (routing estimate only). */
  p50LatencyMs: number;
  capabilities: ModelCapabilities;
  /**
   * Relative answer quality; HIGHER is better. Used by the `quality` policy.
   *
   * ⚠️ SCOPE: this encodes RAW model capability only — NOT Claude-prompt
   * calibration fit. Foxy/tutoring's system prompts, JSON output contract, and
   * CBSE pedagogy decision tree are all calibrated for Claude. A model can have
   * a high qualityTier and still regress those flows because it was never
   * prompt-tuned for them. Therefore any future activation of the `quality`
   * routing policy on a Foxy/tutoring path (it would reorder by this number and
   * could put a non-Claude model first) MUST be reviewed by assessment against
   * that Claude calibration before it ships. `default` remains Anthropic-primary.
   */
  qualityTier: number;
  /**
   * True when the provider is wired (API key expected in env) and the model may
   * be selected. The router NEVER returns a `configured:false` model. Gemini
   * entries are `false` in Phase 1 (dormant seam).
   */
  configured: boolean;
}

// ─── Routing ────────────────────────────────────────────────────────────────

/**
 * Hard requirements a candidate model MUST satisfy to be eligible. Applied as a
 * FILTER before the policy sort. Absent fields impose no constraint.
 */
export interface RoutingConstraints {
  /** Require native JSON mode. */
  needsJson?: boolean;
  /** Require vision input. */
  needsVision?: boolean;
  /** Drop models whose qualityTier is below this floor. */
  minQualityTier?: number;
  /** Drop models whose input cost exceeds this ceiling (USD / 1M tokens). */
  maxInputCostPer1M?: number;
}

// ─── Gateway Request / Result ───────────────────────────────────────────────

export interface GatewayMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Provider-agnostic generation request. Deliberately a strict subset of what
 * both the Claude and OpenAI clients accept, so an adapter can map it onto
 * either without loss. Streaming/tools are Phase-2 extensions.
 */
export interface GatewayRequest {
  systemPrompt: string;
  messages: GatewayMessage[];
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  /** Request strict JSON output where the provider supports it. */
  jsonMode?: boolean;
}

/**
 * Uniform outcome of ONE adapter invocation. Adapters return this instead of
 * throwing (the gateway also defensively try/catches, so a thrown error becomes
 * a `kind:'error'` attempt).
 */
export type AdapterOutcome =
  | {
      kind: 'ok';
      content: string;
      /** Model id the provider reports having served. */
      model: string;
      inputTokens: number;
      outputTokens: number;
      latencyMs: number;
    }
  | {
      kind: 'error';
      /**
       * When true, the whole chain aborts (e.g. auth 401/403 — a different
       * model with the same key won't fix it). Mirrors the legacy
       * fail-fast-on-auth policy in both claude.ts clients.
       */
      failFast: boolean;
      error: string;
      latencyMs: number;
    };

/** One attempt in the fallback chain, recorded for telemetry + diagnostics. */
export interface GatewayAttempt {
  modelId: string;
  provider: ProviderId;
  success: boolean;
  latencyMs: number;
  error?: string;
}

export interface GatewayResult {
  ok: boolean;
  content: string;
  /** Model id that actually answered (empty string when all failed). */
  modelId: string;
  provider: ProviderId | 'none';
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  /** Number of failed attempts BEFORE the success (0 = first model answered). */
  fallbackCount: number;
  /** Effective policy after flag gating (may differ from the requested one). */
  policy: RoutingPolicy;
  attempts: GatewayAttempt[];
  /** Routing-estimate cost of the SUCCESSFUL call (USD). 0 when all failed. */
  estimatedCostUsd: number;
  /** Populated only when `ok` is false. */
  error?: string;
}

// ─── Adapter Interface ──────────────────────────────────────────────────────

/**
 * A provider adapter maps a `GatewayRequest` onto ONE concrete model call.
 *
 * INVARIANT (ai-boundary / P12): adapters MUST delegate to the existing unified
 * clients (`callClaude` / `callOpenAI`) so the circuit breaker, retry/backoff,
 * timeout, and PII posture are preserved. Adapters MUST NOT fetch providers
 * directly (enforced by the `alfanumrik/no-direct-ai-calls` ESLint rule).
 */
export interface ProviderAdapter {
  provider: ProviderId;
  /** Invoke ONE model for one request. Should not throw, but the gateway is defensive. */
  invoke(descriptor: ModelDescriptor, req: GatewayRequest): Promise<AdapterOutcome>;
  /** Optional streaming seam (Phase 2). Absent = adapter is blocking-only. */
  stream?: (descriptor: ModelDescriptor, req: GatewayRequest) => AsyncGenerator<string, AdapterOutcome, unknown>;
}

/** Map of provider → adapter. Injectable so callModel is unit-testable. */
export type AdapterMap = Partial<Record<ProviderId, ProviderAdapter>>;

// ─── Errors ─────────────────────────────────────────────────────────────────

/**
 * Thrown by a provider adapter when the provider has no credentials/config.
 * Used by the Gemini stub in Phase 1 (dormant seam). The gateway treats this as
 * a non-fail-fast error and advances to the next model in the chain.
 */
export class ProviderNotConfiguredError extends Error {
  readonly provider: ProviderId;
  constructor(provider: ProviderId) {
    super(`Provider "${provider}" is not configured (missing API key/config)`);
    this.name = 'ProviderNotConfiguredError';
    this.provider = provider;
  }
}
