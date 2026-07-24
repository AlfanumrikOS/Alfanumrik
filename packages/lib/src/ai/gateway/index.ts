/**
 * Model Gateway — Public API (Phase 1)
 *
 * Provider-agnostic model routing for the Next.js / shared TS layer. Phase 1 is
 * PURELY ADDITIVE and flag-gated (ff_model_gateway_v1, default OFF): `default`
 * policy reproduces the legacy Anthropic-primary chain byte-for-byte, and
 * non-default policies degrade to `default` when the flag is off.
 *
 * Usage:
 *   import { callModel } from '@alfanumrik/lib/ai/gateway';
 *   const r = await callModel({ systemPrompt, messages }, { policy: 'default' });
 *   if (r.ok) use(r.content);
 *
 * See docs/superpowers/specs/2026-07-24-model-gateway-design.md.
 * Owner: ai-engineer.
 */

// ─── Orchestrator ─────────────────────────────────────────────────────────
export { callModel, GATEWAY_FLAG } from './gateway';
export type { CallModelOptions } from './gateway';

// ─── Registry ─────────────────────────────────────────────────────────────
export {
  getModel,
  listModels,
  legacyChain,
  LEGACY_FALLBACK_ORDER,
  estimateCostUsd,
  blendedCostPer1M,
  ROUTING_POLICIES,
  MODEL_IDS,
  ANTHROPIC_HAIKU_ID,
  ANTHROPIC_SONNET_ID,
  OPENAI_MINI_ID,
  OPENAI_FULL_ID,
  GEMINI_FLASH_ID,
  GEMINI_PRO_ID,
} from './registry';
export type { FallbackTarget } from './registry';

// ─── Router ───────────────────────────────────────────────────────────────
export { selectModelChain } from './router';

// ─── Adapters ─────────────────────────────────────────────────────────────
export { anthropicAdapter } from './adapters/anthropic';
export { openaiAdapter } from './adapters/openai';
export { geminiAdapter } from './adapters/gemini';

// ─── Telemetry ────────────────────────────────────────────────────────────
export { emitGatewayAttempt, emitGatewaySummary } from './telemetry';
export type { GatewayTelemetry } from './telemetry';

// ─── Types ────────────────────────────────────────────────────────────────
export { ProviderNotConfiguredError } from './types';
export type {
  ProviderId,
  ModelTier,
  RoutingPolicy,
  ModelCapabilities,
  ModelDescriptor,
  RoutingConstraints,
  GatewayMessage,
  GatewayRequest,
  GatewayResult,
  GatewayAttempt,
  AdapterOutcome,
  ProviderAdapter,
  AdapterMap,
} from './types';
