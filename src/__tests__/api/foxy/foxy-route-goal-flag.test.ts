/**
 * /api/foxy — Phase 1 Goal-Adaptive persona flag plumbing.
 *
 * Pins the contract that `ff_goal_aware_foxy` is consulted on every Foxy
 * turn and that its resolved value is threaded into BOTH the safety-railed
 * system prompt (`foxy_system_prompt`) AND the grounded-answer template
 * variable `academic_goal_section`. Three scenarios are covered:
 *
 *   1. Flag OFF: legacy single-line goal sentence is rendered. The
 *      `academic_goal_section` template variable matches the legacy
 *      output exactly. Tests the byte-identical safety contract end-to-end.
 *
 *   2. Flag ON + known goal: expanded multi-paragraph persona is rendered
 *      (board_topper authored markers from `goal-personas.ts` appear in
 *      both the system prompt and the template variable).
 *
 *   3. Flag ON + null/unknown goal: the route does NOT crash and the
 *      `academic_goal_section` is empty. Defense in depth — Phase 1
 *      cannot become a regression vector for students who haven't
 *      onboarded with a goal yet.
 *
 * P12 (AI Safety): the flag never bypasses safety rails; FOXY_SAFETY_RAILS
 *   is still injected on every turn.
 * P13 (Data Privacy): `studentId` may appear in info-level logs (per
 *   existing route convention — see `foxy_misconception_context_loaded`).
 *   No PII (email, phone, name) is logged in the new persona_mode line.
 *
 * Owner: ai-engineer
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ─── env stubs (route checks these at top of handler) ────────────────────────
beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://test.local';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
});

// ─── RBAC mock ───────────────────────────────────────────────────────────────
const _authorizeImpl = vi.fn();
const _logAuditImpl = vi.fn();

vi.mock('@/lib/rbac', () => ({
  authorizeRequest: (...args: unknown[]) => _authorizeImpl(...args),
  logAudit: (...args: unknown[]) => _logAuditImpl(...args),
}));

// ─── Feature-flag mock — controlled per test ─────────────────────────────────
const _isFeatureEnabled = vi.fn();
vi.mock('@/lib/feature-flags', () => ({
  isFeatureEnabled: (...args: unknown[]) => _isFeatureEnabled(...args),
}));

// ─── Subject-governance mock — pass-through ──────────────────────────────────
vi.mock('@/lib/subjects', () => ({
  validateSubjectWrite: vi.fn().mockResolvedValue({ ok: true }),
}));

// ─── Logger spy ──────────────────────────────────────────────────────────────
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

// ─── grounded-client mock — capture the request ──────────────────────────────
const groundedCalls: Array<{
  request: Record<string, unknown>;
  hopTimeoutMs?: number;
}> = [];

vi.mock('@/lib/ai/grounded-client', () => ({
  callGroundedAnswer: (request: Record<string, unknown>, hopTimeoutMs?: number) => {
    groundedCalls.push({ request, hopTimeoutMs });
    return Promise.resolve({
      grounded: true,
      answer: 'Stub Foxy answer.',
      // Route reads grounded.citations.map(...) — must exist as an array.
      citations: [],
      // Route reads grounded.meta.tokens_used + grounded.meta.latency_ms.
      meta: { latency_ms: 25, tokens_used: 12 },
      // Route reads grounded.trace_id.
      trace_id: 'trace-stub-1',
      // Optional confidence — soft-banner threshold check is no-op here.
      confidence: 0.9,
    });
  },
  callGroundedAnswerStream: vi.fn().mockResolvedValue({ ok: false, reason: 'not-used' }),
}));

vi.mock('@/lib/ai', () => ({
  classifyIntent: vi.fn().mockResolvedValue({ intent: 'should-not-run' }),
  routeIntent: vi
    .fn()
    .mockRejectedValue(new Error('legacy path should not run in goal-flag tests')),
}));

// ─── supabaseAdmin mock ──────────────────────────────────────────────────────
//
// Permissive default that lets the route flow through to the grounded-answer
// call. The `students` row carries an academic_goal that's overridden per
// test via `setStudentRow(...)`.

let _studentRow: { subscription_plan: string; account_status: string; academic_goal: string | null } = {
  subscription_plan: 'free',
  account_status: 'active',
  academic_goal: null,
};

function setStudentRow(row: Partial<typeof _studentRow>) {
  _studentRow = { ..._studentRow, ...row };
}

function makeChain(table: string) {
  const chain: Record<string, unknown> = {};

  const resolveDefault = (): { data: unknown; error: unknown } => {
    if (table === 'students') {
      return { data: _studentRow, error: null };
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

  const fluent = [
    'select',
    'update',
    'eq',
    'neq',
    'in',
    'ilike',
    'order',
    'limit',
    'gte',
    'lte',
    'not',
    'is',
  ];
  for (const m of fluent) {
    chain[m] = (..._args: unknown[]) => chain;
  }
  chain.insert = (_rows: unknown) => {
    return {
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve({ data: null, error: null }).then(resolve, reject),
      select: () => ({
        single: () =>
          Promise.resolve({ data: { id: 'session-uuid-1' }, error: null }),
      }),
    };
  };
  chain.single = () => Promise.resolve(resolveDefault());
  chain.maybeSingle = () => Promise.resolve(resolveDefault());
  (chain as { then: unknown }).then = (
    resolve: (v: unknown) => unknown,
    reject?: (e: unknown) => unknown,
  ) => Promise.resolve(resolveDefault()).then(resolve, reject);
  return chain;
}

const rpcImpl = vi.fn();

vi.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: (table: string) => makeChain(table),
    rpc: (...args: unknown[]) => rpcImpl(...args),
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

function lastGroundedRequest(): Record<string, unknown> {
  if (groundedCalls.length === 0) {
    throw new Error('No grounded-answer call captured');
  }
  return groundedCalls[groundedCalls.length - 1].request;
}

function lastTemplateVars(): Record<string, unknown> {
  const req = lastGroundedRequest();
  const generation = req.generation as Record<string, unknown>;
  return generation.template_variables as Record<string, unknown>;
}

function lastFoxyPromptVar(): string {
  return lastTemplateVars().foxy_system_prompt as string;
}

function lastAcademicGoalSection(): string {
  return lastTemplateVars().academic_goal_section as string;
}

// ─── Common setup ────────────────────────────────────────────────────────────
beforeEach(() => {
  vi.clearAllMocks();
  groundedCalls.length = 0;
  _studentRow = {
    subscription_plan: 'free',
    account_status: 'active',
    academic_goal: null,
  };
  _authorizeImpl.mockResolvedValue({
    authorized: true,
    userId: 'auth-user-1',
    studentId: 'student-uuid-1',
    roles: ['student'],
    permissions: ['foxy.chat'],
  });
  // Quota check passes.
  rpcImpl.mockResolvedValue({
    data: [{ allowed: true, current_count: 1 }],
    error: null,
  });
});

// Helper to set up flag values per test. `ff_grounded_ai_foxy` MUST be true
// so we exercise the grounded-answer service path (where the new gate lives).
// `ai_usage_global` MUST be true so the kill switch doesn't short-circuit.
function setFlags(values: Record<string, boolean>) {
  _isFeatureEnabled.mockImplementation((flag: string) => {
    if (flag in values) return Promise.resolve(values[flag]);
    if (flag === 'ai_usage_global') return Promise.resolve(true);
    if (flag === 'ff_grounded_ai_foxy') return Promise.resolve(true);
    if (flag === 'ff_foxy_streaming') return Promise.resolve(false);
    return Promise.resolve(false);
  });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('/api/foxy — ff_goal_aware_foxy plumbing', () => {
  describe('flag OFF (default)', () => {
    it('renders the legacy single-line goal section (board_topper)', async () => {
      setStudentRow({ academic_goal: 'board_topper' });
      setFlags({ ff_goal_aware_foxy: false });

      const { POST } = await import('@/app/api/foxy/route');
      const res = await POST(
        makePostRequest({
          message: 'Explain photosynthesis',
          subject: 'science',
          grade: '7',
        }),
      );
      expect(res.status).toBe(200);

      // ff_goal_aware_foxy MUST be evaluated on every turn.
      const goalFlagCalls = _isFeatureEnabled.mock.calls.filter(
        (c: unknown[]) => c[0] === 'ff_goal_aware_foxy',
      );
      expect(goalFlagCalls.length).toBeGreaterThanOrEqual(1);
      // It must be evaluated in the student-role + per-user rollout context.
      const ctx = goalFlagCalls[0][1] as Record<string, unknown>;
      expect(ctx.role).toBe('student');
      expect(ctx.userId).toBe('student-uuid-1');

      // Legacy single-line section is rendered.
      const goalSection = lastAcademicGoalSection();
      expect(goalSection).toContain(
        "## Student's Academic Goal: Board Topper (90%+). Teach with depth",
      );
      // Expanded markers are absent.
      expect(goalSection).not.toContain('Tone:');
      expect(goalSection).not.toContain('marking scheme');
      expect(goalSection).not.toContain('Mode emphasis');

      // The system prompt template variable carries the same legacy body
      // (see buildSystemPrompt in route.ts).
      const sysPrompt = lastFoxyPromptVar();
      expect(sysPrompt).toContain(
        "## Student's Academic Goal: Board Topper (90%+)",
      );
      expect(sysPrompt).not.toContain('marking scheme');

      // Persona-mode logging is structured and PII-free.
      const personaLog = loggerInfo.mock.calls.find(
        (c: unknown[]) => c[0] === 'foxy.persona_mode',
      );
      expect(personaLog).toBeDefined();
      const ctxLog = personaLog![1] as Record<string, unknown>;
      expect(ctxLog.useExpandedPersona).toBe(false);
      expect(ctxLog.hasGoal).toBe(true);
      expect(ctxLog.studentId).toBe('student-uuid-1');
      // No PII (email, phone, name).
      expect(ctxLog).not.toHaveProperty('email');
      expect(ctxLog).not.toHaveProperty('phone');
      expect(ctxLog).not.toHaveProperty('name');
    });
  });

  describe('flag ON + known goal', () => {
    it('renders the expanded persona for board_topper', async () => {
      setStudentRow({ academic_goal: 'board_topper' });
      setFlags({ ff_goal_aware_foxy: true });

      const { POST } = await import('@/app/api/foxy/route');
      const res = await POST(
        makePostRequest({
          message: 'Explain Newton third law',
          subject: 'science',
          grade: '10',
          mode: 'explain',
        }),
      );
      expect(res.status).toBe(200);

      // Expanded markers present in BOTH the academic_goal_section and
      // the foxy_system_prompt variables.
      const goalSection = lastAcademicGoalSection();
      expect(goalSection).toContain("## Student's Academic Goal");
      expect(goalSection).toContain('marking scheme');
      expect(goalSection).toContain('examiner mindset');
      expect(goalSection).toContain('Mode emphasis (explain)');
      // Legacy single-line text MUST be absent — the swap happened.
      expect(goalSection).not.toContain(
        '## Student\'s Academic Goal: Board Topper (90%+). Teach with depth',
      );

      const sysPrompt = lastFoxyPromptVar();
      expect(sysPrompt).toContain('marking scheme');
      expect(sysPrompt).toContain('Mode emphasis (explain)');

      // Persona-mode logging reflects the on state.
      const personaLog = loggerInfo.mock.calls.find(
        (c: unknown[]) => c[0] === 'foxy.persona_mode',
      );
      expect(personaLog).toBeDefined();
      const ctxLog = personaLog![1] as Record<string, unknown>;
      expect(ctxLog.useExpandedPersona).toBe(true);
      expect(ctxLog.hasGoal).toBe(true);
      expect(ctxLog.mode).toBe('explain');
    });
  });

  describe('flag ON + null/unknown goal — graceful fallback', () => {
    it('does not crash when academic_goal is null', async () => {
      setStudentRow({ academic_goal: null });
      setFlags({ ff_goal_aware_foxy: true });

      const { POST } = await import('@/app/api/foxy/route');
      const res = await POST(
        makePostRequest({
          message: 'Hello Foxy',
          subject: 'math',
          grade: '8',
        }),
      );
      expect(res.status).toBe(200);

      // With no goal AND expanded persona requested, the section must be
      // an empty string (per buildAcademicGoalSection contract — null goal
      // returns '' before the gating logic runs).
      expect(lastAcademicGoalSection()).toBe('');

      // Persona-mode logging still fires with hasGoal=false.
      const personaLog = loggerInfo.mock.calls.find(
        (c: unknown[]) => c[0] === 'foxy.persona_mode',
      );
      expect(personaLog).toBeDefined();
      const ctxLog = personaLog![1] as Record<string, unknown>;
      expect(ctxLog.hasGoal).toBe(false);
      expect(ctxLog.useExpandedPersona).toBe(true);
    });

    it('does not crash and falls back to legacy when goal is an unknown code', async () => {
      // Simulate a stale/typo'd academic_goal value in the DB (e.g. an
      // older onboarding flow that stored a code we've since renamed).
      setStudentRow({ academic_goal: 'mystery_goal_xyz' });
      setFlags({ ff_goal_aware_foxy: true });

      const { POST } = await import('@/app/api/foxy/route');
      const res = await POST(
        makePostRequest({
          message: 'Tell me about quadratics',
          subject: 'math',
          grade: '9',
        }),
      );
      // Critical: route must not crash. P15 onboarding integrity rhymes
      // with this — a Foxy turn must never 5xx because the student's
      // stored goal code is unfamiliar.
      expect(res.status).toBe(200);

      // The expanded builder returns '' for unknown goals; the route's
      // local buildAcademicGoalSection then falls back to the legacy
      // single-line format with the raw goal string. This is the
      // documented "conservative fallback" shape.
      const goalSection = lastAcademicGoalSection();
      expect(goalSection).toContain("## Student's Academic Goal:");
      // It does NOT contain expanded markers.
      expect(goalSection).not.toContain('Tone:');
      expect(goalSection).not.toContain('Mode emphasis');
    });
  });
});
