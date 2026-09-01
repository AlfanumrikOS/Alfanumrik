// supabase/functions/grounded-answer/__tests__/e2e.test.ts
// End-to-end stubbed test that exercises the full handleRequest HTTP entry
// point for every response path the service produces:
//
//   1. chapter_not_ready   (coverage precheck fails)
//   2. no_chunks_retrieved (strict mode, fewer than 3 chunks)
//   3. low_similarity      (strict mode, confidence below threshold)
//   4. no_supporting_chunks (grounding check returns fail)
//   5. upstream_error      (Claude returns 529 on both Haiku + Sonnet)
//   6. circuit_open        (after tripping the breaker via 3 failures)
//   7. grounded:true       (happy path with citations)
//
// All upstream calls are fetch-stubbed. Supabase client is stubbed via
// __setSupabaseClientForTests. Feature flags + circuits + cache are reset
// at the top of every test.
//
// Deno test runner:
//   deno test --allow-env --allow-read supabase/functions/grounded-answer/__tests__/
//
// NOTE — no --allow-net, on purpose. index.ts guards its Deno.serve() behind
// `import.meta.main`, so importing it here binds no socket. Every upstream call
// is fetch-stubbed, so a network permission would only mask a missing stub.
//
// ADMISSION: handleRequest runs resolveSecurityPrincipal before the pipeline.
// These tests therefore send REAL signed internal-service requests built by
// ./_security-harness.ts — see that file's header for why nothing here weakens
// the auth path, and see the "admission gate is real" tests at the bottom of
// this file for the negative pins.

import { assert, assertEquals } from 'https://deno.land/std@0.210.0/assert/mod.ts';
import {
  handleRequest,
  __resetFeatureFlagCacheForTests,
  __setSupabaseClientForTests,
} from '../index.ts';
import { __clearCacheForTests } from '../cache.ts';
import { __resetAllForTests as __resetCircuitsForTests } from '../circuit.ts';
import { __resetEverydayFlagCacheForTests } from '../_everyday-flag.ts';
import { MIN_CHUNKS_FOR_READY } from '../config.ts';
import { signedRequest, withSecurityRpcs } from './_security-harness.ts';

Deno.env.set('ANTHROPIC_API_KEY', 'test-key');
Deno.env.set('OPENAI_API_KEY', 'test-key');

const originalFetch = globalThis.fetch;
function restoreFetch() {
  globalThis.fetch = originalFetch;
}

function resetAll() {
  __resetFeatureFlagCacheForTests();
  // ff_foxy_everyday_examples_v1 is memoised for 60s at MODULE scope
  // (_everyday-flag.ts). Without this reset the FIRST test in the whole `deno
  // test` process to read it pins the value for every later test in every
  // later file — a cross-file order dependency that silently changed gen_ctx
  // (and therefore cache keys) under pipeline.test.ts.
  __resetEverydayFlagCacheForTests();
  __clearCacheForTests();
  __resetCircuitsForTests();
}

function voyageOk(): Response {
  return new Response(
    JSON.stringify({ data: [{ embedding: new Array(1024).fill(0.01) }] }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

function llmOk(url: string, text: string, inputTokens = 50, outputTokens = 100): Response {
  const isOpenAI = url.includes('openai.com');
  const body = isOpenAI
    ? {
        choices: [{ message: { content: text } }],
        usage: { prompt_tokens: inputTokens, completion_tokens: outputTokens },
      }
    : {
        content: [{ type: 'text', text }],
        usage: { input_tokens: inputTokens, output_tokens: outputTokens },
      };
  return new Response(
    JSON.stringify(body),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

function claude529(): Response {
  return new Response('overloaded', { status: 529 });
}

interface StubBuild {
  chapter_ready?: boolean;
  flag_enabled?: boolean;
  chunks?: Array<{
    id: string;
    content: string;
    chapter_number: number;
    chapter_title: string;
    page_number: number | null;
    similarity: number;
  }>;
  trace_id?: string;
}

// deno-lint-ignore no-explicit-any
function sbStub(fx: StubBuild): any {
  // withSecurityRpcs supplies ONLY the security_* RPC rows (registered active
  // internal caller, enabled enforce-mode route policy, allowed quota) that a
  // correctly-provisioned database would return. It cannot influence the bearer
  // token / timestamp / HMAC checks resolveSecurityPrincipal performs itself.
  return withSecurityRpcs({
    from(table: string) {
      if (table === 'cbse_syllabus') {
        return {
          select(cols: string) {
            // 2026-08-01: coverage.ts's specific-chapter query switched from
            // .select('rag_status') to .select('chunk_count'), and the
            // alternatives query from .eq('rag_status','ready') to
            // .gte('chunk_count', MIN_CHUNKS_FOR_READY). pipeline.test.ts's
            // stub was updated the same day; THIS one was not, because the
            // suite was already failing 401 at admission so nobody saw it.
            // Both shapes below now mirror coverage.ts exactly.
            if (cols.trim() === 'chunk_count') {
              return chainEq(3, () => ({
                maybeSingle: () =>
                  Promise.resolve({
                    data: fx.chapter_ready
                      ? { chunk_count: MIN_CHUNKS_FOR_READY + 150 }
                      : null,
                    error: null,
                  }),
              }));
            }
            // alternatives / subject-wide query:
            // .eq().eq().gte().eq().order().limit()
            return {
              eq: () => ({
                eq: () => ({
                  gte: () => ({
                    eq: () => ({
                      order: () => ({
                        limit: () => Promise.resolve({ data: [], error: null }),
                      }),
                    }),
                  }),
                }),
              }),
            };
          },
        };
      }
      if (table === 'feature_flags') {
        return {
          select: () => ({
            eq: () => ({
              single: () =>
                Promise.resolve({
                  data: { is_enabled: fx.flag_enabled !== false },
                  error: null,
                }),
            }),
          }),
        };
      }
      if (table === 'grounded_ai_traces') {
        return {
          insert: () => ({
            select: () => ({
              single: () =>
                Promise.resolve({
                  data: { id: fx.trace_id ?? 'e2e-trace' },
                  error: null,
                }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
    rpc() {
      return Promise.resolve({
        data: (fx.chunks ?? []).map((c) => ({
          id: c.id,
          content: c.content,
          chapter_number: c.chapter_number,
          chapter_title: c.chapter_title,
          page_number: c.page_number,
          similarity: c.similarity,
          media_url: null,
          media_description: null,
        })),
        error: null,
      });
    },
  });
}

// deno-lint-ignore no-explicit-any
function chainEq(n: number, terminal: () => any): any {
  if (n === 0) return terminal();
  return { eq: () => chainEq(n - 1, terminal) };
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    caller: 'foxy',
    student_id: null,
    query: 'What is photosynthesis?',
    scope: {
      board: 'CBSE',
      grade: '10',
      subject_code: 'science',
      chapter_number: 1,
      chapter_title: 'Light',
    },
    mode: 'strict',
    generation: {
      model_preference: 'auto',
      max_tokens: 512,
      temperature: 0.3,
      system_prompt_template: 'foxy_tutor_v1',
      template_variables: {},
    },
    retrieval: { match_count: 5 },
    retrieve_only: false,
    timeout_ms: 30_000,
    ...overrides,
  };
}

const ROUTE_URL = 'http://localhost/grounded-answer';

/**
 * A genuinely signed internal-service request — the same credential shape
 * /api/foxy sends in production. Async because the HMAC signature is computed
 * with WebCrypto over the canonical request.
 */
function mkRequest(
  body: unknown,
  opts: Parameters<typeof signedRequest>[2] = {},
): Promise<Request> {
  return signedRequest(ROUTE_URL, body, opts);
}

function fiveChunks(sim = 0.025) {
  return [1, 2, 3, 4, 5].map((n) => ({
    id: `chunk-${n}`,
    content: `NCERT content about photosynthesis (chunk ${n}).`,
    chapter_number: 1,
    chapter_title: 'Light',
    page_number: n,
    similarity: sim - n * 0.001,
  }));
}

// ── 1. chapter_not_ready ────────────────────────────────────────────────────
Deno.test('e2e: chapter_not_ready', async () => {
  resetAll();
  __setSupabaseClientForTests(sbStub({ chapter_ready: false, flag_enabled: true }));
  const resp = await handleRequest(await mkRequest(validBody()));
  assertEquals(resp.status, 200);
  const payload = await resp.json();
  assertEquals(payload.grounded, false);
  assertEquals(payload.abstain_reason, 'chapter_not_ready');
});

// ── 2. no_chunks_retrieved (strict, <3 chunks) ──────────────────────────────
Deno.test('e2e: no_chunks_retrieved (strict mode, 0 chunks)', async () => {
  resetAll();
  __setSupabaseClientForTests(
    sbStub({ chapter_ready: true, flag_enabled: true, chunks: [] }),
  );
  globalThis.fetch = ((_u: string | URL) => Promise.resolve(voyageOk())) as typeof fetch;
  try {
    const resp = await handleRequest(await mkRequest(validBody()));
    const payload = await resp.json();
    assertEquals(payload.grounded, false);
    assertEquals(payload.abstain_reason, 'no_chunks_retrieved');
  } finally {
    restoreFetch();
  }
});

// ── 3. low_similarity (strict, confidence below threshold) ──────────────────
Deno.test('e2e: low_similarity abstains in strict mode', async () => {
  resetAll();
  // Low-similarity chunks (well below strict threshold of 0.75 for topSim).
  // But retrieval.ts also enforces minSimilarity — to bypass, override
  // min_similarity_override to allow low-sim chunks through, then rely on
  // confidence calculation to push below 0.75.
  const weakChunks = [1, 2, 3].map((n) => ({
    id: `weak-${n}`,
    content: `Weak chunk ${n}`,
    chapter_number: 1,
    chapter_title: 'Light',
    page_number: n,
    similarity: 0.015,
  }));
  __setSupabaseClientForTests(
    sbStub({ chapter_ready: true, flag_enabled: true, chunks: weakChunks }),
  );
  globalThis.fetch = ((url: string | URL) => {
    const u = String(url);
    if (u.includes('voyageai')) return Promise.resolve(voyageOk());
    if (u.includes('anthropic') || u.includes('openai.com')) {
      return Promise.resolve(
        llmOk(
          u,
          JSON.stringify({ verdict: 'pass', unsupported_sentences: [] }),
        ),
      );
    }
    throw new Error(`unexpected ${u}`);
  }) as typeof fetch;

  try {
    const body = validBody({
      retrieval: { match_count: 10, min_similarity_override: 0.01 },
    });
    // Claude will be called once for answer, once for grounding check.
    // Our simple stub returns the same JSON both times; the "answer" call
    // happens to return valid JSON, which Claude interprets as the
    // answer. Grounding check then passes. Low topSim (0.4) + count
    // coverage (3/10) ⇒ confidence well below 0.75.
    const resp = await handleRequest(await mkRequest(body));
    const payload = await resp.json();
    assertEquals(payload.grounded, false);
    assertEquals(payload.abstain_reason, 'low_similarity');
  } finally {
    restoreFetch();
  }
});

// ── 4. no_supporting_chunks (grounding check fail) ──────────────────────────
Deno.test('e2e: no_supporting_chunks on grounding-check fail', async () => {
  resetAll();
  __setSupabaseClientForTests(
    sbStub({ chapter_ready: true, flag_enabled: true, chunks: fiveChunks() }),
  );
  let call = 0;
  globalThis.fetch = ((url: string | URL) => {
    const u = String(url);
    if (u.includes('voyageai')) return Promise.resolve(voyageOk());
    if (u.includes('anthropic') || u.includes('openai.com')) {
      call++;
      if (call === 1) return Promise.resolve(llmOk(u, 'An answer not supported by chunks.'));
      return Promise.resolve(
        llmOk(
          u,
          JSON.stringify({
            verdict: 'fail',
            unsupported_sentences: ['An answer not supported by chunks.'],
          }),
        ),
      );
    }
    throw new Error(`unexpected ${u}`);
  }) as typeof fetch;

  try {
    const resp = await handleRequest(await mkRequest(validBody()));
    const payload = await resp.json();
    assertEquals(payload.grounded, false);
    assertEquals(payload.abstain_reason, 'no_supporting_chunks');
  } finally {
    restoreFetch();
  }
});

// ── 5. upstream_error (Claude 529 on both attempts) ─────────────────────────
Deno.test('e2e: upstream_error when Claude returns 529 on both models', async () => {
  resetAll();
  __setSupabaseClientForTests(
    sbStub({ chapter_ready: true, flag_enabled: true, chunks: fiveChunks() }),
  );
  globalThis.fetch = ((url: string | URL) => {
    const u = String(url);
    if (u.includes('voyageai')) return Promise.resolve(voyageOk());
    if (u.includes('anthropic') || u.includes('openai.com')) return Promise.resolve(claude529());
    throw new Error(`unexpected ${u}`);
  }) as typeof fetch;

  try {
    const resp = await handleRequest(await mkRequest(validBody()));
    const payload = await resp.json();
    assertEquals(payload.grounded, false);
    assertEquals(payload.abstain_reason, 'upstream_error');
  } finally {
    restoreFetch();
  }
});

// ── 6. circuit_open ─────────────────────────────────────────────────────────
Deno.test('e2e: circuit_open after 3 consecutive upstream failures', async () => {
  resetAll();
  __setSupabaseClientForTests(
    sbStub({ chapter_ready: true, flag_enabled: true, chunks: fiveChunks() }),
  );
  globalThis.fetch = ((url: string | URL) => {
    const u = String(url);
    if (u.includes('voyageai')) return Promise.resolve(voyageOk());
    if (u.includes('anthropic') || u.includes('openai.com')) return Promise.resolve(claude529());
    throw new Error(`unexpected ${u}`);
  }) as typeof fetch;

  try {
    // 3 upstream failures in a row trip the breaker.
    for (let i = 0; i < 3; i++) {
      const r = await handleRequest(await mkRequest(validBody()));
      const p = await r.json();
      assertEquals(p.abstain_reason, 'upstream_error');
    }
    // 4th request: circuit open → no upstream call, abstain with circuit_open.
    const resp = await handleRequest(await mkRequest(validBody()));
    const payload = await resp.json();
    assertEquals(payload.grounded, false);
    assertEquals(payload.abstain_reason, 'circuit_open');
  } finally {
    restoreFetch();
  }
});

// ── 7. grounded:true (happy path) ───────────────────────────────────────────
Deno.test('e2e: grounded:true on happy path with citations', async () => {
  resetAll();
  __setSupabaseClientForTests(
    sbStub({ chapter_ready: true, flag_enabled: true, chunks: fiveChunks() }),
  );
  let call = 0;
  globalThis.fetch = ((url: string | URL) => {
    const u = String(url);
    if (u.includes('voyageai')) return Promise.resolve(voyageOk());
    if (u.includes('anthropic') || u.includes('openai.com')) {
      call++;
      if (call === 1) {
        return Promise.resolve(
          llmOk(u, 'Photosynthesis produces food [1]. Chlorophyll absorbs light [2].'),
        );
      }
      return Promise.resolve(
        llmOk(u, JSON.stringify({ verdict: 'pass', unsupported_sentences: [] })),
      );
    }
    throw new Error(`unexpected ${u}`);
  }) as typeof fetch;

  try {
    const resp = await handleRequest(await mkRequest(validBody()));
    assertEquals(resp.status, 200);
    const payload = await resp.json();
    assertEquals(payload.grounded, true);
    assert(Array.isArray(payload.citations));
    assert(payload.citations.length >= 2);
    assert(typeof payload.confidence === 'number');
    assert(payload.trace_id);
  } finally {
    restoreFetch();
  }
});

// ── Retrieve-only happy path (for completeness) ─────────────────────────────
Deno.test('e2e: retrieve_only returns citations without Claude', async () => {
  resetAll();
  __setSupabaseClientForTests(
    sbStub({ chapter_ready: true, flag_enabled: true, chunks: fiveChunks() }),
  );
  globalThis.fetch = ((url: string | URL) => {
    const u = String(url);
    if (u.includes('voyageai')) return Promise.resolve(voyageOk());
    throw new Error('Claude should NOT be called in retrieve_only mode');
  }) as typeof fetch;

  try {
    const resp = await handleRequest(await mkRequest(validBody({ retrieve_only: true })));
    const payload = await resp.json();
    assertEquals(payload.grounded, true);
    assertEquals(payload.answer, '');
    assertEquals(payload.citations.length, 5);
  } finally {
    restoreFetch();
  }
});

// ── Admission gate is REAL (negative pins) ──────────────────────────────────
// These four tests exist so the signed-request helper above can never be
// mistaken for a bypass. Every positive test in this file reaches the pipeline
// only because it presents a valid service token, a fresh timestamp and a
// correct HMAC signature; remove any ONE of those and admission must still
// reject the request BEFORE the pipeline runs. If someone weakened
// resolveSecurityPrincipal (or added a test-only escape hatch to index.ts),
// these four go red.

Deno.test('e2e: admission — no Authorization header -> 401 deny_auth, pipeline never runs', async () => {
  resetAll();
  __setSupabaseClientForTests(
    sbStub({ chapter_ready: true, flag_enabled: true, chunks: fiveChunks() }),
  );
  globalThis.fetch = (() => {
    throw new Error('no upstream call may happen for a rejected request');
  }) as typeof fetch;
  try {
    const resp = await handleRequest(
      await mkRequest(validBody(), { bearerToken: null, omitSignature: true }),
    );
    assertEquals(resp.status, 401);
    const payload = await resp.json();
    assertEquals(payload.error, 'deny_auth');
    assertEquals(payload.grounded, undefined);
  } finally {
    restoreFetch();
  }
});

Deno.test('e2e: admission — valid token but tampered signature -> 401 deny_signature', async () => {
  resetAll();
  __setSupabaseClientForTests(
    sbStub({ chapter_ready: true, flag_enabled: true, chunks: fiveChunks() }),
  );
  globalThis.fetch = (() => {
    throw new Error('no upstream call may happen for a rejected request');
  }) as typeof fetch;
  try {
    const resp = await handleRequest(
      await mkRequest(validBody(), { signingSecret: 'wrong-signing-secret' }),
    );
    assertEquals(resp.status, 401);
    const payload = await resp.json();
    assertEquals(payload.error, 'deny_signature');
  } finally {
    restoreFetch();
  }
});

Deno.test('e2e: admission — correct signature but stale timestamp -> 401 deny_signature', async () => {
  resetAll();
  __setSupabaseClientForTests(
    sbStub({ chapter_ready: true, flag_enabled: true, chunks: fiveChunks() }),
  );
  globalThis.fetch = (() => {
    throw new Error('no upstream call may happen for a rejected request');
  }) as typeof fetch;
  try {
    // Signed correctly over a timestamp 10 minutes old: the HMAC verifies, the
    // 300s skew window does not.
    const stale = Math.floor(Date.now() / 1000) - 600;
    const resp = await handleRequest(
      await mkRequest(validBody(), { timestampSeconds: stale }),
    );
    assertEquals(resp.status, 401);
    const payload = await resp.json();
    assertEquals(payload.error, 'deny_signature');
  } finally {
    restoreFetch();
  }
});

Deno.test('e2e: admission — body tampered after signing -> 401 deny_signature', async () => {
  resetAll();
  __setSupabaseClientForTests(
    sbStub({ chapter_ready: true, flag_enabled: true, chunks: fiveChunks() }),
  );
  globalThis.fetch = (() => {
    throw new Error('no upstream call may happen for a rejected request');
  }) as typeof fetch;
  try {
    // Sign one body, send a different one. The signature covers sha256(body),
    // so swapping the payload must invalidate it.
    const signed = await mkRequest(validBody());
    const headers = new Headers(signed.headers);
    const tampered = new Request(signed.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(validBody({ query: 'a different question entirely' })),
    });
    const resp = await handleRequest(tampered);
    assertEquals(resp.status, 401);
    const payload = await resp.json();
    assertEquals(payload.error, 'deny_signature');
  } finally {
    restoreFetch();
  }
});
