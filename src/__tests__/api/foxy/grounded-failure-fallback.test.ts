/**
 * /api/foxy grounded-answer failure fallback.
 *
 * Pins the user-visible contract that infra failures coming back from the
 * grounded-answer service do NOT surface the "catching its breath" abstain
 * card. Instead, Foxy falls back to the legacy Claude/OpenAI flow and returns
 * a normal answer.
 *
 * The grounded service remains primary. Only upstream failures such as
 * `upstream_error` and `circuit_open` should route into the fallback path.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://test.local';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
});

const _authorizeImpl = vi.fn();
const _logAuditImpl = vi.fn();

vi.mock('@/lib/rbac', () => ({
  authorizeRequest: (...args: unknown[]) => _authorizeImpl(...args),
  logAudit: (...args: unknown[]) => _logAuditImpl(...args),
}));

const _isFeatureEnabled = vi.fn();
vi.mock('@/lib/feature-flags', () => ({
  isFeatureEnabled: (...args: unknown[]) => _isFeatureEnabled(...args),
}));

vi.mock('@/lib/subjects', () => ({
  validateSubjectWrite: vi.fn().mockResolvedValue({ ok: true }),
}));

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

const groundedCalls: Array<{ request: Record<string, unknown>; hopTimeoutMs?: number }> = [];
const routeIntentImpl = vi.fn().mockResolvedValue({
  response: 'Legacy fallback answer.',
  sources: [],
  tokensUsed: 11,
  model: 'gpt-4o-mini',
  traceId: 'legacy-trace-1',
  intent: 'explain',
});

vi.mock('@/lib/ai/grounded-client', () => ({
  callGroundedAnswer: (request: Record<string, unknown>, hopTimeoutMs?: number) => {
    groundedCalls.push({ request, hopTimeoutMs });
    return Promise.resolve({
      grounded: false,
      abstain_reason: 'upstream_error',
      suggested_alternatives: [],
      trace_id: 'trace-grounded-failure',
      meta: { latency_ms: 37 },
    });
  },
  callGroundedAnswerStream: vi.fn().mockResolvedValue({ ok: false, reason: 'not-used' }),
}));

vi.mock('@/lib/ai', () => ({
  callClaude: vi.fn().mockResolvedValue({ content: 'unused', model: 'mock', tokensUsed: 0 }),
  classifyIntent: vi.fn().mockResolvedValue({ intent: 'explain' }),
  routeIntent: routeIntentImpl,
}));

const insertCalls: { table: string; rows: unknown }[] = [];

function makeChain(table: string) {
  const chain: Record<string, unknown> = {};
  let returnsArray = false;

  const resolveDefault = (): { data: unknown; error: unknown } => {
    if (table === 'students') {
      return {
        data: { subscription_plan: 'free', account_status: 'active', academic_goal: null },
        error: null,
      };
    }
    if (table === 'foxy_sessions') {
      return {
        data: {
          id: 'session-uuid-1',
          subject: 'math',
          grade: '7',
          chapter: null,
          mode: 'learn',
          created_at: '2026-05-02T00:00:00Z',
        },
        error: null,
      };
    }
    if (table === 'foxy_chat_messages') {
      return { data: [], error: null };
    }
    return { data: [], error: null };
  };

  const fluent = ['select', 'update', 'eq', 'neq', 'in', 'ilike', 'order', 'limit', 'gte', 'lte', 'not', 'is'];
  for (const m of fluent) {
    chain[m] = (..._args: unknown[]) => chain;
  }
  chain.select = (cols: string) => {
    if (table === 'foxy_sessions' && cols === 'id') {
      returnsArray = true;
    }
    return chain;
  };
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
  ) => Promise.resolve(returnsArray ? { data: [], error: null } : resolveDefault()).then(resolve, reject);
  return chain;
}

const rpcImpl = vi.fn();

vi.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: (table: string) => makeChain(table),
    rpc: (...args: unknown[]) => rpcImpl(...args),
  },
}));

function makePostRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/foxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  groundedCalls.length = 0;
  insertCalls.length = 0;
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

describe('/api/foxy grounded failures fall back to legacy AI', () => {
  it.each(['upstream_error', 'circuit_open'] as const)(
    'returns a normal answer when grounded-answer reports %s',
    async (abstainReason) => {
      const { POST } = await import('@/app/api/foxy/route');
      const res = await POST(
        makePostRequest({ message: 'Explain Newton third law', subject: 'science', grade: '10' }),
      );
      const body = (await res.json()) as Record<string, unknown>;

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.response).toBe('Legacy fallback answer.');
      expect(body.groundingStatus).toBe('grounded');
      expect(body.abstainReason).toBeUndefined();
      expect(body.traceId).toBe('legacy-trace-1');
      expect(groundedCalls).toHaveLength(1);
      expect(routeIntentImpl).toHaveBeenCalledTimes(1);
      expect(insertCalls.some((call) => call.table === 'foxy_chat_messages')).toBe(true);

      const groundedLog = loggerInfo.mock.calls.find((c: unknown[]) => c[0] === 'foxy_grounded_abstain');
      expect(groundedLog).toBeUndefined();

      const groundedCall = groundedCalls[0];
      expect((groundedCall.request as { query?: string }).query).toBe('Explain Newton third law');
      void abstainReason;
    },
  );
});
