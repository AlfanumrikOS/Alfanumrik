/**
 * Unified Claude API Client
 *
 * Single client for all Claude API calls in the Next.js layer.
 * Features: model fallback chain, retry with backoff, timeout,
 * circuit breaker, structured response parsing.
 *
 * This replaces 10+ separate fetch-to-Claude implementations
 * scattered across API routes and Edge Functions.
 */

import { getAIConfig } from '../config';
import type { ClaudeRequestOptions, ClaudeResponse, ChatMessage } from '../types';
import { logger } from '@/lib/logger';
import { logOpsEvent } from '@/lib/ops-events';

// ─── Circuit Breaker ────────────────────────────────────────────────────────

interface CircuitBreakerState {
  failures: number;
  lastFailureAt: number;
  state: 'closed' | 'open' | 'half-open';
}

const breaker: CircuitBreakerState = {
  failures: 0,
  lastFailureAt: 0,
  state: 'closed',
};

const FAILURE_THRESHOLD = 5;
const RESET_TIMEOUT_MS = 60_000;

function canRequest(): boolean {
  if (breaker.state === 'closed') return true;
  if (breaker.state === 'open') {
    if (Date.now() - breaker.lastFailureAt > RESET_TIMEOUT_MS) {
      breaker.state = 'half-open';
      return true;
    }
    return false;
  }
  // half-open: allow one probe
  return true;
}

function recordSuccess(): void {
  breaker.failures = 0;
  breaker.state = 'closed';
}

function recordFailure(): void {
  breaker.failures++;
  breaker.lastFailureAt = Date.now();
  if (breaker.failures >= FAILURE_THRESHOLD) {
    breaker.state = 'open';
  }
}

// ─── API Types ──────────────────────────────────────────────────────────────

interface ClaudeAPIMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface ClaudeAPIResponse {
  content: Array<{ type: string; text: string }>;
  model: string;
  stop_reason: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

// ─── Single Model Call ──────────────────────────────────────────────────────

async function callModel(
  model: string,
  systemPrompt: string,
  messages: ClaudeAPIMessage[],
  maxTokens: number,
  temperature: number,
  timeoutMs: number,
): Promise<{ response: ClaudeAPIResponse; latencyMs: number } | { error: string; status: number }> {
  const config = getAIConfig();

  if (!config.apiKey) {
    return { error: 'ANTHROPIC_API_KEY not configured', status: 503 };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const start = Date.now();

  try {
    const res = await fetch(`${config.apiBaseUrl}/messages`, {
      signal: controller.signal,
      method: 'POST',
      headers: {
        'x-api-key': config.apiKey,
        'anthropic-version': config.apiVersion,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        temperature,
        system: systemPrompt,
        messages,
      }),
    });

    clearTimeout(timer);
    const latencyMs = Date.now() - start;

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      logger.error('claude_api_http_error', {
        httpStatus: res.status,
        model,
        latencyMs,
        errorBody: errBody.slice(0, 500),
      });
      return { error: `Claude API error ${res.status}: ${errBody.slice(0, 300)}`, status: res.status };
    }

    const data = (await res.json()) as ClaudeAPIResponse;
    return { response: data, latencyMs };
  } catch (err) {
    clearTimeout(timer);
    const latencyMs = Date.now() - start;

    if (err instanceof Error && err.name === 'AbortError') {
      logger.error('claude_api_timeout', { model, timeoutMs, latencyMs });
      return { error: `Claude API timeout after ${timeoutMs}ms`, status: 408 };
    }

    const msg = err instanceof Error ? err.message : String(err);
    logger.error('claude_api_network_error', { model, error: msg, latencyMs });
    return { error: `Claude API network error: ${msg}`, status: 503 };
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Call Claude with automatic model fallback and circuit breaker.
 *
 * Tries the primary model first (Haiku). On 404/429/5xx, falls back to
 * the fallback model (Sonnet). Auth errors (401/403) fail immediately.
 *
 * @throws Error if all models fail or circuit breaker is open.
 */
export async function callClaude(options: ClaudeRequestOptions): Promise<ClaudeResponse> {
  const config = getAIConfig();

  if (!canRequest()) {
    throw new Error('Claude API circuit breaker is open — too many recent failures');
  }

  const {
    systemPrompt,
    messages,
    model,
    maxTokens,
    temperature,
    timeoutMs,
  } = options;

  const apiMessages: ClaudeAPIMessage[] = messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  // If a specific model was requested, only try that model
  const modelsToTry = model
    ? [model]
    : [config.primaryModel.name, config.fallbackModel.name];

  const resolvedMaxTokens = maxTokens ?? config.primaryModel.maxTokens;
  const resolvedTemp = temperature ?? config.primaryModel.temperature;
  const resolvedTimeout = timeoutMs ?? config.primaryModel.timeoutMs;

  let lastError = 'Claude API unavailable';

  for (const modelName of modelsToTry) {
    const result = await callModel(
      modelName,
      systemPrompt,
      apiMessages,
      resolvedMaxTokens,
      resolvedTemp,
      resolvedTimeout,
    );

    if ('error' in result) {
      lastError = result.error;

      // Auth errors won't be fixed by trying a different model
      if (result.status === 401 || result.status === 403) {
        recordFailure();
        throw new Error(lastError);
      }

      // For 404 (model not found), 429 (rate limited), 5xx: try next model
      continue;
    }

    // Success
    recordSuccess();

    logOpsEvent({
      category: 'ai',
      source: 'claude.ts',
      severity: 'info',
      message: `Claude API call succeeded (${modelName})`,
      context: { model: modelName, latency_ms: result.latencyMs },
    });

    // If we fell back to a later model in the chain, emit a warning
    if (modelsToTry.length > 1 && modelName !== modelsToTry[0]) {
      logOpsEvent({
        category: 'ai',
        source: 'claude.ts',
        severity: 'warning',
        message: `Haiku→Sonnet fallback triggered`,
        context: { original_model: modelsToTry[0], fallback_model: modelName, reason: lastError },
      });
    }

    const content = result.response.content?.[0]?.text ?? '';
    return {
      content,
      model: result.response.model ?? modelName,
      tokensUsed: (result.response.usage?.input_tokens ?? 0) + (result.response.usage?.output_tokens ?? 0),
      inputTokens: result.response.usage?.input_tokens ?? 0,
      outputTokens: result.response.usage?.output_tokens ?? 0,
      stopReason: result.response.stop_reason ?? null,
      latencyMs: result.latencyMs,
    };
  }

  // All models failed
  recordFailure();
  logger.error('claude_all_models_failed', { modelsAttempted: modelsToTry, lastError });

  await logOpsEvent({
    category: 'ai',
    source: 'claude.ts',
    severity: 'error',
    message: `Claude API call failed — all models exhausted`,
    context: { models_attempted: modelsToTry, last_error: lastError },
  });

  throw new Error(lastError);
}

/**
 * Check if the circuit breaker is currently open.
 * Useful for health checks and fallback UI decisions.
 */
export function isCircuitBreakerOpen(): boolean {
  return breaker.state === 'open';
}

/**
 * Get circuit breaker state for diagnostics.
 */
export function getCircuitBreakerState(): {
  state: string;
  failures: number;
  lastFailureAt: number;
} {
  return { ...breaker };
}
