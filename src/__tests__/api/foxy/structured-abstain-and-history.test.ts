/**
 * /api/foxy structured-payload — abstain + history (Phase 2 plumbing).
 *
 * Covers two contracts that the persistence test suite doesn't pin:
 *
 *   C. Hard-abstain branch:
 *        - Upstream returns { grounded: false, abstain_reason }.
 *        - Route response: groundingStatus='hard-abstain', NO `structured`
 *          field (abstain is a deliberate "no answer" — the structured
 *          renderer must not synthesize content here).
 *        - NO foxy_chat_messages rows are inserted (current route behavior;
 *          abstain branch returns early before persistence).
 *
 *   D. GET /api/foxy?sessionId loads historical messages including the
 *      `structured` JSONB column so the chat page can re-render past
 *      assistant turns with the structured renderer on session resume.
 *
 * P12 (AI Safety): no structured payload is ever surfaced for an abstain
 *   turn — the upstream did not produce a Claude answer.
 * P13 (Data Privacy): `sources` MUST stay out of the GET response shape.
 *   This file does not test that (covered by foxy-api-no-sources.test.ts);
 *   it only adds the new `structured` field assertion.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { FoxyResponse } from '@/lib/foxy/schema';

// ─── env stubs ───────────────────────────────────────────────────────────────
beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://test.local';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
});

// ─── RBAC mock ───────────────────────────────────────────────────────────────
const _authorizeImpl = vi.fn();
const _logAuditImpl = vi.fn();

vi.mock('@/lib/rbac', () => ({
  authorizeRequest: (...args: unknown[]) => _authorizeImpl(...args),
  logAudit: (...args: unknown[]) => _logAuditImpl(...args),
}));

// ─── Feature-flag mock ───────────────────────────────────────────────────────
const _isFeatureEnabled = vi.fn();
vi.mock('@/lib/feature-flags', () => ({
  isFeatureEnabled: (...args: unknown[]) => _isFeatureEnabled(...args),
}));

// ─── Subject-governance mock — pass-through ──────────────────────────────────
vi.mock('@/lib/subjects', () => ({
  validateSubjectWrite: vi.fn().mockResolvedValue({ ok: true }),
}));

// ─── Logger spy ──────────────────────────────────────────────────────────────
const loggerInfo = vi.fn();
const loggerWarn = vi.fn();
const loggerError = vi.fn();
vi.mock('@/lib/logger', () => ({
  logger: {
    info: (...args: unknown[]) => loggerInfo(...args),
    warn: (...args: unknown[]) => loggerWarn(...args),
    error: (...args: unknown[]) => loggerError(...args),
    debug: vi.fn(),
  },
}));

// ─── grounded-client mock — controlled per test ──────────────────────────────
type GroundedReturn = Record<string, unknown>;
let _groundedReturn: GroundedReturn = {};
function setGroundedReturn(value: GroundedReturn) {
  _groundedReturn = value;
}

vi.mock('@/lib/ai/grounded-client', () => ({
  callGroundedAnswer: (...args: unknown[]) => {
    void args;
    return Promise.resolve(_groundedReturn);
  },
  callGroundedAnswerStream: vi.fn().mockResolvedValue({ ok: false, reason: 'not-used' }),
}));

vi.mock('@/lib/ai', () => ({
  classifyIntent: vi.fn().mockResolvedValue({ intent: 'should-not-run' }),
  routeIntent: vi.fn().mockRejectedValue(new Error('legacy path should not run')),
}));

// ─── supabaseAdmin mock ──────────────────────────────────────────────────────
//
// Two capture surfaces:
//   - `insertCalls` records `from('foxy_chat_messages').insert([...])`
//   - `selectCalls` records `from('foxy_chat_messages').select(<columns>)`
//     which is what the GET handler / loadHistory uses.
//
// `_chatMessagesRows` is the dataset returned by the GET handler's terminal
// chained `.order(...)` await. Set per-test via `setHistoryRows`.

const insertCalls: { table: string; rows: unknown }[] = [];
const selectCalls: { table: string; columns: string }[] = [];
let _chatMessagesRows: unknown = [];

function setHistoryRows(rows: unknown) {
  _chatMessagesRows = rows;
}

function makeChain(table: string) {
  const chain: Record<string, unknown> = {};

  const resolveDefault = (): { data: unknown; error: unknown } => {
    if (table === 'students') {
      return {
        data: { subscription_plan: 'free', account_status: 'active', academic_goal: null },
        error: null,
      };
    }
    if (table === 'foxy_sessions') {
      return { data: { id: 'session-uuid-1', subject: 'math', grade: '7', chapter: null, mode: 'learn', created_at: '2026-05-02T00:00:00Z' }, error: null };
    }
    if (table === 'foxy_chat_messages') {
      // Terminal await on the GET-handler chain returns the configured rows.
      return { data: _chatMessagesRows, error: null };
    }
    return { data: [], error: null };
  };

  // Capture select columns so we can assert the GET handler asks for `structured`.
  chain.select = (cols: string) => {
    selectCalls.push({ table, columns: cols });
    return chain;
  };

  const fluent = [
    'insert',
    'update',
    'eq',
    'neq',
    'in',
    'ilike',
    'order',
    'limit',
    'gte',
    'lte',
    'not',
    'is',
  ];
  for (const m of fluent) {
    chain[m] = (..._args: unknown[]) => chain;
  }
  chain.insert = (rows: unknown) => {
    insertCalls.push({ table, rows });
    return {
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve({ data: null, error: null }).then(resolve, reject),
      select: () => ({
        single: () => Promise.resolve({ data: { id: 'session-uuid-1' }, error: null }),
      }),
    };
  };
  chain.single = () => Promise.resolve(resolveDefault());
  chain.maybeSingle = () => Promise.resolve(resolveDefault());
  (chain as { then: unknown }).then = (
    resolve: (v: unknown) => unknown,
    reject?: (e: unknown) => unknown,
  ) => Promise.resolve(resolveDefault()).then(resolve, reject);
  return chain;
}

const rpcImpl = vi.fn();

vi.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: (table: string) => makeChain(table),
    rpc: (...args: unknown[]) => rpcImpl(...args),
  },
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────
function makePostRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/foxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test' },
    body: JSON.stringify(body),
  });
}

function makeGetRequest(sessionId: string): NextRequest {
  return new NextRequest(`http://localhost/api/foxy?sessionId=${sessionId}`, {
    method: 'GET',
    headers: { Authorization: 'Bearer test' },
  });
}

const VALID_STRUCTURED: FoxyResponse = {
  title: 'Solving 2x + 3 = 11',
  subject: 'math',
  blocks: [
    { type: 'step', text: 'Subtract 3 from both sides.' },
    { type: 'math', latex: '2x = 8' },
    { type: 'answer', text: 'x = 4' },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  insertCalls.length = 0;
  selectCalls.length = 0;
  _chatMessagesRows = [];
  _authorizeImpl.mockResolvedValue({
    authorized: true,
    userId: 'auth-user-1',
    studentId: 'student-uuid-1',
    roles: ['student'],
    permissions: ['foxy.chat'],
  });
  _isFeatureEnabled.mockImplementation((flag: string) => {
    if (flag === 'ai_usage_global') return Promise.resolve(true);
    if (flag === 'ff_grounded_ai_foxy') return Promise.resolve(true);
    if (flag === 'ff_foxy_streaming') return Promise.resolve(false);
    return Promise.resolve(false);
  });
  rpcImpl.mockResolvedValue({
    data: [{ allowed: true, current_count: 1 }],
    error: null,
  });
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('/api/foxy hard-abstain — structured stays absent (case C)', () => {
  it('hard-abstain response omits structured and inserts no message rows', async () => {
    setGroundedReturn({
      grounded: false,
      abstain_reason: 'no_chunks_retrieved',
      suggested_alternatives: [],
      trace_id: 'trace-abstain-1',
      meta: { latency_ms: 50 },
    });

    const { POST } = await import('@/app/api/foxy/route');
    const res = await POST(
      makePostRequest({ message: 'Solve 2x + 3 = 11', subject: 'math', grade: '7' }),
    );
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.groundingStatus).toBe('hard-abstain');
    expect(body.response).toBe('');
    // Critical: NO structured field surfaces on the abstain branch.
    expect('structured' in body).toBe(false);
    // No foxy_chat_messages rows inserted on abstain (current route contract).
    const chatInserts = insertCalls.filter((c) => c.table === 'foxy_chat_messages');
    expect(chatInserts.length).toBe(0);
  });
});

describe('/api/foxy GET history — surfaces structured column (case D)', () => {
  it('selects the structured column and returns it on assistant rows', async () => {
    // Simulate two historical assistant rows: one with a structured payload
    // (post-Phase-2 row) and one without (legacy row written before the
    // structured-output migration).
    setHistoryRows([
      {
        id: 'msg-1',
        role: 'user',
        content: 'Solve 2x + 3 = 11',
        structured: null,
        tokens_used: null,
        created_at: '2026-05-01T10:00:00Z',
      },
      {
        id: 'msg-2',
        role: 'assistant',
        content: 'Solving 2x + 3 = 11\nStep 1: Subtract 3 from both sides.\n$$ 2x = 8 $$\nx = 4',
        structured: VALID_STRUCTURED,
        tokens_used: 42,
        created_at: '2026-05-01T10:00:01Z',
      },
      {
        id: 'msg-3',
        role: 'assistant',
        content: 'Legacy answer with no structured payload.',
        structured: null,
        tokens_used: 30,
        created_at: '2026-05-01T10:00:02Z',
      },
    ]);

    const { GET } = await import('@/app/api/foxy/route');
    const res = await GET(makeGetRequest('session-uuid-1'));
    const body = (await res.json()) as { success: boolean; messages: Array<Record<string, unknown>> };

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);

    // The select(...) call against foxy_chat_messages MUST include `structured`.
    const chatSelects = selectCalls.filter((c) => c.table === 'foxy_chat_messages');
    expect(chatSelects.length).toBeGreaterThanOrEqual(1);
    const cols = chatSelects[chatSelects.length - 1].columns;
    expect(cols).toContain('structured');
    // Defense: still excludes `sources` (Phase 0 contract preserved).
    expect(cols).not.toContain('sources');

    // Wire shape: returned messages carry the structured field through.
    expect(body.messages.length).toBe(3);
    const assistantWithStructured = body.messages.find((m) => m.id === 'msg-2');
    expect(assistantWithStructured?.structured).toEqual(VALID_STRUCTURED);
    const legacyAssistant = body.messages.find((m) => m.id === 'msg-3');
    expect(legacyAssistant?.structured).toBeNull();
    const userRow = body.messages.find((m) => m.id === 'msg-1');
    expect(userRow?.structured).toBeNull();
  });
});
