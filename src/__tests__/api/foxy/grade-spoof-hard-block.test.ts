import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * REG-142 — Foxy P12 grade-spoof HARD BLOCK (CEO Decision D2, 2026-06-15).
 *
 * `/api/foxy` defends three layers against a client claiming a `grade` that
 * does not match the enrolled grade on `students.grade`:
 *
 *  1. ZOD VALIDATION (route.ts:2641-2658). `FoxyRequestBodySchema` requires
 *     `grade ∈ z.enum(['6','7','8','9','10','11','12'])`. Any other value
 *     (out-of-range string, integer, missing) → 400 with `code:'INVALID_GRADE'`
 *     BEFORE the students fetch, RBAC studentId resolution, governance check,
 *     prompt build, RAG retrieval, or LLM call. (P5: grades are strings.)
 *
 *  2. DB-AUTHORITATIVE COMPARE (route.ts:2802-2849). The students row's
 *     `grade` column is loaded server-side and compared to the (already
 *     Zod-validated) body grade. If they differ AND `dbGrade !== null`, the
 *     route returns 403 with `{code:'GRADE_MISMATCH', message:'Request grade
 *     does not match enrollment'}`, writes an `audit_logs` row via `logAudit`
 *     with `action:'foxy.grade_spoof_attempt'` and
 *     `details:{claimed_grade, actual_grade, route:'/api/foxy'}`, and SKIPS
 *     every downstream call — no Claude, no grounded answer, no quota spend.
 *
 *  3. NULL-GRADE WARN-AND-PROCEED (route.ts:2850-2856). A `dbGrade === null`
 *     row (legitimately-onboarding student) is NOT 403'd — the route logs a
 *     `logger.warn` and continues. The flag-gated `validateCurriculumScope`
 *     STEM path still acts as a second layer downstream.
 *
 * Critically, the block is INDEPENDENT of `ff_foxy_curriculum_guard_v1`:
 * the existing curriculum-guard pre-gate only fires for STEM subjects on
 * the grounded path. The grade-spoof hard block must fire for ALL subjects
 * (e.g. english, hindi) regardless of the curriculum-guard flag state.
 *
 * HARNESS NOTES:
 *   - Mocking pattern matches `curriculum-guard-pregate.test.ts` (the most
 *     similar early-gate guard for this route): vi.mock for @/lib/rbac
 *     (authorizeRequest + logAudit), @/lib/feature-flags, @/lib/subjects,
 *     @/lib/logger, @/lib/foxy/math-flag, @/lib/ai/grounded-client,
 *     @/lib/ai (classifyIntent/routeIntent), @/lib/supabase-admin (chained
 *     builder). No new mocking primitive was introduced — every collaborator
 *     boundary already had an existing convention to follow.
 *   - The 403 hard block fires BEFORE the grounded path, so the grounded
 *     client should never be invoked on the spoof case. We mock it to a
 *     normal grounded answer so the happy-path / null-grade / OFF-flag
 *     scenarios still reach a clean 200.
 */

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://test.local';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
});

// ─── RBAC + audit capture ────────────────────────────────────────────────────
const _authorizeImpl = vi.fn();
const _logAuditImpl = vi.fn();
vi.mock('@/lib/rbac', () => ({
  authorizeRequest: (...args: unknown[]) => _authorizeImpl(...args),
  logAudit: (...args: unknown[]) => _logAuditImpl(...args),
}));

// ─── feature flags ───────────────────────────────────────────────────────────
const _isFeatureEnabled = vi.fn();
vi.mock('@/lib/feature-flags', () => ({
  isFeatureEnabled: (...args: unknown[]) => _isFeatureEnabled(...args),
}));

// ─── the two Foxy flag resolvers — driven directly ───────────────────────────
const _isCurriculumGuardEnabled = vi.fn();
const _isMathPipelineEnabled = vi.fn();
vi.mock('@/lib/foxy/math-flag', () => ({
  isCurriculumGuardEnabled: (...args: unknown[]) => _isCurriculumGuardEnabled(...args),
  isMathPipelineEnabled: (...args: unknown[]) => _isMathPipelineEnabled(...args),
}));

// ─── subject governance ok + logger spy ──────────────────────────────────────
vi.mock('@/lib/subjects', () => ({ validateSubjectWrite: vi.fn().mockResolvedValue({ ok: true }) }));
const _loggerWarn = vi.fn();
const _loggerInfo = vi.fn();
const _loggerError = vi.fn();
vi.mock('@/lib/logger', () => ({
  logger: { info: _loggerInfo, warn: _loggerWarn, error: _loggerError, debug: vi.fn() },
}));
vi.mock('@/lib/foxy/recent-lab-context', () => ({
  fetchRecentLabContext: vi.fn().mockResolvedValue([]),
}));

// ─── math collaborators — should never fire on these tests ───────────────────
const _classifyMathSolve = vi.fn();
const _runMathSolvePipeline = vi.fn();
vi.mock('@/lib/ai/workflows/foxy-router', () => ({
  QUIZ_PATTERNS: /\bquiz\b/i,
  classifyMathSolve: (...args: unknown[]) => _classifyMathSolve(...args),
}));
vi.mock('@/lib/ai/math/solve-math', () => ({ solveMath: vi.fn() }));
vi.mock('@/lib/math-python-client', () => ({ verifyMath: vi.fn() }));
vi.mock('@/lib/ai/math/solve-pipeline', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    runMathSolvePipeline: (...args: unknown[]) => _runMathSolvePipeline(...args),
  };
});

// ─── grounded path — the LLM-boundary spy. Must NOT fire when blocked. ───────
const _callGroundedAnswer = vi.fn();
const _callGroundedAnswerStream = vi.fn();
let _groundedReturn: Record<string, unknown> = {};
vi.mock('@/lib/ai/grounded-client', () => ({
  callGroundedAnswer: (...args: unknown[]) => {
    _callGroundedAnswer(...args);
    return Promise.resolve(_groundedReturn);
  },
  callGroundedAnswerStream: (...args: unknown[]) => {
    _callGroundedAnswerStream(...args);
    return Promise.resolve({ ok: false, reason: 'not-used' });
  },
}));

// ─── legacy routeIntent path — also an LLM boundary. Must NOT fire on block. ─
const _classifyIntent = vi.fn();
const _routeIntent = vi.fn();
vi.mock('@/lib/ai', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    classifyIntent: (...args: unknown[]) => {
      _classifyIntent(...args);
      return Promise.resolve({ intent: 'noop' });
    },
    routeIntent: (...args: unknown[]) => {
      _routeIntent(...args);
      return Promise.resolve({
        response: 'legacy',
        intent: 'explain',
        sources: [],
        tokensUsed: 0,
        model: 'none',
        latencyMs: 0,
      });
    },
  };
});

// ─── supabaseAdmin — students row returns whatever the test set in _studentRow ─
let _studentRow: Record<string, unknown> | null = null;
let _studentsFetchCount = 0;

function makeChain(table: string) {
  const chain: Record<string, unknown> = {};
  const resolveDefault = (): { data: unknown; error: unknown } => {
    if (table === 'students') {
      _studentsFetchCount += 1;
      return { data: _studentRow, error: null };
    }
    if (table === 'foxy_sessions') return { data: { id: 'session-uuid-1' }, error: null };
    return { data: [], error: null };
  };
  for (const m of ['select', 'eq', 'neq', 'in', 'ilike', 'order', 'limit', 'gte', 'lte', 'not', 'is']) {
    chain[m] = () => chain;
  }
  const recordWrite = () => ({
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve({ data: null, error: null }).then(resolve, reject),
    eq: () => ({
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve({ data: null, error: null }).then(resolve, reject),
    }),
    select: () => ({
      single: () => Promise.resolve({ data: { id: 'session-uuid-1' }, error: null }),
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve({
          data: [
            { id: 'msg-user', role: 'user' },
            { id: 'msg-assistant', role: 'assistant' },
          ],
          error: null,
        }).then(resolve, reject),
    }),
  });
  chain.insert = () => recordWrite();
  chain.update = () => recordWrite();
  chain.upsert = () => recordWrite();
  chain.delete = () => recordWrite();
  chain.single = () => Promise.resolve(resolveDefault());
  chain.maybeSingle = () => Promise.resolve(resolveDefault());
  (chain as { then: unknown }).then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(resolveDefault()).then(resolve, reject);
  return chain;
}

const rpcImpl = vi.fn((..._args: unknown[]) => Promise.resolve({ data: [{ allowed: true, current_count: 1 }], error: null }));

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
  _studentsFetchCount = 0;
  // Default: enrolled grade '8' — overridden per scenario where needed.
  _studentRow = {
    subscription_plan: 'free',
    account_status: 'active',
    academic_goal: null,
    name: null,
    grade: '8',
  };
  _authorizeImpl.mockResolvedValue({
    authorized: true,
    userId: 'auth-user-1',
    studentId: 'student-uuid-1',
    schoolId: null,
    roles: ['student'],
    permissions: ['foxy.chat'],
  });
  _isFeatureEnabled.mockImplementation((flag: string) => {
    if (flag === 'ai_usage_global') return Promise.resolve(true);
    if (flag === 'ff_grounded_ai_foxy') return Promise.resolve(true);
    return Promise.resolve(false);
  });
  // Curriculum guard OFF by default — we prove the grade-spoof block fires
  // independently of it in test F.
  _isCurriculumGuardEnabled.mockResolvedValue(false);
  _isMathPipelineEnabled.mockResolvedValue(false);
  _classifyMathSolve.mockResolvedValue({ isMathSolve: false });
  _groundedReturn = {
    grounded: true,
    answer: 'Some answer about the topic.',
    citations: [],
    confidence: 0.9,
    groundedFromChunks: true,
    trace_id: 'trace-1',
    suggested_alternatives: [],
    meta: { claude_model: 'haiku', tokens_used: 40, latency_ms: 90 },
  };
});

async function postFoxy(body: Record<string, unknown>): Promise<{ res: Response; body: Record<string, unknown> }> {
  const { POST } = await import('@/app/api/foxy/route');
  const res = await POST(makePostRequest(body));
  const parsed = (await res.json()) as Record<string, unknown>;
  return { res, body: parsed };
}

// ─── A. Zod 400 path — grade outside ['6'..'12'] ─────────────────────────────

describe('A. INVALID_GRADE 400 — body.grade out of allowed CBSE set', () => {
  it('returns 400 with code:"INVALID_GRADE" when grade is "5"', async () => {
    const { res, body } = await postFoxy({ message: 'Hello', subject: 'math', grade: '5' });
    expect(res.status).toBe(400);
    expect(body.code).toBe('INVALID_GRADE');
    expect(body.success).toBe(false);
  });

  it('never fetches the students row when Zod rejects the grade', async () => {
    await postFoxy({ message: 'Hello', subject: 'math', grade: '5' });
    expect(_studentsFetchCount).toBe(0);
  });

  it('never calls Claude / grounded-answer / routeIntent on Zod reject', async () => {
    await postFoxy({ message: 'Hello', subject: 'math', grade: '5' });
    expect(_callGroundedAnswer).not.toHaveBeenCalled();
    expect(_callGroundedAnswerStream).not.toHaveBeenCalled();
    expect(_routeIntent).not.toHaveBeenCalled();
  });

  it('never writes an audit row on Zod reject (grade_spoof_attempt is for the 403 branch only)', async () => {
    await postFoxy({ message: 'Hello', subject: 'math', grade: '5' });
    const spoofAuditCalls = _logAuditImpl.mock.calls.filter(
      (c) => (c[1] as { action?: string })?.action === 'foxy.grade_spoof_attempt',
    );
    expect(spoofAuditCalls).toEqual([]);
  });
});

// ─── B. Zod 400 path — wrong TYPE ────────────────────────────────────────────

describe('B. INVALID_GRADE 400 — body.grade is the wrong type (P5: must be a string)', () => {
  it('returns 400 with code:"INVALID_GRADE" when grade is the integer 12', async () => {
    const { res, body } = await postFoxy({ message: 'Hello', subject: 'math', grade: 12 });
    expect(res.status).toBe(400);
    expect(body.code).toBe('INVALID_GRADE');
    expect(body.success).toBe(false);
  });

  it('never fetches students row + never calls Claude when grade is the integer 12', async () => {
    await postFoxy({ message: 'Hello', subject: 'math', grade: 12 });
    expect(_studentsFetchCount).toBe(0);
    expect(_callGroundedAnswer).not.toHaveBeenCalled();
  });
});

// ─── C. Happy path — claimed grade matches enrolled grade ────────────────────

describe('C. Happy path — body.grade matches db.grade, route proceeds', () => {
  it('does NOT return 400/403 and DOES call the grounded path', async () => {
    _studentRow = {
      subscription_plan: 'free',
      account_status: 'active',
      academic_goal: null,
      name: null,
      grade: '8',
    };
    const { res } = await postFoxy({ message: 'What is photosynthesis?', subject: 'science', grade: '8' });
    expect(res.status).not.toBe(400);
    expect(res.status).not.toBe(403);
    expect(_callGroundedAnswer).toHaveBeenCalledTimes(1);
  });

  it('does NOT write a grade_spoof_attempt audit row on the happy path', async () => {
    _studentRow = {
      subscription_plan: 'free',
      account_status: 'active',
      academic_goal: null,
      name: null,
      grade: '8',
    };
    await postFoxy({ message: 'What is photosynthesis?', subject: 'science', grade: '8' });
    const spoofAuditCalls = _logAuditImpl.mock.calls.filter(
      (c) => (c[1] as { action?: string })?.action === 'foxy.grade_spoof_attempt',
    );
    expect(spoofAuditCalls).toEqual([]);
  });
});

// ─── C2. Legacy grade prefix normalization — enrolled "Grade 9" row ────────

describe('C2. Legacy enrolled grade format — "Grade 9" normalizes to "9"', () => {
  beforeEach(() => {
    _studentRow = {
      subscription_plan: 'premium_yearly',
      account_status: 'active',
      academic_goal: null,
      name: null,
      grade: 'Grade 9',
    };
  });

  it('allows the request when the client claims the normalized grade "9"', async () => {
    const { res } = await postFoxy({ message: 'Explain motion', subject: 'science', grade: '9' });
    expect(res.status).not.toBe(403);
    expect(_callGroundedAnswer).toHaveBeenCalledTimes(1);
  });

  it('logs the normalized enrolled grade rather than the legacy prefixed string', async () => {
    await postFoxy({ message: 'Explain motion', subject: 'science', grade: '9' });
    const requestLog = _loggerInfo.mock.calls.find((c) => c[0] === 'foxy.request');
    expect(requestLog).toBeDefined();
    const ctx = requestLog![1] as Record<string, unknown>;
    expect(ctx.grade).toBe('9');
  });
});

// ─── D. HARD BLOCK — body.grade in allowed set BUT dbGrade is different ──────

describe('D. GRADE_MISMATCH 403 hard block — body.grade ≠ db.grade (the spoof case)', () => {
  beforeEach(() => {
    _studentRow = {
      subscription_plan: 'free',
      account_status: 'active',
      academic_goal: null,
      name: null,
      grade: '8', // ENROLLED grade
    };
  });

  it('returns 403 with exact errorJson envelope (code, error, error_hi)', async () => {
    const { res, body } = await postFoxy({ message: 'JEE physics doubt', subject: 'physics', grade: '12' });
    expect(res.status).toBe(403);
    expect(body).toEqual({
      success: false,
      error: 'Request grade does not match enrollment',
      error_hi: 'Aapki request ka grade aapke profile se match nahi karta.',
      code: 'GRADE_MISMATCH',
    });
  });

  it('writes exactly ONE audit row with action:"foxy.grade_spoof_attempt" and the expected details payload', async () => {
    await postFoxy({ message: 'JEE physics doubt', subject: 'physics', grade: '12' });
    const spoofAuditCalls = _logAuditImpl.mock.calls.filter(
      (c) => (c[1] as { action?: string })?.action === 'foxy.grade_spoof_attempt',
    );
    expect(spoofAuditCalls).toHaveLength(1);
    const [userIdArg, payload] = spoofAuditCalls[0] as [string, Record<string, unknown>];
    expect(userIdArg).toBe('auth-user-1');
    expect(payload.action).toBe('foxy.grade_spoof_attempt');
    expect(payload.resourceType).toBe('students');
    expect(payload.resourceId).toBe('student-uuid-1');
    expect(payload.status).toBe('denied');
    expect(payload.details).toEqual({
      claimed_grade: '12',
      actual_grade: '8',
      route: '/api/foxy',
    });
  });

  it('NEVER calls Claude / grounded-answer / routeIntent on the 403 branch', async () => {
    await postFoxy({ message: 'JEE physics doubt', subject: 'physics', grade: '12' });
    expect(_callGroundedAnswer).not.toHaveBeenCalled();
    expect(_callGroundedAnswerStream).not.toHaveBeenCalled();
    expect(_routeIntent).not.toHaveBeenCalled();
  });

  it('NEVER consumes quota on the 403 branch (no foxy quota RPC invoked)', async () => {
    await postFoxy({ message: 'JEE physics doubt', subject: 'physics', grade: '12' });
    const quotaCalls = rpcImpl.mock.calls.filter((c) => {
      const name = c[0] as string;
      return typeof name === 'string' && /quota|increment|foxy_usage/i.test(name);
    });
    expect(quotaCalls).toEqual([]);
  });
});

// ─── E. Null-grade onboarding student → warn-and-proceed, NOT 403 ────────────

describe('E. Null-grade student row — warn-and-proceed (legit-onboarding branch)', () => {
  beforeEach(() => {
    _studentRow = {
      subscription_plan: 'free',
      account_status: 'active',
      academic_goal: null,
      name: null,
      grade: null, // legitimately-onboarding
    };
  });

  it('does NOT return 403 and DOES call the grounded path', async () => {
    const { res } = await postFoxy({ message: 'Tell me about cells', subject: 'science', grade: '6' });
    expect(res.status).not.toBe(403);
    expect(_callGroundedAnswer).toHaveBeenCalledTimes(1);
  });

  it('calls logger.warn for the null-grade marker', async () => {
    await postFoxy({ message: 'Tell me about cells', subject: 'science', grade: '6' });
    const nullGradeWarn = _loggerWarn.mock.calls.find((c) => {
      const msg = c[0];
      return typeof msg === 'string' && msg.includes('null grade');
    });
    expect(nullGradeWarn, 'expected a logger.warn for the null-grade student row').toBeTruthy();
  });

  it('does NOT write a grade_spoof_attempt audit row when dbGrade is null', async () => {
    await postFoxy({ message: 'Tell me about cells', subject: 'science', grade: '6' });
    const spoofAuditCalls = _logAuditImpl.mock.calls.filter(
      (c) => (c[1] as { action?: string })?.action === 'foxy.grade_spoof_attempt',
    );
    expect(spoofAuditCalls).toEqual([]);
  });
});

// ─── F. Subject independence — block runs for NON-STEM subjects too ──────────

describe('F. The 403 hard block is UNCONDITIONAL — fires for non-STEM subjects regardless of ff_foxy_curriculum_guard_v1', () => {
  beforeEach(() => {
    _studentRow = {
      subscription_plan: 'free',
      account_status: 'active',
      academic_goal: null,
      name: null,
      grade: '8',
    };
    // Explicitly OFF — proves the existing flag-gated STEM curriculum guard is
    // NOT what's blocking us. Re-asserted here for emphasis.
    _isCurriculumGuardEnabled.mockResolvedValue(false);
  });

  it('returns 403 GRADE_MISMATCH on subject="english" (non-STEM) when claimed grade ≠ db grade', async () => {
    const { res, body } = await postFoxy({ message: 'Help me with my essay', subject: 'english', grade: '12' });
    expect(res.status).toBe(403);
    expect(body).toEqual({
      success: false,
      error: 'Request grade does not match enrollment',
      error_hi: 'Aapki request ka grade aapke profile se match nahi karta.',
      code: 'GRADE_MISMATCH',
    });
    expect(_callGroundedAnswer).not.toHaveBeenCalled();
  });

  it('still writes the foxy.grade_spoof_attempt audit row for non-STEM subjects', async () => {
    await postFoxy({ message: 'Help me with my essay', subject: 'english', grade: '12' });
    const spoofAuditCalls = _logAuditImpl.mock.calls.filter(
      (c) => (c[1] as { action?: string })?.action === 'foxy.grade_spoof_attempt',
    );
    expect(spoofAuditCalls).toHaveLength(1);
    expect((spoofAuditCalls[0][1] as Record<string, unknown>).details).toEqual({
      claimed_grade: '12',
      actual_grade: '8',
      route: '/api/foxy',
    });
  });
});
