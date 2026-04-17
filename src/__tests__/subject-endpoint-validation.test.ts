import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * C4/C5 cross-cutting: verify that every API route that writes or reads
 * subject-keyed data honours the subject governance contract.
 *
 * Pattern per route:
 *   allowed case  → get_available_subjects RPC returns the subject  → status != 422
 *   denied  case  → RPC returns different subjects                  → status  = 422
 *                   with { error: 'subject_not_allowed', subject, reason, allowed }
 *
 * This test doubles as a regression catalog entry: if any route regresses to
 * accept a disallowed subject, this suite fails.
 */

// ── Shared mock scaffolding ───────────────────────────────────────────────────

function chain(resolveWith: unknown) {
  const p = Promise.resolve(resolveWith);
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(_, prop: string) {
      if (prop === 'then')        return p.then.bind(p);
      if (prop === 'catch')       return p.catch.bind(p);
      if (prop === 'finally')     return p.finally.bind(p);
      if (prop === 'single')      return () => p;
      if (prop === 'maybeSingle') return () => p;
      return () => new Proxy({} as Record<string, unknown>, handler);
    },
  };
  return new Proxy({} as Record<string, unknown>, handler);
}

// ── Module-level mock state ───────────────────────────────────────────────────

const _authorizeImpl = vi.fn();
const _logAuditImpl = vi.fn();
const _adminSecretImpl = vi.fn();
const _logAdminActionImpl = vi.fn();

let _tableResults: Map<string, unknown> = new Map();
let _rpcResults: Map<string, unknown> = new Map();
const _defaultResult: unknown = { data: null, error: null };
const _rpcDefaultResult: unknown = { data: null, error: null };

function setFromResult(table: string, result: unknown) {
  _tableResults.set(table, result);
}
function setRpcResult(name: string, result: unknown) {
  _rpcResults.set(name, result);
}
function mockGetAvailableSubjects(codes: string[]) {
  const rows = codes.map((c) => ({
    code: c,
    name: c,
    name_hi: c,
    icon: 'i',
    color: 'c',
    subject_kind: 'cbse_core',
    is_core: true,
    is_locked: false,
  }));
  setRpcResult('get_available_subjects', { data: rows, error: null });
}

// ── Module mocks (hoisted by vi.mock) ─────────────────────────────────────────

vi.mock('@/lib/rbac', () => ({
  authorizeRequest: (...args: unknown[]) => _authorizeImpl(...args),
  logAudit: (...args: unknown[]) => _logAuditImpl(...args),
}));

vi.mock('@/lib/admin-auth', () => ({
  requireAdminSecret: (...args: unknown[]) => _adminSecretImpl(...args),
  logAdminAction: (...args: unknown[]) => _logAdminActionImpl(...args),
}));

vi.mock('@/lib/supabase-admin', () => {
  const client = {
    from: (table: string) => chain(_tableResults.get(table) ?? _defaultResult),
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'auth-user-1' } }, error: null }) },
    rpc: (name: string) => Promise.resolve(_rpcResults.get(name) ?? _rpcDefaultResult),
  };
  return {
    supabaseAdmin: client,
    getSupabaseAdmin: () => client,
  };
});

vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock('@/lib/feature-flags', () => ({
  isFeatureEnabled: vi.fn(() => Promise.resolve(false)),
}));

// ── Test helpers ──────────────────────────────────────────────────────────────

function authorizedAs(studentId: string, userId = 'auth-user-1') {
  _authorizeImpl.mockResolvedValue({
    authorized: true,
    userId,
    studentId,
    roles: ['student'],
    permissions: ['quiz.attempt', 'student.profile.write', 'foxy.chat', 'foxy.interact', 'diagnostic.attempt', 'content.read'],
    errorResponse: null,
  });
}

function makeJsonRequest(url: string, method: string, body: unknown) {
  return new NextRequest(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer valid-token',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  _tableResults = new Map();
  _rpcResults = new Map();
  _authorizeImpl.mockResolvedValue({
    authorized: false, userId: null, studentId: null,
    roles: [], permissions: [],
    errorResponse: new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }),
  });
  _adminSecretImpl.mockReturnValue(null);
  // Foxy / ncert-solver routes short-circuit with 503 if these env vars are
  // missing, preventing the governance check we want to exercise. Stub them.
  process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'test-key';
  process.env.VOYAGE_API_KEY = process.env.VOYAGE_API_KEY || 'test-key';
});

// ── The 10 routes in scope (C4 batch + C5). ncert-questions is noted as
//    deviation (directory does not exist in this worktree) — 10 routes total.
//    Each scenario provides: (a) allowed fixture (b) denied fixture.

type ScenarioResult = { status: number };
interface Scenario {
  name: string;
  run: (opts: { allowed: boolean }) => Promise<ScenarioResult>;
}

const scenarios: Scenario[] = [
  // C1 route — already tested fully in api-routes.test.ts; include here for
  // completeness/regression coverage of the allowed→422 toggle.
  {
    name: 'PATCH /api/student/preferences (set_preferred_subject)',
    run: async ({ allowed }) => {
      authorizedAs('s1');
      mockGetAvailableSubjects(allowed ? ['math', 'physics'] : ['math']);
      const { PATCH } = await import('@/app/api/student/preferences/route');
      const req = makeJsonRequest(
        'http://localhost/api/student/preferences',
        'PATCH',
        { action: 'set_preferred_subject', subject: 'physics' },
      );
      const res = await PATCH(req);
      return { status: res.status };
    },
  },

  // C2
  {
    name: 'PATCH /api/student/profile (preferred_subject)',
    run: async ({ allowed }) => {
      authorizedAs('s1');
      setFromResult('students', { data: { id: 's1', name: 'Ravi', board: 'CBSE', name_change_count: 0 }, error: null });
      mockGetAvailableSubjects(allowed ? ['math', 'physics'] : ['math']);
      const { PATCH } = await import('@/app/api/student/profile/route');
      const req = makeJsonRequest(
        'http://localhost/api/student/profile',
        'PATCH',
        { preferred_subject: 'physics' },
      );
      const res = await PATCH(req);
      return { status: res.status };
    },
  },

  // C4 foxy
  {
    name: 'POST /api/foxy',
    run: async ({ allowed }) => {
      authorizedAs('s1');
      setFromResult('students', { data: { subscription_plan: 'free', account_status: 'active', academic_goal: null }, error: null });
      mockGetAvailableSubjects(allowed ? ['math', 'physics'] : ['math']);
      const { POST } = await import('@/app/api/foxy/route');
      const req = makeJsonRequest(
        'http://localhost/api/foxy',
        'POST',
        { message: 'what is motion', subject: 'physics', grade: '10' },
      );
      const res = await POST(req);
      return { status: res.status };
    },
  },

  // C4 quiz GET (questions action)
  {
    name: 'GET /api/quiz?action=questions',
    run: async ({ allowed }) => {
      authorizedAs('s1');
      setFromResult('students', { data: { id: 's1', grade: '10' }, error: null });
      mockGetAvailableSubjects(allowed ? ['math', 'physics'] : ['math']);
      // Recovery-mode: /api/quiz now also calls validate_academic_scope.
      // For the "allowed" case the scope must validate ok; the per-route
      // subject check still drives the 422 in the "denied" case.
      setRpcResult('validate_academic_scope', { data: { ok: allowed }, error: null });
      const { GET } = await import('@/app/api/quiz/route');
      const req = new NextRequest(
        'http://localhost/api/quiz?action=questions&subject=physics&grade=10',
        { headers: { Authorization: 'Bearer valid' } },
      );
      const res = await GET(req);
      return { status: res.status };
    },
  },

  // C4 quiz POST (generate-exam)
  {
    name: 'POST /api/quiz (generate-exam)',
    run: async ({ allowed }) => {
      authorizedAs('s1');
      setFromResult('students', { data: { id: 's1', grade: '10' }, error: null });
      mockGetAvailableSubjects(allowed ? ['math', 'physics'] : ['math']);
      setRpcResult('validate_academic_scope', { data: { ok: allowed }, error: null });
      const { POST } = await import('@/app/api/quiz/route');
      const req = makeJsonRequest(
        'http://localhost/api/quiz',
        'POST',
        { action: 'generate-exam', subject: 'physics', grade: '10' },
      );
      const res = await POST(req);
      return { status: res.status };
    },
  },

  // C4 diagnostic/start
  {
    name: 'POST /api/diagnostic/start',
    run: async ({ allowed }) => {
      authorizedAs('s1');
      setFromResult('students', { data: { id: 's1', grade: '10' }, error: null });
      mockGetAvailableSubjects(allowed ? ['math', 'physics'] : ['math']);
      const { POST } = await import('@/app/api/diagnostic/start/route');
      const req = makeJsonRequest(
        'http://localhost/api/diagnostic/start',
        'POST',
        { grade: '10', subject: 'physics' },
      );
      const res = await POST(req);
      return { status: res.status };
    },
  },

  // C4 student/exam-simulation
  {
    name: 'POST /api/student/exam-simulation',
    run: async ({ allowed }) => {
      authorizedAs('s1');
      mockGetAvailableSubjects(allowed ? ['math', 'physics'] : ['math']);
      const { POST } = await import('@/app/api/student/exam-simulation/route');
      const req = makeJsonRequest(
        'http://localhost/api/student/exam-simulation',
        'POST',
        {
          subject: 'physics',
          grade: '10',
          total_marks: 10,
          obtained_marks: 5,
          time_taken_seconds: 60,
        },
      );
      const res = await POST(req);
      return { status: res.status };
    },
  },

  // C4 student/foxy-interaction (save_flashcard)
  {
    name: 'POST /api/student/foxy-interaction (save_flashcard)',
    run: async ({ allowed }) => {
      authorizedAs('s1');
      mockGetAvailableSubjects(allowed ? ['math', 'physics'] : ['math']);
      const { POST } = await import('@/app/api/student/foxy-interaction/route');
      const req = makeJsonRequest(
        'http://localhost/api/student/foxy-interaction',
        'POST',
        { action: 'save_flashcard', subject: 'physics', answer: 'F=ma' },
      );
      const res = await POST(req);
      return { status: res.status };
    },
  },

  // C4 scan-solve (JSON body override)
  {
    name: 'POST /api/scan-solve (body.subject override)',
    run: async ({ allowed }) => {
      authorizedAs('s1');
      setFromResult('students', {
        data: { id: 's1', grade: '10', subscription_plan: 'free', preferred_subject: 'math' },
        error: null,
      });
      setFromResult('student_scans', { data: null, error: null, count: 0 });
      mockGetAvailableSubjects(allowed ? ['math', 'physics'] : ['math']);
      const { POST } = await import('@/app/api/scan-solve/route');
      const req = makeJsonRequest(
        'http://localhost/api/scan-solve',
        'POST',
        { image_base64: 'abc', subject: 'physics' },
      );
      const res = await POST(req);
      // The only status we care about for governance is 422 vs other.
      // Other failures (e.g. storage upload) still count as "not 422".
      return { status: res.status };
    },
  },

  // C5 concept-engine — denial path is via get_available_subjects for student
  {
    name: 'GET /api/concept-engine?action=chapter',
    run: async ({ allowed }) => {
      authorizedAs('s1');
      mockGetAvailableSubjects(allowed ? ['math', 'physics'] : ['math']);
      const { GET } = await import('@/app/api/concept-engine/route');
      const req = new NextRequest(
        'http://localhost/api/concept-engine?action=chapter&grade=10&subject=physics&chapter=1',
        { headers: { Authorization: 'Bearer valid' } },
      );
      const res = await GET(req);
      return { status: res.status };
    },
  },
];

describe('Subject governance — allowed vs denied across 10 routes', () => {
  for (const s of scenarios) {
    describe(s.name, () => {
      it('does not return 422 when subject is in allowed set', async () => {
        const { status } = await s.run({ allowed: true });
        expect(status).not.toBe(422);
      });

      it('returns 422 when subject is not in allowed set', async () => {
        const { status } = await s.run({ allowed: false });
        expect(status).toBe(422);
      });
    });
  }
});
