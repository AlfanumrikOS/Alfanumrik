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
//
// NOTE (2026-08-02, OpenAI-primary cost swap): resolveModelOrder() now reads
// MODEL_FALLBACK_ORDER (./config.ts), which puts OpenAI first for every
// preference. Most tests below omit `openaiApiKey`, so callClaude()'s
// `if (target.provider === 'openai' && !req.openaiApiKey) continue;` guard
// skips the OpenAI legs entirely and these tests exercise the Anthropic-only
// fallback path (still valid coverage, but no longer "the primary/default
// path" some test names/comments describe). Only the
// "OpenAI finish_reason=length" test below supplies openaiApiKey and
// exercises the real OpenAI-primary order end-to-end.

import { assertEquals } from 'https://deno.land/std@0.210.0/assert/mod.ts';
import { callClaude, callClaudeStream } from '../claude.ts';
import type { ClaudeStreamEvent } from '../claude.ts';
import { __resetModelRolloutCacheForTests } from '../_model-rollout-flag.ts';

const HAIKU_MODEL = 'claude-haiku-4-5-20251001';
const SONNET_MODEL = 'claude-sonnet-4-5-20250929';

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
    // P1-4 fix (2026-09-02): the terminal auth_error branches now call
    // logOpsEvent(), which fetches SUPABASE_URL + '/rest/v1/ops_events'.
    // That's an incidental side effect these tests aren't asserting on and
    // predates none of the `responses` stubs below — short-circuit it here
    // (not counted in `calls`, doesn't consume a `responses` slot) rather
    // than teach every existing test about a fetch call it doesn't care
    // about. logOpsEvent itself swallows any rejection, so any response
    // shape is fine.
    if (String(url).includes('/rest/v1/ops_events')) {
      return Promise.resolve(new Response(null, { status: 200 }));
    }
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

// ── Cross-provider auth_error containment (2026-08-31) ───────────────────────
//
// The two tests above pass NO openaiApiKey, so the OpenAI rungs of
// MODEL_FALLBACK_ORDER.auto are skipped by the key guard and 'auth_error' is
// the only possible outcome. They do NOT cover the production shape, where
// both keys are configured: there, a rotated/revoked ANTHROPIC_API_KEY used to
// abort the WHOLE chain and skip both healthy OpenAI rungs, taking Foxy fully
// down while a working OPENAI_API_KEY sat unused (and pipeline.ts deliberately
// does not trip the circuit breaker on auth_error, so it repeated every turn).
// An auth failure is conclusive only WITHIN a provider.
Deno.test('Anthropic 401 → skips remaining Anthropic rungs but FALLS THROUGH to the OpenAI rung', async () => {
  const calls: FetchCall[] = [];
  installFetchStub(
    [
      () => Promise.resolve(new Response('invalid x-api-key', { status: 401 })),
      () => Promise.resolve(mockOpenAIOkResponse('answer from gpt-4o-mini', 'stop')),
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
      apiKey: 'sk-rotated-anthropic-key',
      openaiApiKey: 'sk-openai',
      modelPreference: 'auto',
    });

    assertEquals(result.ok, true);
    if (result.ok) {
      assertEquals(result.provider, 'openai');
      assertEquals(result.model, 'gpt-4o-mini');
      assertEquals(result.content, 'answer from gpt-4o-mini');
      // Telemetry attributes the dead rung instead of recording nothing.
      assertEquals(result.fallback_count, 1);
      assertEquals(result.failure_chain, ['anthropic:auth_error']);
    }
    // Haiku 401 → Sonnet SKIPPED (same key, same result) → OpenAI tried.
    assertEquals(calls.length, 2);
    assertEquals(calls[0].model, HAIKU_MODEL);
    assertEquals(calls[1].model, 'gpt-4o-mini');
    assertEquals(calls[1].url.includes('api.openai.com'), true);
  } finally {
    restoreFetch();
  }
});

Deno.test('Anthropic 401 then OpenAI 401 → auth_error (no other provider remains)', async () => {
  const calls: FetchCall[] = [];
  installFetchStub(
    [
      () => Promise.resolve(new Response('invalid x-api-key', { status: 401 })),
      () => Promise.resolve(new Response('invalid bearer token', { status: 401 })),
      // Defensive: neither the second Anthropic nor the second OpenAI rung
      // may be attempted once its provider's key has been rejected.
      () => Promise.resolve(mockOpenAIOkResponse('SHOULD NOT BE CALLED', 'stop')),
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
      apiKey: 'sk-bad-anthropic',
      openaiApiKey: 'sk-bad-openai',
      modelPreference: 'auto',
    });

    assertEquals(result.ok, false);
    if (!result.ok) assertEquals(result.reason, 'auth_error');
    assertEquals(calls.length, 2);
    assertEquals(calls[0].model, HAIKU_MODEL);
    assertEquals(calls[1].model, 'gpt-4o-mini');
  } finally {
    restoreFetch();
  }
});

// ── Anthropic error classification parity with OpenAI (2026-08-31) ───────────
// 429 and 5xx used to fall into the `unknown` bucket on the Anthropic branch
// only (OpenAI already classified 404/429/>=500 as server_error), so
// failureLabel() emitted 'anthropic:unknown' and dashboards under-reported
// Anthropic rate limits and 5xx entirely. Fallthrough behaviour is unchanged.
Deno.test('Anthropic 429 → server_error label anthropic:5xx (not anthropic:unknown), still falls through', async () => {
  const calls: FetchCall[] = [];
  installFetchStub(
    [
      () => Promise.resolve(new Response('rate limited', { status: 429 })),
      () => Promise.resolve(mockAnthropicOkResponse('answer from sonnet')),
    ],
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

    assertEquals(result.ok, true);
    if (result.ok) {
      assertEquals(result.model, SONNET_MODEL);
      assertEquals(result.failure_chain, ['anthropic:5xx']);
    }
    assertEquals(calls.length, 2);
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
  // CEO directive 2026-08-26: Claude-primary (MODEL_FALLBACK_ORDER.haiku =
  // [anthropic haiku, openai gpt-4o-mini]). Anthropic Haiku is called first;
  // on success we verify the OpenAI finish_reason→stopReason normalization
  // via a second call that stubs an OpenAI-length response.
  // First stub: Anthropic Haiku returns ok, so OpenAI is never reached.
  // Override: we force OpenAI by stubbing Anthropic to fail (503).
  installFetchStub([
    () => Promise.resolve(new Response('upstream', { status: 503 })),
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

// ─── Percentage-rollout mechanism (2026-08-03) — end-to-end wiring ──────────
// Dedicated bucketing-logic unit tests live in
// __tests__/model-rollout-flag.test.ts. These two tests only prove the
// INTEGRATION: resolveModelOrder really does consult shouldUseClaudePrimary
// and really does switch the resolved order.

function mockFlagRowResponse(row: { is_enabled: boolean; rollout_percentage: number | null } | null): Response {
  return new Response(JSON.stringify(row === null ? [] : [row]), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

Deno.test('rollout: callerId + rollout_percentage=100 → resolves CLAUDE_PRIMARY_FALLBACK_ORDER (OpenAI-first rollback, not Anthropic)', async () => {
  __resetModelRolloutCacheForTests();
  Deno.env.set('SUPABASE_URL', 'https://test.supabase.co');
  Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key');
  const calls: FetchCall[] = [];
  installFetchStub(
    [
      () => Promise.resolve(mockFlagRowResponse({ is_enabled: true, rollout_percentage: 100 })),
      () => Promise.resolve(mockOpenAIOkResponse('answer from openai-primary rollback bucket', 'stop')),
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
      openaiApiKey: 'sk-openai',
      modelPreference: 'haiku',
      callerId: 'student-in-rollback-bucket',
    });
    assertEquals(result.ok, true);
    if (result.ok) {
      // CLAUDE_PRIMARY_FALLBACK_ORDER.haiku = [openai gpt-4o-mini, anthropic haiku]
      assertEquals(result.provider, 'openai');
      assertEquals(result.model, 'gpt-4o-mini');
    }
    assertEquals(calls.length, 2);
    assertEquals(calls[1].model, 'gpt-4o-mini');
  } finally {
    restoreFetch();
    Deno.env.delete('SUPABASE_URL');
    Deno.env.delete('SUPABASE_SERVICE_ROLE_KEY');
    __resetModelRolloutCacheForTests();
  }
});

Deno.test('rollout: callerId present but flag disabled → resolves MODEL_FALLBACK_ORDER (Anthropic-primary, CEO directive 2026-08-26)', async () => {
  __resetModelRolloutCacheForTests();
  Deno.env.set('SUPABASE_URL', 'https://test.supabase.co');
  Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key');
  const calls: FetchCall[] = [];
  installFetchStub(
    [
      () => Promise.resolve(mockFlagRowResponse({ is_enabled: false, rollout_percentage: 100 })),
      () => Promise.resolve(mockAnthropicOkResponse('answer from anthropic-primary default')),
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
      openaiApiKey: 'sk-openai',
      modelPreference: 'haiku',
      callerId: 'any-student',
    });
    assertEquals(result.ok, true);
    if (result.ok) {
      // MODEL_FALLBACK_ORDER.haiku = [anthropic haiku, openai gpt-4o-mini]
      assertEquals(result.provider, 'anthropic');
      assertEquals(result.model, HAIKU_MODEL);
    }
  } finally {
    restoreFetch();
    Deno.env.delete('SUPABASE_URL');
    Deno.env.delete('SUPABASE_SERVICE_ROLE_KEY');
    __resetModelRolloutCacheForTests();
  }
});

// ─── Streaming path: provider-scoped auth_error containment (2026-08-31) ────
// ff_foxy_streaming is at 100% and the web client sends stream:true, so the
// streaming chain carries essentially all web traffic. It used to abort the
// WHOLE cross-provider chain on one provider's 401/403, so a rotated
// ANTHROPIC_API_KEY took Foxy fully down for web while a healthy
// OPENAI_API_KEY sat unused. Containment now mirrors callClaude's, and the
// mid-stream boundary is preserved: a provider swap is only ever possible
// BEFORE the first token ships.

function anthropicSseEvents(texts: string[]): string[] {
  const events: string[] = [
    'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":42}}}\n\n',
  ];
  for (const t of texts) {
    const payload = JSON.stringify({
      type: 'content_block_delta',
      delta: { type: 'text_delta', text: t },
    });
    events.push(`event: content_block_delta\ndata: ${payload}\n\n`);
  }
  events.push('event: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":7}}\n\n');
  return events;
}

function openAiSseEvents(texts: string[]): string[] {
  const events = texts.map(
    (t) => `data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\n`,
  );
  const usage = JSON.stringify({ choices: [], usage: { prompt_tokens: 11, completion_tokens: 3 } });
  events.push(`data: ${usage}\n\n`);
  events.push('data: [DONE]\n\n');
  return events;
}

/** 200 SSE response that closes cleanly after the supplied raw events. */
function mockSseResponse(events: string[]): Response {
  const enc = new TextEncoder();
  let i = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < events.length) {
        controller.enqueue(enc.encode(events[i++]));
        return;
      }
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

/**
 * 200 SSE response that errors AFTER the supplied events have been read.
 * Errors from `pull`, not `start`, on purpose: controller.error() clears any
 * still-queued chunks, so erroring up front would never let a token ship and
 * the post-first-token branch would go untested.
 */
function mockSseThenErrorResponse(events: string[]): Response {
  const enc = new TextEncoder();
  let i = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < events.length) {
        controller.enqueue(enc.encode(events[i++]));
        return;
      }
      controller.error(new Error('upstream connection reset mid-stream'));
    },
  });
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

async function collectStream(
  gen: AsyncGenerator<ClaudeStreamEvent, void, unknown>,
): Promise<{ deltas: string[]; final: ClaudeStreamEvent | null }> {
  const deltas: string[] = [];
  let final: ClaudeStreamEvent | null = null;
  for await (const ev of gen) {
    if (ev.type === 'text_delta') deltas.push(ev.delta);
    else final = ev;
  }
  return { deltas, final };
}

Deno.test('stream: pre-first-token Anthropic 401 → falls through to the OpenAI rung and streams', async () => {
  const calls: FetchCall[] = [];
  installFetchStub(
    [
      () => Promise.resolve(new Response('invalid x-api-key', { status: 401 })),
      () => Promise.resolve(mockSseResponse(openAiSseEvents(['Photo', 'synthesis']))),
    ],
    (c) => calls.push(c),
  );

  try {
    const { deltas, final } = await collectStream(
      callClaudeStream({
        systemPrompt: 'You are Foxy.',
        userMessage: 'What is photosynthesis?',
        maxTokens: 1024,
        temperature: 0.3,
        timeoutMs: 30_000,
        apiKey: 'sk-rotated-anthropic-key',
        openaiApiKey: 'sk-openai',
        modelPreference: 'auto',
      }),
    );

    assertEquals(deltas, ['Photo', 'synthesis']);
    assertEquals(final?.type, 'final');
    if (final && final.type === 'final' && final.ok) {
      assertEquals(final.provider, 'openai');
      assertEquals(final.model, 'gpt-4o-mini');
      assertEquals(final.fullText, 'Photosynthesis');
      // Telemetry attributes the dead rung instead of recording nothing.
      assertEquals(final.fallback_count, 1);
      assertEquals(final.failure_chain, ['anthropic:auth_error']);
    } else {
      throw new Error('expected an ok:true final event');
    }
    // Haiku 401 → Sonnet SKIPPED (same key, same result) → OpenAI streamed.
    assertEquals(calls.length, 2);
    assertEquals(calls[0].model, HAIKU_MODEL);
    assertEquals(calls[1].model, 'gpt-4o-mini');
    assertEquals(calls[1].url.includes('api.openai.com'), true);
  } finally {
    restoreFetch();
  }
});

Deno.test('stream: Anthropic 401 then OpenAI 401 → auth_error terminal (no other provider remains)', async () => {
  const calls: FetchCall[] = [];
  installFetchStub(
    [
      () => Promise.resolve(new Response('invalid x-api-key', { status: 401 })),
      () => Promise.resolve(new Response('invalid bearer token', { status: 401 })),
      // Defensive: neither the second Anthropic nor the second OpenAI rung
      // may be attempted once its provider's key has been rejected.
      () => Promise.resolve(mockSseResponse(anthropicSseEvents(['SHOULD NOT BE STREAMED']))),
    ],
    (c) => calls.push(c),
  );

  try {
    const { deltas, final } = await collectStream(
      callClaudeStream({
        systemPrompt: 'You are Foxy.',
        userMessage: 'test',
        maxTokens: 1024,
        temperature: 0.3,
        timeoutMs: 30_000,
        apiKey: 'sk-bad-anthropic',
        openaiApiKey: 'sk-bad-openai',
        modelPreference: 'auto',
      }),
    );

    assertEquals(deltas, []);
    assertEquals(final?.type, 'final');
    if (final && final.type === 'final' && !final.ok) {
      assertEquals(final.reason, 'auth_error');
      assertEquals(final.partialText, '');
      assertEquals(final.model, 'gpt-4o-mini');
    } else {
      throw new Error('expected an ok:false final event');
    }
    assertEquals(calls.length, 2);
    assertEquals(calls[0].model, HAIKU_MODEL);
    assertEquals(calls[1].model, 'gpt-4o-mini');
  } finally {
    restoreFetch();
  }
});

// Mid-stream boundary pin. This one must pass on BOTH the old and the new
// code — the containment above may never reach past the first token.
Deno.test('stream: post-first-token failure → final ok:false with partialText, no second provider', async () => {
  const calls: FetchCall[] = [];
  installFetchStub(
    [
      // message_start + one text_delta, then the upstream connection dies.
      () => Promise.resolve(mockSseThenErrorResponse(anthropicSseEvents(['Photo']).slice(0, 2))),
      // Must never be reached: tokens already shipped to the browser.
      () => Promise.resolve(mockSseResponse(anthropicSseEvents(['SHOULD NOT BE STREAMED']))),
    ],
    (c) => calls.push(c),
  );

  try {
    const { deltas, final } = await collectStream(
      callClaudeStream({
        systemPrompt: 'You are Foxy.',
        userMessage: 'What is photosynthesis?',
        maxTokens: 1024,
        temperature: 0.3,
        timeoutMs: 30_000,
        apiKey: 'sk-test',
        openaiApiKey: 'sk-openai',
        modelPreference: 'auto',
      }),
    );

    assertEquals(deltas, ['Photo']);
    assertEquals(final?.type, 'final');
    if (final && final.type === 'final' && !final.ok) {
      assertEquals(final.reason, 'unknown');
      assertEquals(final.partialText, 'Photo');
      assertEquals(final.model, HAIKU_MODEL);
    } else {
      throw new Error('expected an ok:false final event');
    }
    // No fallback of any kind once the first token has shipped. Filtered to
    // AI-provider calls only: the 2026-09-01 anthropic:unknown diagnostic
    // (claude.ts's logOpsEvent on this exact failure path) also goes through
    // the same stubbed global fetch, and legitimately fires here — it is an
    // observability write, not a fallback attempt, so it must not count
    // against "no second provider call."
    assertEquals(calls.filter((c) => c.url.includes('anthropic.com')).length, 1);
  } finally {
    restoreFetch();
  }
});

// ── Anthropic streaming error classification parity (2026-08-31) ────────────
// streamOnce classified only 404/529 as server_error, so 429 and every other
// 5xx fell into `unknown` and failureLabel() emitted 'anthropic:unknown'.
// Now matches callOnce and streamOpenAIOnce: 404 || 429 || >= 500.
Deno.test('stream: Anthropic 429 → server_error label anthropic:5xx, still falls through', async () => {
  const calls: FetchCall[] = [];
  installFetchStub(
    [
      () => Promise.resolve(new Response('rate limited', { status: 429 })),
      () => Promise.resolve(mockSseResponse(anthropicSseEvents(['from sonnet']))),
    ],
    (c) => calls.push(c),
  );

  try {
    const { final } = await collectStream(
      callClaudeStream({
        systemPrompt: 'sp',
        userMessage: 'q',
        maxTokens: 512,
        temperature: 0.3,
        timeoutMs: 30_000,
        apiKey: 'sk-test',
        modelPreference: 'auto',
      }),
    );

    assertEquals(final?.type, 'final');
    if (final && final.type === 'final' && final.ok) {
      assertEquals(final.model, SONNET_MODEL);
      assertEquals(final.failure_chain, ['anthropic:5xx']);
    } else {
      throw new Error('expected an ok:true final event');
    }
    assertEquals(calls.length, 2);
  } finally {
    restoreFetch();
  }
});

Deno.test('stream: Anthropic 503 → server_error label anthropic:5xx (band, not just 529)', async () => {
  installFetchStub([
    () => Promise.resolve(new Response('service unavailable', { status: 503 })),
    () => Promise.resolve(mockSseResponse(anthropicSseEvents(['from sonnet']))),
  ]);

  try {
    const { final } = await collectStream(
      callClaudeStream({
        systemPrompt: 'sp',
        userMessage: 'q',
        maxTokens: 512,
        temperature: 0.3,
        timeoutMs: 30_000,
        apiKey: 'sk-test',
        modelPreference: 'auto',
      }),
    );

    assertEquals(final?.type, 'final');
    if (final && final.type === 'final' && final.ok) {
      assertEquals(final.failure_chain, ['anthropic:5xx']);
    } else {
      throw new Error('expected an ok:true final event');
    }
  } finally {
    restoreFetch();
  }
});

// ─── Scenario (h): session context survives a cross-provider fallback ────────
//
// Foxy MOL audit requirement 10, scenario (h) is "Anthropic failure -> OpenAI
// fallback". The ROUTING half is covered by the auth-containment tests above
// (Anthropic 401 -> the OpenAI rung answers). The half that was never asserted
// is what the OpenAI rung actually RECEIVES: the tests above only capture the
// url and the model id, so a fallback that silently dropped the system prompt
// or the conversation history would still have passed every one of them.
//
// That matters because the two branches build their request bodies in two
// separate functions (`callOnce` / `callOpenAIOnce`) with no shared builder.
// A student mid-conversation whose Anthropic rung 401s must keep their thread —
// otherwise Foxy answers the follow-up "but why does it bend?" with no idea
// what "it" is.
//
// Broader provider parity (system-prompt byte identity, prompt-cache
// segmentation neutrality, response_format asymmetry) lives in
// ./provider-parity.test.ts. These two pin the AUTH-failure path specifically,
// non-streaming and streaming.

interface BodyCall {
  url: string;
  // deno-lint-ignore no-explicit-any
  body: any;
}

function installBodyCapturingStub(
  responses: Array<() => Promise<Response>>,
  captured: BodyCall[],
) {
  let idx = 0;
  globalThis.fetch = ((url: string | URL, init?: RequestInit) => {
    captured.push({
      url: String(url),
      body: init?.body ? JSON.parse(init.body as string) : {},
    });
    const handler = responses[idx];
    idx += 1;
    if (!handler) return Promise.reject(new Error('no more stubbed responses'));
    return handler();
  }) as typeof fetch;
}

const CONTEXT_SYSTEM_PROMPT =
  'You are Foxy.\n## Safety Rails\nOnly teach from CBSE Grade 8 scope.';
const CONTEXT_TURNS: Array<{ role: 'user' | 'assistant'; content: string }> = [
  { role: 'user', content: 'Why does a pencil look bent in water?' },
  { role: 'assistant', content: 'What happens to light when it changes medium?' },
];
const CONTEXT_USER_MESSAGE = 'It bends? But why does it bend?';

Deno.test('Anthropic 401 -> the OpenAI rung receives the SAME system prompt AND the full conversation history', async () => {
  const captured: BodyCall[] = [];
  installBodyCapturingStub(
    [
      () => Promise.resolve(new Response('invalid x-api-key', { status: 401 })),
      () => Promise.resolve(mockOpenAIOkResponse('Refraction — light slows down.', 'stop')),
    ],
    captured,
  );

  try {
    const result = await callClaude({
      systemPrompt: CONTEXT_SYSTEM_PROMPT,
      userMessage: CONTEXT_USER_MESSAGE,
      conversationTurns: CONTEXT_TURNS,
      maxTokens: 1024,
      temperature: 0.3,
      timeoutMs: 30_000,
      apiKey: 'sk-rotated-anthropic-key',
      openaiApiKey: 'sk-openai',
      modelPreference: 'auto',
    });

    assertEquals(result.ok, true);
    assertEquals(captured.length, 2);

    const anthropicBody = captured[0].body;
    const openaiBody = captured[1].body;
    assertEquals(captured[1].url.includes('api.openai.com'), true);

    // Same system prompt. Anthropic sends it as a block array (legacy single
    // block here — no systemSegments supplied); OpenAI as messages[0].
    const anthropicSystem = Array.isArray(anthropicBody.system)
      // deno-lint-ignore no-explicit-any
      ? anthropicBody.system.map((b: any) => b.text as string).join('')
      : anthropicBody.system;
    assertEquals(anthropicSystem, CONTEXT_SYSTEM_PROMPT);
    assertEquals(openaiBody.messages[0].role, 'system');
    assertEquals(openaiBody.messages[0].content, CONTEXT_SYSTEM_PROMPT);
    assertEquals(openaiBody.messages[0].content, anthropicSystem);

    // Session context: both prior turns, in order, plus the current message.
    const expectedTurns = [...CONTEXT_TURNS, { role: 'user', content: CONTEXT_USER_MESSAGE }];
    assertEquals(
      // deno-lint-ignore no-explicit-any
      anthropicBody.messages.map((m: any) => ({ role: m.role, content: m.content })),
      expectedTurns,
    );
    assertEquals(
      openaiBody.messages
        .slice(1)
        // deno-lint-ignore no-explicit-any
        .map((m: any) => ({ role: m.role, content: m.content })),
      expectedTurns,
    );
  } finally {
    restoreFetch();
  }
});

Deno.test('stream: Anthropic 401 -> the OpenAI rung receives the SAME system prompt AND the full conversation history', async () => {
  const captured: BodyCall[] = [];
  installBodyCapturingStub(
    [
      () => Promise.resolve(new Response('invalid x-api-key', { status: 401 })),
      () => Promise.resolve(mockSseResponse(openAiSseEvents(['Refr', 'action']))),
    ],
    captured,
  );

  try {
    const { deltas, final } = await collectStream(
      callClaudeStream({
        systemPrompt: CONTEXT_SYSTEM_PROMPT,
        userMessage: CONTEXT_USER_MESSAGE,
        conversationTurns: CONTEXT_TURNS,
        maxTokens: 1024,
        temperature: 0.3,
        timeoutMs: 30_000,
        apiKey: 'sk-rotated-anthropic-key',
        openaiApiKey: 'sk-openai',
        modelPreference: 'auto',
      }),
    );

    assertEquals(deltas, ['Refr', 'action']);
    assertEquals(final?.type, 'final');
    assertEquals(captured.length, 2);

    const openaiBody = captured[1].body;
    assertEquals(captured[1].url.includes('api.openai.com'), true);
    assertEquals(openaiBody.stream, true);
    assertEquals(openaiBody.messages[0].role, 'system');
    assertEquals(openaiBody.messages[0].content, CONTEXT_SYSTEM_PROMPT);

    const expectedTurns = [...CONTEXT_TURNS, { role: 'user', content: CONTEXT_USER_MESSAGE }];
    assertEquals(
      openaiBody.messages
        .slice(1)
        // deno-lint-ignore no-explicit-any
        .map((m: any) => ({ role: m.role, content: m.content })),
      expectedTurns,
    );
  } finally {
    restoreFetch();
  }
});

// ── Prompt-cache token capture (2026-09-01) ─────────────────────────────────
//
// Regression pin for a defect that survived a first attempted fix. claude.ts
// sets cache_control in 12 places, so Anthropic reports a cached turn as a
// SMALL input_tokens plus large cache_read_input_tokens /
// cache_creation_input_tokens. This file used to read only input_tokens.
//
// Measured consequence in production (mol_request_logs, 7 days, same
// doubt_solving/foxy task): Anthropic logged 12-78 prompt tokens while OpenAI
// logged 8,327-12,518 for identical work — a ~479x under-count, with the
// remainder priced at zero. A real Foxy turn on 2026-09-01 08:31 recorded
// 22 prompt tokens and $0.004367 against ~11,500 tokens actually sent.
//
// PR #1686 fixed the MOL provider (_shared/mol/providers/anthropic.ts) but NOT
// this file, which is the path Foxy answers actually take. Hence this pin.
Deno.test('callClaude captures Anthropic prompt-cache counters (blocking path)', async () => {
  installFetchStub([
    () => Promise.resolve(new Response(
      JSON.stringify({
        id: 'msg_cached',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'a cached answer' }],
        model: 'claude-test',
        usage: {
          input_tokens: 22,
          output_tokens: 869,
          cache_read_input_tokens: 9000,
          cache_creation_input_tokens: 2500,
        },
        stop_reason: 'end_turn',
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )),
  ]);
  try {
    const res = await callClaude({
      systemPrompt: 'sys',
      userMessage: 'q',
      maxTokens: 1024,
      temperature: 0,
      timeoutMs: 30_000,
      apiKey: 'test-key',
      modelPreference: 'auto',
    });
    assertEquals(res.ok, true);
    if (!res.ok) return;
    // input_tokens must stay the UNCACHED remainder — not silently merged,
    // because reads and writes price differently (0.1x vs 1.25x).
    assertEquals(res.inputTokens, 22);
    assertEquals(res.outputTokens, 869);
    assertEquals(res.cacheReadTokens, 9000);
    assertEquals(res.cacheWriteTokens, 2500);
  } finally {
    restoreFetch();
  }
});

Deno.test('callClaude defaults cache counters to 0 when Anthropic omits them', async () => {
  installFetchStub([() => Promise.resolve(mockAnthropicOkResponse('plain answer', 50, 120))]);
  try {
    const res = await callClaude({
      systemPrompt: 'sys',
      userMessage: 'q',
      maxTokens: 1024,
      temperature: 0,
      timeoutMs: 30_000,
      apiKey: 'test-key',
      modelPreference: 'auto',
    });
    assertEquals(res.ok, true);
    if (!res.ok) return;
    // 0, not undefined: an uncached call must be distinguishable from one that
    // was never measured, or the same blindness returns by another route.
    assertEquals(res.cacheReadTokens, 0);
    assertEquals(res.cacheWriteTokens, 0);
  } finally {
    restoreFetch();
  }
});
