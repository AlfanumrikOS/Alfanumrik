/**
 * FOX-1 (P12) — live grounded-path output backstop (NON-STREAMING).
 *
 * Pins the user-visible contract that when the grounded-answer service returns
 * a SUCCESSFUL (grounded:true) answer whose text contains hard-blocked content
 * (profanity / slur / self-harm / injection token), `/api/foxy` MUST:
 *   - return the existing SAFE-ABSTAIN envelope (response:'',
 *     groundingStatus:'hard-abstain') — NOT the raw unsafe text,
 *   - REFUND the consumed quota unit (the student got no usable answer),
 *   - emit category-only telemetry (no answer text), and
 *   - NOT persist the unsafe text into foxy_chat_messages.
 *
 * Conversely a normal CBSE answer must pass through UNCHANGED (grounded status,
 * the answer text on the wire, no refund).
 *
 * FOX-6 (P13): also asserts the request assembled for the grounded service
 * carries only scope + IDs (board/grade/subject/student_id UUID + the student's
 * own query) and NO injected studentName/email/phone.
 *
 * Harness mirrors `grounded-failure-fallback.test.ts`. Owner: testing.
 * Enforces: P12 (AI Safety), P13 (Data Privacy).
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

// Quota module: spy on refundQuota; control the gate deterministically so we
// don't depend on the RPC mock for quota accounting.
const refundQuotaSpy = vi.fn().mockResolvedValue(undefined);
vi.mock('@/app/api/foxy/_lib/quota', () => ({
  checkAndIncrementQuota: vi.fn().mockResolvedValue({ allowed: true, remaining: 49 }),
  refundQuota: (...args: unknown[]) => refundQuotaSpy(...args),
  resolveTenantAiOverrides: vi.fn().mockResolvedValue({}),
}));

// The grounded-answer client. Each test sets `nextGroundedAnswer`.
const groundedCalls: Array<{ request: Record<string, unknown> }> = [];
let nextGroundedAnswer = 'placeholder';
vi.mock('@/lib/ai/grounded-client', () => ({
  callGroundedAnswer: (request: Record<string, unknown>) => {
    groundedCalls.push({ request });
    return Promise.resolve({
      grounded: true,
      answer: nextGroundedAnswer,
      citations: [],
      confidence: 0.91,
      groundedFromChunks: true,
      trace_id: 'trace-grounded-ok',
      meta: { claude_model: 'haiku', tokens_used: 42, latency_ms: 21 },
    });
  },
  callGroundedAnswerStream: vi.fn().mockResolvedValue({ ok: false, reason: 'not-used' }),
}));

vi.mock('@/lib/ai', () => ({
  callClaude: vi.fn().mockResolvedValue({ content: 'unused', model: 'mock', tokensUsed: 0 }),
  classifyIntent: vi.fn().mockResolvedValue({ intent: 'explain' }),
  routeIntent: vi.fn().mockResolvedValue({
    response: 'legacy-unused',
    sources: [],
    tokensUsed: 0,
    model: 'gpt-4o-mini',
    traceId: 'legacy-unused',
    intent: 'explain',
  }),
}));

const insertCalls: { table: string; rows: unknown }[] = [];
const updateCalls: { table: string; values: unknown }[] = [];

function makeChain(table: string) {
  const chain: Record<string, unknown> = {};
  let returnsArray = false;

  const resolveDefault = (): { data: unknown; error: unknown } => {
    if (table === 'students') {
      return {
        data: {
          subscription_plan: 'free',
          account_status: 'active',
          academic_goal: null,
          school_id: null,
        },
        error: null,
      };
    }
    if (table === 'foxy_sessions') {
      return {
        data: {
          id: 'session-uuid-1',
          subject: 'science',
          grade: '10',
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
    if (table === 'student_daily_usage') {
      return { data: { usage_count: 1 }, error: null };
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
  chain.update = (values: unknown) => {
    updateCalls.push({ table, values });
    return chain;
  };
  chain.insert = (rows: unknown) => {
    insertCalls.push({ table, rows });
    return {
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve({ data: null, error: null }).then(resolve, reject),
      select: () => ({
        single: () => Promise.resolve({ data: { id: 'session-uuid-1' }, error: null }),
        then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
          Promise.resolve({
            data: [
              { id: 'msg-user-1', role: 'user' },
              { id: 'msg-assistant-1', role: 'assistant' },
            ],
            error: null,
          }).then(resolve, reject),
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
  updateCalls.length = 0;
  refundQuotaSpy.mockResolvedValue(undefined);
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
  rpcImpl.mockResolvedValue({ data: [{ allowed: true, current_count: 1 }], error: null });
});

describe('/api/foxy — FOX-1 output safety backstop (non-streaming)', () => {
  it('serves the safe-abstain envelope and refunds when the grounded answer is hard-blocked', async () => {
    // A "successful" grounded answer that nevertheless contains profanity.
    nextGroundedAnswer =
      'Newton said the third law means that for every action there is an equal ' +
      'and opposite reaction, you absolute fucking genius.';

    const { POST } = await import('@/app/api/foxy/route');
    const res = await POST(
      makePostRequest({ message: 'Explain Newton third law', subject: 'science', grade: '10' }),
    );
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    // SAFE-ABSTAIN: the raw unsafe text never reaches the wire.
    expect(body.response).toBe('');
    expect(body.groundingStatus).toBe('hard-abstain');
    expect(body.tokensUsed).toBe(0);
    expect(String(body.response)).not.toContain('fucking');

    // Quota refunded — the student didn't get a usable answer.
    expect(refundQuotaSpy).toHaveBeenCalledWith('student-uuid-1', 'foxy_chat');

    // Category-only telemetry (P13): warn fired, no answer text in its payload.
    const blockedWarn = loggerWarn.mock.calls.find(
      (c: unknown[]) => c[0] === 'foxy.output.safety_blocked',
    );
    expect(blockedWarn).toBeDefined();
    const warnPayload = JSON.stringify(blockedWarn?.[1] ?? {});
    expect(warnPayload).not.toContain('fucking');
    expect(warnPayload).toContain('blocklist');

    // The unsafe text was NOT persisted into foxy_chat_messages (neither
    // insert rows nor an UPDATE setting content carry the profanity).
    const allWrites = JSON.stringify([...insertCalls, ...updateCalls]);
    expect(allWrites).not.toContain('fucking');
  });

  it('passes a normal CBSE answer through unchanged (grounded, no refund)', async () => {
    nextGroundedAnswer =
      'Newton\'s third law states that for every action there is an equal and ' +
      'opposite reaction. Pushing a wall pushes you back with equal force.';

    const { POST } = await import('@/app/api/foxy/route');
    const res = await POST(
      makePostRequest({ message: 'Explain Newton third law', subject: 'science', grade: '10' }),
    );
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.response).toBe(nextGroundedAnswer);
    expect(['grounded', 'unverified']).toContain(body.groundingStatus);
    expect(body.groundingStatus).not.toBe('hard-abstain');
    expect(refundQuotaSpy).not.toHaveBeenCalled();

    const blockedWarn = loggerWarn.mock.calls.find(
      (c: unknown[]) => c[0] === 'foxy.output.safety_blocked',
    );
    expect(blockedWarn).toBeUndefined();
  });
});

describe('/api/foxy — FOX-6 prompt-assembly carries only scope + IDs (P13)', () => {
  it('the grounded request has no studentName/email/phone — only scope + UUID + query', async () => {
    nextGroundedAnswer = 'Photosynthesis converts light energy into chemical energy in chloroplasts.';

    const { POST } = await import('@/app/api/foxy/route');
    await POST(
      makePostRequest({ message: 'Explain photosynthesis', subject: 'science', grade: '10' }),
    );

    expect(groundedCalls).toHaveLength(1);
    const req = groundedCalls[0].request as Record<string, unknown>;

    // Identity is a pseudonymous UUID only — never a name/email/phone.
    expect(req.student_id).toBe('student-uuid-1');
    expect(req.query).toBe('Explain photosynthesis');

    // scope is board/grade/subject only.
    const scope = req.scope as Record<string, unknown>;
    expect(scope.board).toBe('CBSE');
    expect(scope.grade).toBe('10');
    expect(scope.subject_code).toBe('science');

    // No top-level PII-shaped keys.
    for (const key of Object.keys(req)) {
      expect(key.toLowerCase()).not.toMatch(/name|email|phone|password|aadhaar/);
    }

    // template_variables keys are pedagogy/scope only — no PII identifiers.
    const tmpl = (req.generation as { template_variables?: Record<string, string> })
      ?.template_variables ?? {};
    for (const key of Object.keys(tmpl)) {
      expect(key.toLowerCase()).not.toMatch(/\b(email|phone|full_name|parent_name|student_name|address)\b/);
    }

    // Defensive: the whole serialized request carries no email/@ marker.
    const serialized = JSON.stringify(req);
    expect(serialized).not.toMatch(/@[\w.-]+\.\w+/);
  });
});
