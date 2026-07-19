// supabase/functions/alfabot-answer/__tests__/integration.test.ts
//
// End-to-end tests for the AlfaBot Edge Function entry point. Mocks the
// OpenAI + Voyage HTTP layer via globalThis.fetch stubbing (the MOL cassette
// helper is Node-only and unavailable here). Each test installs a fresh fetch
// stub keyed off the URL pattern.
//
// Run:
//   cd supabase/functions/alfabot-answer && deno test --allow-all

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from 'https://deno.land/std@0.210.0/assert/mod.ts';

import { handleRequest, __setSupabaseClientForTests } from '../index.ts';
import { __resetAllForTests as resetCircuit } from '../circuit.ts';

// ─── Env stubs ──────────────────────────────────────────────────────────────

Deno.env.set('OPENAI_API_KEY', 'sk-test-fake');
Deno.env.set('VOYAGE_API_KEY', 'voyage-test-fake');
Deno.env.set('SUPABASE_URL', 'https://test.supabase.co');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'service-role-test');

// ─── Test helpers ───────────────────────────────────────────────────────────

interface FetchStubConfig {
  /** Synthetic OpenAI completion text (used for chat-completions calls). */
  openAiText?: string;
  /** Embedding to return from Voyage. Default: a [0...] vector of length 1024. */
  voyageEmbedding?: number[];
  /** If true, OpenAI returns 500. */
  openAiServerError?: boolean;
  /** If true, OpenAI fetch hangs past the timeout. */
  openAiTimeout?: boolean;
}

const ORIGINAL_FETCH = globalThis.fetch;

function installFetchStub(cfg: FetchStubConfig = {}): void {
  const embedding = cfg.voyageEmbedding ?? new Array(1024).fill(0);

  globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === 'string'
      ? input
      : input instanceof URL
      ? input.toString()
      : input.url;

    if (url.includes('api.voyageai.com')) {
      return new Response(
        JSON.stringify({ data: [{ embedding, index: 0 }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    if (url.includes('api.openai.com')) {
      if (cfg.openAiServerError) {
        return new Response('upstream down', { status: 500 });
      }
      if (cfg.openAiTimeout) {
        // Sleep longer than the OpenAI client's 20s timeout.
        await new Promise((r) => setTimeout(r, 25_000));
        return new Response('late', { status: 200 });
      }
      const text = cfg.openAiText ?? 'Default test reply. (company)';
      return new Response(
        JSON.stringify({
          id: 'chatcmpl-test',
          object: 'chat.completion',
          model: 'gpt-4o-mini',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: text },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 800, completion_tokens: 60 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    // Fall through — should never happen in these tests.
    return new Response('unexpected fetch target', { status: 599 });
  }) as typeof fetch;
}

function restoreFetch(): void {
  globalThis.fetch = ORIGINAL_FETCH;
}

// Stub Supabase RPC client. The retrieval module calls .rpc('match_alfabot_kb_chunks', ...)
// and expects { data, error } back. We control what chunks are "retrieved".
interface ChunkRow {
  id: string;
  section_id: string;
  title: string;
  content: string;
  canonical: boolean;
  similarity: number;
}

function stubSupabase(chunks: ChunkRow[]): void {
  __setSupabaseClientForTests({
    // deno-lint-ignore no-explicit-any
    rpc: (_name: string, _args: unknown): Promise<{ data: ChunkRow[]; error: null }> => {
      return Promise.resolve({ data: chunks, error: null });
    },
  });
}

function makeBody(overrides: Record<string, unknown> = {}): unknown {
  return {
    message: 'How much does Alfanumrik cost?',
    audience: 'parent',
    lang: 'en',
    sessionId: '11111111-1111-1111-1111-111111111111',
    history: [],
    anonId: 'anon-test-1',
    ...overrides,
  };
}

function makeJsonRequest(body: unknown): Request {
  return new Request('https://example.com/alfabot-answer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
}

// ─── Tests ──────────────────────────────────────────────────────────────────

Deno.test('happy path: parent asks pricing → response contains ₹699 + cites (pricing-plans)', async () => {
  resetCircuit();
  // Fixture updated 2026-07-17 (pricing-framing fix): mirrors the truthful
  // tier-ladder canonical copy — the old "everything included / no upsells"
  // framing contradicted the live 3-tier product and was removed from the KB.
  installFetchStub({
    openAiText:
      'Pro, at ₹699 per month, is our most popular family plan — Foxy with 100 chats a day, unlimited quizzes, all seven subjects, and the Sunday parent letter. Starter is ₹299 per month and Unlimited is ₹1,099 per month (pricing-plans). Want to try Foxy free? Sign up at /.',
  });
  stubSupabase([
    {
      id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      section_id: 'pricing-plans',
      title: 'Pricing Plans',
      content:
        'Pro: ₹699 per month — our most popular family plan. Starter: ₹299 per month. Unlimited: ₹1,099 per month. Every plan starts free on the Explorer tier — no credit card required. Cancel anytime, one tap, no questions.',
      canonical: true,
      similarity: 0.85,
    },
  ]);

  try {
    const res = await handleRequest(makeJsonRequest(makeBody()));
    assertEquals(res.status, 200);
    const body = await res.json();
    assertStringIncludes(body.response, '₹699');
    assertStringIncludes(body.response, '(pricing-plans)');
    assertEquals(body.degradedMode, false);
    assert(body.sourcesUsed.includes('pricing-plans'));
    assertEquals(body.model, 'gpt-4o-mini');
  } finally {
    restoreFetch();
  }
});

Deno.test('out-of-scope: math homework → not_a_tutor refusal', async () => {
  resetCircuit();
  installFetchStub();
  stubSupabase([]);
  try {
    const res = await handleRequest(
      makeJsonRequest(makeBody({ message: 'solve 2+2', audience: 'student' })),
    );
    assertEquals(res.status, 200);
    const body = await res.json();
    assertStringIncludes(body.response, "I'm not a tutor");
    assertStringIncludes(body.response, 'Foxy');
    assertEquals(body.abstainReason, 'hard_refusal_not_a_tutor');
    // Hard refusal happens BEFORE model call.
    assertEquals(body.tokensUsed, 0);
    assertEquals(body.model, 'hard_refusal');
  } finally {
    restoreFetch();
  }
});

Deno.test('banned phrase: model says "coming soon" → post-process rewrites to abstain', async () => {
  resetCircuit();
  installFetchStub({
    openAiText:
      'We are working on this feature, coming soon to all parents (product-features).',
  });
  stubSupabase([
    {
      id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      section_id: 'product-features',
      title: 'Product Features',
      content: 'Foxy is your study buddy.',
      canonical: false,
      similarity: 0.7,
    },
  ]);
  try {
    const res = await handleRequest(
      makeJsonRequest(makeBody({ message: 'do you support biology?' })),
    );
    const body = await res.json();
    assertEquals(body.degradedMode, true);
    assertEquals(body.abstainReason, 'banned_phrase');
    assertStringIncludes(body.response, "I don't have that info");
  } finally {
    restoreFetch();
  }
});

Deno.test('empty retrieval + model invents a citation → orphan_citation abstain', async () => {
  resetCircuit();
  installFetchStub({
    openAiText:
      'Alfanumrik is an Indian K-12 EdTech company building a CBSE-aligned learning OS (company). Want to learn more? Email hello@alfanumrik.com.',
  });
  stubSupabase([]);
  try {
    const res = await handleRequest(
      makeJsonRequest(makeBody({ message: 'tell me about your company' })),
    );
    const body = await res.json();
    // With zero retrieved chunks, the only valid cited sections are the
    // canonical core ones (pricing-plans, safety-privacy-dpdpa,
    // refusal-policy, contact). A "(company)" cite is therefore an orphan
    // and the post-validator MUST abstain — defense-in-depth against
    // hallucinated citations when retrieval drops out.
    assertEquals(body.degradedMode, true);
    assertEquals(body.abstainReason, 'orphan_citation');
    assertStringIncludes(body.response, "I don't have that info");
  } finally {
    restoreFetch();
  }
});

Deno.test('empty retrieval + model cites only canonical sections → passes through', async () => {
  resetCircuit();
  installFetchStub({
    openAiText:
      'You can reach our team at hello@alfanumrik.com any business day (contact). Happy to help!',
  });
  stubSupabase([]);
  try {
    const res = await handleRequest(
      makeJsonRequest(makeBody({ message: 'how do I reach support?' })),
    );
    const body = await res.json();
    assertEquals(body.degradedMode, false);
    assertStringIncludes(body.response, '(contact)');
  } finally {
    restoreFetch();
  }
});

Deno.test('audience routing: school → response tone mentions ROI / sales', async () => {
  resetCircuit();
  // Audience routing is enforced by the system prompt; here we just verify
  // the audience flows through to the request and the response is served
  // without error, with the school audience in the log path.
  installFetchStub({
    openAiText:
      'For schools we offer 30 to 3,000 seats and connect you with our sales team for a quote (school-b2b). Visit /for-schools or email hello@alfanumrik.com.',
  });
  stubSupabase([
    {
      id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
      section_id: 'school-b2b',
      title: 'School B2B',
      content:
        'Bulk seats 30-3,000. NEP-aligned. Sales team responds within one business day.',
      canonical: false,
      similarity: 0.8,
    },
  ]);
  try {
    const res = await handleRequest(
      makeJsonRequest(
        makeBody({
          audience: 'school',
          message: 'how do you onboard new schools?',
        }),
      ),
    );
    const body = await res.json();
    assertEquals(body.degradedMode, false);
    const lower = body.response.toLowerCase();
    assert(
      lower.includes('sales') || lower.includes('school') || lower.includes('roi'),
      `school audience response did not contain expected keywords: ${body.response}`,
    );
  } finally {
    restoreFetch();
  }
});

Deno.test('language routing: lang=hi refusal in Devanagari', async () => {
  resetCircuit();
  installFetchStub();
  stubSupabase([]);
  try {
    const res = await handleRequest(
      makeJsonRequest(
        makeBody({
          message: 'solve x + 5 = 10',
          lang: 'hi',
        }),
      ),
    );
    const body = await res.json();
    // Hindi refusal should contain Devanagari characters.
    assert(
      /[ऀ-ॿ]/.test(body.response),
      `expected Devanagari in response, got: ${body.response}`,
    );
    assertEquals(body.abstainReason, 'hard_refusal_not_a_tutor');
  } finally {
    restoreFetch();
  }
});

Deno.test('upstream 500: degraded mode, abstain reply, never 5xx', async () => {
  resetCircuit();
  installFetchStub({ openAiServerError: true });
  stubSupabase([]);
  try {
    const res = await handleRequest(
      makeJsonRequest(makeBody({ message: 'tell me about Foxy' })),
    );
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.degradedMode, true);
    assert(body.abstainReason?.startsWith('upstream_'));
    assertStringIncludes(body.response, "I don't have that info");
  } finally {
    restoreFetch();
  }
});

Deno.test('invalid body returns 400 with field-specific error', async () => {
  resetCircuit();
  const res = await handleRequest(
    new Request('https://example.com/alfabot-answer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'hi' }), // missing audience/lang/etc.
    }),
  );
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error, 'invalid_audience');
});

Deno.test('CORS preflight returns 204 with permissive headers', async () => {
  const res = await handleRequest(
    new Request('https://example.com/alfabot-answer', { method: 'OPTIONS' }),
  );
  assertEquals(res.status, 204);
  assertEquals(res.headers.get('Access-Control-Allow-Origin'), '*');
});
