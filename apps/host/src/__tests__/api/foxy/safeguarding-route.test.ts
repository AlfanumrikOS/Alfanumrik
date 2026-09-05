import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Safeguarding Phase 1 — /api/foxy Tier-1/Tier-2 wiring (ff_safeguarding_v1).
 *
 *  A. Flag OFF → Tier-1 screen is NEVER invoked; the turn is byte-identical
 *     to the legacy path (grounded answer, no escalation writes).
 *  B. Flag ON + Tier-1 hit + Tier-2 CONFIRMED → terminal safeguarding reply:
 *     - safeguarding_escalations row inserted (excerpt capped at 500 chars,
 *       classifier_meta = confidence + label only);
 *     - fan-out invoked with { escalationId, schoolId, category } — NO excerpt;
 *     - quota unit refunded;
 *     - NO grounded/LLM answer call.
 *  C. Flag ON + Tier-1 hit + Tier-2 AMBIGUOUS (not confirmed) → the turn
 *     continues completely normally (no row, no refund, grounded runs).
 *  D. sessionMood: valid enum passes through to the classifier; invalid
 *     values are dropped silently (classifier sees null), never a 400.
 *
 * HARNESS: cloned from grade-spoof-hard-block.test.ts (the canonical early-
 * gate harness for this route) + factories for the two ai-engineer-owned
 * safeguarding modules and this route's _lib/quota + fan-out modules.
 */

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://test.local';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
});

// ─── RBAC + audit ────────────────────────────────────────────────────────────
const _authorizeImpl = vi.fn();
const _logAuditImpl = vi.fn();
vi.mock('@alfanumrik/lib/rbac', () => ({
  authorizeRequest: (...args: unknown[]) => _authorizeImpl(...args),
  logAudit: (...args: unknown[]) => _logAuditImpl(...args),
}));

// ─── feature flags ───────────────────────────────────────────────────────────
const _isFeatureEnabled = vi.fn();
vi.mock('@alfanumrik/lib/feature-flags', () => ({
  isFeatureEnabled: (...args: unknown[]) => _isFeatureEnabled(...args),
}));

const _isCurriculumGuardEnabled = vi.fn();
const _isMathPipelineEnabled = vi.fn();
vi.mock('@alfanumrik/lib/foxy/math-flag', () => ({
  isCurriculumGuardEnabled: (...args: unknown[]) => _isCurriculumGuardEnabled(...args),
  isMathPipelineEnabled: (...args: unknown[]) => _isMathPipelineEnabled(...args),
}));

vi.mock('@alfanumrik/lib/subjects', () => ({ validateSubjectWrite: vi.fn().mockResolvedValue({ ok: true }) }));
vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@alfanumrik/lib/foxy/recent-lab-context', () => ({
  fetchRecentLabContext: vi.fn().mockResolvedValue([]),
}));

const _classifyMathSolve = vi.fn();
vi.mock('@alfanumrik/lib/ai/workflows/foxy-router', () => ({
  QUIZ_PATTERNS: /\bquiz\b/i,
  ESSAY_LENGTH_PATTERNS: /\bin detail\b/i,
  classifyMathSolve: (...args: unknown[]) => _classifyMathSolve(...args),
}));
vi.mock('@alfanumrik/lib/ai/math/solve-math', () => ({ solveMath: vi.fn() }));
vi.mock('@alfanumrik/lib/math-python-client', () => ({ verifyMath: vi.fn() }));
vi.mock('@alfanumrik/lib/ai/math/solve-pipeline', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, runMathSolvePipeline: vi.fn() };
});

// ─── LLM boundaries ──────────────────────────────────────────────────────────
const _callGroundedAnswer = vi.fn();
let _groundedReturn: Record<string, unknown> = {};
vi.mock('@alfanumrik/lib/ai/grounded-client', () => ({
  callGroundedAnswer: (...args: unknown[]) => {
    _callGroundedAnswer(...args);
    return Promise.resolve(_groundedReturn);
  },
  callGroundedAnswerStream: vi.fn().mockResolvedValue({ ok: false, reason: 'not-used' }),
}));
vi.mock('@alfanumrik/lib/ai', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    classifyIntent: vi.fn().mockResolvedValue({ intent: 'noop' }),
    routeIntent: vi.fn().mockResolvedValue({
      response: 'legacy', intent: 'explain', sources: [], tokensUsed: 0, model: 'none', latencyMs: 0,
    }),
  };
});

// ─── safeguarding modules (ai-engineer FIXED contracts) ──────────────────────
const _screen = vi.fn();
vi.mock('@alfanumrik/lib/ai/validation/safeguarding-screen', () => ({
  screenForSafeguarding: (...args: unknown[]) => _screen(...args),
}));
const _classify = vi.fn();
vi.mock('@alfanumrik/lib/ai/validation/safeguarding-classify', () => ({
  classifySafeguarding: (...args: unknown[]) => _classify(...args),
}));

// ─── fan-out spy ─────────────────────────────────────────────────────────────
const _escalate = vi.fn(() => Promise.resolve({ notifiedAdminCount: 1 }));
vi.mock('@/app/api/foxy/_lib/safeguarding-escalate', () => ({
  escalateSafeguarding: (...args: unknown[]) => _escalate(...args),
}));

// ─── quota module (allow + refund spy) ───────────────────────────────────────
const _refundQuota = vi.fn(() => Promise.resolve());
vi.mock('@/app/api/foxy/_lib/quota', () => ({
  checkAndIncrementQuota: vi.fn().mockResolvedValue({ allowed: true, remaining: 4, limit: 5 }),
  refundQuota: (...args: unknown[]) => _refundQuota(...args),
  resolveTenantAiOverrides: vi.fn().mockResolvedValue({}),
}));

// ─── supabaseAdmin chain ─────────────────────────────────────────────────────
let _studentRow: Record<string, unknown> | null = null;
let _escalationInsertPayload: Record<string, unknown> | null = null;

function makeChain(table: string) {
  const chain: Record<string, unknown> = {};
  const resolveDefault = (): { data: unknown; error: unknown } => {
    if (table === 'students') return { data: _studentRow, error: null };
    if (table === 'foxy_sessions') return { data: { id: 'session-uuid-1' }, error: null };
    return { data: [], error: null };
  };
  for (const m of ['select', 'eq', 'neq', 'in', 'ilike', 'order', 'limit', 'gte', 'lte', 'not', 'is']) {
    chain[m] = () => chain;
  }
  const recordWrite = (payload?: unknown) => {
    if (table === 'safeguarding_escalations' && payload && !Array.isArray(payload)) {
      _escalationInsertPayload = payload as Record<string, unknown>;
    }
    return {
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve({ data: null, error: null }).then(resolve, reject),
      eq: () => ({
        then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
          Promise.resolve({ data: null, error: null }).then(resolve, reject),
      }),
      select: () => ({
        single: () =>
          Promise.resolve(
            table === 'safeguarding_escalations'
              ? { data: { id: 'esc-uuid-1' }, error: null }
              : { data: { id: 'session-uuid-1' }, error: null },
          ),
        then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
          Promise.resolve({
            data: [
              { id: 'msg-user', role: 'user' },
              { id: 'msg-assistant', role: 'assistant' },
            ],
            error: null,
          }).then(resolve, reject),
      }),
    };
  };
  chain.insert = (payload?: unknown) => recordWrite(payload);
  chain.update = () => recordWrite();
  chain.upsert = () => recordWrite();
  chain.delete = () => recordWrite();
  chain.single = () => Promise.resolve(resolveDefault());
  chain.maybeSingle = () => Promise.resolve(resolveDefault());
  (chain as { then: unknown }).then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(resolveDefault()).then(resolve, reject);
  return chain;
}

const rpcImpl = vi.fn((..._args: unknown[]) =>
  Promise.resolve({ data: [{ allowed: true, used_count: 1 }], error: null }),
);
vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  supabaseAdmin: { from: (table: string) => makeChain(table), rpc: (...args: unknown[]) => rpcImpl(...args) },
  getSupabaseAdmin: vi.fn(),
}));

const DISCLOSURE = 'I really do not want to be here anymore, nothing feels okay';

function makePostRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/foxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-jwt' },
    body: JSON.stringify(body),
  });
}

async function postFoxy(body: Record<string, unknown>) {
  const { POST } = await import('@/app/api/foxy/route');
  const res = await POST(makePostRequest(body));
  const parsed = (await res.json()) as Record<string, unknown>;
  return { res, body: parsed };
}

let _safeguardingFlag = false;

beforeEach(() => {
  vi.clearAllMocks();
  _escalationInsertPayload = null;
  _safeguardingFlag = false;
  _studentRow = {
    subscription_plan: 'free',
    account_status: 'active',
    academic_goal: null,
    name: null,
    grade: '8',
    onboarding_completed: true,
    school_id: 'school-uuid-1',
  };
  _authorizeImpl.mockResolvedValue({
    authorized: true,
    userId: 'auth-user-1',
    studentId: 'student-uuid-1',
    schoolId: 'school-uuid-1',
    roles: ['student'],
    permissions: ['foxy.chat'],
  });
  _isFeatureEnabled.mockImplementation((flag: string) => {
    if (flag === 'ai_usage_global') return Promise.resolve(true);
    if (flag === 'ff_grounded_ai_foxy') return Promise.resolve(true);
    if (flag === 'ff_safeguarding_v1') return Promise.resolve(_safeguardingFlag);
    return Promise.resolve(false);
  });
  _isCurriculumGuardEnabled.mockResolvedValue(false);
  _isMathPipelineEnabled.mockResolvedValue(false);
  _classifyMathSolve.mockResolvedValue({ isMathSolve: false });
  _screen.mockReturnValue({ hit: false, categories: [] });
  _classify.mockResolvedValue({ confirmed: false, category: 'none', confidence: 0, tier: 'none' });
  _groundedReturn = {
    grounded: true,
    answer: 'A normal science answer.',
    citations: [],
    confidence: 0.9,
    groundedFromChunks: true,
    trace_id: 'trace-1',
    suggested_alternatives: [],
    meta: { claude_model: 'haiku', tokens_used: 40, latency_ms: 90 },
  };
});

describe('A. flag OFF — tier-1 is a complete no-op', () => {
  it('never invokes the screen and answers normally', async () => {
    _safeguardingFlag = false;
    const { res } = await postFoxy({ message: DISCLOSURE, subject: 'science', grade: '8' });
    expect(res.status).toBe(200);
    expect(_screen).not.toHaveBeenCalled();
    expect(_classify).not.toHaveBeenCalled();
    expect(_escalationInsertPayload).toBeNull();
    expect(_callGroundedAnswer).toHaveBeenCalledTimes(1);
  });
});

describe('B. flag ON + hit + CONFIRMED — safeguarding terminal', () => {
  beforeEach(() => {
    _safeguardingFlag = true;
    _screen.mockReturnValue({ hit: true, categories: ['self_harm'] });
    _classify.mockResolvedValue({
      confirmed: true,
      category: 'self_harm',
      confidence: 0.93,
      tier: 'high',
    });
  });

  it('returns the safeguarding terminal envelope and never calls the LLM', async () => {
    const { res, body } = await postFoxy({ message: DISCLOSURE, subject: 'science', grade: '8' });
    expect(res.status).toBe(200);
    expect(body.badgeState).toBe('safeguarding');
    expect(body.safeguarding).toEqual({ helpline: { name: 'Childline', number: '1098' } });
    expect(_callGroundedAnswer).not.toHaveBeenCalled();
  });

  it('screens the ORIGINAL message and inserts the escalation row with capped excerpt + minimal classifier_meta', async () => {
    await postFoxy({ message: DISCLOSURE, subject: 'science', grade: '8' });
    expect(_screen).toHaveBeenCalledWith(DISCLOSURE);
    expect(_escalationInsertPayload).toMatchObject({
      student_id: 'student-uuid-1',
      school_id: 'school-uuid-1',
      session_id: 'session-uuid-1',
      category: 'self_harm',
      tier: 'high',
      disclosure_excerpt: DISCLOSURE.slice(0, 500),
    });
    expect(_escalationInsertPayload!.classifier_meta).toEqual({
      confidence: 0.93,
      label: 'self_harm',
    });
  });

  it('fans out with metadata only (no excerpt) and refunds the quota unit', async () => {
    await postFoxy({ message: DISCLOSURE, subject: 'science', grade: '8' });
    expect(_escalate).toHaveBeenCalledTimes(1);
    const fanoutArg = _escalate.mock.calls[0][0] as Record<string, unknown>;
    expect(fanoutArg).toEqual({
      escalationId: 'esc-uuid-1',
      schoolId: 'school-uuid-1',
      category: 'self_harm',
    });
    expect(JSON.stringify(fanoutArg)).not.toContain('do not want to be here');
    expect(_refundQuota).toHaveBeenCalledWith('student-uuid-1', 'foxy_chat');
  });

  it('audits flow:safeguarding without the message text (P13)', async () => {
    await postFoxy({ message: DISCLOSURE, subject: 'science', grade: '8' });
    const sgAudit = _logAuditImpl.mock.calls.find(
      (c) => ((c[1] as { details?: { flow?: string } })?.details?.flow) === 'safeguarding',
    );
    expect(sgAudit).toBeDefined();
    const details = (sgAudit![1] as { details: Record<string, unknown> }).details;
    expect(details.category).toBe('self_harm');
    expect(details.tier).toBe('high');
    expect(details.escalated).toBe(true);
    expect(JSON.stringify(details)).not.toContain('do not want to be here');
  });
});

describe('C. flag ON + hit + AMBIGUOUS — the turn continues normally', () => {
  it('no escalation row, no refund, grounded answer served', async () => {
    _safeguardingFlag = true;
    _screen.mockReturnValue({ hit: true, categories: ['distress'] });
    _classify.mockResolvedValue({ confirmed: false, category: 'distress', confidence: 0.4, tier: 'low' });
    const { res, body } = await postFoxy({ message: DISCLOSURE, subject: 'science', grade: '8' });
    expect(res.status).toBe(200);
    expect(body.badgeState).not.toBe('safeguarding');
    expect(_escalationInsertPayload).toBeNull();
    expect(_refundQuota).not.toHaveBeenCalled();
    expect(_callGroundedAnswer).toHaveBeenCalledTimes(1);
  });

  it('classifier failure ≠ confirmed: the turn still answers normally', async () => {
    _safeguardingFlag = true;
    _screen.mockReturnValue({ hit: true, categories: ['distress'] });
    _classify.mockRejectedValue(new Error('classifier down'));
    const { res } = await postFoxy({ message: DISCLOSURE, subject: 'science', grade: '8' });
    expect(res.status).toBe(200);
    expect(_escalationInsertPayload).toBeNull();
    expect(_callGroundedAnswer).toHaveBeenCalledTimes(1);
  });
});

describe('D. sessionMood — validated enum, dropped silently when invalid', () => {
  beforeEach(() => {
    _safeguardingFlag = true;
    _screen.mockReturnValue({ hit: true, categories: ['self_harm'] });
    _classify.mockResolvedValue({ confirmed: true, category: 'self_harm', confidence: 0.9, tier: 'high' });
  });

  it('passes a valid sessionMood through to the classifier', async () => {
    await postFoxy({ message: DISCLOSURE, subject: 'science', grade: '8', sessionMood: 'stressed' });
    expect(_classify).toHaveBeenCalledWith(DISCLOSURE, {
      sessionMood: 'stressed',
      categories: ['self_harm'],
    });
  });

  it('drops an invalid sessionMood silently (classifier sees null, request is NOT rejected)', async () => {
    const { res } = await postFoxy({
      message: DISCLOSURE, subject: 'science', grade: '8', sessionMood: 'furious',
    });
    expect(res.status).toBe(200);
    expect(_classify).toHaveBeenCalledWith(DISCLOSURE, {
      sessionMood: null,
      categories: ['self_harm'],
    });
  });
});
