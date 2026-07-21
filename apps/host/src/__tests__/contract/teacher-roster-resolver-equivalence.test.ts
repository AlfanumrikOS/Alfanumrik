/**
 * Cross-resolver roster-equivalence contract (teacher-dashboard deep RCA,
 * 2026-07-20).
 *
 * BACKGROUND: prior to this refactor there were THREE independent
 * re-implementations of "which students can this teacher see" on the
 * Next.js server side (`canAccessStudent`'s teacher branch, the remediation
 * route's `resolveRemediationClassScope`/`resolveRemediationReadScope`, and
 * the parent-notify route's `rosterClassId`), plus a FOURTH in the Deno
 * `teacher-dashboard` Edge Function. They had drifted from each other —
 * most notably a missing `is_active` filter on `class_teachers` and a
 * missing `is_active` filter on the `teachers` lookup itself in the
 * parent-notify route.
 *
 * All THREE Next.js surfaces now delegate to the SAME canonical resolver —
 * `resolveTeacherIdentity` + `resolveTeacherRosterScope` in
 * `@alfanumrik/lib/rbac`. This test exercises the REAL, un-reimplemented
 * code paths end-to-end against one shared in-memory fixture:
 *   1. `canAccessStudent` (imported directly from rbac.ts)
 *   2. `POST /api/teacher/remediation` (the real route handler)
 *   3. `POST /api/teacher/parent-notify` (the real route handler)
 *
 * and asserts they agree on the authorized student set — WITH ONE
 * DOCUMENTED, INTENTIONAL EXCEPTION: the remediation route additionally
 * requires the selected class to belong to the teacher's OWN school
 * (`includeClassDetails: true`, a business rule for curriculum-topic
 * scoping that predates this refactor and is preserved verbatim). Neither
 * `canAccessStudent` nor parent-notify have ever enforced a school match —
 * this is a deliberate business-rule difference, not resolver drift, and
 * this test pins it explicitly so it cannot regress silently in either
 * direction.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Fixture ids ──────────────────────────────────────────────────────
const TEACHER_AUTH = '11111111-1111-4111-a111-111111111111';
const TEACHER_ID = '22222222-2222-4222-a222-222222222222';
const SCHOOL_A = '33333333-3333-4333-a333-333333333333'; // teacher's home school
const SCHOOL_B = '44444444-4444-4444-a444-444444444444'; // a different school
const CLASS_A = '55555555-5555-4555-a555-555555555555'; // teacher's class, home school
const CLASS_B = '66666666-6666-4666-a666-666666666666'; // teacher's class, OTHER school
const STUDENT_HOME = '77777777-7777-4777-a777-777777777777'; // enrolled in CLASS_A
const STUDENT_CROSS = '88888888-8888-4888-a888-888888888888'; // enrolled in CLASS_B
const STUDENT_OUTSIDE = '99999999-9999-4999-a999-999999999999'; // not enrolled anywhere
const STUDENT_INACTIVE = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'; // enrolled but is_active=false

// ── Hoisted mutable fixture tables + auth stub ──────────────────────
const holders = vi.hoisted(() => {
  const TABLES: Record<string, Array<Record<string, unknown>>> = {
    teachers: [{ id: '22222222-2222-4222-a222-222222222222', auth_user_id: '11111111-1111-4111-a111-111111111111', school_id: '33333333-3333-4333-a333-333333333333', is_active: true }],
    class_teachers: [
      { teacher_id: '22222222-2222-4222-a222-222222222222', class_id: '55555555-5555-4555-a555-555555555555', is_active: true },
      { teacher_id: '22222222-2222-4222-a222-222222222222', class_id: '66666666-6666-4666-a666-666666666666', is_active: true },
    ],
    classes: [
      { id: '55555555-5555-4555-a555-555555555555', school_id: '33333333-3333-4333-a333-333333333333', grade: '7', subject: 'Mathematics', is_active: true, deleted_at: null },
      { id: '66666666-6666-4666-a666-666666666666', school_id: '44444444-4444-4444-a444-444444444444', grade: '8', subject: 'Science', is_active: true, deleted_at: null },
    ],
    class_enrollments: [
      { class_id: '55555555-5555-4555-a555-555555555555', student_id: '77777777-7777-4777-a777-777777777777', is_active: true },
      { class_id: '66666666-6666-4666-a666-666666666666', student_id: '88888888-8888-4888-a888-888888888888', is_active: true },
      { class_id: '55555555-5555-4555-a555-555555555555', student_id: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa', is_active: false },
    ],
    students: [
      { id: '77777777-7777-4777-a777-777777777777', school_id: '33333333-3333-4333-a333-333333333333', is_active: true, deleted_at: null, auth_user_id: null, name: 'Home Student', grade: '7' },
      { id: '88888888-8888-4888-a888-888888888888', school_id: '44444444-4444-4444-a444-444444444444', is_active: true, deleted_at: null, auth_user_id: null, name: 'Cross Student', grade: '8' },
      { id: '99999999-9999-4999-a999-999999999999', school_id: '33333333-3333-4333-a333-333333333333', is_active: true, deleted_at: null, auth_user_id: null, name: 'Outside Student', grade: '7' },
      { id: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa', school_id: '33333333-3333-4333-a333-333333333333', is_active: true, deleted_at: null, auth_user_id: null, name: 'Inactive Enrollment Student', grade: '7' },
    ],
    guardians: [],
    guardian_student_links: [],
    teacher_parent_threads: [],
    teacher_parent_messages: [],
    notifications: [],
    teacher_remediation_assignments: [],
    at_risk_alerts: [],
    curriculum_topics: [],
    subjects: [],
  };

  let idCounter = 0;

  function queryBuilder(table: string) {
    const filters: Array<(r: Record<string, unknown>) => boolean> = [];
    let isInsert = false;
    let insertPayload: Record<string, unknown> | Record<string, unknown>[] | null = null;

    const rowsFor = () => TABLES[table] ?? (TABLES[table] = []);
    const applyFilters = () => rowsFor().filter((r) => filters.every((f) => f(r)));

    const finalizeInsert = () => {
      const payloads = Array.isArray(insertPayload) ? insertPayload : [insertPayload as Record<string, unknown>];
      const created = payloads.map((p) => ({ id: `generated-${table}-${idCounter++}`, created_at: new Date().toISOString(), ...p }));
      rowsFor().push(...created);
      return created;
    };

    const api: Record<string, unknown> = {
      select() { return api; },
      insert(payload: Record<string, unknown> | Record<string, unknown>[]) {
        isInsert = true;
        insertPayload = payload;
        return api;
      },
      eq(col: string, val: unknown) { filters.push((r) => r[col] === val); return api; },
      in(col: string, vals: unknown[]) { filters.push((r) => vals.includes(r[col])); return api; },
      is(col: string, val: unknown) { filters.push((r) => (r[col] ?? null) === val); return api; },
      not() { return api; },
      order() { return api; },
      limit() { return api; },
      maybeSingle: async () => {
        if (isInsert) {
          const created = finalizeInsert();
          return { data: created[0] ?? null, error: null };
        }
        const matched = applyFilters();
        return { data: matched[0] ?? null, error: null };
      },
      single: async () => {
        if (isInsert) {
          const created = finalizeInsert();
          return { data: created[0] ?? null, error: null };
        }
        const matched = applyFilters();
        return { data: matched[0] ?? null, error: null };
      },
      then(resolve: (v: { data: unknown; error: unknown }) => unknown) {
        if (isInsert) {
          const created = finalizeInsert();
          return Promise.resolve({ data: created, error: null }).then(resolve);
        }
        const matched = applyFilters();
        return Promise.resolve({ data: matched, error: null }).then(resolve);
      },
    };
    return api;
  }

  const client = {
    from(table: string) { return queryBuilder(table); },
    rpc(name: string) {
      if (name === 'get_user_permissions') {
        return Promise.resolve({
          data: { roles: [{ name: 'teacher' }], permissions: ['class.assign_remediation', 'class.manage'] },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: { message: `unmocked rpc: ${name}` } });
    },
  };

  return {
    client,
    mockAuthorize: vi.fn(),
  };
});

vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  supabaseAdmin: holders.client,
  getSupabaseAdmin: () => holders.client,
}));

vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('@alfanumrik/lib/rbac', async () => {
  // Keep every REAL export (canAccessStudent, resolveTeacherIdentity,
  // resolveTeacherRosterScope, getUserPermissions, …) — only authorizeRequest
  // is stubbed, since real JWT/cookie auth cannot run in a unit test.
  const actual = await vi.importActual<typeof import('@alfanumrik/lib/rbac')>('@alfanumrik/lib/rbac');
  return {
    ...actual,
    authorizeRequest: (...args: unknown[]) => holders.mockAuthorize(...args),
  };
});

function authAsTeacher() {
  holders.mockAuthorize.mockResolvedValue({
    authorized: true,
    userId: TEACHER_AUTH,
    studentId: null,
    roles: ['teacher'],
    permissions: ['class.assign_remediation', 'class.manage'],
  });
}

function makeRemediationPost(classId: string, studentId: string): Request {
  return new Request('http://localhost/api/teacher/remediation', {
    method: 'POST',
    headers: { Authorization: 'Bearer fake.jwt', 'Content-Type': 'application/json' },
    body: JSON.stringify({ class_id: classId, student_id: studentId }),
  });
}

function makeParentNotifyPost(studentId: string): Request {
  return new Request('http://localhost/api/teacher/parent-notify', {
    method: 'POST',
    headers: { Authorization: 'Bearer fake.jwt', 'Content-Type': 'application/json' },
    body: JSON.stringify({ student_id: studentId, context: 'general' }),
  });
}

/** True iff the parent-notify response indicates the roster check DENIED access. */
async function parentNotifyDeniedRoster(res: Response): Promise<boolean> {
  if (res.status !== 403) return false;
  const body = await res.json();
  return typeof body.error === 'string' && /roster/i.test(body.error);
}

beforeEach(() => {
  vi.clearAllMocks();
  authAsTeacher();
});

describe('canAccessStudent (canonical boundary) — real function, no re-implementation', () => {
  it('grants the home-school enrolled student', async () => {
    const { canAccessStudent } = await import('@alfanumrik/lib/rbac');
    await expect(canAccessStudent(TEACHER_AUTH, STUDENT_HOME)).resolves.toBe(true);
  });

  it('grants the cross-school enrolled student (canAccessStudent has no school gate)', async () => {
    const { canAccessStudent } = await import('@alfanumrik/lib/rbac');
    await expect(canAccessStudent(TEACHER_AUTH, STUDENT_CROSS)).resolves.toBe(true);
  });

  it('denies a student not enrolled in any of the teacher classes', async () => {
    const { canAccessStudent } = await import('@alfanumrik/lib/rbac');
    await expect(canAccessStudent(TEACHER_AUTH, STUDENT_OUTSIDE)).resolves.toBe(false);
  });

  it('denies a student whose enrollment is inactive', async () => {
    const { canAccessStudent } = await import('@alfanumrik/lib/rbac');
    await expect(canAccessStudent(TEACHER_AUTH, STUDENT_INACTIVE)).resolves.toBe(false);
  });
});

describe('POST /api/teacher/remediation — same canonical resolver, real route handler', () => {
  it('authorizes the home-school enrolled student (agrees with canAccessStudent)', async () => {
    const { POST } = await import('@/app/api/teacher/remediation/route');
    const res = await POST(makeRemediationPost(CLASS_A, STUDENT_HOME) as never);
    expect(res.status).toBe(201);
  });

  it('DENIES the cross-school student — documented divergence (curriculum school-scoping), not drift', async () => {
    const { POST } = await import('@/app/api/teacher/remediation/route');
    const res = await POST(makeRemediationPost(CLASS_B, STUDENT_CROSS) as never);
    expect(res.status).toBe(403);
  });

  it('denies a student not on the roster (agrees with canAccessStudent)', async () => {
    const { POST } = await import('@/app/api/teacher/remediation/route');
    const res = await POST(makeRemediationPost(CLASS_A, STUDENT_OUTSIDE) as never);
    expect(res.status).toBe(403);
  });

  it('denies a student with an inactive enrollment (agrees with canAccessStudent)', async () => {
    const { POST } = await import('@/app/api/teacher/remediation/route');
    const res = await POST(makeRemediationPost(CLASS_A, STUDENT_INACTIVE) as never);
    expect(res.status).toBe(403);
  });
});

describe('POST /api/teacher/parent-notify — same canonical resolver, real route handler', () => {
  it('authorizes the home-school enrolled student (agrees with canAccessStudent)', async () => {
    const { POST } = await import('@/app/api/teacher/parent-notify/route');
    const res = await POST(makeParentNotifyPost(STUDENT_HOME) as never);
    expect(await parentNotifyDeniedRoster(res)).toBe(false);
  });

  it('authorizes the cross-school student — agrees with canAccessStudent (no school gate), diverges from remediation', async () => {
    const { POST } = await import('@/app/api/teacher/parent-notify/route');
    const res = await POST(makeParentNotifyPost(STUDENT_CROSS) as never);
    expect(await parentNotifyDeniedRoster(res)).toBe(false);
  });

  it('denies a student not on the roster (agrees with canAccessStudent)', async () => {
    const { POST } = await import('@/app/api/teacher/parent-notify/route');
    const res = await POST(makeParentNotifyPost(STUDENT_OUTSIDE) as never);
    expect(await parentNotifyDeniedRoster(res)).toBe(true);
  });

  it('denies a student with an inactive enrollment (agrees with canAccessStudent)', async () => {
    const { POST } = await import('@/app/api/teacher/parent-notify/route');
    const res = await POST(makeParentNotifyPost(STUDENT_INACTIVE) as never);
    expect(await parentNotifyDeniedRoster(res)).toBe(true);
  });
});
