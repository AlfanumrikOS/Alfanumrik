// supabase/functions/grounded-answer/__tests__/embedding.test.ts
// Deno test runner. Run via:
//   cd supabase/functions/grounded-answer && deno test --allow-all
//
// Verifies Voyage embedding behaviour by stubbing the global fetch:
//   - happy path returns the embedding
//   - AbortError on first attempt triggers one retry
//   - timeout both times returns null
//   - HTTP 500 returns null (no retry on HTTP error)
//   - missing API key short-circuits with null

import { assertEquals } from 'https://deno.land/std@0.210.0/assert/mod.ts';
import { generateEmbedding } from '../embedding.ts';

// Rehydrate the original fetch after every test so stubs don't leak between cases.
const originalFetch = globalThis.fetch;
function restoreFetch() {
  globalThis.fetch = originalFetch;
}

function mockEmbedding(): number[] {
  // 1024-dim embedding (filled with a simple pattern so tests are deterministic)
  return Array.from({ length: 1024 }, (_, i) => (i % 7) * 0.01);
}

function mockOkResponse(embedding: number[]): Response {
  return new Response(JSON.stringify({ data: [{ embedding, index: 0 }] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function mockAbortPromise(): Promise<never> {
  return new Promise((_resolve, reject) => {
    // Simulate AbortController firing: throw the DOMException the caller
    // would see when signal.aborted triggers.
    reject(new DOMException('The signal has been aborted', 'AbortError'));
  });
}

Deno.test('first call succeeds → returns embedding array', async () => {
  const embedding = mockEmbedding();
  let calls = 0;
  globalThis.fetch = ((_url: string | URL, _init?: RequestInit) => {
    calls++;
    return Promise.resolve(mockOkResponse(embedding));
  }) as typeof fetch;

  try {
    const result = await generateEmbedding('what is photosynthesis?', 10_000, 'voy-key');
    assertEquals(result?.length, 1024);
    assertEquals(result?.[7], 0);
    assertEquals(calls, 1);
  } finally {
    restoreFetch();
  }
});

Deno.test('first call times out → retries → retry succeeds → returns embedding', async () => {
  const embedding = mockEmbedding();
  let calls = 0;
  globalThis.fetch = ((_url: string | URL, _init?: RequestInit) => {
    calls++;
    if (calls === 1) return mockAbortPromise();
    return Promise.resolve(mockOkResponse(embedding));
  }) as typeof fetch;

  try {
    const result = await generateEmbedding('test query', 10_000, 'voy-key');
    assertEquals(result?.length, 1024);
    assertEquals(calls, 2);
  } finally {
    restoreFetch();
  }
});

Deno.test('both calls time out → returns null', async () => {
  let calls = 0;
  globalThis.fetch = ((_url: string | URL, _init?: RequestInit) => {
    calls++;
    return mockAbortPromise();
  }) as typeof fetch;

  try {
    const result = await generateEmbedding('test query', 10_000, 'voy-key');
    assertEquals(result, null);
    assertEquals(calls, 2);
  } finally {
    restoreFetch();
  }
});

Deno.test('HTTP 500 → returns null and does not retry', async () => {
  let calls = 0;
  globalThis.fetch = ((_url: string | URL, _init?: RequestInit) => {
    calls++;
    return Promise.resolve(
      new Response('internal error', { status: 500 }),
    );
  }) as typeof fetch;

  try {
    const result = await generateEmbedding('test query', 10_000, 'voy-key');
    assertEquals(result, null);
    // HTTP errors don't retry — only timeouts do. Spec §6.4 step 2.
    assertEquals(calls, 1);
  } finally {
    restoreFetch();
  }
});

Deno.test('no API key → returns null without fetching', async () => {
  let calls = 0;
  globalThis.fetch = ((_url: string | URL, _init?: RequestInit) => {
    calls++;
    return Promise.resolve(mockOkResponse(mockEmbedding()));
  }) as typeof fetch;

  try {
    const result = await generateEmbedding('test query', 10_000, '');
    assertEquals(result, null);
    assertEquals(calls, 0);
  } finally {
    restoreFetch();
  }
});

Deno.test('empty query → returns null without fetching', async () => {
  let calls = 0;
  globalThis.fetch = ((_url: string | URL, _init?: RequestInit) => {
    calls++;
    return Promise.resolve(mockOkResponse(mockEmbedding()));
  }) as typeof fetch;

  try {
    const result = await generateEmbedding('   ', 10_000, 'voy-key');
    assertEquals(result, null);
    assertEquals(calls, 0);
  } finally {
    restoreFetch();
  }
});

Deno.test('wrong-dimension embedding → returns null', async () => {
  // Voyage could theoretically return a 512-dim vector if the model changes.
  // We must reject anything that won't fit rag_content_chunks.embedding vector(1024).
  const bad = Array.from({ length: 512 }, () => 0.1);
  globalThis.fetch = ((_url: string | URL, _init?: RequestInit) =>
    Promise.resolve(
      new Response(JSON.stringify({ data: [{ embedding: bad, index: 0 }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )) as typeof fetch;

  try {
    const result = await generateEmbedding('test', 10_000, 'voy-key');
    assertEquals(result, null);
  } finally {
    restoreFetch();
  }
});