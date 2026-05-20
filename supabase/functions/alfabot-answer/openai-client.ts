// supabase/functions/alfabot-answer/openai-client.ts
//
// OpenAI chat-completions client for AlfaBot. Mirrors the MOL OpenAI
// provider pattern (_shared/mol/providers/openai.ts) but adapted for
// (a) streaming with an AsyncGenerator interface, and
// (b) AlfaBot's tighter shape (no vision, no MOL ProviderResponse wrapping).
//
// Streaming notes:
//   - OpenAI returns Server-Sent Events. Each SSE frame is "data: <json>\n\n".
//     The stream terminates with "data: [DONE]\n\n".
//   - The JSON payload of each frame has the shape
//       { id, object, choices: [{ delta: { content?: string }, ... }], ... }
//     The `delta.content` field carries each token chunk.
//   - For final usage stats (prompt_tokens, completion_tokens) we set
//     `stream_options: { include_usage: true }` so OpenAI emits a final
//     frame with `usage` populated.
//
// Timeout: 20s per call. On timeout we throw AlfabotUpstreamError('timeout').
// The Edge Function entry point catches that, marks the response
// degradedMode:true, and returns an abstain string — NEVER a 5xx.

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_TIMEOUT_MS = 20_000;

export type OpenAIRole = 'system' | 'user' | 'assistant';

export interface OpenAIMessage {
  role: OpenAIRole;
  content: string;
}

export interface OpenAIChatConfig {
  model: string;
  temperature: number;
  max_tokens: number;
  presence_penalty?: number;
  frequency_penalty?: number;
}

export interface OpenAINonStreamResult {
  text: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  finishReason: string;
}

export type OpenAIStreamEvent =
  | { type: 'token'; delta: string }
  | {
      type: 'final';
      model: string;
      promptTokens: number;
      completionTokens: number;
      finishReason: string;
    };

/**
 * Discriminated error for AlfaBot upstream failures. The Edge Function entry
 * point inspects `kind` to pick the right structured log + degraded-mode
 * abstain.
 */
export class AlfabotUpstreamError extends Error {
  readonly kind: 'timeout' | 'auth_error' | 'server_error' | 'rate_limit' | 'malformed' | 'unknown';

  constructor(
    kind: AlfabotUpstreamError['kind'],
    message?: string,
  ) {
    super(message || kind);
    this.kind = kind;
    this.name = 'AlfabotUpstreamError';
  }
}

function getApiKey(): string {
  const key = Deno.env.get('OPENAI_API_KEY') ?? '';
  if (!key) {
    throw new AlfabotUpstreamError('auth_error', 'OPENAI_API_KEY missing');
  }
  return key;
}

function classifyHttpError(status: number): AlfabotUpstreamError['kind'] {
  if (status === 401 || status === 403) return 'auth_error';
  if (status === 429) return 'rate_limit';
  if (status >= 500) return 'server_error';
  return 'unknown';
}

function buildBody(
  systemPrompt: string,
  messages: OpenAIMessage[],
  config: OpenAIChatConfig,
  stream: boolean,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: config.model,
    messages: [
      { role: 'system' as const, content: systemPrompt },
      ...messages,
    ],
    max_tokens: config.max_tokens,
    temperature: config.temperature,
  };
  if (typeof config.presence_penalty === 'number') {
    body.presence_penalty = config.presence_penalty;
  }
  if (typeof config.frequency_penalty === 'number') {
    body.frequency_penalty = config.frequency_penalty;
  }
  if (stream) {
    body.stream = true;
    body.stream_options = { include_usage: true };
  }
  return body;
}

/**
 * Non-streaming call. Returns the full assistant text + usage metadata.
 * Throws AlfabotUpstreamError on any failure — callers catch and degrade.
 */
export async function callOpenAIChat(
  systemPrompt: string,
  messages: OpenAIMessage[],
  config: OpenAIChatConfig,
): Promise<OpenAINonStreamResult> {
  const apiKey = getApiKey();
  const body = buildBody(systemPrompt, messages, config, false);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new AlfabotUpstreamError('timeout');
    }
    throw new AlfabotUpstreamError('unknown', String(err));
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const raw = await res.text().catch(() => '');
    throw new AlfabotUpstreamError(
      classifyHttpError(res.status),
      `OpenAI ${res.status} ${raw.slice(0, 200)}`,
    );
  }

  let data: {
    choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
    model?: string;
  };
  try {
    data = await res.json();
  } catch {
    throw new AlfabotUpstreamError('malformed', 'non-JSON OpenAI response');
  }

  const text = (data.choices?.[0]?.message?.content ?? '').trim();
  if (!text) {
    throw new AlfabotUpstreamError('malformed', 'empty assistant content');
  }

  return {
    text,
    model: data.model ?? config.model,
    promptTokens: data.usage?.prompt_tokens ?? 0,
    completionTokens: data.usage?.completion_tokens ?? 0,
    finishReason: data.choices?.[0]?.finish_reason ?? 'stop',
  };
}

/**
 * Streaming call. Yields token deltas as they arrive, then a final event
 * with usage + model. Throws AlfabotUpstreamError on connect-level failure;
 * mid-stream parse errors are logged and swallowed (we never abort an
 * already-started stream — the user is seeing tokens).
 */
export async function* streamOpenAIChat(
  systemPrompt: string,
  messages: OpenAIMessage[],
  config: OpenAIChatConfig,
): AsyncGenerator<OpenAIStreamEvent, void, unknown> {
  const apiKey = getApiKey();
  const body = buildBody(systemPrompt, messages, config, true);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof Error && err.name === 'AbortError') {
      throw new AlfabotUpstreamError('timeout');
    }
    throw new AlfabotUpstreamError('unknown', String(err));
  }

  if (!res.ok) {
    clearTimeout(timer);
    const raw = await res.text().catch(() => '');
    throw new AlfabotUpstreamError(
      classifyHttpError(res.status),
      `OpenAI ${res.status} ${raw.slice(0, 200)}`,
    );
  }

  if (!res.body) {
    clearTimeout(timer);
    throw new AlfabotUpstreamError('malformed', 'OpenAI streaming response has no body');
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finalModel = config.model;
  let promptTokens = 0;
  let completionTokens = 0;
  let finishReason = 'stop';

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let nlIdx;
      while ((nlIdx = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, nlIdx);
        buffer = buffer.slice(nlIdx + 2);
        if (!frame.trim()) continue;

        // Each frame is one or more `data: ...` lines.
        const lines = frame.split('\n').filter((l) => l.startsWith('data:'));
        for (const line of lines) {
          const payload = line.slice(5).trim();
          if (payload === '[DONE]') {
            // Stream terminator. Subsequent reads should hit done=true.
            continue;
          }
          let parsed: {
            choices?: Array<{
              delta?: { content?: string };
              finish_reason?: string | null;
            }>;
            usage?: { prompt_tokens?: number; completion_tokens?: number };
            model?: string;
          };
          try {
            parsed = JSON.parse(payload);
          } catch {
            // Malformed SSE frame — skip; do not abort the stream.
            continue;
          }
          if (parsed.model) finalModel = parsed.model;
          if (parsed.usage) {
            promptTokens = parsed.usage.prompt_tokens ?? promptTokens;
            completionTokens = parsed.usage.completion_tokens ?? completionTokens;
          }
          const choice = parsed.choices?.[0];
          if (choice?.delta?.content) {
            yield { type: 'token', delta: choice.delta.content };
          }
          if (choice?.finish_reason) {
            finishReason = choice.finish_reason;
          }
        }
      }
    }
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
  }

  yield {
    type: 'final',
    model: finalModel,
    promptTokens,
    completionTokens,
    finishReason,
  };
}
