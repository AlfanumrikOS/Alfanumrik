import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { FoxyResponse } from '@/lib/foxy/schema';
import type { MathPipelineResult } from '@/lib/ai/math/solve-pipeline';

/**
 * GUARD #5 — Foxy MATH-SOLVE turn is FORMATIVE-ONLY: 0 XP, ZERO mastery writes.
 *
 * BINDING assessment contract: a math-solve turn (Classifier -> Solver ->
 * Verifier) is a tutoring interaction, NOT a graded assessment. It must:
 *   - call NEITHER submitQuizResults NOR atomic_quiz_profile_update,
 *   - write to NONE of the mastery surfaces (concept_mastery, cme_concept_state,
 *     student_skill_state, knowledge_gaps, learner_mastery, cme_error_log,
 *     bloom_progression, student_learning_profiles, quiz_sessions),
 *   - award 0 XP (audit `xpAwarded: 0`; response `tokensUsed: 0`).
 *
 * A solver-verified answer cannot move mastery_mean / p_know — only a REAL quiz
 * submission does, through the existing atomic RPC path. This guard is the wall
 * (P2 XP economy, P4 atomic submission).
 *
 * HARNESS NOTE (why this differs from the original):
 *   The original harness left `ff_grounded_ai_foxy` defaulting to FALSE, so the
 *   route took the LEGACY path (route.ts:3053) and returned 503 BEFORE ever
 *   reaching the math branch (route.ts:3078, which lives in the GROUNDED path).
 *   The "solveMath called 0 times" / 503 failures were a harness bug, not a
 *   pipeline bug. Fix: flip `ff_grounded_ai_foxy` ON so the route reaches the
 *   grounded path's math branch, and mock `runMathSolvePipeline` at the module
 *   boundary to return a fixed MathPipelineResult so `persistMathTurnAndRespond`
 *   runs deterministically — we then record EVERY supabaseAdmin write + RPC and
 *   assert the forbidden surfaces are untouched. (Driving the real solveMath/
 *   verifyMath wiring is unnecessary here; the verdict→display mapping is unit-
 *   tested in math-verdict-display.test.ts. We mock the module so the no-mastery
 *   invariant is tested at the ROUTE level — the layer that actually persists.)
 *
 *   Defense-in-depth: the mapping module itself imports NO supabase client (it
 *   only calls solveMath + verifyMath + logger + FoxyResponseSchema), so it
 *   CANNOT write mastery even in principle; this route-level check pins the
 *   persistence layer (`persistMathTurnAndRespond`).
 *
 * REASONING v2 NOTE (Phase 1): the route now runs `validateCurriculumScope`
 *   BEFORE `runMathSolvePipeline`. To reach the solver path the scope gate must
 *   return inScope:true, so we mock `@/lib/foxy/curriculum-scope`. The
 *   OUT-OF-SCOPE path (scope.inScope === false) is ALSO formative — 0 XP / 0
 *   mastery — and is pinned in its own describe block below.
 */

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

// Tables the route LEGITIMATELY writes on a math turn:
//   - foxy_sessions: touched by resolveSession (update last_active_at / insert new)
//   - foxy_chat_messages: the user+assistant turn persistence
const ALLOWED_WRITE_TABLES = ['foxy_sessions', 'foxy_chat_messages'] as const;

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

// ─── math collaborators + the extracted pipeline module ──────────────────────
const _classifyMathSolve = vi.fn();
const _runMathSolvePipeline = vi.fn();
// solveMath/verifyMath are mocked so that even if anything tried to touch them
// it would be inert; the route calls runMathSolvePipeline (mocked) instead.
vi.mock('@/lib/ai/workflows/foxy-router', () => ({
  QUIZ_PATTERNS: /\bquiz\b/i,
  classifyMathSolve: (...args: unknown[]) => _classifyMathSolve(...args),
}));
vi.mock('@/lib/ai/math/solve-math', () => ({ solveMath: vi.fn() }));
vi.mock('@/lib/math-python-client', () => ({ verifyMath: vi.fn() }));
vi.mock('@/lib/ai/math/solve-pipeline', async (importOriginal) => {
  // Keep stripAnswerValue + types real; only stub the orchestrator.
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    runMathSolvePipeline: (...args: unknown[]) => _runMathSolvePipeline(...args),
  };
});

// ─── curriculum-scope gate (Reasoning v2 Phase 1) ────────────────────────────
// The route runs this BEFORE the pipeline. Default ON (inScope:true) so the
// in-scope tests reach the solver; the out-of-scope describe block flips it.
const _validateCurriculumScope = vi.fn();
vi.mock('@/lib/foxy/curriculum-scope', () => ({
  validateCurriculumScope: (...args: unknown[]) => _validateCurriculumScope(...args),
}));

// grounded path must NOT run on a math turn (the math branch returns early).
vi.mock('@/lib/ai/grounded-client', () => ({
  callGroundedAnswer: vi.fn().mockRejectedValue(new Error('grounded path must not run on a math turn')),
  callGroundedAnswerStream: vi.fn().mockResolvedValue({ ok: false }),
}));
vi.mock('@/lib/ai', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    classifyIntent: vi.fn().mockResolvedValue({ intent: 'noop' }),
    routeIntent: vi.fn().mockRejectedValue(new Error('legacy path must not run')),
  };
});

// ─── supabaseAdmin: record EVERY write op + rpc ──────────────────────────────
interface WriteRecord { table: string; op: 'insert' | 'update' | 'upsert' | 'delete'; }
let writes: WriteRecord[] = [];
let rpcCalls: Array<{ name: string }> = [];

function makeChain(table: string) {
  const chain: Record<string, unknown> = {};
  const resolveDefault = (): { data: unknown; error: unknown } => {
    if (table === 'students') {
      // grade '6' matches the request grade so validateCurriculumScope (mocked
      // anyway) and any direct enrolled-grade read line up.
      return { data: { subscription_plan: 'free', account_status: 'active', academic_goal: null, name: null, grade: '6' }, error: null };
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
  // usage-check RPC must allow.
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

// A FIXED verified pipeline result — the verdict→display mapping is unit-tested
// elsewhere; here we only assert persistence side effects.
function verifiedResult(): MathPipelineResult {
  const structured: FoxyResponse = {
    title: 'Adding 1/2 + 3/4',
    subject: 'math',
    blocks: [
      { type: 'step', text: 'Take the LCM of 2 and 4, which is 4.' },
      { type: 'math', latex: '\\frac{2}{4} + \\frac{3}{4}' },
      { type: 'answer', text: '5/4' },
      { type: 'question', text: 'Now try 1/3 + 1/6.' },
    ],
  };
  return {
    structured,
    badgeState: 'verified',
    modelUsed: 'claude-haiku-4-5-20251001',
    verdict: { is_correct: true, confidence: 1 },
    escalated: false,
  };
}

function checkManuallyResult(): MathPipelineResult {
  const structured: FoxyResponse = {
    title: 'Adding 1/2 + 3/4',
    subject: 'math',
    blocks: [
      { type: 'step', text: 'Take the LCM of 2 and 4, which is 4.' },
      { type: 'math', latex: '\\frac{2}{4} + \\frac{3}{4}' },
      { type: 'answer', text: "Let's check this final step together." },
      { type: 'question', text: 'Now try 1/3 + 1/6.' },
    ],
  };
  return {
    structured,
    badgeState: 'check_manually',
    modelUsed: 'claude-sonnet-4-20250514',
    verdict: { is_correct: false, confidence: 1 },
    escalated: true,
  };
}

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
  // CRITICAL: grounded path ON (so the route reaches the math branch, not the
  // legacy 503) AND math pipeline ON. Everything else OFF.
  _isFeatureEnabled.mockImplementation((flag: string) => {
    if (flag === 'ai_usage_global') return Promise.resolve(true);
    if (flag === 'ff_grounded_ai_foxy') return Promise.resolve(true);
    if (flag === 'ff_foxy_math_pipeline_v1') return Promise.resolve(true);
    return Promise.resolve(false);
  });
  _classifyMathSolve.mockResolvedValue({ isMathSolve: true, topic: 'fractions', chapter: 'fractions' });
  // Default: curriculum scope ALLOWS (so the in-scope tests reach the pipeline).
  _validateCurriculumScope.mockResolvedValue({ inScope: true, enrolledGrade: '6' });
  _runMathSolvePipeline.mockResolvedValue(verifiedResult());
});

async function postMath(): Promise<Response> {
  const { POST } = await import('@/app/api/foxy/route');
  return POST(makePostRequest({ message: 'add 1/2 + 3/4', subject: 'math', grade: '6' }));
}

describe('GUARD #5 — math-solve turn writes ZERO mastery surfaces', () => {
  it('reaches the math branch (pipeline invoked) and returns 200', async () => {
    const res = await postMath();
    expect(res.status).toBe(200);
    // The math branch actually ran — proves we did NOT take the legacy 503 path.
    expect(_runMathSolvePipeline).toHaveBeenCalledTimes(1);
  });

  it('no insert/update/upsert to any forbidden mastery table', async () => {
    await postMath();
    const masteryWrites = writes.filter((w) =>
      (FORBIDDEN_MASTERY_TABLES as readonly string[]).includes(w.table),
    );
    expect(masteryWrites, `unexpected mastery writes: ${JSON.stringify(masteryWrites)}`).toEqual([]);
  });

  it('the only written tables are session/turn persistence (foxy_sessions + foxy_chat_messages)', async () => {
    await postMath();
    const writtenTables = [...new Set(writes.map((w) => w.table))];
    for (const t of writtenTables) {
      expect(ALLOWED_WRITE_TABLES as readonly string[], `unexpected write to ${t}`).toContain(t);
    }
    // foxy_chat_messages MUST be written (the turn persisted).
    expect(writtenTables).toContain('foxy_chat_messages');
  });
});

describe('GUARD #5 — math-solve turn awards 0 XP and never calls the quiz-submit path', () => {
  it('never calls atomic_quiz_profile_update / submit_quiz_results', async () => {
    await postMath();
    for (const rpc of FORBIDDEN_RPCS) {
      expect(rpcCalls.find((c) => c.name === rpc), `${rpc} must not be called`).toBeUndefined();
    }
  });

  it('response carries tokensUsed:0 and the audit log records xpAwarded:0', async () => {
    const res = await postMath();
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.success).toBe(true);
    expect(body.tokensUsed).toBe(0);
    // Audit details pin xpAwarded:0 for the math-pipeline flow.
    const mathAudit = _logAuditImpl.mock.calls
      .map((c) => c[1] as { details?: Record<string, unknown> })
      .find((d) => d?.details?.flow === 'math-pipeline');
    expect(mathAudit, 'expected a math-pipeline audit entry').toBeTruthy();
    expect(mathAudit!.details!.xpAwarded).toBe(0);
  });

  it('the response envelope carries no XP field of any kind', async () => {
    const res = await postMath();
    const body = await res.json();
    const blob = JSON.stringify(body).toLowerCase();
    expect(blob).not.toMatch(/"xp_earned"|"xpearned"|"xp_total"|"xpawarded"/);
  });

  it('a check_manually (stripped) verdict is ALSO 0 XP / 0 mastery (formative regardless of verdict)', async () => {
    _runMathSolvePipeline.mockReset().mockResolvedValue(checkManuallyResult());

    const res = await postMath();
    expect(res.status).toBe(200);
    const masteryWrites = writes.filter((w) =>
      (FORBIDDEN_MASTERY_TABLES as readonly string[]).includes(w.table),
    );
    expect(masteryWrites).toEqual([]);
    expect(rpcCalls.find((c) => c.name === 'atomic_quiz_profile_update')).toBeUndefined();
    // Still 0 XP on the wire.
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.tokensUsed).toBe(0);
  });
});

describe('GUARD #5 — curriculum OUT-OF-SCOPE math turn is ALSO formative: 0 XP, 0 mastery, no solver (Reasoning v2 Phase 1)', () => {
  beforeEach(() => {
    // Scope gate DENIES — the route persists the turn + returns the bilingual
    // out-of-scope reply and NEVER runs the solver/verifier pipeline.
    _validateCurriculumScope.mockResolvedValue({
      inScope: false,
      enrolledGrade: '6',
      reason: 'topic_not_in_chapter',
      messageEn: 'This question is outside the currently selected chapter.',
      messageHi: 'यह सवाल अभी चुने हुए अध्याय के बाहर का है।',
      suggestedActionEn: 'Switch to the relevant chapter or class to continue.',
      suggestedActionHi: 'जारी रखने के लिए संबंधित अध्याय या कक्षा पर जाएँ।',
    });
  });

  it('returns 200 with badgeState "out_of_scope" and NEVER invokes runMathSolvePipeline', async () => {
    const res = await postMath();
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.success).toBe(true);
    expect(body.badgeState).toBe('out_of_scope');
    expect((body.curriculum as Record<string, unknown>).status).toBe('curriculum_out_of_scope');
    expect(body.verification_skipped).toBe('out_of_curriculum_scope');
    // The solver/verifier pipeline must NOT run on an out-of-scope turn.
    expect(_runMathSolvePipeline).not.toHaveBeenCalled();
  });

  it('writes ZERO mastery surfaces and never calls the quiz-submit RPCs', async () => {
    await postMath();
    const masteryWrites = writes.filter((w) =>
      (FORBIDDEN_MASTERY_TABLES as readonly string[]).includes(w.table),
    );
    expect(masteryWrites, `unexpected mastery writes: ${JSON.stringify(masteryWrites)}`).toEqual([]);
    for (const rpc of FORBIDDEN_RPCS) {
      expect(rpcCalls.find((c) => c.name === rpc), `${rpc} must not be called`).toBeUndefined();
    }
  });

  it('persists the turn to foxy_chat_messages only (session continuity), no other tables', async () => {
    await postMath();
    const writtenTables = [...new Set(writes.map((w) => w.table))];
    for (const t of writtenTables) {
      expect(ALLOWED_WRITE_TABLES as readonly string[], `unexpected write to ${t}`).toContain(t);
    }
    // The user+assistant turn is persisted even on the out-of-scope reply.
    expect(writtenTables).toContain('foxy_chat_messages');
  });

  it('audits the out-of-scope flow with xpAwarded:0 (formative), and the envelope carries no XP field', async () => {
    const res = await postMath();
    const outOfScopeAudit = _logAuditImpl.mock.calls
      .map((c) => c[1] as { details?: Record<string, unknown> })
      .find((d) => d?.details?.flow === 'math-pipeline-out-of-scope');
    expect(outOfScopeAudit, 'expected a math-pipeline-out-of-scope audit entry').toBeTruthy();
    expect(outOfScopeAudit!.details!.xpAwarded).toBe(0);
    // No XP of any kind on the wire.
    const body = await res.json();
    const blob = JSON.stringify(body).toLowerCase();
    expect(blob).not.toMatch(/"xp_earned"|"xpearned"|"xp_total"|"xpawarded"/);
  });
});
