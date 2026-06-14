import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * GUARD — Foxy CURRICULUM-GUARD STEM-only HARD pre-gate (CEO Decision A).
 *
 * The bug this closes: an out-of-grade CONCEPTUAL query (e.g. a Grade 7 student
 * asking "Explain integration") never reaches the math-SOLVE branch (it isn't a
 * concrete solve query), so the curriculum validator never ran and the student
 * got a full out-of-grade explanation from the grounded path.
 *
 * The fix: on the GROUNDED path, BEFORE the math-solve branch, the route runs
 * `validateCurriculumScope(..., 'grade_only')` on EVERY STEM query (conceptual
 * OR solve) when `isCurriculumGuardEnabled` is true. A truly-out-of-grade topic
 * (deterministic T4a lexicon — NO LLM) is HARD-blocked with badgeState
 * 'out_of_scope' + curriculum.status 'curriculum_out_of_scope', the grounded
 * answer is NEVER produced, and the turn awards 0 XP / no mastery (P2).
 *
 * When the guard is OFF the pre-gate is skipped entirely and the conceptual
 * query flows to the grounded path byte-identically (P12 kill-switch).
 *
 * HARNESS NOTES:
 *   - We mock `@/lib/foxy/math-flag` to control BOTH gates: the curriculum guard
 *     (isCurriculumGuardEnabled) and the math pipeline (isMathPipelineEnabled,
 *     forced OFF so the conceptual query never enters the solve branch). The
 *     `ff_grounded_ai_foxy` DB flag is ON so the route takes the grounded path
 *     (not the legacy 503).
 *   - `validateCurriculumScope` runs FOR REAL (grade_only) so the deterministic
 *     T4a out-of-grade lexicon is exercised end-to-end through the route. It
 *     needs NO LLM in grade_only mode; we still mock `callReasoningModel` to a
 *     rejecting spy to PROVE no model call is made on this path.
 *   - supabaseAdmin returns enrolled grade '7'; validateSubjectWrite is ok; the
 *     grounded client returns a normal answer for the OFF (pass-through) case.
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

// ─── DB feature flags (ff_grounded_ai_foxy ON; everything else per-call) ─────
const _isFeatureEnabled = vi.fn();
vi.mock('@/lib/feature-flags', () => ({
  isFeatureEnabled: (...args: unknown[]) => _isFeatureEnabled(...args),
}));

// ─── the two Foxy flag resolvers — mocked so we drive the guard directly ─────
const _isCurriculumGuardEnabled = vi.fn();
const _isMathPipelineEnabled = vi.fn();
vi.mock('@/lib/foxy/math-flag', () => ({
  isCurriculumGuardEnabled: (...args: unknown[]) => _isCurriculumGuardEnabled(...args),
  isMathPipelineEnabled: (...args: unknown[]) => _isMathPipelineEnabled(...args),
}));

// ─── T2 subject gate (ok) + logger ───────────────────────────────────────────
vi.mock('@/lib/subjects', () => ({ validateSubjectWrite: vi.fn().mockResolvedValue({ ok: true }) }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/foxy/recent-lab-context', () => ({
  fetchRecentLabContext: vi.fn().mockResolvedValue([]),
}));

// ─── reasoning cascade — must NEVER fire on the grade_only pre-gate ──────────
const _callReasoningModel = vi.fn();
vi.mock('@/lib/ai/clients/reasoning-cascade', () => ({
  callReasoningModel: (...args: unknown[]) => _callReasoningModel(...args),
}));

// ─── math collaborators — must NEVER fire (conceptual query, pipeline OFF) ───
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

// ─── grounded path — produces the answer when the guard is OFF / passes ──────
const _callGroundedAnswer = vi.fn();
let _groundedReturn: Record<string, unknown> = {};
vi.mock('@/lib/ai/grounded-client', () => ({
  callGroundedAnswer: (...args: unknown[]) => {
    _callGroundedAnswer(...args);
    return Promise.resolve(_groundedReturn);
  },
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

// ─── supabaseAdmin — record writes; enrolled grade '7' ───────────────────────
interface WriteRecord { table: string; op: 'insert' | 'update' | 'upsert' | 'delete'; }
let writes: WriteRecord[] = [];
let rpcCalls: Array<{ name: string }> = [];

function makeChain(table: string) {
  const chain: Record<string, unknown> = {};
  const resolveDefault = (): { data: unknown; error: unknown } => {
    if (table === 'students') {
      // Enrolled grade '7' — authoritative for the grade_only pre-gate.
      return { data: { subscription_plan: 'free', account_status: 'active', academic_goal: null, name: null, grade: '7' }, error: null };
    }
    if (table === 'foxy_sessions') return { data: { id: 'session-uuid-1' }, error: null };
    return { data: [], error: null };
  };
  for (const m of ['select', 'eq', 'neq', 'in', 'ilike', 'order', 'limit', 'gte', 'lte', 'not', 'is']) {
    chain[m] = () => chain;
  }
  const recordWrite = (op: WriteRecord['op']) => {
    writes.push({ table, op });
    return {
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
    };
  };
  chain.insert = () => recordWrite('insert');
  chain.update = () => recordWrite('update');
  chain.upsert = () => recordWrite('upsert');
  chain.delete = () => recordWrite('delete');
  chain.single = () => Promise.resolve(resolveDefault());
  chain.maybeSingle = () => Promise.resolve(resolveDefault());
  (chain as { then: unknown }).then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(resolveDefault()).then(resolve, reject);
  return chain;
}

const rpcImpl = vi.fn((name: string) => {
  rpcCalls.push({ name });
  return Promise.resolve({ data: [{ allowed: true, current_count: 1 }], error: null });
});

vi.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: { from: (table: string) => makeChain(table), rpc: (...args: unknown[]) => rpcImpl(args[0] as string) },
}));

function makePostRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/foxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-jwt' },
    body: JSON.stringify(body),
  });
}

const FORBIDDEN_MASTERY_TABLES = [
  'concept_mastery',
  'cme_concept_state',
  'student_skill_state',
  'knowledge_gaps',
  'learner_mastery',
  'cme_error_log',
  'bloom_progression',
  'student_learning_profiles',
  'quiz_sessions',
] as const;
const FORBIDDEN_RPCS = ['atomic_quiz_profile_update', 'submit_quiz_results'] as const;

beforeEach(() => {
  vi.clearAllMocks();
  writes = [];
  rpcCalls = [];
  _authorizeImpl.mockResolvedValue({
    authorized: true,
    userId: 'auth-user-1',
    studentId: 'student-uuid-1',
    schoolId: null,
    roles: ['student'],
    permissions: ['foxy.chat'],
  });
  // grounded path ON (so the route reaches the pre-gate + grounded path, not the
  // legacy 503). Math pipeline DB flag OFF — but the route reads it via the
  // mocked isMathPipelineEnabled, forced OFF below regardless.
  _isFeatureEnabled.mockImplementation((flag: string) => {
    if (flag === 'ai_usage_global') return Promise.resolve(true);
    if (flag === 'ff_grounded_ai_foxy') return Promise.resolve(true);
    return Promise.resolve(false);
  });
  // Conceptual query → math pipeline never enters the solve branch.
  _isMathPipelineEnabled.mockResolvedValue(false);
  _classifyMathSolve.mockResolvedValue({ isMathSolve: false });
  rpcImpl.mockImplementation((name: string) => {
    rpcCalls.push({ name });
    return Promise.resolve({ data: [{ allowed: true, current_count: 1 }], error: null });
  });
  // grade_only never calls the LLM — a rejecting spy proves it.
  _callReasoningModel.mockRejectedValue(new Error('grade_only must never call the LLM'));
  _groundedReturn = {
    grounded: true,
    answer: 'Integration is part of calculus...',
    citations: [],
    confidence: 0.9,
    groundedFromChunks: true,
    trace_id: 'trace-grounded',
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

// ─── Guard ON: out-of-grade CONCEPTUAL query is HARD-blocked before grounded ──

describe('curriculum guard ON — grade 7 math "Explain integration" is HARD-blocked (THE REPORTED BUG CASE)', () => {
  beforeEach(() => {
    _isCurriculumGuardEnabled.mockResolvedValue(true);
  });

  it('returns 200 with badgeState "out_of_scope" + curriculum.status "curriculum_out_of_scope"', async () => {
    const { res, body } = await postFoxy({ message: 'Explain to me integration', subject: 'math', grade: '7' });
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.badgeState).toBe('out_of_scope');
    expect((body.curriculum as Record<string, unknown>).status).toBe('curriculum_out_of_scope');
    expect(body.verification_skipped).toBe('out_of_curriculum_scope');
  });

  it('the grounded-answer call is NEVER made (the out-of-grade explanation is blocked)', async () => {
    await postFoxy({ message: 'Explain to me integration', subject: 'math', grade: '7' });
    expect(_callGroundedAnswer).not.toHaveBeenCalled();
  });

  it('the pre-gate is deterministic — callReasoningModel is NEVER called (grade_only skips T4b)', async () => {
    await postFoxy({ message: 'Explain to me integration', subject: 'math', grade: '7' });
    expect(_callReasoningModel).not.toHaveBeenCalled();
  });

  it('awards 0 XP / writes no mastery surface / never calls the quiz-submit RPCs', async () => {
    const { body } = await postFoxy({ message: 'Explain to me integration', subject: 'math', grade: '7' });
    const masteryWrites = writes.filter((w) => (FORBIDDEN_MASTERY_TABLES as readonly string[]).includes(w.table));
    expect(masteryWrites, `unexpected mastery writes: ${JSON.stringify(masteryWrites)}`).toEqual([]);
    for (const rpc of FORBIDDEN_RPCS) {
      expect(rpcCalls.find((c) => c.name === rpc), `${rpc} must not be called`).toBeUndefined();
    }
    // No XP of any kind on the wire.
    const blob = JSON.stringify(body).toLowerCase();
    expect(blob).not.toMatch(/"xp_earned"|"xpearned"|"xp_total"|"xpawarded"/);
    // The math solver/verifier pipeline never ran.
    expect(_runMathSolvePipeline).not.toHaveBeenCalled();
  });

  it('audits the out-of-scope flow with xpAwarded:0 (formative)', async () => {
    await postFoxy({ message: 'Explain to me integration', subject: 'math', grade: '7' });
    const audit = _logAuditImpl.mock.calls
      .map((c) => c[1] as { details?: Record<string, unknown> })
      .find((d) => d?.details?.flow === 'math-pipeline-out-of-scope');
    expect(audit, 'expected a math-pipeline-out-of-scope audit entry').toBeTruthy();
    expect(audit!.details!.xpAwarded).toBe(0);
  });
});

// ─── Guard OFF: conceptual query flows to the grounded path (byte-identical) ──

describe('curriculum guard OFF — the conceptual query flows to grounded as before', () => {
  beforeEach(() => {
    _isCurriculumGuardEnabled.mockResolvedValue(false);
  });

  it('the grounded answer IS produced (pre-gate skipped, no out-of-scope reply)', async () => {
    const { res, body } = await postFoxy({ message: 'Explain to me integration', subject: 'math', grade: '7' });
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    // grounded path produced the answer.
    expect(_callGroundedAnswer).toHaveBeenCalledTimes(1);
    // No curriculum out-of-scope envelope.
    expect(body.badgeState).toBeUndefined();
    expect('curriculum' in body && (body.curriculum as Record<string, unknown>)?.status === 'curriculum_out_of_scope').toBe(false);
  });

  it('validateCurriculumScope is never reached via the pre-gate (guard gate short-circuits) — no LLM either', async () => {
    await postFoxy({ message: 'Explain to me integration', subject: 'math', grade: '7' });
    // The guard gate returned false, so the pre-gate block is a no-op.
    expect(_callReasoningModel).not.toHaveBeenCalled();
    expect(_runMathSolvePipeline).not.toHaveBeenCalled();
  });
});
