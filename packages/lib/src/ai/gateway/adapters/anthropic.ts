/**
 * Model Gateway — Anthropic Adapter (Phase 1)
 *
 * Wraps the existing unified Claude client (`clients/claude.ts`). It does NOT
 * fetch Anthropic directly — the circuit breaker, retry/backoff, timeout, and
 * PII posture all live in `callClaude` and are preserved. This satisfies the
 * `alfanumrik/no-direct-ai-calls` ESLint boundary (adapters wrap clients).
 *
 * The gateway hands one concrete descriptor at a time, so we pass `model:
 * descriptor.id` to pin `callClaude` to exactly that model (its own internal
 * Haiku→Sonnet fallback is bypassed here — the gateway owns cross-model
 * ordering). All per-model retry/backoff and the module-level breaker still fire.
 *
 * Owner: ai-engineer.
 */

import type { AdapterOutcome, GatewayRequest, ModelDescriptor, ProviderAdapter } from '../types';
import { callClaude } from '../../clients/claude';

/** Detect auth failures from callClaude's thrown message → fail the chain fast. */
function isAuthError(message: string): boolean {
  // Precise: catch the exact 401/403 statuses callClaude throws
  // ("Claude API error 401/403:") plus explicit auth phrasings. The prior
  // broad /auth/i matched non-auth strings that merely contain "auth" and
  // could prematurely fail-fast, skipping the OpenAI fallback tail.
  return /\b(401|403)\b/.test(message) || /unauthor|forbidden|api key/i.test(message);
}

export const anthropicAdapter: ProviderAdapter = {
  provider: 'anthropic',

  async invoke(descriptor: ModelDescriptor, req: GatewayRequest): Promise<AdapterOutcome> {
    const start = Date.now();
    try {
      const res = await callClaude({
        systemPrompt: req.systemPrompt,
        messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
        model: descriptor.id, // pin to this exact model — gateway owns fallback
        maxTokens: req.maxTokens,
        temperature: req.temperature,
        timeoutMs: req.timeoutMs,
      });
      return {
        kind: 'ok',
        content: res.content,
        model: res.model,
        inputTokens: res.inputTokens,
        outputTokens: res.outputTokens,
        latencyMs: res.latencyMs,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // callClaude throws on auth (401/403), circuit-open, and exhausted-model.
      // Auth won't recover on another model with the same key → fail fast.
      return { kind: 'error', failFast: isAuthError(message), error: message, latencyMs: Date.now() - start };
    }
  },
};
