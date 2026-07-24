/**
 * Model Gateway — Orchestrator (Phase 1)
 *
 * `callModel(req, opts)` is the single entry point. It:
 *   1. Resolves the effective policy (flag-gated — see below).
 *   2. Builds the ordered candidate chain via the router.
 *   3. Tries each model's adapter in order, advancing on failure, stopping on a
 *      fail-fast error (auth) or the first success.
 *   4. Emits uniform per-attempt + per-call telemetry.
 *   5. Returns the first success, or a structured all-failed result.
 *
 * FLAG GATE (ff_model_gateway_v1, default OFF): the NON-default policies are
 * gated. When the flag is OFF, ANY requested policy is forced to `default`, so
 * callModel behaves identically to the legacy Anthropic-primary chain
 * regardless of what the caller asked for. `default` is always available (it IS
 * the legacy path) and never touches the flag system.
 *
 * Zero behavior change by default: with policy `default` and no constraints the
 * chain is byte-for-byte the legacy grounded-answer `auto` order, invoked
 * through the same unified clients (breaker/retry preserved).
 *
 * Owner: ai-engineer. Assessment reviews any change that could move a live path
 * off Claude-primary; user approval required to change a live model/provider.
 */

import { isFeatureEnabled } from '@alfanumrik/lib/feature-flags';
import { MODEL_GATEWAY_FLAGS } from '@alfanumrik/lib/flags/registries/foxy';
import type {
  AdapterMap,
  GatewayAttempt,
  GatewayRequest,
  GatewayResult,
  ProviderAdapter,
  RoutingConstraints,
  RoutingPolicy,
} from './types';
import { selectModelChain } from './router';
import { estimateCostUsd, getModel } from './registry';
import { anthropicAdapter } from './adapters/anthropic';
import { openaiAdapter } from './adapters/openai';
import { geminiAdapter } from './adapters/gemini';
import { emitGatewayAttempt, emitGatewaySummary } from './telemetry';

/** The flag gating non-default routing (registry constant — single source, ops-owned). */
export const GATEWAY_FLAG = MODEL_GATEWAY_FLAGS.V1;

/** Default provider→adapter wiring. Overridable via opts.adapters for tests. */
const DEFAULT_ADAPTERS: AdapterMap = {
  anthropic: anthropicAdapter,
  openai: openaiAdapter,
  gemini: geminiAdapter,
};

export interface CallModelOptions {
  /** Requested routing policy. Defaults to `default` (legacy chain). */
  policy?: RoutingPolicy;
  /** Hard eligibility constraints applied before the policy sort. */
  constraints?: RoutingConstraints;
  /**
   * Optional flag-evaluation context (role/env/institution/userId) forwarded to
   * isFeatureEnabled. Model routing carries NO PII; this is scoping only.
   */
  flagContext?: Parameters<typeof isFeatureEnabled>[1];
  /** Adapter override for unit tests. Falls back to DEFAULT_ADAPTERS per provider. */
  adapters?: AdapterMap;
}

/**
 * Provider-agnostic model call with policy-based routing + fallback.
 *
 * Never throws — returns `{ ok: false, error }` when every candidate fails, so
 * callers branch on `result.ok` (mirrors grounded-answer's never-throw client).
 */
export async function callModel(
  req: GatewayRequest,
  opts: CallModelOptions = {},
): Promise<GatewayResult> {
  const requested: RoutingPolicy = opts.policy ?? 'default';

  // Flag gate: non-default policies require ff_model_gateway_v1. OFF → force
  // `default` so behavior is identical to the legacy Anthropic-primary chain.
  let effectivePolicy: RoutingPolicy = requested;
  if (requested !== 'default') {
    const enabled = await isFeatureEnabled(GATEWAY_FLAG, opts.flagContext ?? {});
    if (!enabled) effectivePolicy = 'default';
  }

  const chain = selectModelChain(effectivePolicy, opts.constraints ?? {});
  const adapters = opts.adapters ?? {};

  const attempts: GatewayAttempt[] = [];
  let lastError = 'No configured model matched the routing policy/constraints';

  for (const descriptor of chain) {
    const adapter: ProviderAdapter | undefined = adapters[descriptor.provider] ?? DEFAULT_ADAPTERS[descriptor.provider];
    if (!adapter) {
      lastError = `No adapter registered for provider "${descriptor.provider}"`;
      continue;
    }

    const fallbackCount = attempts.length;
    let outcome;
    try {
      outcome = await adapter.invoke(descriptor, req);
    } catch (err) {
      // Defensive: a well-behaved adapter returns AdapterOutcome, but a stub
      // (Gemini) or an unexpected throw is normalized here to a non-fail-fast
      // error so the chain still advances.
      outcome = {
        kind: 'error' as const,
        failFast: false,
        error: err instanceof Error ? err.message : String(err),
        latencyMs: 0,
      };
    }

    if (outcome.kind === 'ok') {
      const cost = estimateCostUsd(descriptor, outcome.inputTokens, outcome.outputTokens);
      attempts.push({ modelId: descriptor.id, provider: descriptor.provider, success: true, latencyMs: outcome.latencyMs });
      emitGatewayAttempt({
        modelId: descriptor.id,
        provider: descriptor.provider,
        policy: effectivePolicy,
        inputTokens: outcome.inputTokens,
        outputTokens: outcome.outputTokens,
        estimatedCostUsd: cost,
        latencyMs: outcome.latencyMs,
        fallbackCount,
        success: true,
      });
      emitGatewaySummary({
        policy: effectivePolicy,
        success: true,
        modelId: descriptor.id,
        provider: descriptor.provider,
        fallbackCount,
        latencyMs: outcome.latencyMs,
        estimatedCostUsd: cost,
        attemptCount: attempts.length,
      });
      return {
        ok: true,
        content: outcome.content,
        modelId: outcome.model || descriptor.id,
        provider: descriptor.provider,
        inputTokens: outcome.inputTokens,
        outputTokens: outcome.outputTokens,
        latencyMs: outcome.latencyMs,
        fallbackCount,
        policy: effectivePolicy,
        attempts,
        estimatedCostUsd: cost,
      };
    }

    // Failure path.
    attempts.push({
      modelId: descriptor.id,
      provider: descriptor.provider,
      success: false,
      latencyMs: outcome.latencyMs,
      error: outcome.error,
    });
    lastError = outcome.error;
    emitGatewayAttempt({
      modelId: descriptor.id,
      provider: descriptor.provider,
      policy: effectivePolicy,
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostUsd: 0,
      latencyMs: outcome.latencyMs,
      fallbackCount,
      success: false,
    });

    if (outcome.failFast) break; // auth error — a different model won't help
  }

  // All candidates failed.
  emitGatewaySummary({
    policy: effectivePolicy,
    success: false,
    modelId: '',
    provider: 'none',
    fallbackCount: attempts.length,
    latencyMs: attempts.reduce((s, a) => s + a.latencyMs, 0),
    estimatedCostUsd: 0,
    attemptCount: attempts.length,
  });

  return {
    ok: false,
    content: '',
    modelId: '',
    provider: 'none',
    inputTokens: 0,
    outputTokens: 0,
    latencyMs: attempts.reduce((s, a) => s + a.latencyMs, 0),
    fallbackCount: attempts.length,
    policy: effectivePolicy,
    attempts,
    estimatedCostUsd: 0,
    error: lastError,
  };
}

// Re-export so callers can reference the exact model set the gateway resolves.
export { getModel };
