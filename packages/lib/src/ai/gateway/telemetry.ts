/**
 * Model Gateway — Telemetry (Phase 1)
 *
 * Uniform, provider-agnostic emit for every gateway attempt + a per-call
 * summary. Reuses the EXISTING sinks — the structured `logger` (per attempt,
 * cheap, no DB) and `logOpsEvent` category `'ai'` (per call, the same channel
 * clients/claude.ts already writes to). No new sink is introduced.
 *
 * P13: model metadata ONLY. Never emits prompts, messages, student ids, or any
 * PII — just {modelId, provider, policy, tokens, cost, latency, fallbackCount,
 * success}. logOpsEvent additionally redacts its context before insert.
 *
 * Owner: ai-engineer.
 */

import { logger } from '@alfanumrik/lib/logger';
import { logOpsEvent } from '@alfanumrik/lib/ops-events';
import type { ProviderId, RoutingPolicy } from './types';

/** The uniform per-attempt telemetry shape. Metadata only — no PII (P13). */
export interface GatewayTelemetry {
  modelId: string;
  provider: ProviderId;
  policy: RoutingPolicy;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  latencyMs: number;
  /** How many models failed before this attempt (0 = first tried). */
  fallbackCount: number;
  success: boolean;
}

/**
 * Emit one attempt to the structured logger. Cheap (no DB), safe to call for
 * every model tried in a chain.
 */
export function emitGatewayAttempt(t: GatewayTelemetry): void {
  logger.info('ai_model_gateway_attempt', {
    modelId: t.modelId,
    provider: t.provider,
    policy: t.policy,
    inputTokens: t.inputTokens,
    outputTokens: t.outputTokens,
    estimatedCostUsd: Number(t.estimatedCostUsd.toFixed(6)),
    latencyMs: t.latencyMs,
    fallbackCount: t.fallbackCount,
    success: t.success,
  });
}

/**
 * Emit the per-call summary to the ops-events `'ai'` channel (the same sink
 * clients/claude.ts uses). Fire-and-forget for info; awaited by logOpsEvent for
 * error severity. Called once per callModel with the terminal outcome.
 */
export function emitGatewaySummary(params: {
  policy: RoutingPolicy;
  success: boolean;
  modelId: string;
  provider: ProviderId | 'none';
  fallbackCount: number;
  latencyMs: number;
  estimatedCostUsd: number;
  attemptCount: number;
}): void {
  void logOpsEvent({
    category: 'ai',
    source: 'gateway.ts',
    severity: params.success ? 'info' : 'error',
    message: params.success
      ? `Model gateway call succeeded (${params.modelId}, policy=${params.policy})`
      : `Model gateway call failed — all models exhausted (policy=${params.policy})`,
    context: {
      policy: params.policy,
      model: params.modelId || null,
      provider: params.provider,
      fallback_count: params.fallbackCount,
      attempt_count: params.attemptCount,
      latency_ms: params.latencyMs,
      estimated_cost_usd: Number(params.estimatedCostUsd.toFixed(6)),
    },
  });
}
