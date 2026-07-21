/**
 * GET /api/teacher/students — roster-read contract (Task T6, teacher-dashboard
 * deep RCA, 2026-07-20).
 *
 * Asserts:
 *  1. The route returns exactly the student set `canAccessStudent` would
 *     authorize for the same teacher (both delegate to the same canonical
 *     resolver — resolveTeacherIdentity + resolveTeacherRosterScope).
 *  2. Tenant isolation: a teacher who teaches classes in TWO different
 *     schools only ever sees students enrolled in THEIR OWN active classes
 *     (never students from an unrelated class/teacher/school).
 *  3. Non-teacher roles (missing `class.manage`) get 403 from
 *     `authorizeRequest` before any roster query runs.
 *  4. An inactive enrollment is excluded (mirrors canAccessStudent).
 *  5. `?classId=` scopes the result to just that class and 403s for a class
 *     the caller-teacher doesn't own.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const TEACHER_AUTH = '11111111-1111-4111-a111-111111111111';
const TEACHER_ID = '22222222-2222-4222-a222-222222222222';
const SCHOOL_A = '33333333-3333-4333-a333-333333333333';
const SCHOOL_B = '44444444-4444-4444-a444-444444444444';
const CLASS_A = '55555555-5555-4555-a555-555555555555'; // teacher's own class, school A
const CLASS_B = '66666666-6666-4666-a666-666666666666'; // teacher's own class, school B
const CLASS_OTHER = 'cccccccc-cccc-4ccc-accc-cccccccccccc'; // NOT this teacher's class
const STUDENT_A = '77777777-7777-4777-a777-777777777777'; // enrolled in CLASS_A
const STUDENT_B = '88888888-8888-4888-a888-888888888888'; // enrolled in CLASS_B
const STUDENT_OUTSIDE = '99999999-9999-4999-a999-999999999999'; // not enrolled anywhere the teacher owns
const STUDENT_INACTIVE = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'; // enrolled but is_active=false
const STUDENT_OTHER_TEACHER = 'bbbbbbbb-bbbb-4bbb-abbb-bbbbbbbbbbbb'; // enrolled in a class this teacher does NOT teach

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
      { id: 'cccccccc-cccc-4ccc-accc-cccccccccccc', school_id: '44444444-4444-4444-a444-444444444444', grade: '8', subject: 'Science', is_active: true, deleted_at: null },
    ],
    class_enrollments: [
      { class_id: '55555555-5555-4555-a555-555555555555', student_id: '77777777-7777-4777-a777-777777777777', is_active: true },
      { class_id: '66666666-6666-4666-a666-666666666666', student_id: '88888888-8888-4888-a888-888888888888', is_active: true },
      { class_id: '55555555-5555-4555-a555-555555555555', student_id: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa', is_active: false },
      { class_id: 'cccccccc-cccc-4ccc-accc-cccccccccccc', student_id: 'bbbbbbbb-bbbb-4bbb-abbb-bbbbbbbbbbbb', is_active: true },
    ],
    students: [
      { id: '77777777-7777-4777-a777-777777777777', school_id: '33333333-3333-4333-a333-333333333333', is_active: true, deleted_at: null, auth_user_id: null, name: 'Home Student', grade: '7', xp_total: 100, streak_days: 3 },
      { id: '88888888-8888-4888-a888-888888888888', school_id: '44444444-4444-4444-a444-444444444444', is_active: true, deleted_at: null, auth_user_id: null, name: 'Cross School Student', grade: '8', xp_total: 200, streak_days: 5 },
      { id: '99999999-9999-4999-a999-999999999999', school_id: '33333333-3333-4333-a333-333333333333', is_active: true, deleted_at: null, auth_user_id: null, name: 'Outside Student', grade: '7', xp_total: 0, streak_days: 0 },
      { id: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa', school_id: '33333333-3333-4333-a333-333333333333', is_active: true, deleted_at: null, auth_user_id: null, name: 'Inactive Enrollment Student', grade: '7', xp_total: 0, streak_days: 0 },
      { id: 'bbbbbbbb-bbbb-4bbb-abbb-bbbbbbbbbbbb', school_id: '44444444-4444-4444-a444-444444444444', is_active: true, deleted_at: null, auth_user_id: null, name: 'Other Teacher Student', grade: '8', xp_total: 0, streak_days: 0 },
    ],
    guardians: [],
    guardian_student_links: [],
    teacher_student_notes: [
      { teacher_id: '22222222-2222-4222-a222-222222222222', student_id: '77777777-7777-4777-a777-777777777777', note: 'Doing well', custom_goal: 'Finish algebra' },
    ],
  };

  function queryBuilder(table: string) {
    const filters: Array<(r: Record<string, unknown>) => boolean> = [];
    const rowsFor = () => TABLES[table] ?? (TABLES[table] = []);
    const applyFilters = () => rowsFor().filter((r) => filters.every((f) => f(r)));

    const api: Record<string, unknown> = {
      select() { return api; },
      eq(col: string, val: unknown) { filters.push((r) => r[col] === val); return api; },
      in(col: string, vals: unknown[]) { filters.push((r) => vals.includes(r[col])); return api; },
      is(col: string, val: unknown) { filters.push((r) => (r[col] ?? null) === val); return api; },
      not() { return api; },
      order() { return api; },
      limit() { return api; },
      maybeSingle: async () => {
        const matched = applyFilters();
        return { data: matched[0] ?? null, error: null };
      },
      single: async () => {
        const matched = applyFilters();
        return { data: matched[0] ?? null, error: null };
      },
      then(resolve: (v: { data: unknown; error: unknown }) => unknown) {
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
          data: { roles: [{ name: 'teacher' }], permissions: ['class.manage'] },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: { message: `unmocked rpc: ${name}` } });
    },
  };

  return { client, mockAuthorize: vi.fn() };
});

vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  supabaseAdmin: holders.client,
  getSupabaseAdmin: () => holders.client,
}));

vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('@alfanumrik/lib/rbac', async () => {
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
    permissions: ['class.manage'],
  });
}

function authAsForbidden() {
  holders.mockAuthorize.mockResolvedValue({
    authorized: false,
    userId: null,
    studentId: null,
    roles: [],
    permissions: [],
    errorResponse: new Response(JSON.stringify({ error: 'Forbidden', code: 'PERMISSION_DENIED' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    }),
  });
}

function makeRequest(query = ''): Request {
  return new Request(`http://localhost/api/teacher/students${query}`, {
    headers: { Authorization: 'Bearer fake.jwt' },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  authAsTeacher();
});

describe('GET /api/teacher/students — canonical roster contract', () => {
  it('agrees with canAccessStudent: returns the home-school student', async () => {
    const { GET } = await import('@/app/api/teacher/students/route');
    const { canAccessStudent } = await import('@alfanumrik/lib/rbac');
    const res = await GET(makeRequest() as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    const ids = (body.data as Array<{ id: string }>).map((s) => s.id);
    expect(ids).toContain(STUDENT_A);
    await expect(canAccessStudent(TEACHER_AUTH, STUDENT_A)).resolves.toBe(true);
  });

  it('tenant isolation: sees own students across BOTH schools it teaches in', async () => {
    const { GET } = await import('@/app/api/teacher/students/route');
    const res = await GET(makeRequest() as never);
    const body = await res.json();
    const ids = (body.data as Array<{ id: string }>).map((s) => s.id);
    expect(ids).toEqual(expect.arrayContaining([STUDENT_A, STUDENT_B]));
  });

  it('tenant isolation: never returns a student from a class this teacher does not teach', async () => {
    const { GET } = await import('@/app/api/teacher/students/route');
    const { canAccessStudent } = await import('@alfanumrik/lib/rbac');
    const res = await GET(makeRequest() as never);
    const body = await res.json();
    const ids = (body.data as Array<{ id: string }>).map((s) => s.id);
    expect(ids).not.toContain(STUDENT_OTHER_TEACHER);
    expect(ids).not.toContain(STUDENT_OUTSIDE);
    await expect(canAccessStudent(TEACHER_AUTH, STUDENT_OTHER_TEACHER)).resolves.toBe(false);
    await expect(canAccessStudent(TEACHER_AUTH, STUDENT_OUTSIDE)).resolves.toBe(false);
  });

  it('excludes a student whose enrollment is inactive (agrees with canAccessStudent)', async () => {
    const { GET } = await import('@/app/api/teacher/students/route');
    const { canAccessStudent } = await import('@alfanumrik/lib/rbac');
    const res = await GET(makeRequest() as never);
    const body = await res.json();
    const ids = (body.data as Array<{ id: string }>).map((s) => s.id);
    expect(ids).not.toContain(STUDENT_INACTIVE);
    await expect(canAccessStudent(TEACHER_AUTH, STUDENT_INACTIVE)).resolves.toBe(false);
  });

  it('scopes to a single class via ?classId= and includes the note/customGoal', async () => {
    const { GET } = await import('@/app/api/teacher/students/route');
    const res = await GET(makeRequest(`?classId=${CLASS_A}`) as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    const ids = (body.data as Array<{ id: string }>).map((s) => s.id);
    expect(ids).toEqual([STUDENT_A]);
    const student = body.data[0];
    expect(student.classIds).toEqual([CLASS_A]);
    expect(student.note).toBe('Doing well');
    expect(student.customGoal).toBe('Finish algebra');
  });

  it('403s when ?classId= is a class this teacher does not own', async () => {
    const { GET } = await import('@/app/api/teacher/students/route');
    const res = await GET(makeRequest(`?classId=${CLASS_OTHER}`) as never);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(typeof body.error).toBe('string');
  });

  it('400s on a malformed classId', async () => {
    const { GET } = await import('@/app/api/teacher/students/route');
    const res = await GET(makeRequest('?classId=not-a-uuid') as never);
    expect(res.status).toBe(400);
  });

  it('403s for a non-teacher / missing-permission caller before any roster query runs', async () => {
    authAsForbidden();
    const { GET } = await import('@/app/api/teacher/students/route');
    const res = await GET(makeRequest() as never);
    expect(res.status).toBe(403);
  });
});
