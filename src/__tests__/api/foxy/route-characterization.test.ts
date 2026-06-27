/**
 * H1 REFACTOR — STEP 0 CHARACTERIZATION PINS for `src/app/api/foxy/route.ts`.
 *
 * These tests LOCK the CURRENT observable behavior of the Foxy route so that
 * any later module-extraction step (H1) that changes behavior fails here.
 * They describe what the route DOES today, not what it SHOULD do — do not
 * "fix" the route to make an assertion read nicer; if the route changes, this
 * file is the tripwire that proves the extraction was not behavior-preserving.
 *
 * Four architect-flagged under-covered behaviors are pinned:
 *
 *   GAP 1 — Quota-tier boundary matrix. `DAILY_QUOTA` (free/starter/pro/
 *           unlimited) is consumed only inside `checkAndIncrementQuota`. We pin
 *           the table's TS-side effect: the exact `p_limit` dispatched to the
 *           `check_and_record_usage` RPC per plan, the `remaining = max(0,
 *           limit - current_count)` arithmetic at limit-1 / limit / over-limit,
 *           and the `allowed === false` → HTTP 429 mapping.
 *           NOTE: the actual at-limit ALLOW/DENY verdict is computed inside the
 *           SQL RPC (DB), which this route mocks — so we pin the inputs
 *           (p_limit) and outputs (remaining / 429) that route.ts owns, and
 *           drive the verdict via the RPC mock the way the DB would.
 *
 *   GAP 2 — Refund / abstain decision matrix (HIGHEST VALUE). For every
 *           `AbstainReason` we pin whether a quota refund fires and what
 *           `quotaRemaining` (effectiveRemaining) the client receives:
 *             - upstream_error / circuit_open  → LEGACY fallback (no abstain card)
 *             - chapter_not_ready              → refund + quotaRemaining = remaining+1
 *             - low_similarity / no_supporting_chunks / no_chunks_retrieved /
 *               scope_mismatch                 → NO refund + quotaRemaining = remaining
 *
 *   GAP 3 — Branch-selection pin. `ff_grounded_ai_foxy` OFF → `runLegacyFoxyFlow`
 *           (routeIntent invoked, grounded client NOT). ON → grounded path
 *           (grounded client invoked, routeIntent NOT).
 *
 *   GAP 4 — Null-grade permutations. onboarded (onboarding_completed===true) +
 *           null db grade → 403 GRADE_MISMATCH (reason:onboarded_null_grade).
 *           pre-onboarding + null db grade → warn-and-proceed (NOT 403).
 *
 * HARNESS: mirrors `grade-spoof-hard-block.test.ts` and
 * `grounded-failure-fallback.test.ts` — same collaborator-boundary mocks
 * (rbac, feature-flags, foxy/math-flag, subjects, logger, grounded-client,
 * @/lib/ai, supabase-admin). No new mocking primitive. route.ts is NOT
 * modified by this step.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

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

// ─── feature flags — driven per scenario ─────────────────────────────────────
const _isFeatureEnabled = vi.fn();
vi.mock('@/lib/feature-flags', () => ({
  isFeatureEnabled: (...args: unknown[]) => _isFeatureEnabled(...args),
}));

// ─── the two Foxy flag resolvers — off by default ────────────────────────────
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

// ─── grounded path — the LLM boundary. Configurable per scenario. ────────────
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

// ─── legacy routeIntent path — the OTHER LLM boundary. ───────────────────────
const _classifyIntent = vi.fn();
const _routeIntent = vi.fn();
vi.mock('@/lib/ai', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    classifyIntent: (...args: unknown[]) => {
      _classifyIntent(...args);
      return Promise.resolve({ intent: 'explain' });
    },
    routeIntent: (...args: unknown[]) => {
      _routeIntent(...args);
      return Promise.resolve({
        response: 'LEGACY_ANSWER',
        intent: 'explain',
        sources: [],
        tokensUsed: 11,
        model: 'gpt-4o-mini',
        latencyMs: 0,
        traceId: 'legacy-trace-1',
      });
    },
  };
});

// ─── supabaseAdmin — students row + RPC + table-access tracking ──────────────
let _studentRow: Record<string, unknown> | null = null;
// Records each table name passed to .from() — used to detect refundQuota,
// which touches 'student_daily_usage'.
const _fromTables: string[] = [];

function makeChain(table: string) {
  _fromTables.push(table);
  const chain: Record<string, unknown> = {};
  const resolveDefault = (): { data: unknown; error: unknown } => {
    if (table === 'students') return { data: _studentRow, error: null };
    if (table === 'foxy_sessions') return { data: { id: 'session-uuid-1' }, error: null };
    // refundQuota reads usage_count then UPDATEs when > 0 — give it a real row
    // so the full refund write path executes (not just the SELECT).
    if (table === 'student_daily_usage') return { data: { usage_count: 5 }, error: null };
    return { data: [], error: null };
  };
  for (const m of ['select', 'eq', 'neq', 'in', 'ilike', 'order', 'limit', 'gte', 'lte', 'not', 'is']) {
    chain[m] = () => chain;
  }
  const recordWrite = () => ({
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve({ data: null, error: null }).then(resolve, reject),
    eq: () => ({
      eq: () => ({
        eq: () => ({
          then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
            Promise.resolve({ data: null, error: null }).then(resolve, reject),
        }),
        then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
          Promise.resolve({ data: null, error: null }).then(resolve, reject),
      }),
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

// RPC mock: captures every call and answers check_and_record_usage from the
// per-test quota config so we can exercise the boundary at limit-1/limit/over.
const _rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
let _quotaRow: { allowed: boolean; current_count: number } = { allowed: true, current_count: 1 };
// Union of the RPC success-shape (data row[] / error null) and the error-shape
// (data null / error {message}) so the over-limit override at line ~371 — which
// drives the DB-error branch — is assignable to the same mock signature.
type RpcResult = {
  data: { allowed: boolean; current_count: number }[] | null;
  error: { message: string } | null;
};
const rpcImpl = vi.fn((name: string, args: Record<string, unknown>): Promise<RpcResult> => {
  _rpcCalls.push({ name, args });
  if (name === 'check_and_record_usage') {
    return Promise.resolve({ data: [_quotaRow], error: null });
  }
  return Promise.resolve({ data: [{ allowed: true, current_count: 1 }], error: null });
});

vi.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: { from: (table: string) => makeChain(table), rpc: (...args: unknown[]) => rpcImpl(...(args as [string, Record<string, unknown>])) },
}));

function makePostRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/foxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-jwt' },
    body: JSON.stringify(body),
  });
}

function quotaCheckLimit(): number | undefined {
  const call = _rpcCalls.find((c) => c.name === 'check_and_record_usage');
  return call?.args?.p_limit as number | undefined;
}

function refundFired(): boolean {
  return _fromTables.includes('student_daily_usage');
}

beforeEach(() => {
  vi.clearAllMocks();
  _fromTables.length = 0;
  _rpcCalls.length = 0;
  _quotaRow = { allowed: true, current_count: 1 };
  // Default: enrolled grade '8', free plan, onboarding completed — claimed
  // grade '8' so the grade-spoof block never fires unless a test wants it.
  _studentRow = {
    subscription_plan: 'free',
    account_status: 'active',
    academic_goal: null,
    name: null,
    grade: '8',
    onboarding_completed: true,
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
  _isCurriculumGuardEnabled.mockResolvedValue(false);
  _isMathPipelineEnabled.mockResolvedValue(false);
  _classifyMathSolve.mockResolvedValue({ isMathSolve: false });
  // Default grounded SUCCESS — overridden in abstain scenarios.
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

// A grade-safe default body: claimed grade matches the default enrolled '8'.
function body(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { message: 'Explain photosynthesis', subject: 'science', grade: '8', ...extra };
}

// ───────────────────────────────────────────────────────────────────────────
// GAP 1 — QUOTA-TIER BOUNDARY MATRIX
// ───────────────────────────────────────────────────────────────────────────

describe('GAP 1 — DAILY_QUOTA tier table: per-plan p_limit dispatch', () => {
  const cases: Array<[string, number]> = [
    ['free', 10],
    ['starter', 30],
    ['pro', 100],
    ['unlimited', 999999],
  ];

  it.each(cases)(
    'plan "%s" dispatches p_limit=%d to check_and_record_usage',
    async (plan, expectedLimit) => {
      _studentRow = {
        subscription_plan: plan,
        account_status: 'active',
        academic_goal: null,
        name: null,
        grade: '8',
        onboarding_completed: true,
      };
      const { res } = await postFoxy(body());
      expect(res.status).toBe(200);
      expect(quotaCheckLimit()).toBe(expectedLimit);
    },
  );

  it('an unknown/unmapped plan falls back to DEFAULT_QUOTA=10', async () => {
    // normalizeFoxyPlanCode coerces unknown plans to "free" before the route
    // even reaches DAILY_QUOTA, so the dispatched limit is the free=10 value.
    _studentRow = {
      subscription_plan: 'some_legacy_unknown_plan',
      account_status: 'active',
      academic_goal: null,
      name: null,
      grade: '8',
      onboarding_completed: true,
    };
    const { res } = await postFoxy(body());
    expect(res.status).toBe(200);
    expect(quotaCheckLimit()).toBe(10);
  });
});

describe('GAP 1 — quota boundary: remaining arithmetic + allow/deny (free, limit=10)', () => {
  it('at limit-1 (current_count=9) → allowed, 200, quotaRemaining=1', async () => {
    _quotaRow = { allowed: true, current_count: 9 };
    const { res, body: b } = await postFoxy(body());
    expect(res.status).toBe(200);
    expect(b.quotaRemaining).toBe(1);
  });

  it('at the limit (current_count=10) → allowed, 200, quotaRemaining=0', async () => {
    _quotaRow = { allowed: true, current_count: 10 };
    const { res, body: b } = await postFoxy(body());
    expect(res.status).toBe(200);
    expect(b.quotaRemaining).toBe(0);
  });

  it('remaining is clamped at 0 — never negative (current_count=15)', async () => {
    _quotaRow = { allowed: true, current_count: 15 };
    const { res, body: b } = await postFoxy(body());
    expect(res.status).toBe(200);
    expect(b.quotaRemaining).toBe(0);
  });

  it('over the limit (RPC reports allowed=false) → 429 with quotaRemaining=0, no LLM call', async () => {
    _quotaRow = { allowed: false, current_count: 11 };
    const { res, body: b } = await postFoxy(body());
    expect(res.status).toBe(429);
    expect(b.quotaRemaining).toBe(0);
    expect(_callGroundedAnswer).not.toHaveBeenCalled();
    expect(_routeIntent).not.toHaveBeenCalled();
  });

  it('RPC error short-circuits to deny (429), never serves an answer', async () => {
    rpcImpl.mockImplementationOnce((name: string, args: Record<string, unknown>) => {
      _rpcCalls.push({ name, args });
      return Promise.resolve({ data: null, error: { message: 'db down' } });
    });
    const { res } = await postFoxy(body());
    expect(res.status).toBe(429);
    expect(_callGroundedAnswer).not.toHaveBeenCalled();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// GAP 2 — REFUND / ABSTAIN DECISION MATRIX  (highest value)
// ───────────────────────────────────────────────────────────────────────────

describe('GAP 2 — abstain reasons that fall back to LEGACY (no abstain card, no refund block)', () => {
  it.each(['upstream_error', 'circuit_open'] as const)(
    'abstain_reason "%s" → legacy flow: routeIntent invoked, grounded card NOT shown',
    async (reason) => {
      _groundedReturn = {
        grounded: false,
        abstain_reason: reason,
        suggested_alternatives: [],
        trace_id: 'trace-x',
        meta: { latency_ms: 12 },
      };
      const { res, body: b } = await postFoxy(body());
      expect(res.status).toBe(200);
      expect(b.success).toBe(true);
      expect(b.response).toBe('LEGACY_ANSWER');
      expect(b.groundingStatus).toBe('grounded');
      // The hard-abstain envelope fields must be ABSENT — this is the legacy path.
      expect(b.abstainReason).toBeUndefined();
      expect(_callGroundedAnswer).toHaveBeenCalledTimes(1);
      expect(_routeIntent).toHaveBeenCalledTimes(1);
    },
  );
});

describe('GAP 2 — abstain reason that REFUNDS quota (chapter_not_ready)', () => {
  beforeEach(() => {
    // current_count=2 on free(10) → remaining=8 at the time of the abstain.
    _quotaRow = { allowed: true, current_count: 2 };
    _groundedReturn = {
      grounded: false,
      abstain_reason: 'chapter_not_ready',
      suggested_alternatives: [],
      trace_id: 'trace-cnr',
      meta: { latency_ms: 12 },
    };
  });

  it('returns a hard-abstain envelope, NOT the legacy answer', async () => {
    const { res, body: b } = await postFoxy(body());
    expect(res.status).toBe(200);
    expect(b.groundingStatus).toBe('hard-abstain');
    expect(b.abstainReason).toBe('chapter_not_ready');
    expect(b.response).toBe('');
    expect(_routeIntent).not.toHaveBeenCalled();
  });

  it('recomputes effectiveRemaining = remaining + 1 (8 → 9) because the quota was refunded', async () => {
    const { body: b } = await postFoxy(body());
    expect(b.quotaRemaining).toBe(9);
  });

  it('actually touches student_daily_usage (the refund write path fired)', async () => {
    await postFoxy(body());
    expect(refundFired()).toBe(true);
  });
});

describe('GAP 2 — abstain reasons that do NOT refund (effectiveRemaining === remaining)', () => {
  const noRefund = ['low_similarity', 'no_supporting_chunks', 'no_chunks_retrieved', 'scope_mismatch'] as const;

  it.each(noRefund)(
    'abstain_reason "%s" → hard-abstain, quotaRemaining stays = remaining (8), no refund write',
    async (reason) => {
      _quotaRow = { allowed: true, current_count: 2 }; // remaining = 8
      _groundedReturn = {
        grounded: false,
        abstain_reason: reason,
        suggested_alternatives: [],
        trace_id: 'trace-nr',
        meta: { latency_ms: 12 },
      };
      const { res, body: b } = await postFoxy(body());
      expect(res.status).toBe(200);
      expect(b.groundingStatus).toBe('hard-abstain');
      expect(b.abstainReason).toBe(reason);
      expect(b.quotaRemaining).toBe(8);
      expect(refundFired()).toBe(false);
      expect(_routeIntent).not.toHaveBeenCalled();
    },
  );
});

// ───────────────────────────────────────────────────────────────────────────
// GAP 3 — BRANCH SELECTION:  ff_grounded_ai_foxy  OFF → legacy, ON → grounded
// ───────────────────────────────────────────────────────────────────────────

describe('GAP 3 — ff_grounded_ai_foxy branch selection', () => {
  it('flag OFF → runLegacyFoxyFlow (routeIntent invoked, grounded client NOT)', async () => {
    _isFeatureEnabled.mockImplementation((flag: string) => {
      if (flag === 'ai_usage_global') return Promise.resolve(true);
      if (flag === 'ff_grounded_ai_foxy') return Promise.resolve(false);
      return Promise.resolve(false);
    });
    const { res, body: b } = await postFoxy(body());
    expect(res.status).toBe(200);
    expect(b.response).toBe('LEGACY_ANSWER');
    expect(_routeIntent).toHaveBeenCalledTimes(1);
    expect(_callGroundedAnswer).not.toHaveBeenCalled();
  });

  it('flag ON → grounded path (grounded client invoked, routeIntent NOT)', async () => {
    // default beforeEach has ff_grounded_ai_foxy ON
    const { res, body: b } = await postFoxy(body());
    expect(res.status).toBe(200);
    expect(b.response).toBe('Some answer about the topic.');
    expect(_callGroundedAnswer).toHaveBeenCalledTimes(1);
    expect(_routeIntent).not.toHaveBeenCalled();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// GAP 4 — NULL-GRADE PERMUTATIONS
// ───────────────────────────────────────────────────────────────────────────

describe('GAP 4 — null db-grade permutations', () => {
  it('onboarded (onboarding_completed=true) + null grade → 403 GRADE_MISMATCH, no LLM call', async () => {
    _studentRow = {
      subscription_plan: 'free',
      account_status: 'active',
      academic_goal: null,
      name: null,
      grade: null,
      onboarding_completed: true,
    };
    const { res, body: b } = await postFoxy(body({ grade: '8' }));
    expect(res.status).toBe(403);
    expect(b.code).toBe('GRADE_MISMATCH');
    expect(_callGroundedAnswer).not.toHaveBeenCalled();
    expect(_routeIntent).not.toHaveBeenCalled();
  });

  it('onboarded + null grade → audit row carries reason:"onboarded_null_grade"', async () => {
    _studentRow = {
      subscription_plan: 'free',
      account_status: 'active',
      academic_goal: null,
      name: null,
      grade: null,
      onboarding_completed: true,
    };
    await postFoxy(body({ grade: '8' }));
    const spoofAudit = _logAuditImpl.mock.calls.find(
      (c) => (c[1] as { action?: string })?.action === 'foxy.grade_spoof_attempt',
    );
    expect(spoofAudit).toBeDefined();
    expect((spoofAudit![1] as { details?: Record<string, unknown> }).details).toMatchObject({
      claimed_grade: '8',
      actual_grade: null,
      route: '/api/foxy',
      reason: 'onboarded_null_grade',
    });
  });

  it('pre-onboarding (onboarding_completed=false) + null grade → warn-and-proceed, 200, grounded path runs', async () => {
    _studentRow = {
      subscription_plan: 'free',
      account_status: 'active',
      academic_goal: null,
      name: null,
      grade: null,
      onboarding_completed: false,
    };
    const { res } = await postFoxy(body({ grade: '8' }));
    expect(res.status).not.toBe(403);
    expect(_callGroundedAnswer).toHaveBeenCalledTimes(1);
    const nullGradeWarn = _loggerWarn.mock.calls.find(
      (c) => typeof c[0] === 'string' && (c[0] as string).includes('null grade'),
    );
    expect(nullGradeWarn).toBeTruthy();
  });

  it('pre-onboarding + null grade does NOT write a grade_spoof_attempt audit row', async () => {
    _studentRow = {
      subscription_plan: 'free',
      account_status: 'active',
      academic_goal: null,
      name: null,
      grade: null,
      onboarding_completed: false,
    };
    await postFoxy(body({ grade: '8' }));
    const spoofAudit = _logAuditImpl.mock.calls.filter(
      (c) => (c[1] as { action?: string })?.action === 'foxy.grade_spoof_attempt',
    );
    expect(spoofAudit).toEqual([]);
  });
});
