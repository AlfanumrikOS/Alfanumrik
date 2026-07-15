/**
 * Foxy Teaching Director — BLOCKING-path persist-on-success (Phase 2.1 polish,
 * 2026-07-15). Behind ff_foxy_teaching_director_v1 (default OFF).
 *
 * FIX 2 pins the lesson-step advance timing on the blocking JSON path
 * (apps/host/src/app/api/foxy/route.ts):
 *
 *   • grounded SUCCESS on a teaching turn → persistLessonProgress fires exactly
 *     once (with the composed plan), AND the wire returns suggestedButtons +
 *     nextActions.
 *   • hard-abstain (no teaching produced) → persistLessonProgress does NOT fire
 *     (the student didn't get the teaching, so the lesson stays put).
 *
 * The Director helpers are mocked so this file tests the ROUTE decision (WHEN
 * persist happens), not the pure brain (pinned in lib/foxy/teaching-director.
 * test.ts) or the wiring adapter (foxy-teaching-director-wiring.test.ts). The
 * harness mirrors route-characterization.test.ts's collaborator-boundary mocks.
 *
 * Owner: ai-engineer. P14 reviewers: assessment (pedagogy), testing, frontend.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { TeachingPlan } from '@alfanumrik/lib/foxy/teaching-director';

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://test.local';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
});

// ─── RBAC + audit ────────────────────────────────────────────────────────────
const _authorizeImpl = vi.fn();
vi.mock('@alfanumrik/lib/rbac', () => ({
  authorizeRequest: (...args: unknown[]) => _authorizeImpl(...args),
  logAudit: vi.fn(),
}));

// ─── feature flags ───────────────────────────────────────────────────────────
const _isFeatureEnabled = vi.fn();
vi.mock('@alfanumrik/lib/feature-flags', () => ({
  isFeatureEnabled: (...args: unknown[]) => _isFeatureEnabled(...args),
}));

// ─── Foxy flag resolvers off ─────────────────────────────────────────────────
vi.mock('@alfanumrik/lib/foxy/math-flag', () => ({
  isCurriculumGuardEnabled: vi.fn().mockResolvedValue(false),
  isMathPipelineEnabled: vi.fn().mockResolvedValue(false),
}));

// ─── subject governance ok + logger ──────────────────────────────────────────
vi.mock('@alfanumrik/lib/subjects', () => ({ validateSubjectWrite: vi.fn().mockResolvedValue({ ok: true }) }));
vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@alfanumrik/lib/foxy/recent-lab-context', () => ({ fetchRecentLabContext: vi.fn().mockResolvedValue([]) }));

// ─── math collaborators — never fire ─────────────────────────────────────────
vi.mock('@alfanumrik/lib/ai/workflows/foxy-router', () => ({
  QUIZ_PATTERNS: /\bquiz\b/i,
  classifyMathSolve: vi.fn().mockResolvedValue({ isMathSolve: false }),
}));
vi.mock('@alfanumrik/lib/ai/math/solve-math', () => ({ solveMath: vi.fn() }));
vi.mock('@alfanumrik/lib/math-python-client', () => ({ verifyMath: vi.fn() }));
vi.mock('@alfanumrik/lib/ai/math/solve-pipeline', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, runMathSolvePipeline: vi.fn() };
});

// ─── grounded path — configurable per scenario ───────────────────────────────
let _groundedReturn: Record<string, unknown> = {};
vi.mock('@alfanumrik/lib/ai/grounded-client', () => ({
  callGroundedAnswer: vi.fn(() => Promise.resolve(_groundedReturn)),
  callGroundedAnswerStream: vi.fn(() => Promise.resolve({ ok: false, reason: 'not-used' })),
}));

// ─── legacy routeIntent — should not fire on the grounded path ───────────────
const _routeIntent = vi.fn();
vi.mock('@alfanumrik/lib/ai', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    classifyIntent: vi.fn(() => Promise.resolve({ intent: 'explain' })),
    routeIntent: (...args: unknown[]) => {
      _routeIntent(...args);
      return Promise.resolve({ response: 'LEGACY', intent: 'explain', sources: [], tokensUsed: 1, model: 'x', latencyMs: 0, traceId: 't' });
    },
  };
});

// ─── Teaching Director — mock the WIRING adapter; spy persistLessonProgress ───
// isTeachingTurn + a fixed compose plan + a section stub let us drive the route
// decision without the pure brain. persistLessonProgress is the spy under test.
const _persistSpy = vi.fn();
const FAKE_PLAN = {
  currentObjective: {
    conceptName: 'Decimals',
    conceptId: 'concept-decimals-1',
    whyNow: 'next-in-ladder',
    reason: { en: 'You are ready for the next step: Decimals.', hi: 'आप अगले चरण के लिए तैयार हैं: Decimals।' },
  },
  lessonStep: 'hook',
  difficultyTarget: 0.5,
  targetBloom: 'understand',
  depthCeiling: 'within_grade',
  suggestedButtons: ['got_it', 'show_example', 'quiz_me'],
  recommendedNextActions: [
    { kind: 'quiz_concept', label: { en: 'Practice Decimals with a few questions', hi: 'Decimals के कुछ सवालों से अभ्यास करो' } },
  ],
} as unknown as TeachingPlan;
vi.mock('@/app/api/foxy/_lib/teaching-director', () => ({
  isTeachingTurn: (mode: string) => mode !== 'practice',
  loadLessonStepState: vi.fn().mockResolvedValue(null),
  maybeComposeTeachingPlan: vi.fn(() => FAKE_PLAN),
  buildTeachingDirectorSection: vi.fn(() => '## TEACHING DIRECTOR (mock)'),
  persistLessonProgress: (...args: unknown[]) => _persistSpy(...args),
}));

// ─── supabaseAdmin — students row + RPC + generic reads/writes ────────────────
let _studentRow: Record<string, unknown> | null = null;
function makeChain(table: string) {
  const chain: Record<string, unknown> = {};
  const resolveDefault = (): { data: unknown; error: unknown } => {
    if (table === 'students') return { data: _studentRow, error: null };
    if (table === 'foxy_sessions') return { data: { id: 'session-uuid-1' }, error: null };
    if (table === 'student_daily_usage') return { data: { usage_count: 5 }, error: null };
    return { data: [], error: null };
  };
  for (const m of ['select', 'eq', 'neq', 'in', 'ilike', 'order', 'limit', 'gte', 'lte', 'not', 'is']) {
    chain[m] = () => chain;
  }
  const recordWrite = () => ({
    then: (res: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(res),
    eq: () => ({ then: (res: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(res) }),
    select: () => ({
      single: () => Promise.resolve({ data: { id: 'session-uuid-1' }, error: null }),
      then: (res: (v: unknown) => unknown) =>
        Promise.resolve({ data: [{ id: 'msg-user', role: 'user' }, { id: 'msg-assistant', role: 'assistant' }], error: null }).then(res),
    }),
  });
  chain.insert = () => recordWrite();
  chain.update = () => recordWrite();
  chain.upsert = () => recordWrite();
  chain.delete = () => recordWrite();
  chain.single = () => Promise.resolve(resolveDefault());
  chain.maybeSingle = () => Promise.resolve(resolveDefault());
  (chain as { then: unknown }).then = (res: (v: unknown) => unknown) => Promise.resolve(resolveDefault()).then(res);
  return chain;
}
let _quotaRow = { allowed: true, used_count: 1 };
let _planLimit = 30;
const rpcImpl = vi.fn((name: string) => {
  if (name === 'check_and_record_usage') return Promise.resolve({ data: [_quotaRow], error: null });
  if (name === 'get_plan_limit') return Promise.resolve({ data: _planLimit, error: null });
  return Promise.resolve({ data: [{ allowed: true, used_count: 1 }], error: null });
});
vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  supabaseAdmin: { from: (t: string) => makeChain(t), rpc: (...args: unknown[]) => rpcImpl(...(args as [string])) },
}));

// eslint-disable-next-line import/first
function makePostRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/foxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-jwt' },
    body: JSON.stringify(body),
  });
}

async function postFoxy(body: Record<string, unknown>): Promise<{ res: Response; body: Record<string, unknown> }> {
  const { POST } = await import('@/app/api/foxy/route');
  const res = await POST(makePostRequest(body));
  const parsed = (await res.json()) as Record<string, unknown>;
  return { res, body: parsed };
}

beforeEach(() => {
  vi.clearAllMocks();
  _quotaRow = { allowed: true, used_count: 1 };
  _planLimit = 30;
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
  // Director flag ON (+ the usual grounded/global flags); everything else OFF.
  _isFeatureEnabled.mockImplementation((flag: string) => {
    if (flag === 'ai_usage_global') return Promise.resolve(true);
    if (flag === 'ff_grounded_ai_foxy') return Promise.resolve(true);
    if (flag === 'ff_foxy_teaching_director_v1') return Promise.resolve(true);
    return Promise.resolve(false);
  });
  // Default grounded SUCCESS — overridden in the abstain scenario.
  _groundedReturn = {
    grounded: true,
    answer: 'Decimals are numbers with a fractional part expressed after a point.',
    citations: [],
    confidence: 0.9,
    groundedFromChunks: true,
    trace_id: 'trace-1',
    suggested_alternatives: [],
    meta: { claude_model: 'haiku', tokens_used: 40, latency_ms: 90 },
  };
});

function body(extra: Record<string, unknown> = {}): Record<string, unknown> {
  // Teaching turn (mode 'learn'), claimed grade matches enrolled '8'.
  return { message: 'Teach me decimals', subject: 'math', grade: '8', mode: 'learn', ...extra };
}

describe('blocking path — lesson step advances ONLY on grounded success (FIX 2)', () => {
  it('grounded success on a teaching turn → persistLessonProgress fires once + wire returns plan fields', async () => {
    const { res, body: b } = await postFoxy(body());
    expect(res.status).toBe(200);
    expect(b.success).toBe(true);
    // FIX 2 — lesson advanced exactly once, with the composed plan, on success.
    expect(_persistSpy).toHaveBeenCalledTimes(1);
    expect(_persistSpy).toHaveBeenCalledWith('session-uuid-1', FAKE_PLAN);
    // Wire parity — the same fields the streaming done event now carries.
    expect(b.suggestedButtons).toEqual(FAKE_PLAN.suggestedButtons);
    expect(b.nextActions).toEqual(FAKE_PLAN.recommendedNextActions);
    // Grounded path, not legacy.
    expect(_routeIntent).not.toHaveBeenCalled();
  });

  it('hard-abstain (chapter_not_ready) → persistLessonProgress does NOT fire (lesson stays put)', async () => {
    _groundedReturn = {
      grounded: false,
      abstain_reason: 'chapter_not_ready',
      suggested_alternatives: [],
      trace_id: 'trace-abstain',
      meta: { latency_ms: 12 },
    };
    const { res, body: b } = await postFoxy(body());
    expect(res.status).toBe(200);
    expect(b.groundingStatus).toBe('hard-abstain');
    // FIX 2 — the student got no teaching, so the lesson step must NOT advance.
    expect(_persistSpy).not.toHaveBeenCalled();
    // And no plan fields leak onto the hard-abstain envelope.
    expect(b).not.toHaveProperty('suggestedButtons');
    expect(b).not.toHaveProperty('nextActions');
  });

  it('no-refund abstain (no_chunks_retrieved) → persistLessonProgress does NOT fire', async () => {
    _groundedReturn = {
      grounded: false,
      abstain_reason: 'no_chunks_retrieved',
      suggested_alternatives: [],
      trace_id: 'trace-nr',
      meta: { latency_ms: 12 },
    };
    const { res, body: b } = await postFoxy(body());
    expect(res.status).toBe(200);
    expect(b.groundingStatus).toBe('hard-abstain');
    expect(_persistSpy).not.toHaveBeenCalled();
  });
});
