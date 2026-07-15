// supabase/functions/grounded-answer/__tests__/claude.test.ts
// Deno test runner. Run via:
//   cd supabase/functions/grounded-answer && deno test --allow-all
//
// Verifies Claude call routing:
//   - Haiku 200 → returns content + model=haiku
//   - Haiku 529 → Sonnet 200 → returns content + model=sonnet
//   - Haiku 401 → auth_error, doesn't try Sonnet
//   - content '{{INSUFFICIENT_CONTEXT}}' → insufficientContext:true
//   - both models timeout → ok:false, reason:timeout

import { assertEquals } from 'https://deno.land/std@0.210.0/assert/mod.ts';
import { callClaude } from '../claude.ts';

const HAIKU_MODEL = 'claude-haiku-4-5-20251001';
const SONNET_MODEL = 'claude-sonnet-4-20250514';

const originalFetch = globalThis.fetch;
function restoreFetch() {
  globalThis.fetch = originalFetch;
}

function mockAnthropicOkResponse(text: string, inputTokens = 50, outputTokens = 120): Response {
  return new Response(
    JSON.stringify({
      id: 'msg_test',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text }],
      model: 'claude-test',
      usage: { input_tokens: inputTokens, output_tokens: outputTokens },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

function mockAbortPromise(): Promise<never> {
  return new Promise((_resolve, reject) => {
    reject(new DOMException('The signal has been aborted', 'AbortError'));
  });
}

interface FetchCall {
  url: string;
  model: string;
}

function installFetchStub(
  responses: Array<() => Promise<Response>>,
  onCall?: (call: FetchCall) => void,
) {
  let idx = 0;
  globalThis.fetch = ((url: string | URL, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(init.body as string) : {};
    const call: FetchCall = { url: String(url), model: body.model };
    onCall?.(call);
    const handler = responses[idx];
    idx++;
    if (!handler) return Promise.reject(new Error('no more stubbed responses'));
    return handler();
  }) as typeof fetch;
}

Deno.test('Haiku 200 → returns content + model=haiku', async () => {
  const calls: FetchCall[] = [];
  installFetchStub(
    [() => Promise.resolve(mockAnthropicOkResponse('Photosynthesis is the process...'))],
    (c) => calls.push(c),
  );

  try {
    const result = await callClaude({
      systemPrompt: 'You are Foxy.',
      userMessage: 'What is photosynthesis?',
      maxTokens: 1024,
      temperature: 0.3,
      timeoutMs: 30_000,
      apiKey: 'sk-test',
      modelPreference: 'auto',
    });

    assertEquals(result.ok, true);
    if (result.ok) {
      assertEquals(result.model, HAIKU_MODEL);
      assertEquals(result.content, 'Photosynthesis is the process...');
      assertEquals(result.insufficientContext, false);
      assertEquals(result.inputTokens, 50);
      assertEquals(result.outputTokens, 120);
    }
    assertEquals(calls.length, 1);
    assertEquals(calls[0].model, HAIKU_MODEL);
  } finally {
    restoreFetch();
  }
});

Deno.test('Haiku 529 → falls through to Sonnet 200 → model=sonnet', async () => {
  const calls: FetchCall[] = [];
  installFetchStub(
    [
      () => Promise.resolve(new Response('overloaded', { status: 529 })),
      () => Promise.resolve(mockAnthropicOkResponse('Answer from Sonnet')),
    ],
    (c) => calls.push(c),
  );

  try {
    const result = await callClaude({
      systemPrompt: 'You are Foxy.',
      userMessage: 'test',
      maxTokens: 1024,
      temperature: 0.3,
      timeoutMs: 30_000,
      apiKey: 'sk-test',
      modelPreference: 'auto',
    });

    assertEquals(result.ok, true);
    if (result.ok) {
      assertEquals(result.model, SONNET_MODEL);
      assertEquals(result.content, 'Answer from Sonnet');
    }
    assertEquals(calls.length, 2);
    assertEquals(calls[0].model, HAIKU_MODEL);
    assertEquals(calls[1].model, SONNET_MODEL);
  } finally {
    restoreFetch();
  }
});

Deno.test('Haiku 401 → auth_error, does NOT try Sonnet', async () => {
  const calls: FetchCall[] = [];
  installFetchStub(
    [
      () => Promise.resolve(new Response('invalid api key', { status: 401 })),
      // Second handler shouldn't be invoked; leave something defensive so
      // the test fails loudly if it is.
      () => Promise.resolve(mockAnthropicOkResponse('SHOULD NOT BE CALLED')),
    ],
    (c) => calls.push(c),
  );

  try {
    const result = await callClaude({
      systemPrompt: 'You are Foxy.',
      userMessage: 'test',
      maxTokens: 1024,
      temperature: 0.3,
      timeoutMs: 30_000,
      apiKey: 'sk-bad',
      modelPreference: 'auto',
    });

    assertEquals(result.ok, false);
    if (!result.ok) assertEquals(result.reason, 'auth_error');
    assertEquals(calls.length, 1); // Sonnet never tried
  } finally {
    restoreFetch();
  }
});

Deno.test('Haiku 403 → auth_error, does NOT try Sonnet', async () => {
  const calls: FetchCall[] = [];
  installFetchStub(
    [() => Promise.resolve(new Response('forbidden', { status: 403 }))],
    (c) => calls.push(c),
  );

  try {
    const result = await callClaude({
      systemPrompt: 'sp',
      userMessage: 'q',
      maxTokens: 512,
      temperature: 0.3,
      timeoutMs: 30_000,
      apiKey: 'sk-test',
      modelPreference: 'auto',
    });

    assertEquals(result.ok, false);
    if (!result.ok) assertEquals(result.reason, 'auth_error');
    assertEquals(calls.length, 1);
  } finally {
    restoreFetch();
  }
});

Deno.test('content === {{INSUFFICIENT_CONTEXT}} → ok:true, insufficientContext:true', async () => {
  installFetchStub([
    () => Promise.resolve(mockAnthropicOkResponse('{{INSUFFICIENT_CONTEXT}}')),
  ]);

  try {
    const result = await callClaude({
      systemPrompt: 'sp',
      userMessage: 'a question about off-scope physics',
      maxTokens: 512,
      temperature: 0.3,
      timeoutMs: 30_000,
      apiKey: 'sk-test',
      modelPreference: 'haiku',
    });

    assertEquals(result.ok, true);
    if (result.ok) {
      assertEquals(result.insufficientContext, true);
      assertEquals(result.content, '{{INSUFFICIENT_CONTEXT}}');
    }
  } finally {
    restoreFetch();
  }
});

Deno.test('both models timeout → ok:false, reason:timeout', async () => {
  const calls: FetchCall[] = [];
  installFetchStub(
    [() => mockAbortPromise(), () => mockAbortPromise()],
    (c) => calls.push(c),
  );

  try {
    const result = await callClaude({
      systemPrompt: 'sp',
      userMessage: 'q',
      maxTokens: 512,
      temperature: 0.3,
      timeoutMs: 30_000,
      apiKey: 'sk-test',
      modelPreference: 'auto',
    });

    assertEquals(result.ok, false);
    if (!result.ok) assertEquals(result.reason, 'timeout');
    assertEquals(calls.length, 2);
  } finally {
    restoreFetch();
  }
});

Deno.test('modelPreference=haiku only calls Haiku, never Sonnet', async () => {
  const calls: FetchCall[] = [];
  installFetchStub(
    [() => Promise.resolve(new Response('overloaded', { status: 529 }))],
    (c) => calls.push(c),
  );

  try {
    const result = await callClaude({
      systemPrompt: 'sp',
      userMessage: 'q',
      maxTokens: 512,
      temperature: 0.3,
      timeoutMs: 30_000,
      apiKey: 'sk-test',
      modelPreference: 'haiku',
    });

    assertEquals(result.ok, false);
    if (!result.ok) assertEquals(result.reason, 'server_error');
    assertEquals(calls.length, 1); // only Haiku tried
    assertEquals(calls[0].model, HAIKU_MODEL);
  } finally {
    restoreFetch();
  }
});

Deno.test('modelPreference=sonnet only calls Sonnet, never Haiku', async () => {
  const calls: FetchCall[] = [];
  installFetchStub(
    [() => Promise.resolve(mockAnthropicOkResponse('from sonnet'))],
    (c) => calls.push(c),
  );

  try {
    const result = await callClaude({
      systemPrompt: 'sp',
      userMessage: 'q',
      maxTokens: 512,
      temperature: 0.3,
      timeoutMs: 30_000,
      apiKey: 'sk-test',
      modelPreference: 'sonnet',
    });

    assertEquals(result.ok, true);
    if (result.ok) assertEquals(result.model, SONNET_MODEL);
    assertEquals(calls.length, 1);
    assertEquals(calls[0].model, SONNET_MODEL);
  } finally {
    restoreFetch();
  }
});

// C3 (MOL grounded-answer integration, 2026-05-18): when Haiku fails AND
// Sonnet succeeds, the ok-true response carries fallback_count + failure_chain.
// This is the foundation for mol_request_logs attribution — without it,
// shadow-log rows would record fallback_count: 0 for every call regardless of
// what actually happened. We assert the exact label format ('anthropic:timeout')
// so the adapter contract stays stable.
Deno.test('Haiku timeout → Sonnet success → fallback_count:1, failure_chain:[anthropic:timeout]', async () => {
  installFetchStub([
    () => mockAbortPromise(),
    () => Promise.resolve(mockAnthropicOkResponse('answer from sonnet')),
  ]);

  try {
    const result = await callClaude({
      systemPrompt: 'sp',
      userMessage: 'q',
      maxTokens: 512,
      temperature: 0.3,
      timeoutMs: 30_000,
      apiKey: 'sk-test',
      modelPreference: 'auto',
    });

    assertEquals(result.ok, true);
    if (result.ok) {
      assertEquals(result.model, SONNET_MODEL);
      assertEquals(result.fallback_count, 1);
      assertEquals(result.failure_chain, ['anthropic:timeout']);
    }
  } finally {
    restoreFetch();
  }
});

Deno.test('Haiku success on first try → fallback_count:0, failure_chain undefined', async () => {
  // Regression guard: existing happy-path callers must NOT see a failure_chain
  // array when no fallback fired. Empty arrays here would force every consumer
  // to length-check; the contract is "absent or undefined when 0".
  installFetchStub([
    () => Promise.resolve(mockAnthropicOkResponse('answer from haiku')),
  ]);

  try {
    const result = await callClaude({
      systemPrompt: 'sp',
      userMessage: 'q',
      maxTokens: 512,
      temperature: 0.3,
      timeoutMs: 30_000,
      apiKey: 'sk-test',
      modelPreference: 'auto',
    });

    assertEquals(result.ok, true);
    if (result.ok) {
      assertEquals(result.model, HAIKU_MODEL);
      assertEquals(result.fallback_count, 0);
      assertEquals(result.failure_chain, undefined);
    }
  } finally {
    restoreFetch();
  }
});

Deno.test('missing API key → auth_error, no fetch', async () => {
  let calls = 0;
  globalThis.fetch = ((_u: string | URL, _i?: RequestInit) => {
    calls++;
    return Promise.resolve(mockAnthropicOkResponse('should not happen'));
  }) as typeof fetch;

  try {
    const result = await callClaude({
      systemPrompt: 'sp',
      userMessage: 'q',
      maxTokens: 512,
      temperature: 0.3,
      timeoutMs: 30_000,
      apiKey: '',
      modelPreference: 'auto',
    });

    assertEquals(result.ok, false);
    if (!result.ok) assertEquals(result.reason, 'auth_error');
    assertEquals(calls, 0);
  } finally {
    restoreFetch();
  }
});

// ── Phase 0.2: stopReason surfacing (drives Foxy bounded continuation) ────────
//
// The non-streaming ClaudeResponse ok variant now carries a normalized
// `stopReason`. The Foxy structured pipeline keys the bounded continuation off
// `stopReason === 'max_tokens'`, so these lock the normalization for both
// providers.

function mockAnthropicOkResponseWithStop(
  text: string,
  stopReason: string | null,
): Response {
  return new Response(
    JSON.stringify({
      id: 'msg_test',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text }],
      model: 'claude-test',
      stop_reason: stopReason,
      usage: { input_tokens: 40, output_tokens: 200 },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

function mockOpenAIOkResponse(text: string, finishReason: string | null): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: text }, finish_reason: finishReason }],
      usage: { prompt_tokens: 40, completion_tokens: 200 },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

Deno.test('Anthropic stop_reason=max_tokens → stopReason:max_tokens', async () => {
  installFetchStub([
    () => Promise.resolve(mockAnthropicOkResponseWithStop('partial answer...', 'max_tokens')),
  ]);
  try {
    const result = await callClaude({
      systemPrompt: 'sp',
      userMessage: 'q',
      maxTokens: 128,
      temperature: 0.3,
      timeoutMs: 30_000,
      apiKey: 'sk-test',
      modelPreference: 'haiku',
    });
    assertEquals(result.ok, true);
    if (result.ok) assertEquals(result.stopReason, 'max_tokens');
  } finally {
    restoreFetch();
  }
});

Deno.test('Anthropic stop_reason=end_turn → stopReason:end_turn', async () => {
  installFetchStub([
    () => Promise.resolve(mockAnthropicOkResponseWithStop('complete answer.', 'end_turn')),
  ]);
  try {
    const result = await callClaude({
      systemPrompt: 'sp',
      userMessage: 'q',
      maxTokens: 1024,
      temperature: 0.3,
      timeoutMs: 30_000,
      apiKey: 'sk-test',
      modelPreference: 'haiku',
    });
    assertEquals(result.ok, true);
    if (result.ok) assertEquals(result.stopReason, 'end_turn');
  } finally {
    restoreFetch();
  }
});

Deno.test('Anthropic stop_reason absent → stopReason:other (never spuriously max_tokens)', async () => {
  // Defensive: a missing stop_reason must NOT read as max_tokens, or the
  // continuation would fire on complete answers.
  installFetchStub([
    () => Promise.resolve(mockAnthropicOkResponse('answer with no stop_reason field')),
  ]);
  try {
    const result = await callClaude({
      systemPrompt: 'sp',
      userMessage: 'q',
      maxTokens: 1024,
      temperature: 0.3,
      timeoutMs: 30_000,
      apiKey: 'sk-test',
      modelPreference: 'haiku',
    });
    assertEquals(result.ok, true);
    if (result.ok) assertEquals(result.stopReason, 'other');
  } finally {
    restoreFetch();
  }
});

Deno.test('OpenAI finish_reason=length → stopReason:max_tokens (normalized)', async () => {
  // Only OpenAI is stubbed, and Haiku 529 forces the fallback to gpt-4o-mini.
  installFetchStub([
    () => Promise.resolve(new Response('overloaded', { status: 529 })),
    () => Promise.resolve(mockOpenAIOkResponse('partial from gpt', 'length')),
  ]);
  try {
    const result = await callClaude({
      systemPrompt: 'sp',
      userMessage: 'q',
      maxTokens: 128,
      temperature: 0.3,
      timeoutMs: 30_000,
      apiKey: 'sk-test',
      openaiApiKey: 'sk-openai',
      modelPreference: 'haiku',
    });
    assertEquals(result.ok, true);
    if (result.ok) {
      assertEquals(result.provider, 'openai');
      assertEquals(result.stopReason, 'max_tokens');
    }
  } finally {
    restoreFetch();
  }
});