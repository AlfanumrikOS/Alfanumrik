// supabase/functions/grounded-answer/__tests__/grounding-check.test.ts
// Deno test runner. Run via:
//   cd supabase/functions/grounded-answer && deno test --allow-all
//
// Verifies strict-mode grounding verifier:
//   - Claude pass verdict → pass
//   - Claude fail verdict → fail with unsupported list
//   - timeout → conservative fail
//   - non-JSON response → conservative fail
//   - INSUFFICIENT_CONTEXT answer is still sent; prompt instructs pass

import { assertEquals } from 'https://deno.land/std@0.210.0/assert/mod.ts';
import { runGroundingCheck } from '../grounding-check.ts';

const originalFetch = globalThis.fetch;
function restoreFetch() {
  globalThis.fetch = originalFetch;
}

function mockOkResponse(text: string): Response {
  return new Response(
    JSON.stringify({
      id: 'msg_test',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text }],
      model: 'claude-haiku-4-5-20251001',
      usage: { input_tokens: 200, output_tokens: 30 },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

function mockAbortPromise(): Promise<never> {
  return new Promise((_resolve, reject) => {
    reject(new DOMException('aborted', 'AbortError'));
  });
}

const sampleChunks = [
  { id: 'c-1', content: 'Photosynthesis is the process by which plants convert light into glucose.' },
];

Deno.test('Claude returns pass verdict → pass', async () => {
  globalThis.fetch = ((_u: string | URL, _i?: RequestInit) =>
    Promise.resolve(mockOkResponse('{"verdict":"pass","unsupported_sentences":[]}'))) as typeof fetch;

  try {
    const result = await runGroundingCheck(
      'Photosynthesis is the process by which plants convert light into glucose.',
      'What is photosynthesis?',
      sampleChunks,
      'sk-test',
    );
    assertEquals(result.verdict, 'pass');
    assertEquals(result.unsupportedSentences.length, 0);
  } finally {
    restoreFetch();
  }
});

Deno.test('Claude returns fail verdict → fail with unsupported list', async () => {
  const body = JSON.stringify({
    verdict: 'fail',
    unsupported_sentences: ['Plants also absorb nitrogen from the air.'],
  });
  globalThis.fetch = ((_u: string | URL, _i?: RequestInit) =>
    Promise.resolve(mockOkResponse(body))) as typeof fetch;

  try {
    const result = await runGroundingCheck(
      'Photosynthesis makes glucose. Plants also absorb nitrogen from the air.',
      'What is photosynthesis?',
      sampleChunks,
      'sk-test',
    );
    assertEquals(result.verdict, 'fail');
    assertEquals(result.unsupportedSentences.length, 1);
    assertEquals(result.unsupportedSentences[0], 'Plants also absorb nitrogen from the air.');
  } finally {
    restoreFetch();
  }
});

Deno.test('Claude timeout → conservative fail', async () => {
  globalThis.fetch = ((_u: string | URL, _i?: RequestInit) => mockAbortPromise()) as typeof fetch;

  try {
    const result = await runGroundingCheck(
      'some answer',
      'some question',
      sampleChunks,
      'sk-test',
      50, // tight timeout; stub aborts anyway
    );
    assertEquals(result.verdict, 'fail');
    assertEquals(result.unsupportedSentences.length, 0);
  } finally {
    restoreFetch();
  }
});

Deno.test('Claude returns non-JSON → conservative fail', async () => {
  globalThis.fetch = ((_u: string | URL, _i?: RequestInit) =>
    Promise.resolve(mockOkResponse('Sorry, I cannot help with that.'))) as typeof fetch;

  try {
    const result = await runGroundingCheck('answer', 'q', sampleChunks, 'sk-test');
    assertEquals(result.verdict, 'fail');
    assertEquals(result.unsupportedSentences.length, 0);
  } finally {
    restoreFetch();
  }
});

Deno.test('Claude returns malformed JSON → conservative fail', async () => {
  globalThis.fetch = ((_u: string | URL, _i?: RequestInit) =>
    Promise.resolve(mockOkResponse('{"verdict":"pass","unsupported_sentences":[}'))) as typeof fetch;

  try {
    const result = await runGroundingCheck('answer', 'q', sampleChunks, 'sk-test');
    assertEquals(result.verdict, 'fail');
  } finally {
    restoreFetch();
  }
});

Deno.test('Claude returns unknown verdict → conservative fail', async () => {
  globalThis.fetch = ((_u: string | URL, _i?: RequestInit) =>
    Promise.resolve(mockOkResponse('{"verdict":"maybe","unsupported_sentences":[]}'))) as typeof fetch;

  try {
    const result = await runGroundingCheck('answer', 'q', sampleChunks, 'sk-test');
    assertEquals(result.verdict, 'fail');
  } finally {
    restoreFetch();
  }
});

Deno.test('answer === INSUFFICIENT_CONTEXT → still calls Claude, prompt instructs pass', async () => {
  // The prompt tells Claude to return pass when the answer is exactly
  // {{INSUFFICIENT_CONTEXT}}. We stub Claude to confirm it does so and
  // verify the call still happens (we don't short-circuit locally).
  let callCount = 0;
  globalThis.fetch = ((_u: string | URL, _i?: RequestInit) => {
    callCount++;
    return Promise.resolve(mockOkResponse('{"verdict":"pass","unsupported_sentences":[]}'));
  }) as typeof fetch;

  try {
    const result = await runGroundingCheck(
      '{{INSUFFICIENT_CONTEXT}}',
      'What is the capital of France?',
      sampleChunks,
      'sk-test',
    );
    assertEquals(result.verdict, 'pass');
    assertEquals(callCount, 1);
  } finally {
    restoreFetch();
  }
});

Deno.test('HTTP 500 from Claude → conservative fail', async () => {
  globalThis.fetch = ((_u: string | URL, _i?: RequestInit) =>
    Promise.resolve(new Response('internal', { status: 500 }))) as typeof fetch;

  try {
    const result = await runGroundingCheck('answer', 'q', sampleChunks, 'sk-test');
    assertEquals(result.verdict, 'fail');
  } finally {
    restoreFetch();
  }
});

Deno.test('missing API key → conservative fail with no fetch', async () => {
  let calls = 0;
  globalThis.fetch = ((_u: string | URL, _i?: RequestInit) => {
    calls++;
    return Promise.resolve(mockOkResponse('{}'));
  }) as typeof fetch;

  try {
    const result = await runGroundingCheck('answer', 'q', sampleChunks, '');
    assertEquals(result.verdict, 'fail');
    assertEquals(calls, 0);
  } finally {
    restoreFetch();
  }
});

Deno.test('JSON wrapped in markdown fences is still parsed', async () => {
  // Claude sometimes adds ```json ...``` fences; the extractor scans for
  // the first balanced { ... } span and should succeed regardless.
  const wrapped = '```json\n{"verdict":"pass","unsupported_sentences":[]}\n```';
  globalThis.fetch = ((_u: string | URL, _i?: RequestInit) =>
    Promise.resolve(mockOkResponse(wrapped))) as typeof fetch;

  try {
    const result = await runGroundingCheck('answer', 'q', sampleChunks, 'sk-test');
    assertEquals(result.verdict, 'pass');
  } finally {
    restoreFetch();
  }
});