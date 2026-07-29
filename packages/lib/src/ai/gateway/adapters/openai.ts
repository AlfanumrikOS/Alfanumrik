/**
 * Model Gateway — OpenAI Adapter (Phase 1)
 *
 * Wraps the existing unified OpenAI client (`clients/openai.ts`). Does NOT fetch
 * OpenAI directly. `callOpenAI` throws on ANY failure (that is its contract — it
 * is one tier of the reasoning cascade); we translate the throw into a uniform
 * `AdapterOutcome` so the gateway can advance to the next model.
 *
 * Fail-fast policy: an auth error (401/403) aborts the chain — a different model
 * on the same key won't help. A missing `OPENAI_API_KEY` is NOT fail-fast: it
 * simply means this provider is unavailable, so the gateway skips to the next
 * model (mirrors grounded-answer skipping OpenAI targets when no key is set).
 *
 * Owner: ai-engineer.
 */

import type { AdapterOutcome, GatewayRequest, ModelDescriptor, ProviderAdapter } from '../types';
import { callOpenAI } from '../../clients/openai';

function isAuthError(message: string): boolean {
  return /OpenAI API error 40(1|3)\b/.test(message);
}

export const openaiAdapter: ProviderAdapter = {
  provider: 'openai',

  async invoke(descriptor: ModelDescriptor, req: GatewayRequest): Promise<AdapterOutcome> {
    const start = Date.now();
    try {
      const res = await callOpenAI({
        model: descriptor.id,
        systemPrompt: req.systemPrompt,
        messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
        maxTokens: req.maxTokens,
        temperature: req.temperature,
        timeoutMs: req.timeoutMs,
        jsonMode: req.jsonMode,
      });
      // The unified OpenAI client returns total token usage only; split is not
      // available, so surface it as input tokens (cost estimate stays a routing
      // estimate regardless — see registry.ts header).
      return {
        kind: 'ok',
        content: res.content,
        model: res.model,
        inputTokens: res.tokensUsed,
        outputTokens: 0,
        latencyMs: Date.now() - start,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { kind: 'error', failFast: isAuthError(message), error: message, latencyMs: Date.now() - start };
    }
  },
};
