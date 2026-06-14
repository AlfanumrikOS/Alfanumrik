import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * GUARD — Unified OpenAI Chat Client (Foxy Reasoning v2 — Phase 1).
 *
 * `callOpenAI` is ONE tier of the reasoning cascade. Its contract is deliberately
 * minimal and THROW-on-failure (the cascade catches the throw and advances to the
 * next availability tier). This guard pins that contract by mocking ONLY the
 * boundary — global `fetch` and `process.env.OPENAI_API_KEY` — and running the
 * real client + logger.
 *
 * Asserted contract:
 *   - success: parses { content, model, tokensUsed } from the chat-completions
 *     envelope (data.choices[0].message.content / data.model / data.usage.total_tokens);
 *   - jsonMode: sets response_format: { type: 'json_object' } in the request body;
 *     default (no jsonMode) omits response_format entirely;
 *   - the system prompt is prepended as a leading { role: 'system' } message;
 *   - THROWS on: missing OPENAI_API_KEY (never calls fetch), non-2xx HTTP,
 *     empty/whitespace completion;
 *   - timeout: an AbortError (fired via the AbortController signal) becomes a
 *     "timeout after Nms" throw.
 *
 * P13: the client never adds PII; we assert only config/shape, never a student id.
 */

const _loggerError = vi.fn();
const _loggerWarn = vi.fn();
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: (...a: unknown[]) => _loggerWarn(...a), error: (...a: unknown[]) => _loggerError(...a), debug: vi.fn() },
}));

import { callOpenAI, OPENAI_MINI_MODEL, OPENAI_FULL_MODEL } from '@/lib/ai/clients/openai';

const ORIGINAL_KEY = process.env.OPENAI_API_KEY;

/** Build a well-formed OpenAI chat-completions success envelope. */
function okEnvelope(content: string, model = 'gpt-4o-mini', totalTokens = 42) {
  return {
    model,
    choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage: { total_tokens: totalTokens },
  };
}

/** A fetch Response stub with .ok / .status / .json() / .text(). */
function fetchResponse(opts: { ok: boolean; status: number; json?: unknown; text?: string }): Response {
  return {
    ok: opts.ok,
    status: opts.status,
    json: () => Promise.resolve(opts.json),
    text: () => Promise.resolve(opts.text ?? ''),
  } as unknown as Response;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.OPENAI_API_KEY = 'sk-test-key-not-real';
});

afterEach(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = ORIGINAL_KEY;
  vi.unstubAllGlobals();
});

describe('callOpenAI — success parse', () => {
  it('parses { content, model, tokensUsed } from the chat-completions envelope', async () => {
    const fetchMock = vi.fn().mockResolvedValue(fetchResponse({ ok: true, status: 200, json: okEnvelope('hello world', 'gpt-4o-mini', 123) }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await callOpenAI({
      model: OPENAI_MINI_MODEL,
      systemPrompt: 'You are a tutor.',
      messages: [{ role: 'user', content: '2+2?' }],
    });

    expect(result.content).toBe('hello world');
    expect(result.model).toBe('gpt-4o-mini');
    expect(result.tokensUsed).toBe(123);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('POSTs to api.openai.com chat/completions with the model + bearer auth + system-first messages', async () => {
    const fetchMock = vi.fn().mockResolvedValue(fetchResponse({ ok: true, status: 200, json: okEnvelope('ok') }));
    vi.stubGlobal('fetch', fetchMock);

    await callOpenAI({
      model: OPENAI_FULL_MODEL,
      systemPrompt: 'SYS-PROMPT',
      messages: [{ role: 'user', content: 'hi' }],
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('api.openai.com');
    expect(String(url)).toContain('/chat/completions');
    expect((init as RequestInit).method).toBe('POST');
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer sk-test-key-not-real');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.model).toBe(OPENAI_FULL_MODEL);
    // System prompt is the LEADING message, then the chat turns.
    expect(body.messages[0]).toEqual({ role: 'system', content: 'SYS-PROMPT' });
    expect(body.messages[1]).toEqual({ role: 'user', content: 'hi' });
  });

  it('falls back to tokensUsed:0 and the requested model when the envelope omits usage/model', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      fetchResponse({ ok: true, status: 200, json: { choices: [{ message: { content: 'x' } }] } }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await callOpenAI({ model: 'gpt-4o-mini', systemPrompt: 's', messages: [{ role: 'user', content: 'q' }] });
    expect(result.tokensUsed).toBe(0);
    expect(result.model).toBe('gpt-4o-mini');
  });
});

describe('callOpenAI — jsonMode', () => {
  it('sets response_format json_object when jsonMode is true', async () => {
    const fetchMock = vi.fn().mockResolvedValue(fetchResponse({ ok: true, status: 200, json: okEnvelope('{"x":1}') }));
    vi.stubGlobal('fetch', fetchMock);

    await callOpenAI({ model: 'gpt-4o-mini', systemPrompt: 's', messages: [{ role: 'user', content: 'q' }], jsonMode: true });

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.response_format).toEqual({ type: 'json_object' });
  });

  it('omits response_format entirely when jsonMode is unset (default)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(fetchResponse({ ok: true, status: 200, json: okEnvelope('plain') }));
    vi.stubGlobal('fetch', fetchMock);

    await callOpenAI({ model: 'gpt-4o-mini', systemPrompt: 's', messages: [{ role: 'user', content: 'q' }] });

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect('response_format' in body).toBe(false);
  });
});

describe('callOpenAI — THROWS on failure (the cascade-advances contract)', () => {
  it('throws when OPENAI_API_KEY is missing — WITHOUT calling fetch', async () => {
    delete process.env.OPENAI_API_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      callOpenAI({ model: 'gpt-4o-mini', systemPrompt: 's', messages: [{ role: 'user', content: 'q' }] }),
    ).rejects.toThrow(/OPENAI_API_KEY not configured/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws on a non-2xx HTTP response (e.g. 500) and logs the http error', async () => {
    const fetchMock = vi.fn().mockResolvedValue(fetchResponse({ ok: false, status: 500, text: 'internal error' }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      callOpenAI({ model: 'gpt-4o-mini', systemPrompt: 's', messages: [{ role: 'user', content: 'q' }] }),
    ).rejects.toThrow(/OpenAI API error 500/);
    expect(_loggerError).toHaveBeenCalledWith('openai_api_http_error', expect.objectContaining({ httpStatus: 500 }));
  });

  it('throws on a 429 rate-limit (so the cascade can advance to the next tier)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(fetchResponse({ ok: false, status: 429, text: 'rate limited' }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      callOpenAI({ model: 'gpt-4o-mini', systemPrompt: 's', messages: [{ role: 'user', content: 'q' }] }),
    ).rejects.toThrow(/OpenAI API error 429/);
  });

  it('throws on an empty completion (content is empty string)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(fetchResponse({ ok: true, status: 200, json: okEnvelope('') }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      callOpenAI({ model: 'gpt-4o-mini', systemPrompt: 's', messages: [{ role: 'user', content: 'q' }] }),
    ).rejects.toThrow(/empty content/);
    expect(_loggerWarn).toHaveBeenCalledWith('openai_api_empty_content', expect.objectContaining({ model: 'gpt-4o-mini' }));
  });

  it('throws on a whitespace-only completion (treated as empty)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(fetchResponse({ ok: true, status: 200, json: okEnvelope('   \n\t ') }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      callOpenAI({ model: 'gpt-4o-mini', systemPrompt: 's', messages: [{ role: 'user', content: 'q' }] }),
    ).rejects.toThrow(/empty content/);
  });

  it('throws on a missing choices array (no completion at all)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(fetchResponse({ ok: true, status: 200, json: { model: 'gpt-4o-mini' } }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      callOpenAI({ model: 'gpt-4o-mini', systemPrompt: 's', messages: [{ role: 'user', content: 'q' }] }),
    ).rejects.toThrow(/empty content/);
  });
});

describe('callOpenAI — timeout via AbortController', () => {
  it('aborts the request after timeoutMs and throws a timeout error', async () => {
    // Simulate the platform aborting: fetch rejects with an AbortError when the
    // controller's signal fires. We model that by rejecting with a named
    // AbortError the moment fetch is called (the real abort path the client guards).
    const fetchMock = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        const signal = init.signal as AbortSignal | undefined;
        const fail = () => {
          const err = new Error('The operation was aborted');
          err.name = 'AbortError';
          reject(err);
        };
        if (signal?.aborted) return fail();
        signal?.addEventListener('abort', fail);
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      callOpenAI({
        model: 'gpt-4o-mini',
        systemPrompt: 's',
        messages: [{ role: 'user', content: 'q' }],
        timeoutMs: 5, // tiny timeout → the setTimeout fires controller.abort()
      }),
    ).rejects.toThrow(/timeout after 5ms/);
    expect(_loggerError).toHaveBeenCalledWith('openai_api_timeout', expect.objectContaining({ timeoutMs: 5 }));
  });

  it('wraps a generic network error as a non-leaking "network error" throw', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('ECONNRESET socket hang up'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      callOpenAI({ model: 'gpt-4o-mini', systemPrompt: 's', messages: [{ role: 'user', content: 'q' }] }),
    ).rejects.toThrow(/OpenAI API network error/);
    // P13: the wrapped throw does not leak the raw socket detail.
    await expect(
      callOpenAI({ model: 'gpt-4o-mini', systemPrompt: 's', messages: [{ role: 'user', content: 'q' }] }),
    ).rejects.not.toThrow(/ECONNRESET/);
  });
});

describe('callOpenAI — exported model ids', () => {
  it('OPENAI_MINI_MODEL is gpt-4o-mini, OPENAI_FULL_MODEL is gpt-4o', () => {
    expect(OPENAI_MINI_MODEL).toBe('gpt-4o-mini');
    expect(OPENAI_FULL_MODEL).toBe('gpt-4o');
  });
});
