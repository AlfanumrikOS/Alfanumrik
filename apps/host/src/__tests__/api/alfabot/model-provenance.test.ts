/**
 * REG-67 — AlfaBot model provenance regression.
 *
 * Pins the contract that every AlfaBot turn records `model='gpt-4o-mini'`
 * (or the configured fallback) in THREE places:
 *
 *   1. `alfabot_messages.model` — persisted on the assistant row
 *   2. `audit_logs.details.model` — persisted on the `alfabot.respond` action
 *   3. Response envelope `body.model` — surfaced to the client widget
 *
 * Why this is catalogued (per .claude/CLAUDE.md):
 *   "User approval required for AI model changes". This regression is the
 *   mechanical guard — if a future PR silently swaps the model, this test
 *   fails and the change cannot land without an explicit catalog update.
 *
 * Test strategy mirrors `src/__tests__/api/alfabot/route.test.ts`:
 *   - Mock supabase-admin to capture INSERTs into `alfabot_messages`.
 *   - Mock logAudit to capture the audit row's `details.model`.
 *   - Mock the Edge Function fetch to return a known model in the JSON
 *     response so we can verify pass-through.
 *
 * Owner: testing.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ─── Env stubs (must run before module import) ──────────────────────────────
beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://test.local';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
  process.env.ALFABOT_IP_SALT = 'test-salt';
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
});

// ─── Mocks (hoisted; identical pattern to route.test.ts) ────────────────────

let _mockedAnonCookie: string | null = null;
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === 'alf_anon_id' && _mockedAnonCookie
        ? { name, value: _mockedAnonCookie }
        : undefined,
    set: vi.fn(),
  }),
}));

const _isFeatureEnabled = vi.fn();
vi.mock('@alfanumrik/lib/feature-flags', () => ({
  isFeatureEnabled: (...args: unknown[]) => _isFeatureEnabled(...args),
}));

vi.mock('@alfanumrik/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const _logAudit = vi.fn();
vi.mock('@alfanumrik/lib/rbac', () => ({
  logAudit: (...args: unknown[]) => _logAudit(...args),
}));

// In-memory state for the supabase mock — captures every alfabot_messages
// INSERT so we can inspect the `model` column.
const state = {
  messageInserts: [] as Array<{
    session_id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    model?: string;
  }>,
  nextSessionId: 'sess-aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
};

function resetState() {
  state.messageInserts.length = 0;
  state.nextSessionId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
}

function makeChain(table: string): Record<string, unknown> {
  const ctx: { filters: Array<{ col: string; val: unknown }> } = { filters: [] };
  const chain: Record<string, unknown> = {};

  chain.select = () => chain;
  chain.eq = (col: string, val: unknown) => {
    ctx.filters.push({ col, val });
    return chain;
  };
  chain.in = () => chain;
  chain.order = () => chain;
  chain.limit = () => chain;
  chain.update = () => chain;
  chain.insert = (row: Record<string, unknown> | Record<string, unknown>[]) => {
    const rows = Array.isArray(row) ? row : [row];
    if (table === 'alfabot_messages') {
      for (const r of rows) {
        state.messageInserts.push(r as unknown as (typeof state.messageInserts)[number]);
      }
    }
    return {
      select: () => ({
        single: async () => {
          if (table === 'alfabot_sessions') {
            const id = state.nextSessionId;
            return {
              data: {
                id,
                anon_id: 'test-anon',
                audience: 'parent',
                lang: 'en',
                message_count: 0,
              },
              error: null,
            };
          }
          return { data: null, error: null };
        },
      }),
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: null, error: null }).then(resolve),
    };
  };

  const resolveTerminal = (): { data: unknown; error: unknown } => {
    if (table === 'alfabot_messages') return { data: [], error: null };
    if (table === 'alfabot_denylist') return { data: null, error: null };
    return { data: null, error: null };
  };
  chain.maybeSingle = async () => resolveTerminal();
  chain.single = async () => resolveTerminal();
  (chain as { then: unknown }).then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve(resolveTerminal()).then(resolve);

  return chain;
}

vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  supabaseAdmin: { from: (table: string) => makeChain(table) },
}));

// ─── Edge Function fetch mock — controllable per test ───────────────────────

const _edgeFetchMock = vi.fn();

beforeEach(async () => {
  vi.clearAllMocks();
  resetState();
  vi.stubGlobal('fetch', _edgeFetchMock);
  _isFeatureEnabled.mockImplementation((flag: string) => {
    if (flag === 'ff_alfabot_v1') return Promise.resolve(true);
    if (flag === 'ff_alfabot_streaming') return Promise.resolve(false);
    return Promise.resolve(false);
  });
  const mod = await import('@/app/api/alfabot/route');
  mod._testing.resetMemoryStore();
  mod._testing.resetDenylistCache();
  mod._testing.resetBudgetMemory();
});

function makeRequest(opts: { body: Record<string, unknown>; anonCookie?: string }): NextRequest {
  _mockedAnonCookie = opts.anonCookie ?? null;
  return new NextRequest('http://localhost/api/alfabot', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-forwarded-for': '203.0.113.42',
      'user-agent': 'test-ua',
    },
    body: JSON.stringify(opts.body),
  });
}

function mockEdgeResponse(model: string) {
  _edgeFetchMock.mockResolvedValue(
    new Response(
      JSON.stringify({
        response: 'AlfaBot answer text.',
        sources: [],
        tokensUsed: 80,
        latencyMs: 200,
        estimatedCostUsd: 0.0002,
        model,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ),
  );
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('REG-67 — AlfaBot model provenance', () => {
  it('records model=gpt-4o-mini in alfabot_messages, audit_logs, and the response envelope', async () => {
    mockEdgeResponse('gpt-4o-mini');
    const { POST } = await import('@/app/api/alfabot/route');
    const res = await POST(
      makeRequest({
        body: { message: 'What is Foxy?', audience: 'parent', lang: 'en' },
        anonCookie: 'anon-model-1',
      }),
    );
    expect(res.status).toBe(200);

    // 1. Response envelope.
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.model).toBe('gpt-4o-mini');

    // 2. alfabot_messages.model (assistant row only — user rows must NOT
    //    carry a model field per the route's documented behaviour).
    const assistantRows = state.messageInserts.filter((r) => r.role === 'assistant');
    expect(assistantRows).toHaveLength(1);
    expect(assistantRows[0].model).toBe('gpt-4o-mini');
    const userRows = state.messageInserts.filter((r) => r.role === 'user');
    expect(userRows).toHaveLength(1);
    // P13 + audit policy: the user row has the visitor's message text (chat
    // history), but NO model column.
    expect(userRows[0]).not.toHaveProperty('model');

    // 3. audit_logs.details.model on the alfabot.respond action.
    const respondLogs = _logAudit.mock.calls.filter(
      (c: unknown[]) => (c[1] as Record<string, unknown>).action === 'alfabot.respond',
    );
    expect(respondLogs).toHaveLength(1);
    const details = (respondLogs[0][1] as { details: Record<string, unknown> }).details;
    expect(details.model).toBe('gpt-4o-mini');
  });

  it('honours the upstream model field when the Edge Function returns a fallback name', async () => {
    // The route's documented behaviour: if upstream returns a different
    // `model` (e.g. gpt-4o fallback after gpt-4o-mini failed), pass it
    // through verbatim so audit trails reflect reality.
    mockEdgeResponse('gpt-4o');
    const { POST } = await import('@/app/api/alfabot/route');
    const res = await POST(
      makeRequest({
        body: { message: 'How does pricing work?', audience: 'parent', lang: 'en' },
        anonCookie: 'anon-model-2',
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.model).toBe('gpt-4o');
    const assistantRows = state.messageInserts.filter((r) => r.role === 'assistant');
    expect(assistantRows[0].model).toBe('gpt-4o');
    const respondLogs = _logAudit.mock.calls.filter(
      (c: unknown[]) => (c[1] as Record<string, unknown>).action === 'alfabot.respond',
    );
    const details = (respondLogs[0][1] as { details: Record<string, unknown> }).details;
    expect(details.model).toBe('gpt-4o');
  });

  it('falls back to gpt-4o-mini when the Edge Function omits the model field', async () => {
    // Defensive: the route uses `upstreamBody.model || MODEL_ID` so a
    // missing upstream `model` should produce the constant default.
    _edgeFetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          response: 'Default model fallback.',
          sources: [],
          tokensUsed: 50,
          latencyMs: 150,
          // No `model` field.
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const { POST } = await import('@/app/api/alfabot/route');
    const res = await POST(
      makeRequest({
        body: { message: 'Hi', audience: 'parent', lang: 'en' },
        anonCookie: 'anon-model-3',
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.model).toBe('gpt-4o-mini');
    const assistantRows = state.messageInserts.filter((r) => r.role === 'assistant');
    expect(assistantRows[0].model).toBe('gpt-4o-mini');
  });

  it('stamps model=gpt-4o-mini on the upstream-failure audit row too', async () => {
    // When the Edge Function fails, the route logs an `alfabot.upstream_failed`
    // audit row with status='failure'. Per the route source, `model: MODEL_ID`
    // is hard-coded on that path — drift here would mean an outage hides
    // the model from forensics.
    _edgeFetchMock.mockResolvedValue(
      new Response('upstream error', { status: 503 }),
    );
    const { POST } = await import('@/app/api/alfabot/route');
    const res = await POST(
      makeRequest({
        body: { message: 'Hi', audience: 'parent', lang: 'en' },
        anonCookie: 'anon-model-4',
      }),
    );
    expect(res.status).toBe(200);
    const failedLogs = _logAudit.mock.calls.filter(
      (c: unknown[]) =>
        (c[1] as Record<string, unknown>).action === 'alfabot.upstream_failed',
    );
    expect(failedLogs).toHaveLength(1);
    const details = (failedLogs[0][1] as { details: Record<string, unknown> }).details;
    expect(details.model).toBe('gpt-4o-mini');
  });
});
