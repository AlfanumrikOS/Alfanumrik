import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * GUARD #8 — Foxy MATH-PIPELINE FLAG-OFF byte-identity (kill switch).
 *
 * With `ff_foxy_math_pipeline_v1` OFF, a math-shaped query MUST take the
 * existing grounded path UNCHANGED:
 *   - classifyMathSolve / solveMath / verifyMath are NEVER called,
 *   - the response carries NO `badgeState` (that field is math-pipeline-only),
 *   - the grounded path produced the answer (groundingStatus present, success).
 *
 * HARNESS NOTE (why this differs from the original):
 *   The math branch lives on the GROUNDED path (route.ts:3078). To exercise the
 *   flag-OFF kill switch we therefore mock `ff_grounded_ai_foxy` ON (so the
 *   route takes the grounded path, NOT the legacy 503 at route.ts:3053) and mock
 *   `callGroundedAnswer` to a normal grounded answer so the route reaches a clean
 *   200 via the grounded path. `ff_foxy_math_pipeline_v1` is OFF, so the math
 *   branch must be skipped entirely.
 *
 *   The CORE kill-switch invariant — "the math collaborators are not invoked and
 *   the flag was consulted" — is asserted in EVERY test and does NOT depend on a
 *   clean 200 (it is true the instant the flag-gated branch is skipped). The
 *   grounded-success-shape assertions (success/no-badgeState/groundingStatus)
 *   pin the byte-identity contract on top of that.
 */

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://test.local';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
});

const _authorizeImpl = vi.fn();
vi.mock('@/lib/rbac', () => ({
  authorizeRequest: (...args: unknown[]) => _authorizeImpl(...args),
  logAudit: vi.fn(),
}));

const _isFeatureEnabled = vi.fn();
vi.mock('@/lib/feature-flags', () => ({
  isFeatureEnabled: (...args: unknown[]) => _isFeatureEnabled(...args),
}));

vi.mock('@/lib/subjects', () => ({ validateSubjectWrite: vi.fn().mockResolvedValue({ ok: true }) }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
// Lab context fetch hits the network in prod; stub to an empty (no-op) result.
vi.mock('@/lib/foxy/recent-lab-context', () => ({
  fetchRecentLabContext: vi.fn().mockResolvedValue([]),
}));

// ─── math collaborators — spied; must NEVER fire when the flag is OFF ────────
const _classifyMathSolve = vi.fn();
const _solveMath = vi.fn();
const _verifyMath = vi.fn();
const _runMathSolvePipeline = vi.fn();
vi.mock('@/lib/ai/workflows/foxy-router', () => ({
  QUIZ_PATTERNS: /\bquiz\b/i,
  classifyMathSolve: (...args: unknown[]) => _classifyMathSolve(...args),
}));
vi.mock('@/lib/ai/math/solve-math', () => ({ solveMath: (...args: unknown[]) => _solveMath(...args) }));
vi.mock('@/lib/math-python-client', () => ({ verifyMath: (...args: unknown[]) => _verifyMath(...args) }));
vi.mock('@/lib/ai/math/solve-pipeline', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    runMathSolvePipeline: (...args: unknown[]) => _runMathSolvePipeline(...args),
  };
});

// ─── grounded path SUCCEEDS (this is the path the flag-off turn must take) ───
let _groundedReturn: Record<string, unknown> = {};
vi.mock('@/lib/ai/grounded-client', () => ({
  callGroundedAnswer: () => Promise.resolve(_groundedReturn),
  callGroundedAnswerStream: vi.fn().mockResolvedValue({ ok: false, reason: 'not-used' }),
}));
vi.mock('@/lib/ai', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    classifyIntent: vi.fn().mockResolvedValue({ intent: 'noop' }),
    routeIntent: vi.fn().mockResolvedValue({ response: 'legacy', intent: 'explain', sources: [], tokensUsed: 0, model: 'none', latencyMs: 0 }),
  };
});

// ─── supabaseAdmin — permissive pass-through ─────────────────────────────────
function makeChain(table: string) {
  const chain: Record<string, unknown> = {};
  const resolveDefault = (): { data: unknown; error: unknown } => {
    if (table === 'students') {
      return { data: { subscription_plan: 'free', account_status: 'active', academic_goal: null, name: null }, error: null };
    }
    if (table === 'foxy_sessions') return { data: { id: 'session-uuid-1' }, error: null };
    return { data: [], error: null };
  };
  for (const m of ['select', 'eq', 'neq', 'in', 'ilike', 'order', 'limit', 'gte', 'lte', 'not', 'is', 'update']) {
    chain[m] = () => chain;
  }
  chain.insert = () => ({
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve({ data: null, error: null }).then(resolve, reject),
    select: () => ({
      single: () => Promise.resolve({ data: { id: 'session-uuid-1' }, error: null }),
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve({ data: [{ id: 'm', role: 'assistant' }], error: null }).then(resolve, reject),
    }),
  });
  chain.single = () => Promise.resolve(resolveDefault());
  chain.maybeSingle = () => Promise.resolve(resolveDefault());
  (chain as { then: unknown }).then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(resolveDefault()).then(resolve, reject);
  return chain;
}
const rpcImpl = vi.fn();
vi.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: { from: (table: string) => makeChain(table), rpc: (...args: unknown[]) => rpcImpl(...args) },
}));

function makePostRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/foxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-jwt' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  _authorizeImpl.mockResolvedValue({
    authorized: true,
    userId: 'auth-user-1',
    studentId: 'student-uuid-1',
    schoolId: null,
    roles: ['student'],
    permissions: ['foxy.chat'],
  });
  // CRITICAL: math pipeline flag OFF. grounded ON so the turn completes.
  _isFeatureEnabled.mockImplementation((flag: string) => {
    if (flag === 'ai_usage_global') return Promise.resolve(true);
    if (flag === 'ff_grounded_ai_foxy') return Promise.resolve(true);
    if (flag === 'ff_foxy_math_pipeline_v1') return Promise.resolve(false); // <-- OFF
    return Promise.resolve(false);
  });
  rpcImpl.mockResolvedValue({ data: [{ allowed: true, current_count: 1 }], error: null });
  _groundedReturn = {
    grounded: true,
    answer: '1/2 + 3/4 = 5/4.',
    citations: [],
    confidence: 0.92,
    groundedFromChunks: true,
    trace_id: 'trace-flagoff',
    suggested_alternatives: [],
    meta: { claude_model: 'haiku', tokens_used: 30, latency_ms: 80 },
  };
});

/** Drive the route, never throw out of the helper (so the core invariant can be asserted even if the grounded path is brittle). */
async function postFoxy(body: Record<string, unknown>): Promise<{ res: Response | null; body: Record<string, unknown> | null }> {
  const { POST } = await import('@/app/api/foxy/route');
  const res = await POST(makePostRequest(body));
  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = (await res.json()) as Record<string, unknown>;
  } catch {
    parsed = null;
  }
  return { res, body: parsed };
}

describe('GUARD #8 — ff_foxy_math_pipeline_v1 OFF: math-shaped query takes the grounded path', () => {
  it('the math collaborators are NEVER invoked (the kill-switch core invariant)', async () => {
    await postFoxy({ message: 'add 1/2 + 3/4', subject: 'math', grade: '6' });
    expect(_classifyMathSolve).not.toHaveBeenCalled();
    expect(_solveMath).not.toHaveBeenCalled();
    expect(_verifyMath).not.toHaveBeenCalled();
    expect(_runMathSolvePipeline).not.toHaveBeenCalled();
  });

  it('reaches a clean 200 via the grounded path', async () => {
    const { res, body } = await postFoxy({ message: 'add 1/2 + 3/4', subject: 'math', grade: '6' });
    expect(res!.status).toBe(200);
    expect(body!.success).toBe(true);
    // Math collaborators still untouched.
    expect(_classifyMathSolve).not.toHaveBeenCalled();
  });

  it('the response carries NO badgeState (math-pipeline-only field)', async () => {
    const { body } = await postFoxy({ message: 'solve x^2 - 5x + 6 = 0', subject: 'math', grade: '10' });
    expect(body!.success).toBe(true);
    expect('badgeState' in body!).toBe(false);
    expect(body!.badgeState).toBeUndefined();
    // And the pipeline never ran.
    expect(_runMathSolvePipeline).not.toHaveBeenCalled();
  });

  it('the grounded path produced the answer (groundingStatus present, not a math verdict)', async () => {
    const { body } = await postFoxy({ message: 'calculate 12 * 4', subject: 'math', grade: '6' });
    expect(body!.success).toBe(true);
    expect(body!.groundingStatus).toBeDefined();
    // The verifier never ran, so there is no verifier-derived field on the wire.
    expect('badgeState' in body!).toBe(false);
    expect(_verifyMath).not.toHaveBeenCalled();
  });

  it('explicitly consults ff_foxy_math_pipeline_v1 then short-circuits (gate is checked, classifier never reached)', async () => {
    await postFoxy({ message: 'add 1/2 + 3/4', subject: 'math', grade: '6' });
    const checkedFlags = _isFeatureEnabled.mock.calls.map((c) => c[0]);
    expect(checkedFlags).toContain('ff_foxy_math_pipeline_v1');
    // Gate returned false → classifier never reached.
    expect(_classifyMathSolve).not.toHaveBeenCalled();
  });
});
