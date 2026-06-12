/**
 * /api/pulse/* — Student Pulse cross-role authorization contract (P8 / P9 / P13).
 *
 * This file is the VERIFICATION GATE for the Pulse cross-role data boundary.
 * It proves the DENY paths explicitly — that a caller WITHOUT the right
 * relationship and/or permission is rejected with the correct status, that the
 * rejection is audit-logged, and (the P13 invariant) that NO student payload
 * leaks on any deny path.
 *
 * Routes under test:
 *   - /api/pulse/student/[id]  (RELATIONSHIP lens — parent/teacher/principal/self)
 *       canAccessStudent is THE hard data boundary; a viewing permission is also
 *       required (relationship-without-permission is still denied).
 *   - /api/pulse/class/[classId]  (CLASS lens — teacher; class_teachers ownership)
 *   - /api/pulse/me  (SELF lens — progress.view_own only)
 *
 * The /api/pulse/school route resolves auth via resolveCommandCenterContext,
 * which is already pinned by src/__tests__/lib/school-admin/command-center-context.test.ts
 * (P9 gate + membership scope + 4xx/5xx mapping). It is intentionally not
 * re-tested here to avoid duplicating that contract.
 *
 * Mocking follows the established teacher/parent route pattern
 * (src/__tests__/api/teacher/remediation/route.test.ts): @/lib/rbac is stubbed
 * so authorizeRequest / canAccessStudent / hasAnyPermission / logAudit are
 * controllable + observable; @/lib/supabase-admin is a tiny in-memory query
 * builder; and @/lib/pulse/pulse-server is stubbed so we can assert it is NEVER
 * reached on a deny path (no payload is ever built) and capture the payload it
 * WOULD return on the happy path.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted, controllable mock holders ────────────────────────────────
const holders = vi.hoisted(() => ({
  mockAuthorize: vi.fn(),
  mockCanAccessStudent: vi.fn(),
  mockHasAnyPermission: vi.fn(),
  mockLogAudit: vi.fn(),
  mockBuildSingle: vi.fn(),
  mockBuildClass: vi.fn(),
  // supabase-admin in-memory state
  mockState: {} as {
    target?: { auth_user_id: string | null } | null;
    targetError?: { message: string } | null;
    teacher?: { id: string } | null;
    teacherError?: { message: string } | null;
    ownsLink?: { class_id: string } | null;
    ownsError?: { message: string } | null;
    roster?: Array<{ students: unknown }> | null;
    rosterError?: { message: string } | null;
  },
}));

vi.mock('@/lib/rbac', () => ({
  authorizeRequest: (...a: unknown[]) => holders.mockAuthorize(...a),
  canAccessStudent: (...a: unknown[]) => holders.mockCanAccessStudent(...a),
  hasAnyPermission: (...a: unknown[]) => holders.mockHasAnyPermission(...a),
  logAudit: (...a: unknown[]) => holders.mockLogAudit(...a),
}));

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// The pulse builders are the ONLY thing that returns a student payload. Stubbing
// them lets us (a) prove they are NEVER called on a deny path and (b) capture a
// known payload on the allow path.
const SENTINEL_PULSE = {
  status: 'steady',
  timeline: [{ kind: 'learner.quiz_completed', occurredAt: '2026-06-12T00:00:00Z', summary: { subject: 'math' } }],
  masterySummary: { bySubject: [], strengths: ['math'], atRisk: [], totalAtRiskChapters: 0 },
  signals: {},
  schemaVersion: 1,
  generatedAt: '2026-06-12T12:00:00Z',
};

vi.mock('@/lib/pulse/pulse-server', () => ({
  buildSingleStudentPulse: (...a: unknown[]) => holders.mockBuildSingle(...a),
  buildClassPulseItems: (...a: unknown[]) => holders.mockBuildClass(...a),
}));

vi.mock('@/lib/supabase-admin', () => {
  // ── students: .select('auth_user_id').eq('id', x).maybeSingle() ──
  function studentsChain() {
    const chain = {
      eq() {
        return chain;
      },
      maybeSingle() {
        return Promise.resolve({
          data: holders.mockState.target ?? null,
          error: holders.mockState.targetError ?? null,
        });
      },
    };
    return chain;
  }

  // ── teachers: .select('id').eq().eq().maybeSingle() ──
  function teachersChain() {
    const chain = {
      eq() {
        return chain;
      },
      maybeSingle() {
        return Promise.resolve({
          data: holders.mockState.teacher ?? null,
          error: holders.mockState.teacherError ?? null,
        });
      },
    };
    return chain;
  }

  // ── class_teachers: .select().eq().eq().eq().limit().maybeSingle() ──
  function classTeachersChain() {
    const chain = {
      eq() {
        return chain;
      },
      limit() {
        return chain;
      },
      maybeSingle() {
        return Promise.resolve({
          data: holders.mockState.ownsLink ?? null,
          error: holders.mockState.ownsError ?? null,
        });
      },
    };
    return chain;
  }

  // ── class_students: .select(...).eq().eq().limit() (awaited array) ──
  function classStudentsChain() {
    const result = {
      data: holders.mockState.roster ?? [],
      error: holders.mockState.rosterError ?? null,
    };
    const chain = {
      eq() {
        return chain;
      },
      limit() {
        return Promise.resolve(result);
      },
    };
    return chain;
  }

  return {
    supabaseAdmin: {
      from(table: string) {
        if (table === 'students') return { select: () => studentsChain() };
        if (table === 'teachers') return { select: () => teachersChain() };
        if (table === 'class_teachers') return { select: () => classTeachersChain() };
        if (table === 'class_students') return { select: () => classStudentsChain() };
        throw new Error(`Unexpected table in test mock: ${table}`);
      },
    },
  };
});

// ── Fixture IDs (valid RFC4122 v4) ────────────────────────────────────
const CALLER_AUTH = '11111111-1111-4111-a111-111111111111';
const STUDENT_ID = '33333333-3333-4333-a333-333333333333';
const STUDENT_AUTH = '99999999-9999-4999-a999-999999999999';
const TEACHER_ID = '22222222-2222-4222-a222-222222222222';
const CLASS_ID = '44444444-4444-4444-a444-444444444444';

// ── Request factories ─────────────────────────────────────────────────
function studentReq() {
  return new Request(`http://localhost/api/pulse/student/${STUDENT_ID}`, {
    headers: { Authorization: 'Bearer fake.jwt' },
  });
}
function classReq() {
  return new Request(`http://localhost/api/pulse/class/${CLASS_ID}`, {
    headers: { Authorization: 'Bearer fake.jwt' },
  });
}
function meReq() {
  return new Request('http://localhost/api/pulse/me', {
    headers: { Authorization: 'Bearer fake.jwt' },
  });
}

const studentCtx = { params: Promise.resolve({ id: STUDENT_ID }) };
const classCtx = { params: Promise.resolve({ classId: CLASS_ID }) };

// ── Auth helpers ──────────────────────────────────────────────────────
function authOk(userId = CALLER_AUTH) {
  holders.mockAuthorize.mockResolvedValue({
    authorized: true,
    userId,
    studentId: null,
    roles: [],
    permissions: [],
  });
}
function authFail(status: number) {
  holders.mockAuthorize.mockResolvedValue({
    authorized: false,
    userId: null,
    studentId: null,
    roles: [],
    permissions: [],
    errorResponse: new Response(
      JSON.stringify({ success: false, error: status === 401 ? 'Unauthorized' : 'Forbidden' }),
      { status, headers: { 'Content-Type': 'application/json' } },
    ),
  });
}

/**
 * P13 GUARD — assert a deny-path body carries NO student payload.
 * Every Pulse student field (status/timeline/masterySummary/signals) must be
 * absent; only the { success:false, error } envelope is allowed.
 */
function expectNoStudentPayload(body: Record<string, unknown>) {
  expect(body.success).toBe(false);
  expect(body.data).toBeUndefined();
  expect(body).not.toHaveProperty('status'); // PulseStatus must not leak at top level
  expect(body).not.toHaveProperty('timeline');
  expect(body).not.toHaveProperty('masterySummary');
  expect(body).not.toHaveProperty('signals');
  // And the sentinel never appears anywhere in the serialized body.
  expect(JSON.stringify(body)).not.toContain(STUDENT_AUTH);
  expect(JSON.stringify(body)).not.toContain('learner.quiz_completed');
}

beforeEach(() => {
  vi.clearAllMocks();
  holders.mockState = {};
  holders.mockBuildSingle.mockResolvedValue(SENTINEL_PULSE);
  holders.mockBuildClass.mockResolvedValue([]);
});

// ════════════════════════════════════════════════════════════════════════════
// /api/pulse/student/[id] — RELATIONSHIP lens
// ════════════════════════════════════════════════════════════════════════════

describe('GET /api/pulse/student/[id] — cross-role boundary (P8/P13)', () => {
  it('returns 401 (verbatim auth errorResponse) when unauthenticated — no payload', async () => {
    const { GET } = await import('@/app/api/pulse/student/[id]/route');
    authFail(401);
    const res = await GET(studentReq(), studentCtx);
    expect(res.status).toBe(401);
    // Boundary never consulted, builder never reached.
    expect(holders.mockCanAccessStudent).not.toHaveBeenCalled();
    expect(holders.mockBuildSingle).not.toHaveBeenCalled();
    const body = await res.json();
    expectNoStudentPayload(body);
  });

  it('returns 400 for an invalid (non-UUID) student id — no boundary call, no payload', async () => {
    const { GET } = await import('@/app/api/pulse/student/[id]/route');
    authOk();
    const badReq = new Request('http://localhost/api/pulse/student/not-a-uuid', {
      headers: { Authorization: 'Bearer fake.jwt' },
    });
    const res = await GET(badReq, { params: Promise.resolve({ id: 'not-a-uuid' }) });
    expect(res.status).toBe(400);
    expect(holders.mockCanAccessStudent).not.toHaveBeenCalled();
    expect(holders.mockBuildSingle).not.toHaveBeenCalled();
    const body = await res.json();
    expectNoStudentPayload(body);
  });

  it('PARENT not linked to the student → 403 (canAccessStudent false), audited, no payload', async () => {
    const { GET } = await import('@/app/api/pulse/student/[id]/route');
    authOk();
    holders.mockCanAccessStudent.mockResolvedValue(false); // not a linked child
    const res = await GET(studentReq(), studentCtx);
    expect(res.status).toBe(403);

    // canAccessStudent IS the boundary and it was the thing that failed.
    expect(holders.mockCanAccessStudent).toHaveBeenCalledWith(CALLER_AUTH, STUDENT_ID);
    // Permission gate never even reached — boundary short-circuits first.
    expect(holders.mockHasAnyPermission).not.toHaveBeenCalled();
    // Builder never invoked → no student data ever assembled.
    expect(holders.mockBuildSingle).not.toHaveBeenCalled();

    // Denial is audited with status 'denied' + the no_relationship reason.
    expect(holders.mockLogAudit).toHaveBeenCalledTimes(1);
    const [auditUser, entry] = holders.mockLogAudit.mock.calls[0];
    expect(auditUser).toBe(CALLER_AUTH);
    expect(entry.action).toBe('pulse.student_viewed');
    expect(entry.status).toBe('denied');
    expect(entry.resourceId).toBe(STUDENT_ID);
    expect(entry.details?.reason).toBe('no_relationship');

    const body = await res.json();
    expectNoStudentPayload(body);
  });

  it('TEACHER not assigned to the student → 403 (canAccessStudent false), audited, no payload', async () => {
    // Same boundary, different audience — canAccessStudent encodes "assigned".
    const { GET } = await import('@/app/api/pulse/student/[id]/route');
    authOk();
    holders.mockCanAccessStudent.mockResolvedValue(false); // not an assigned student
    const res = await GET(studentReq(), studentCtx);
    expect(res.status).toBe(403);
    expect(holders.mockBuildSingle).not.toHaveBeenCalled();
    const [, entry] = holders.mockLogAudit.mock.calls[0];
    expect(entry.status).toBe('denied');
    expect(entry.details?.reason).toBe('no_relationship');
    const body = await res.json();
    expectNoStudentPayload(body);
  });

  it('RELATIONSHIP but NO viewing permission → 403, audited (no_view_permission), no payload', async () => {
    // The defense-in-depth case: a real relationship is NOT enough — the caller
    // must ALSO hold a viewing permission. Proves the second gate independently.
    const { GET } = await import('@/app/api/pulse/student/[id]/route');
    authOk();
    holders.mockCanAccessStudent.mockResolvedValue(true); // relationship exists
    holders.mockHasAnyPermission.mockResolvedValue(false); // but no view perm
    const res = await GET(studentReq(), studentCtx);
    expect(res.status).toBe(403);

    // Boundary passed, permission gate consulted with the exact view-permission set.
    expect(holders.mockHasAnyPermission).toHaveBeenCalledTimes(1);
    const [, perms] = holders.mockHasAnyPermission.mock.calls[0];
    expect(perms).toEqual(
      expect.arrayContaining([
        'progress.view_own',
        'child.view_progress',
        'class.view_analytics',
        'report.view_class',
        'institution.view_analytics',
      ]),
    );
    // Still no payload built.
    expect(holders.mockBuildSingle).not.toHaveBeenCalled();

    const [, entry] = holders.mockLogAudit.mock.calls[0];
    expect(entry.status).toBe('denied');
    expect(entry.details?.reason).toBe('no_view_permission');

    const body = await res.json();
    expectNoStudentPayload(body);
  });

  it('happy path: relationship + permission → 200 and the pulse payload (allow-path control)', async () => {
    // Control case proving the deny assertions above are meaningful: when BOTH
    // gates pass, the builder runs and the payload IS returned.
    const { GET } = await import('@/app/api/pulse/student/[id]/route');
    authOk();
    holders.mockCanAccessStudent.mockResolvedValue(true);
    holders.mockHasAnyPermission.mockResolvedValue(true);
    holders.mockState.target = { auth_user_id: STUDENT_AUTH };
    const res = await GET(studentReq(), studentCtx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.status).toBe('steady');
    // Builder was driven by the TARGET's auth_user_id, not the caller's.
    expect(holders.mockBuildSingle).toHaveBeenCalledWith(expect.anything(), STUDENT_AUTH);
    // Success audit recorded.
    const successAudit = holders.mockLogAudit.mock.calls.find(
      (c) => c[1]?.status === 'success',
    );
    expect(successAudit).toBeTruthy();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// /api/pulse/class/[classId] — CLASS lens (teacher ownership)
// ════════════════════════════════════════════════════════════════════════════

describe('GET /api/pulse/class/[classId] — class ownership boundary (P8/P13)', () => {
  it('TEACHER who does not own the class → 403, audited (not_class_owner), no payload', async () => {
    const { GET } = await import('@/app/api/pulse/class/[classId]/route');
    authOk();
    holders.mockState.teacher = { id: TEACHER_ID }; // is an active teacher
    holders.mockState.ownsLink = null; // but not linked to this class
    const res = await GET(classReq(), classCtx);
    expect(res.status).toBe(403);

    // Roster was never loaded → no student rows assembled.
    expect(holders.mockBuildClass).not.toHaveBeenCalled();

    expect(holders.mockLogAudit).toHaveBeenCalledTimes(1);
    const [auditUser, entry] = holders.mockLogAudit.mock.calls[0];
    expect(auditUser).toBe(CALLER_AUTH);
    expect(entry.action).toBe('pulse.class_viewed');
    expect(entry.status).toBe('denied');
    expect(entry.resourceId).toBe(CLASS_ID);
    expect(entry.details?.reason).toBe('not_class_owner');

    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.data).toBeUndefined();
    expect(body).not.toHaveProperty('students');
  });

  it('caller holds class.view_analytics but is NOT an active teacher → 403, audited, no payload', async () => {
    const { GET } = await import('@/app/api/pulse/class/[classId]/route');
    authOk();
    holders.mockState.teacher = null; // no teacher profile
    const res = await GET(classReq(), classCtx);
    expect(res.status).toBe(403);
    expect(holders.mockBuildClass).not.toHaveBeenCalled();
    const [, entry] = holders.mockLogAudit.mock.calls[0];
    expect(entry.status).toBe('denied');
    expect(entry.details?.reason).toBe('not_a_teacher');
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.data).toBeUndefined();
  });

  it('requires the class.view_analytics permission at the RBAC gate', async () => {
    const { GET } = await import('@/app/api/pulse/class/[classId]/route');
    authOk();
    holders.mockState.teacher = { id: TEACHER_ID };
    holders.mockState.ownsLink = { class_id: CLASS_ID };
    holders.mockState.roster = [];
    await GET(classReq(), classCtx);
    expect(holders.mockAuthorize).toHaveBeenCalledTimes(1);
    const [, perm] = holders.mockAuthorize.mock.calls[0];
    expect(perm).toBe('class.view_analytics');
  });

  it('returns 401 verbatim when unauthenticated — no payload', async () => {
    const { GET } = await import('@/app/api/pulse/class/[classId]/route');
    authFail(401);
    const res = await GET(classReq(), classCtx);
    expect(res.status).toBe(401);
    expect(holders.mockBuildClass).not.toHaveBeenCalled();
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.data).toBeUndefined();
  });

  it('returns 400 for an invalid (non-UUID) class id — no ownership lookup, no payload', async () => {
    const { GET } = await import('@/app/api/pulse/class/[classId]/route');
    authOk();
    const badReq = new Request('http://localhost/api/pulse/class/not-a-uuid', {
      headers: { Authorization: 'Bearer fake.jwt' },
    });
    const res = await GET(badReq, { params: Promise.resolve({ classId: 'not-a-uuid' }) });
    expect(res.status).toBe(400);
    expect(holders.mockBuildClass).not.toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// /api/pulse/me — SELF lens
// ════════════════════════════════════════════════════════════════════════════

describe('GET /api/pulse/me — self lens RBAC gate (P9)', () => {
  it('missing progress.view_own → blocked verbatim (403), no payload', async () => {
    const { GET } = await import('@/app/api/pulse/me/route');
    authFail(403); // authorizeRequest('progress.view_own') denies
    const res = await GET(meReq());
    expect(res.status).toBe(403);
    expect(holders.mockBuildSingle).not.toHaveBeenCalled();
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.data).toBeUndefined();
    expect(body).not.toHaveProperty('signals');
  });

  it('requests authorizeRequest with the progress.view_own permission', async () => {
    const { GET } = await import('@/app/api/pulse/me/route');
    authOk();
    await GET(meReq());
    expect(holders.mockAuthorize).toHaveBeenCalledTimes(1);
    const [, perm] = holders.mockAuthorize.mock.calls[0];
    expect(perm).toBe('progress.view_own');
  });

  it('401 when unauthenticated — verbatim, no payload', async () => {
    const { GET } = await import('@/app/api/pulse/me/route');
    authFail(401);
    const res = await GET(meReq());
    expect(res.status).toBe(401);
    expect(holders.mockBuildSingle).not.toHaveBeenCalled();
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.data).toBeUndefined();
  });

  it('happy path: builds the SELF pulse for the caller own auth_user_id (allow-path control)', async () => {
    const { GET } = await import('@/app/api/pulse/me/route');
    authOk(CALLER_AUTH);
    const res = await GET(meReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.status).toBe('steady');
    // SELF lens: builder is keyed by the CALLER's own auth id (no cross-student access).
    expect(holders.mockBuildSingle).toHaveBeenCalledWith(expect.anything(), CALLER_AUTH);
  });
});
