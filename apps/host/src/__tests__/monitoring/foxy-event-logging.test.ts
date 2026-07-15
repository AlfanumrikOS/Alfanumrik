/**
 * Foxy fire-and-forget monitoring instrumentation — silent-drop regression guard.
 *
 * Backend added additive, non-blocking observability to `src/app/api/foxy/route.ts`:
 *   - `logFoxyAsk(tokens)` fires a `foxy_ask` learning_event + an
 *     `edge_fn_latency_ms` system_metric at every TERMINAL SUCCESS return.
 *   - The top-level catch fires an `error_rate` system_metric.
 *   - Business early-returns (429 quota, 4xx grade/subject denials) are NOT
 *     errors and MUST NOT emit `error_rate`, and never reach `logFoxyAsk`.
 *
 * Why these assertions exist (the silent-drop trap):
 *   `learning_events.student_id` is `uuid NOT NULL REFERENCES auth.users(id)`.
 *   The route resolves TWO distinct ids — `auth.userId` (= auth.uid(), the
 *   auth.users PK) and `auth.studentId` (= students-table PK). The event row's
 *   FK targets auth.users, so `student_id` MUST be `auth.userId`. If a future
 *   refactor swaps in `studentId`, EVERY event silently fails the FK and is
 *   swallowed by fire-and-forget (logLearningEvent never throws) — no test,
 *   no alert, no data. This suite pins:
 *     1. student_id === auth.userId  (NOT studentId)
 *     2. topic_id === null           (no verified curriculum_topics.id in scope)
 *     3. session_id === resolvedSessionId
 *     4. event_type === 'foxy_ask'
 *     5. catch path → metric_name 'error_rate'
 *     6. 429 quota early-return → NO error_rate AND NO foxy_ask
 *
 * Plus compile-time/type guards on the union + the metric/event shapes the
 * route uses.
 *
 * Harness: drives the REAL `POST` handler with the same heavy-mock surface as
 * `src/__tests__/api/foxy/foxy-route-goal-flag.test.ts` (the proven pattern for
 * unit-testing this 4700-line route), plus a `@alfanumrik/lib/monitoring/log-event` mock
 * so the loggers are observable instead of hitting Supabase.
 *
 * Owner: testing. References quiz-integrity-adjacent P12/P13 conventions but
 * makes NO claim about scoring.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { LearningEvent, LearningEventType, SystemMetric } from '@/types/monitoring';

// ─── env stubs (route reads these at handler top) ────────────────────────────
beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://test.local';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
});

// ─── RBAC mock ───────────────────────────────────────────────────────────────
// CRITICAL: userId and studentId are DELIBERATELY different sentinel strings so
// a regression that logs studentId is caught by an exact-equality assertion.
const AUTH_USER_ID = 'auth-uid-AAAA-1111'; // = auth.uid() / auth.users PK
const STUDENT_PK = 'student-pk-BBBB-2222'; // = students-table PK (must NOT be logged)

const _authorizeImpl = vi.fn();
const _logAuditImpl = vi.fn();
vi.mock('@alfanumrik/lib/rbac', () => ({
  authorizeRequest: (...args: unknown[]) => _authorizeImpl(...args),
  logAudit: (...args: unknown[]) => _logAuditImpl(...args),
}));

// ─── Feature-flag mock — controlled per test ─────────────────────────────────
const _isFeatureEnabled = vi.fn();
vi.mock('@alfanumrik/lib/feature-flags', () => ({
  isFeatureEnabled: (...args: unknown[]) => _isFeatureEnabled(...args),
}));

// ─── Subject-governance mock — pass-through ──────────────────────────────────
vi.mock('@alfanumrik/lib/subjects', () => ({
  validateSubjectWrite: vi.fn().mockResolvedValue({ ok: true }),
}));

// ─── Logger spy (silence + observe) ──────────────────────────────────────────
vi.mock('@alfanumrik/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ─── ops-events mock (catch path imports this dynamically) ───────────────────
vi.mock('@alfanumrik/lib/ops-events', () => ({
  logOpsEvent: vi.fn().mockResolvedValue(undefined),
}));

// ─── THE UNIT UNDER TEST: monitoring loggers ─────────────────────────────────
// Spies capture every call so we can assert the EXACT payload the route builds.
// The real implementations are fire-and-forget and never throw — we replace
// them with resolved spies so nothing touches Supabase.
const learningEvents: Array<Omit<LearningEvent, 'id' | 'occurred_at'>> = [];
const systemMetrics: Array<Omit<SystemMetric, 'id' | 'recorded_at'>> = [];

const _logLearningEvent = vi.fn((e: Omit<LearningEvent, 'id' | 'occurred_at'>) => {
  learningEvents.push(e);
  return Promise.resolve();
});
const _logSystemMetric = vi.fn((m: Omit<SystemMetric, 'id' | 'recorded_at'>) => {
  systemMetrics.push(m);
  return Promise.resolve();
});

vi.mock('@alfanumrik/lib/monitoring/log-event', () => ({
  logLearningEvent: (e: Omit<LearningEvent, 'id' | 'occurred_at'>) => _logLearningEvent(e),
  logSystemMetric: (m: Omit<SystemMetric, 'id' | 'recorded_at'>) => _logSystemMetric(m),
  // Deterministic ids so the session-id fallback in logFoxyAsk is observable.
  generateSessionId: () => 'fallback-session-id',
  generateCorrelationId: () => 'corr-fixed-1',
}));

// ─── grounded-client mock — drives the grounded-default SUCCESS path ─────────
// Per-test overridable so the catch-path test can make it reject.
let _groundedImpl: (...args: unknown[]) => Promise<unknown> = () =>
  Promise.resolve({
    grounded: true,
    answer: 'Stub Foxy answer.',
    citations: [],
    meta: { latency_ms: 25, tokens_used: 99 },
    trace_id: 'trace-stub-1',
    confidence: 0.9,
  });

vi.mock('@alfanumrik/lib/ai/grounded-client', () => ({
  callGroundedAnswer: (...args: unknown[]) => _groundedImpl(...args),
  callGroundedAnswerStream: vi.fn().mockResolvedValue({ ok: false, reason: 'not-used' }),
}));

// Legacy intent-router path must never run in these grounded tests.
vi.mock('@alfanumrik/lib/ai', () => ({
  classifyIntent: vi.fn().mockResolvedValue({ intent: 'should-not-run' }),
  routeIntent: vi.fn().mockRejectedValue(new Error('legacy path should not run')),
}));

// ─── supabaseAdmin mock ──────────────────────────────────────────────────────
let _studentRow: { subscription_plan: string; account_status: string; academic_goal: string | null } = {
  subscription_plan: 'free',
  account_status: 'active',
  academic_goal: null,
};

function makeChain(table: string) {
  const chain: Record<string, unknown> = {};
  const resolveDefault = (): { data: unknown; error: unknown } => {
    if (table === 'students') return { data: _studentRow, error: null };
    if (table === 'foxy_sessions') {
      return {
        data: {
          id: 'resolved-session-uuid-XYZ',
          subject: 'science',
          grade: '7',
          chapter: null,
          mode: 'learn',
          created_at: '2026-05-02T00:00:00Z',
        },
        error: null,
      };
    }
    if (table === 'foxy_chat_messages') return { data: [], error: null };
    return { data: [], error: null };
  };

  const fluent = ['select', 'update', 'eq', 'neq', 'in', 'ilike', 'order', 'limit', 'gte', 'lte', 'not', 'is'];
  for (const m of fluent) chain[m] = (..._a: unknown[]) => chain;
  chain.insert = (_rows: unknown) => ({
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve({ data: null, error: null }).then(resolve, reject),
    select: () => ({
      single: () => Promise.resolve({ data: { id: 'resolved-session-uuid-XYZ' }, error: null }),
    }),
  });
  chain.single = () => Promise.resolve(resolveDefault());
  chain.maybeSingle = () => Promise.resolve(resolveDefault());
  (chain as { then: unknown }).then = (
    resolve: (v: unknown) => unknown,
    reject?: (e: unknown) => unknown,
  ) => Promise.resolve(resolveDefault()).then(resolve, reject);
  return chain;
}

// Quota RPC (`check_and_record_usage`) is per-test controllable.
let _quotaAllowed = true;
const rpcImpl = vi.fn((name: string) => {
  if (name === 'check_and_record_usage') {
    return Promise.resolve({ data: [{ allowed: _quotaAllowed, used_count: 1 }], error: null });
  }
  if (name === 'get_plan_limit') {
    return Promise.resolve({ data: 10, error: null });
  }
  return Promise.resolve({ data: [], error: null });
});

vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: (table: string) => makeChain(table),
    rpc: (...args: unknown[]) => rpcImpl(...(args as [string])),
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

function setFlags(values: Record<string, boolean>) {
  _isFeatureEnabled.mockImplementation((flag: string) => {
    if (flag in values) return Promise.resolve(values[flag]);
    if (flag === 'ai_usage_global') return Promise.resolve(true);
    if (flag === 'ff_grounded_ai_foxy') return Promise.resolve(true);
    if (flag === 'ff_foxy_streaming') return Promise.resolve(false);
    // Math pipeline OFF so we land on the grounded-default path deterministically.
    return Promise.resolve(false);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  learningEvents.length = 0;
  systemMetrics.length = 0;
  _quotaAllowed = true;
  _studentRow = { subscription_plan: 'free', account_status: 'active', academic_goal: null };
  _groundedImpl = () =>
    Promise.resolve({
      grounded: true,
      answer: 'Stub Foxy answer.',
      citations: [],
      meta: { latency_ms: 25, tokens_used: 99 },
      trace_id: 'trace-stub-1',
      confidence: 0.9,
    });
  _authorizeImpl.mockResolvedValue({
    authorized: true,
    userId: AUTH_USER_ID,
    studentId: STUDENT_PK,
    roles: ['student'],
    permissions: ['foxy.chat'],
    schoolId: null,
  });
  setFlags({});
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. Type-level guards (compile-time): the route's payload shapes must remain
//    assignable to the monitoring contract, and 'foxy_ask' must stay in the union.
// ─────────────────────────────────────────────────────────────────────────────
describe('Foxy event-logging — type/shape contract (compile-time guard)', () => {
  it("'foxy_ask' is a member of LearningEventType", () => {
    // If 'foxy_ask' is ever removed from the union, this assignment fails tsc.
    const t: LearningEventType = 'foxy_ask';
    expect(t).toBe('foxy_ask');
  });

  it('the exact learning_event the route builds is assignable to LearningEvent', () => {
    // Mirrors the route's logFoxyAsk payload verbatim. A shape drift (renamed
    // field, wrong type) breaks `npm run type-check`, not just this assertion.
    const event: Omit<LearningEvent, 'id' | 'occurred_at'> = {
      student_id: AUTH_USER_ID,
      session_id: 'resolved-session-uuid-XYZ',
      event_type: 'foxy_ask',
      topic_id: null,
      verb: 'asked',
      object_type: 'foxy',
      result: { response_tokens: 99 },
      context: { grade: '7', correlation_id: 'corr-fixed-1' },
    };
    expect(event.event_type).toBe('foxy_ask');
    expect(event.topic_id).toBeNull();
  });

  it('the route metrics (error_rate, edge_fn_latency_ms, foxy_request) are assignable to SystemMetric', () => {
    const m1: Omit<SystemMetric, 'id' | 'recorded_at'> = {
      metric_name: 'error_rate',
      route: '/api/foxy',
      value: 1,
      tags: { error_code: 'unknown' },
    };
    const m2: Omit<SystemMetric, 'id' | 'recorded_at'> = {
      metric_name: 'edge_fn_latency_ms',
      route: '/api/foxy',
      value: 12,
      tags: { grade: '7' },
    };
    const m3: Omit<SystemMetric, 'id' | 'recorded_at'> = {
      metric_name: 'foxy_request',
      route: '/api/foxy',
      value: 1,
      tags: { grade: '7' },
    };
    expect([m1.metric_name, m2.metric_name, m3.metric_name]).toEqual([
      'error_rate',
      'edge_fn_latency_ms',
      'foxy_request',
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Behavioral: grounded-default SUCCESS path emits the foxy_ask event with
//    the FK-safe identity. This is the silent-drop guard.
// ─────────────────────────────────────────────────────────────────────────────
describe('Foxy event-logging — grounded success path (silent-drop guard)', () => {
  async function driveSuccess() {
    const { POST } = await import('@/app/api/foxy/route');
    const res = await POST(
      makePostRequest({ message: 'Explain photosynthesis', subject: 'science', grade: '7' }),
    );
    return res;
  }

  it('returns 200 on the grounded-default path', async () => {
    const res = await driveSuccess();
    expect(res.status).toBe(200);
  });

  it('logs a foxy_ask learning_event with student_id === auth.userId (NOT studentId)', async () => {
    await driveSuccess();
    const ask = learningEvents.find((e) => e.event_type === 'foxy_ask');
    expect(ask).toBeDefined();
    // THE load-bearing assertion: FK targets auth.users(id), so this MUST be
    // the auth uid, never the students-table PK.
    expect(ask!.student_id).toBe(AUTH_USER_ID);
    expect(ask!.student_id).not.toBe(STUDENT_PK);
  });

  it('logs topic_id === null (no verified curriculum_topics.id in scope)', async () => {
    await driveSuccess();
    const ask = learningEvents.find((e) => e.event_type === 'foxy_ask');
    expect(ask!.topic_id).toBeNull();
  });

  it('logs session_id === resolvedSessionId (not the fallback)', async () => {
    await driveSuccess();
    const ask = learningEvents.find((e) => e.event_type === 'foxy_ask');
    // resolveSession returns the foxy_sessions row id from the mock.
    expect(ask!.session_id).toBe('resolved-session-uuid-XYZ');
    expect(ask!.session_id).not.toBe('fallback-session-id');
  });

  it('logs verb=asked, object_type=foxy, response_tokens from grounded.meta, and PII-free context', async () => {
    await driveSuccess();
    const ask = learningEvents.find((e) => e.event_type === 'foxy_ask')!;
    expect(ask.verb).toBe('asked');
    expect(ask.object_type).toBe('foxy');
    expect((ask.result as Record<string, unknown>).response_tokens).toBe(99);
    const ctx = ask.context as Record<string, unknown>;
    expect(ctx.grade).toBe('7');
    expect(ctx.correlation_id).toBe('corr-fixed-1');
    // P13: no PII keys ride along in the context.
    expect(ctx).not.toHaveProperty('email');
    expect(ctx).not.toHaveProperty('phone');
    expect(ctx).not.toHaveProperty('name');
  });

  it('emits the edge_fn_latency_ms metric AND the foxy_request metric on success', async () => {
    await driveSuccess();
    const names = systemMetrics.map((m) => m.metric_name);
    expect(names).toContain('foxy_request');
    expect(names).toContain('edge_fn_latency_ms');
    const latency = systemMetrics.find((m) => m.metric_name === 'edge_fn_latency_ms')!;
    expect(latency.route).toBe('/api/foxy');
    expect(typeof latency.value).toBe('number');
    expect((latency.tags as Record<string, unknown>).grade).toBe('7');
  });

  it('does NOT emit error_rate on a successful turn', async () => {
    await driveSuccess();
    expect(systemMetrics.find((m) => m.metric_name === 'error_rate')).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Behavioral: top-level catch path emits error_rate (and only on a genuine
//    exception, never on a success).
// ─────────────────────────────────────────────────────────────────────────────
describe('Foxy event-logging — error path', () => {
  it('emits an error_rate system_metric when the handler throws downstream', async () => {
    // callGroundedAnswer is NOT wrapped in a local try/catch in the route, so a
    // rejection bubbles to the top-level catch which emits error_rate.
    _groundedImpl = () => Promise.reject(new Error('grounded service exploded'));

    const { POST } = await import('@/app/api/foxy/route');
    const res = await POST(
      makePostRequest({ message: 'Explain gravity', subject: 'science', grade: '7' }),
    );

    // Top-level catch returns 503.
    expect(res.status).toBe(503);

    const err = systemMetrics.find((m) => m.metric_name === 'error_rate');
    expect(err).toBeDefined();
    expect(err!.route).toBe('/api/foxy');
    expect(err!.value).toBe(1);
    // P13: only an error_code tag, no PII / no message text.
    const tags = err!.tags as Record<string, unknown>;
    expect(tags).toHaveProperty('error_code');
    expect(JSON.stringify(tags)).not.toContain('grounded service exploded');

    // A thrown turn never reached logFoxyAsk, so no foxy_ask event.
    expect(learningEvents.find((e) => e.event_type === 'foxy_ask')).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Behavioral: business early-returns are NOT errors. The 429 quota path must
//    NOT emit error_rate and must NOT emit a foxy_ask event.
// ─────────────────────────────────────────────────────────────────────────────
describe('Foxy event-logging — business early-returns do not pollute telemetry', () => {
  it('429 quota exhaustion emits NO error_rate and NO foxy_ask event', async () => {
    _quotaAllowed = false; // check_and_record_usage → allowed:false → 429

    const { POST } = await import('@/app/api/foxy/route');
    const res = await POST(
      makePostRequest({ message: 'Explain mitosis', subject: 'science', grade: '7' }),
    );
    expect(res.status).toBe(429);

    // error_rate is reserved for genuine exceptions — a quota cap is expected.
    expect(systemMetrics.find((m) => m.metric_name === 'error_rate')).toBeUndefined();
    // logFoxyAsk is defined AFTER the quota gate, so no success event fires.
    expect(learningEvents.find((e) => e.event_type === 'foxy_ask')).toBeUndefined();
  });

  it('a 400 invalid-grade early-return emits NO error_rate and NO foxy_ask event', async () => {
    const { POST } = await import('@/app/api/foxy/route');
    const res = await POST(
      // grade '5' is below the CBSE 6-12 range → 400 before any logging.
      makePostRequest({ message: 'Hi', subject: 'science', grade: '5' }),
    );
    expect(res.status).toBe(400);
    expect(systemMetrics.find((m) => m.metric_name === 'error_rate')).toBeUndefined();
    expect(learningEvents.find((e) => e.event_type === 'foxy_ask')).toBeUndefined();
  });
});
