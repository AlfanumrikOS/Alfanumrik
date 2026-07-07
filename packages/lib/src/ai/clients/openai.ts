/**
 * Unified OpenAI Chat Client (Foxy Reasoning v2 — Phase 1)
 *
 * A thin Node fetch client for the OpenAI Chat Completions API. Mirrors the
 * latency/timeout posture of the Claude client (`src/lib/ai/clients/claude.ts`)
 * but is deliberately MINIMAL — it is one tier of the reasoning cascade
 * (`reasoning-cascade.ts`), which owns the cross-provider availability fallback.
 * For that reason this client does NOT implement its own model-fallback chain:
 * it calls EXACTLY the model it is handed, and THROWS on any failure so the
 * cascade can advance to the next tier.
 *
 * No new npm dependency — uses the global `fetch` available in the Next.js
 * (Node 18+) runtime.
 *
 * P13: no PII in any throw/log. The client only ever sees the system prompt +
 * chat turns it is handed (already anonymised by the caller); it never adds
 * student identifiers. On error it logs the model + HTTP status + a truncated
 * provider error body only.
 *
 * Owner: ai-engineer.
 */

import { logger } from '@alfanumrik/lib/logger';

// ─── Model IDs ──────────────────────────────────────────────────────────────

/** Real-time / base reasoning tier. */
export const OPENAI_MINI_MODEL = 'gpt-4o-mini';

/** Escalation reasoning tier (full model). */
export const OPENAI_FULL_MODEL = 'gpt-4o';

// ─── Defaults ─────────────────────────────────────────────────────────────-

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_TOKENS = 1024;
const DEFAULT_TEMPERATURE = 0.3;
const OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions';

// ─── Public Types ─────────────────────────────────────────────────────────-

export interface OpenAIChatOptions {
  model: string;
  systemPrompt: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  /** When true, request a strict JSON object via response_format. */
  jsonMode?: boolean;
}

export interface OpenAIChatResult {
  content: string;
  model: string;
  tokensUsed: number;
}

// ─── API Response Shape ─────────────────────────────────────────────────────

interface OpenAIChatAPIResponse {
  model?: string;
  choices?: Array<{
    message?: { role?: string; content?: string | null };
    finish_reason?: string | null;
  }>;
  usage?: { total_tokens?: number };
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Call the OpenAI Chat Completions API for ONE model.
 *
 * THROWS on: missing OPENAI_API_KEY, non-2xx HTTP, network error/timeout, or an
 * empty/whitespace completion. This throw-on-failure posture is intentional —
 * the reasoning cascade catches it and advances to the next availability tier.
 *
 * @throws Error if the key is missing, the request fails, or the content is empty.
 */
export async function callOpenAI(options: OpenAIChatOptions): Promise<OpenAIChatResult> {
  const apiKey = process.env.OPENAI_API_KEY ?? '';
  if (!apiKey) {
    // No PII — config-state only.
    throw new Error('OPENAI_API_KEY not configured');
  }

  const {
    model,
    systemPrompt,
    messages,
    maxTokens = DEFAULT_MAX_TOKENS,
    temperature = DEFAULT_TEMPERATURE,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    jsonMode = false,
  } = options;

  // OpenAI chat shape: a leading `system` message, then the chat turns.
  const apiMessages = [
    { role: 'system' as const, content: systemPrompt },
    ...messages.map((m) => ({ role: m.role, content: m.content })),
  ];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(OPENAI_CHAT_URL, {
      signal: controller.signal,
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        temperature,
        messages: apiMessages,
        ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
      }),
    });

    clearTimeout(timer);

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      // P13: status + truncated provider body only — never the prompt/messages.
      logger.error('openai_api_http_error', {
        httpStatus: res.status,
        model,
        errorBody: errBody.slice(0, 300),
      });
      throw new Error(`OpenAI API error ${res.status}`);
    }

    const data = (await res.json()) as OpenAIChatAPIResponse;
    const content = data.choices?.[0]?.message?.content ?? '';

    if (!content.trim()) {
      logger.warn('openai_api_empty_content', { model });
      throw new Error('OpenAI API returned empty content');
    }

    return {
      content,
      model: data.model ?? model,
      tokensUsed: data.usage?.total_tokens ?? 0,
    };
  } catch (err) {
    clearTimeout(timer);

    // Re-throw our own already-logged errors unchanged (avoid double-logging).
    if (
      err instanceof Error &&
      (err.message.startsWith('OpenAI API error ') ||
        err.message === 'OpenAI API returned empty content' ||
        err.message === 'OPENAI_API_KEY not configured')
    ) {
      throw err;
    }

    if (err instanceof Error && err.name === 'AbortError') {
      logger.error('openai_api_timeout', { model, timeoutMs });
      throw new Error(`OpenAI API timeout after ${timeoutMs}ms`);
    }

    const msg = err instanceof Error ? err.message : String(err);
    // P13: error message only — these are network-layer strings, never PII.
    logger.error('openai_api_network_error', { model, error: msg });
    throw new Error(`OpenAI API network error`);
  }
}
