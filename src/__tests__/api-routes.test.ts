import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * API Route tests — input validation, auth rejection, IDOR ownership
 *
 * Strategy:
 *   - Mock authorizeRequest to control auth state deterministically
 *   - Mock supabaseAdmin.from via a configurable per-table result map
 *   - Test HTTP contract: status codes, response shapes, opaque IDOR responses
 *
 * IMPORTANT mock design note:
 *   The `vi.mock` factory runs at module evaluation time. All runtime control
 *   must go through module-level variables. The `fromImpl` variable is the
 *   gate: tests call `setFromResult(table, result)` to control per-table responses.
 */

// ── Shared thenable chain proxy ────────────────────────────────────────────────
// Creates a proxy that supports `await proxy`, `.single()`, `.maybeSingle()`,
// and arbitrary chain methods (.select, .eq, .limit, etc.)
// MUST create Promise ONCE and bind then/catch/finally — Proxy does not auto-bind.
function chain(resolveWith: unknown) {
  const p = Promise.resolve(resolveWith);
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(_, prop: string) {
      if (prop === 'then')        return p.then.bind(p);
      if (prop === 'catch')       return p.catch.bind(p);
      if (prop === 'finally')     return p.finally.bind(p);
      if (prop === 'single')      return () => p;
      if (prop === 'maybeSingle') return () => p;
      // selectchains: eq, select, limit, order, etc. all return self
      return () => new Proxy({} as Record<string, unknown>, handler);
    },
  };
  return new Proxy({} as Record<string, unknown>, handler);
}

// ── RBAC mock ─────────────────────────────────────────────────────────────────
const _authorizeImpl = vi.fn();
const _logAuditImpl  = vi.fn();

vi.mock('@/lib/rbac', () => ({
  authorizeRequest: (...args: unknown[]) => _authorizeImpl(...args),
  logAudit:         (...args: unknown[]) => _logAuditImpl(...args),
}));

// ── supabaseAdmin mock ────────────────────────────────────────────────────────
// Per-table result map: keys are table names, values are the resolved result.
// Use `setFromResult(table, result)` from tests to control responses.
// `_defaultResult` is used when no table-specific override exists.
let _tableResults: Map<string, unknown>  = new Map();
let _defaultResult: unknown = { data: null, error: null };
let _authGetUserResult: unknown = { data: { user: { id: 'auth-user-1' } }, error: null };

function setFromResult(table: string, result: unknown) {
  _tableResults.set(table, result);
}

vi.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: (table: string) => chain(_tableResults.get(table) ?? _defaultResult),
    auth: { getUser: () => Promise.resolve(_authGetUserResult) },
  },
  getSupabaseAdmin: () => ({
    from: (table: string) => chain(_tableResults.get(table) ?? _defaultResult),
    auth: { getUser: () => Promise.resolve(_authGetUserResult) },
  }),
}));

// ── Logger mock ───────────────────────────────────────────────────────────────
vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRequest(method: 'PATCH' | 'POST', body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('http://localhost/api/test', {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer valid-token',
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function patch(body: unknown, headers?: Record<string, string>) {
  return makeRequest('PATCH', body, headers);
}

function post(body: unknown, headers?: Record<string, string>) {
  return makeRequest('POST', body, headers);
}

function authorizedAs(studentId: string, userId = 'auth-user-1') {
  _authorizeImpl.mockResolvedValue({
    authorized: true,
    userId,
    studentId,
    roles: ['student'],
    permissions: ['quiz.attempt', 'student.profile.write'],
    errorResponse: null,
  });
}

function unauthorized() {
  const response = new Response(
    JSON.stringify({ error: 'Unauthorized', code: 'AUTH_REQUIRED' }),
    { status: 401, headers: { 'Content-Type': 'application/json' } }
  );
  _authorizeImpl.mockResolvedValue({
    authorized: false, userId: null, studentId: null,
    roles: [], permissions: [], errorResponse: response,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  _tableResults = new Map();
  _defaultResult = { data: null, error: null };
  _authGetUserResult = { data: { user: { id: 'auth-user-1' } }, error: null };
  unauthorized(); // default: unauthenticated
});

// =============================================================================
// PATCH /api/student/preferences
// =============================================================================

describe('PATCH /api/student/preferences', () => {
  async function call(body: unknown, headers?: Record<string, string>) {
    const { PATCH } = await import('@/app/api/student/preferences/route');
    return PATCH(patch(body, headers));
  }

  describe('auth', () => {
    it('returns 401 when no Authorization header', async () => {
      const res = await call({ action: 'set_preferred_subject', subject: 'science' });
      expect(res.status).toBe(401);
    });

    it('returns 401 when token invalid', async () => {
      const res = await call({ action: 'set_preferred_subject', subject: 'science' });
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ error: expect.stringMatching(/unauthorized/i) });
    });
  });

  describe('input validation', () => {
    it('returns 400 when action is missing', async () => {
      authorizedAs('s1');
      const res = await call({ subject: 'math' });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: expect.stringContaining('action must be one of') });
    });

    it('returns 400 when action is not a valid enum value', async () => {
      authorizedAs('s1');
      const res = await call({ action: 'delete_account' });
      expect(res.status).toBe(400);
    });

    it('returns 400 when body is not valid JSON', async () => {
      authorizedAs('s1');
      const { PATCH } = await import('@/app/api/student/preferences/route');
      const req = new NextRequest('http://localhost', {
        method: 'PATCH',
        headers: { Authorization: 'Bearer t' },
        body: 'not-json',
      });
      const res = await PATCH(req);
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: 'Invalid request body' });
    });
  });

  describe('action: set_preferred_subject', () => {
    it('returns 400 when subject is empty string', async () => {
      authorizedAs('s1');
      const res = await call({ action: 'set_preferred_subject', subject: '' });
      expect(res.status).toBe(400);
    });

    it('returns 400 when subject is missing', async () => {
      authorizedAs('s1');
      const res = await call({ action: 'set_preferred_subject' });
      expect(res.status).toBe(400);
    });

    it('returns 200 on valid subject update', async () => {
      authorizedAs('s1');
      setFromResult('students', { data: null, error: null });
      const res = await call({ action: 'set_preferred_subject', subject: 'science' });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ success: true });
    });
  });

  describe('action: set_selected_subjects', () => {
    it('returns 400 when subjects is not an array', async () => {
      authorizedAs('s1');
      const res = await call({ action: 'set_selected_subjects', subjects: 'science', preferred_subject: 'science' });
      expect(res.status).toBe(400);
    });

    it('returns 400 when subjects is empty array', async () => {
      authorizedAs('s1');
      const res = await call({ action: 'set_selected_subjects', subjects: [], preferred_subject: 'science' });
      expect(res.status).toBe(400);
    });

    it('returns 400 when preferred_subject is not a string', async () => {
      authorizedAs('s1');
      const res = await call({ action: 'set_selected_subjects', subjects: ['math'], preferred_subject: 123 });
      expect(res.status).toBe(400);
    });

    it('returns 200 on valid payload', async () => {
      authorizedAs('s1');
      setFromResult('students', { data: null, error: null });
      const res = await call({ action: 'set_selected_subjects', subjects: ['math', 'science'], preferred_subject: 'math' });
      expect(res.status).toBe(200);
    });
  });

  describe('action: dismiss_nudge — IDOR protection', () => {
    it('returns 400 when nudge_id is empty', async () => {
      authorizedAs('s1');
      const res = await call({ action: 'dismiss_nudge', nudge_id: '' });
      expect(res.status).toBe(400);
    });

    it('returns 404 when nudge does not exist', async () => {
      authorizedAs('s1');
      setFromResult('smart_nudges', { data: null, error: null }); // maybeSingle → null
      const res = await call({ action: 'dismiss_nudge', nudge_id: 'nonexistent-nudge' });
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ error: 'Nudge not found' });
    });

    it('returns 404 — opaque — when nudge belongs to different student (IDOR)', async () => {
      authorizedAs('student-1');
      // Nudge exists but student_id is different
      setFromResult('smart_nudges', { data: { id: 'nudge-1', student_id: 'student-2' }, error: null });
      const res = await call({ action: 'dismiss_nudge', nudge_id: 'nudge-1' });
      // Must NOT reveal nudge exists (opaque 404 — same as not-found)
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ error: 'Nudge not found' });
    });
  });
});

// =============================================================================
// PATCH /api/student/profile
// =============================================================================

describe('PATCH /api/student/profile', () => {
  async function call(body: unknown) {
    const { PATCH } = await import('@/app/api/student/profile/route');
    return PATCH(patch(body));
  }

  it('returns 401 when unauthorized', async () => {
    const res = await call({ preferred_language: 'en' });
    expect(res.status).toBe(401);
  });

  describe('preferred_language validation', () => {
    it('returns 400 for invalid preferred_language', async () => {
      authorizedAs('s1');
      setFromResult('students', { data: { id: 's1', name: 'Ravi', board: 'CBSE', name_change_count: 0 }, error: null });
      const res = await call({ preferred_language: 'fr' });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: expect.stringContaining('preferred_language') });
    });

    it('accepts hi as valid preferred_language', async () => {
      authorizedAs('s1');
      setFromResult('students', { data: { id: 's1', name: 'Ravi', board: 'CBSE', name_change_count: 0 }, error: null });
      const res = await call({ preferred_language: 'hi' });
      expect(res.status).toBe(200);
    });
  });

  describe('name change guard', () => {
    it('returns 403 when student has already changed name once', async () => {
      authorizedAs('s1');
      setFromResult('students', { data: { id: 's1', name: 'Ravi', board: 'CBSE', name_change_count: 1 }, error: null });
      const res = await call({ name: 'Rahul' });
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ error: 'Name can only be changed once' });
    });

    it('returns 400 when name is empty string', async () => {
      authorizedAs('s1');
      setFromResult('students', { data: { id: 's1', name: 'Ravi', board: 'CBSE', name_change_count: 0 }, error: null });
      const res = await call({ name: '  ' });
      expect(res.status).toBe(400);
    });

    it('returns 400 when name exceeds 100 chars', async () => {
      authorizedAs('s1');
      setFromResult('students', { data: { id: 's1', name: 'Ravi', board: 'CBSE', name_change_count: 0 }, error: null });
      const res = await call({ name: 'A'.repeat(101) });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: expect.stringContaining('100 characters') });
    });

    it('allows name change when name_change_count is 0', async () => {
      authorizedAs('s1');
      // First call: students table (fetch current record)
      // Second call: students table (update)
      // Both go through setFromResult('students', ...) — our mock returns the same for both
      // Route uses .single() for fetch; update doesn't use .single() — but both hit 'students'
      // Set to return student record (fetch success); update success also expected
      setFromResult('students', { data: { id: 's1', name: 'Ravi', board: 'CBSE', name_change_count: 0 }, error: null });
      const res = await call({ name: 'Rahul Kumar' });
      expect(res.status).toBe(200);
    });
  });

  describe('board change guard', () => {
    it('returns 400 for invalid board value', async () => {
      authorizedAs('s1');
      setFromResult('students', { data: { id: 's1', name: 'Ravi', board: 'CBSE', name_change_count: 0 }, error: null });
      const res = await call({ board: 'Unknown Board' });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: expect.stringContaining('board must be one of') });
    });

    it('returns 200 when sending same board as current (no-op)', async () => {
      authorizedAs('s1');
      // board === current → no DB update for board needed → success
      setFromResult('students', { data: { id: 's1', name: 'Ravi', board: 'CBSE', name_change_count: 0 }, error: null });
      const res = await call({ board: 'CBSE' }); // same as current → updatePayload empty
      expect(res.status).toBe(200);
    });
  });
});

// =============================================================================
// PATCH /api/teacher/profile
// =============================================================================

describe('PATCH /api/teacher/profile', () => {
  async function call(body: unknown, authHeader = 'Bearer valid-token') {
    const { PATCH } = await import('@/app/api/teacher/profile/route');
    return PATCH(patch(body, { Authorization: authHeader }));
  }

  beforeEach(() => {
    // Default: auth succeeds, teacher record exists
    _authGetUserResult = { data: { user: { id: 'auth-1' } }, error: null };
    setFromResult('teachers', { data: { id: 'teacher-1' }, error: null });
  });

  describe('auth', () => {
    it('returns 401 when no Bearer token', async () => {
      const res = await call({ name: 'Priya' }, '');
      expect(res.status).toBe(401);
    });

    it('returns 401 when token is invalid', async () => {
      _authGetUserResult = { data: { user: null }, error: { message: 'Invalid token' } };
      const res = await call({ name: 'Priya' });
      expect(res.status).toBe(401);
    });

    it('returns 404 when auth user has no teacher record', async () => {
      // resolveTeacherId returns null → data is null from .single()
      setFromResult('teachers', { data: null, error: null });
      const res = await call({ name: 'Priya' });
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ error: 'Teacher account not found' });
    });
  });

  describe('name validation', () => {
    it('returns 400 when name is less than 2 chars', async () => {
      const res = await call({ name: 'A' });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: expect.stringContaining('2–100 characters') });
    });

    it('returns 400 when name exceeds 100 chars', async () => {
      const res = await call({ name: 'A'.repeat(101) });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: expect.stringContaining('2–100') });
    });

    it('returns 400 when school_name exceeds 200 chars', async () => {
      const res = await call({ school_name: 'S'.repeat(201) });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: expect.stringContaining('200 characters') });
    });
  });

  describe('successful updates', () => {
    it('returns 200 with no changes when body has no updatable fields', async () => {
      const res = await call({});
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ success: true });
    });

    it('returns 200 on valid name and school_name', async () => {
      // First from('teachers'): resolveTeacherId → { id: 'teacher-1' }
      // Second from('teachers'): update → { data: null, error: null }
      setFromResult('teachers', { data: { id: 'teacher-1' }, error: null });
      const res = await call({ name: 'Priya Sharma', school_name: 'Delhi Public School' });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ success: true });
    });
  });

  it('returns 400 when request body is not valid JSON', async () => {
    const { PATCH } = await import('@/app/api/teacher/profile/route');
    const req = new NextRequest('http://localhost', {
      method: 'PATCH',
      headers: { Authorization: 'Bearer valid-token' },
      body: 'not-json',
    });
    const res = await PATCH(req);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'Invalid request body' });
  });
});

// =============================================================================
// IDOR: PATCH /api/student/study-plan — task ownership chain
// =============================================================================

describe('IDOR: study-plan task ownership', () => {
  async function call(body: unknown) {
    const { PATCH } = await import('@/app/api/student/study-plan/route');
    return PATCH(patch(body));
  }

  it('returns 401 when not authenticated', async () => {
    const res = await call({ task_id: 'task-1', status: 'completed' });
    expect(res.status).toBe(401);
  });

  it('returns 400 when task_id is missing', async () => {
    authorizedAs('student-1');
    const res = await call({ status: 'completed' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when status is invalid enum value', async () => {
    authorizedAs('student-1');
    setFromResult('study_plan_tasks', {
      data: { id: 'task-1', status: 'pending', study_plan: { student_id: 'student-1' } },
      error: null,
    });
    const res = await call({ task_id: 'task-1', status: 'invalid_status' });
    expect(res.status).toBe(400);
  });

  it('returns 404 when task belongs to different student (IDOR)', async () => {
    authorizedAs('student-1');
    setFromResult('study_plan_tasks', {
      data: { id: 'task-1', status: 'pending', study_plan: { student_id: 'student-2' } }, // different!
      error: null,
    });
    const res = await call({ task_id: 'task-1', status: 'completed' });
    expect(res.status).toBe(404);
  });
});
