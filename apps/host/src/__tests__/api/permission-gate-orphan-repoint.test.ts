import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Permission-gate repoint pin — orphaned permission codes → granted siblings.
 *
 * Seven routes previously gated on permission codes that NO role is granted in
 * the RBAC matrix conformance migration (20260612123200_rbac_matrix_conformance.sql).
 * Every non-super_admin caller got a 403 because the code existed only in the
 * TS registry (`src/lib/rbac.ts`) but had zero role_permissions grants — only
 * super_admin's runtime bypass hid the break.
 *
 * Each route was repointed to its already-granted semantic twin:
 *   /api/auth/repair            admin.manage_users   → user.manage         (admin)
 *   /api/v1/admin/roles         system.manage_roles  → role.manage         (admin)  [GET/POST/PATCH]
 *   /api/student/profile        student.profile.write→ profile.update_own  (student)
 *   /api/student/scan-upload    student.scan         → image.upload        (student)
 *   /api/student/study-plan     study_plan.write     → study_plan.create   (student)
 *   /api/exam/chapters          exam.write           → exam.create         (student)
 *   /api/student/shop/purchase  student.profile.write→ profile.update_own  (student)
 *
 * Grant evidence: 20260612123200_rbac_matrix_conformance.sql
 *   - user.manage / role.manage: defined (lines 157-158), granted to `admin`
 *     via the admin wildcard grant (lines 340-344).
 *   - profile.update_own / image.upload / study_plan.create / exam.create:
 *     defined (lines 122,110,105,109), explicitly granted to `student`
 *     (lines 219-228).
 *   - /api/student/shop/purchase spends the student's OWN earned in-app
 *     currency (Foxy Coins / XP) and mutates their own account state — it does
 *     NOT initiate a real-money/subscription payment, so the self-service gate
 *     is profile.update_own (line 122, granted to student at line 224), not
 *     payments.subscribe.
 *
 * Strategy: mock authorizeRequest. Assert (a) each handler passes the
 * GRANTED sibling code as authorizeRequest's first arg (so a real role that
 * holds the sibling is permitted), and (b) a denied authorizeRequest result
 * propagates as the route's 401/403 response (a caller WITHOUT the permission
 * is rejected). This pins the gate, not the business logic.
 */

const _authorizeImpl = vi.fn();
const _logAuditImpl = vi.fn();
const _invalidateImpl = vi.fn();

vi.mock('@alfanumrik/lib/rbac', () => ({
  authorizeRequest: (...args: unknown[]) => _authorizeImpl(...args),
  logAudit: (...args: unknown[]) => _logAuditImpl(...args),
  invalidateForSecurityEvent: (...args: unknown[]) => _invalidateImpl(...args),
}));

vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@alfanumrik/lib/identity', () => ({
  VALID_ROLES: ['student', 'teacher', 'parent'],
  isValidRole: (r: string) => ['student', 'teacher', 'parent'].includes(r),
}));

vi.mock('@alfanumrik/lib/identity/audit', () => ({
  logIdentityEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@alfanumrik/lib/subjects', () => ({
  validateSubjectWrite: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock('@alfanumrik/lib/sanitize', () => ({
  isValidUUID: (s: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s),
}));

// ── supabaseAdmin mock: thenable chain proxy + rpc/auth ─────────────────────
let _tableResults: Map<string, unknown> = new Map();
let _defaultResult: unknown = { data: null, error: null };
let _rpcResults: Map<string, unknown> = new Map();
const _rpcDefault: unknown = { data: { ok: true }, error: null };

function chain(resolveWith: unknown) {
  const p = Promise.resolve(resolveWith);
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(_, prop: string) {
      if (prop === 'then') return p.then.bind(p);
      if (prop === 'catch') return p.catch.bind(p);
      if (prop === 'finally') return p.finally.bind(p);
      if (prop === 'single') return () => p;
      if (prop === 'maybeSingle') return () => p;
      return () => new Proxy({} as Record<string, unknown>, handler);
    },
  };
  return new Proxy({} as Record<string, unknown>, handler);
}

const adminClient = {
  from: (table: string) => chain(_tableResults.get(table) ?? _defaultResult),
  auth: { getUser: () => Promise.resolve({ data: { user: { id: 'auth-1' } }, error: null }) },
  rpc: (name: string) => Promise.resolve(_rpcResults.get(name) ?? _rpcDefault),
};

vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  supabaseAdmin: adminClient,
  getSupabaseAdmin: () => adminClient,
}));

// ── Helpers ─────────────────────────────────────────────────────────────────
function req(method: string, body?: unknown): NextRequest {
  return new NextRequest('http://localhost/api/test', {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer t' },
    body: body !== undefined ? JSON.stringify(body) : null,
  });
}

/** Caller HOLDS the gate permission → authorizeRequest resolves authorized. */
function permit(opts: { studentId?: string; userId?: string; roles?: string[] } = {}) {
  _authorizeImpl.mockResolvedValue({
    authorized: true,
    userId: opts.userId ?? 'auth-1',
    studentId: opts.studentId ?? null,
    roles: opts.roles ?? ['student'],
    permissions: [],
    errorResponse: null,
  });
}

/** Caller LACKS the gate permission → authorizeRequest returns a 403 response. */
function deny() {
  const errorResponse = new Response(
    JSON.stringify({ error: 'Forbidden', code: 'FORBIDDEN' }),
    { status: 403, headers: { 'Content-Type': 'application/json' } },
  );
  _authorizeImpl.mockResolvedValue({
    authorized: false,
    userId: null,
    studentId: null,
    roles: [],
    permissions: [],
    errorResponse,
  });
}

function gateArg(): string {
  // authorizeRequest(request, 'permission.code', options?) — code is arg index 1.
  return (_authorizeImpl.mock.calls[0] as unknown[])[1] as string;
}

beforeEach(() => {
  vi.clearAllMocks();
  _tableResults = new Map();
  _defaultResult = { data: null, error: null };
  _rpcResults = new Map();
});

// =============================================================================
// POST /api/auth/repair → user.manage (admin)
// =============================================================================
describe('POST /api/auth/repair gates on user.manage', () => {
  const VALID_BODY = { auth_user_id: '11111111-1111-4111-8111-111111111111' };

  it('authorizes against the granted sibling user.manage', async () => {
    permit({ roles: ['admin'] });
    const { POST } = await import('@/app/api/auth/repair/route');
    await POST(req('POST', VALID_BODY));
    expect(gateArg()).toBe('user.manage');
  });

  it('rejects a caller without user.manage (403 propagates)', async () => {
    deny();
    const { POST } = await import('@/app/api/auth/repair/route');
    const res = await POST(req('POST', VALID_BODY));
    expect(res.status).toBe(403);
  });
});

// =============================================================================
// GET/POST/PATCH /api/v1/admin/roles → role.manage (admin)
// =============================================================================
describe('/api/v1/admin/roles gates on role.manage', () => {
  it('GET authorizes against the granted sibling role.manage', async () => {
    permit({ roles: ['admin'] });
    _tableResults.set('roles', { data: [], error: null });
    const { GET } = await import('@/app/api/v1/admin/roles/route');
    await GET(req('GET'));
    expect(gateArg()).toBe('role.manage');
  });

  it('POST authorizes against the granted sibling role.manage', async () => {
    permit({ roles: ['admin'] });
    const { POST } = await import('@/app/api/v1/admin/roles/route');
    await POST(req('POST', { name: 'editor' }));
    expect(gateArg()).toBe('role.manage');
  });

  it('PATCH authorizes against the granted sibling role.manage', async () => {
    permit({ roles: ['admin'] });
    _tableResults.set('roles', { data: { id: 'role-1', name: 'editor' }, error: null });
    _tableResults.set('user_roles', { data: [], error: null });
    const { PATCH } = await import('@/app/api/v1/admin/roles/route');
    await PATCH(req('PATCH', { role_id: '550e8400-e29b-41d4-a716-446655440000', permissions: [] }));
    expect(gateArg()).toBe('role.manage');
  });

  it('GET rejects a caller without role.manage (403 propagates)', async () => {
    deny();
    const { GET } = await import('@/app/api/v1/admin/roles/route');
    const res = await GET(req('GET'));
    expect(res.status).toBe(403);
  });

  it('POST rejects a caller without role.manage (403 propagates)', async () => {
    deny();
    const { POST } = await import('@/app/api/v1/admin/roles/route');
    const res = await POST(req('POST', { name: 'editor' }));
    expect(res.status).toBe(403);
  });

  it('PATCH rejects a caller without role.manage (403 propagates)', async () => {
    deny();
    const { PATCH } = await import('@/app/api/v1/admin/roles/route');
    const res = await PATCH(req('PATCH', { role_id: '550e8400-e29b-41d4-a716-446655440000', permissions: [] }));
    expect(res.status).toBe(403);
  });
});

// =============================================================================
// PATCH /api/student/profile → profile.update_own (student)
// =============================================================================
describe('PATCH /api/student/profile gates on profile.update_own', () => {
  it('authorizes against the granted sibling profile.update_own', async () => {
    permit({ studentId: 's1' });
    _tableResults.set('students', { data: { id: 's1', name: 'Ravi', board: 'CBSE', name_change_count: 0 }, error: null });
    const { PATCH } = await import('@/app/api/student/profile/route');
    await PATCH(req('PATCH', { preferred_language: 'hi' }));
    expect(gateArg()).toBe('profile.update_own');
  });

  it('passes requireStudentId option to the gate', async () => {
    permit({ studentId: 's1' });
    _tableResults.set('students', { data: { id: 's1', name: 'Ravi', board: 'CBSE', name_change_count: 0 }, error: null });
    const { PATCH } = await import('@/app/api/student/profile/route');
    await PATCH(req('PATCH', { preferred_language: 'hi' }));
    expect((_authorizeImpl.mock.calls[0] as unknown[])[2]).toMatchObject({ requireStudentId: true });
  });

  it('rejects a caller without profile.update_own (403 propagates)', async () => {
    deny();
    const { PATCH } = await import('@/app/api/student/profile/route');
    const res = await PATCH(req('PATCH', { preferred_language: 'hi' }));
    expect(res.status).toBe(403);
  });
});

// =============================================================================
// POST /api/student/scan-upload → image.upload (student)
// =============================================================================
describe('POST /api/student/scan-upload gates on image.upload', () => {
  it('authorizes against the granted sibling image.upload', async () => {
    permit({ studentId: 's1' });
    const { POST } = await import('@/app/api/student/scan-upload/route');
    await POST(req('POST', { image_url: 'x', image_type: 'homework' }));
    expect(gateArg()).toBe('image.upload');
  });

  it('rejects a caller without image.upload (403 propagates)', async () => {
    deny();
    const { POST } = await import('@/app/api/student/scan-upload/route');
    const res = await POST(req('POST', { image_url: 'x', image_type: 'homework' }));
    expect(res.status).toBe(403);
  });
});

// =============================================================================
// PATCH /api/student/study-plan → study_plan.create (student)
// =============================================================================
describe('PATCH /api/student/study-plan gates on study_plan.create', () => {
  it('authorizes against the granted sibling study_plan.create', async () => {
    permit({ studentId: 's1' });
    const { PATCH } = await import('@/app/api/student/study-plan/route');
    await PATCH(req('PATCH', { task_id: 't1', status: 'completed' }));
    expect(gateArg()).toBe('study_plan.create');
  });

  it('rejects a caller without study_plan.create (403 propagates)', async () => {
    deny();
    const { PATCH } = await import('@/app/api/student/study-plan/route');
    const res = await PATCH(req('PATCH', { task_id: 't1', status: 'completed' }));
    expect(res.status).toBe(403);
  });
});

// =============================================================================
// POST /api/exam/chapters → exam.create (student)
// =============================================================================
describe('POST /api/exam/chapters gates on exam.create', () => {
  it('authorizes against the granted sibling exam.create', async () => {
    permit({ studentId: 's1' });
    const { POST } = await import('@/app/api/exam/chapters/route');
    await POST(req('POST', { exam_config_id: 'cfg-1', chapters: [{ chapter_number: 1 }] }));
    expect(gateArg()).toBe('exam.create');
  });

  it('rejects a caller without exam.create (403 propagates)', async () => {
    deny();
    const { POST } = await import('@/app/api/exam/chapters/route');
    const res = await POST(req('POST', { exam_config_id: 'cfg-1', chapters: [{ chapter_number: 1 }] }));
    expect(res.status).toBe(403);
  });
});

// =============================================================================
// POST /api/student/shop/purchase → profile.update_own (student)
// =============================================================================
describe('POST /api/student/shop/purchase gates on profile.update_own', () => {
  const VALID_BODY = { itemId: 'streak_freeze', currency: 'coins' };

  it('authorizes against the granted sibling profile.update_own', async () => {
    permit({ studentId: 's1' });
    _rpcResults.set('purchase_streak_freeze', { data: 120, error: null });
    const { POST } = await import('@/app/api/student/shop/purchase/route');
    await POST(req('POST', VALID_BODY));
    expect(gateArg()).toBe('profile.update_own');
  });

  it('passes requireStudentId option to the gate', async () => {
    permit({ studentId: 's1' });
    _rpcResults.set('purchase_streak_freeze', { data: 120, error: null });
    const { POST } = await import('@/app/api/student/shop/purchase/route');
    await POST(req('POST', VALID_BODY));
    expect((_authorizeImpl.mock.calls[0] as unknown[])[2]).toMatchObject({ requireStudentId: true });
  });

  it('rejects a caller without profile.update_own (403 propagates)', async () => {
    deny();
    const { POST } = await import('@/app/api/student/shop/purchase/route');
    const res = await POST(req('POST', VALID_BODY));
    expect(res.status).toBe(403);
  });
});
