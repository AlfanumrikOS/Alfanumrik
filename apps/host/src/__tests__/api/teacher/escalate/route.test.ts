/**
 * T13 (Teacher Dashboard RCA follow-up) — POST /api/teacher/escalate contract tests.
 *
 * Mirrors the mocking approach in
 * `apps/host/src/__tests__/api/teacher/parent-notify/route.test.ts`: the
 * canonical `resolveTeacherIdentity`/`resolveTeacherRosterScope` resolvers run
 * for REAL against a mocked `supabaseAdmin`/`getSupabaseAdmin` in-memory store;
 * only `authorizeRequest` is stubbed.
 *
 * Pins:
 *   - Auth gate: 401/403 when authorizeRequest denies.
 *   - Validation: 400 on missing student_id / empty note.
 *   - Roster boundary (P8): a student NOT on the caller's roster -> 403, no
 *     notification row written.
 *   - No active school admin -> clean 409 { no_admin: true }, no row written.
 *   - Happy path: one `notifications` row PER active admin at the teacher's
 *     school, recipient_type='school_admin', sender_type='teacher',
 *     type='teacher_escalation', carrying student_id/class_id/note in `data`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuthorize } = vi.hoisted(() => ({ mockAuthorize: vi.fn() }));

vi.mock('@alfanumrik/lib/rbac', async () => {
  const actual = await vi.importActual<typeof import('@alfanumrik/lib/rbac')>('@alfanumrik/lib/rbac');
  return {
    ...actual,
    authorizeRequest: (...args: unknown[]) => mockAuthorize(...args),
  };
});

vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const TEACHER_AUTH_A = '11111111-aaaa-aaaa-aaaa-111111111111';
const TEACHER_ID_A   = '22222222-aaaa-aaaa-aaaa-222222222222';

const STUDENT_ID_X   = '55555555-cccc-cccc-cccc-555555555555'; // on roster
const STUDENT_OFF    = '55555555-ffff-ffff-ffff-555555555555'; // NOT on roster

const CLASS_ID       = '77777777-7777-7777-7777-777777777777';
const SCHOOL_ID      = '66666666-6666-6666-6666-666666666666';
const SCHOOL_NO_ADMIN = '66666666-6666-6666-6666-999999999999';

const ADMIN_ID_1     = '99999999-1111-1111-1111-111111111111';
const ADMIN_ID_2     = '99999999-2222-2222-2222-222222222222';

type Row = Record<string, unknown>;

let teachers: Array<{ id: string; auth_user_id: string; school_id: string | null; is_active: boolean }>;
let students: Array<{ id: string; name: string; grade: string | null }>;
let classTeachers: Array<{ teacher_id: string; class_id: string; is_active: boolean }>;
let classEnrollments: Array<{ class_id: string; student_id: string; is_active: boolean }>;
let schoolAdmins: Array<{ id: string; school_id: string; is_active: boolean }>;
let notifications: Row[];

let idCounter = 0;
const newId = () => `aaaaaaaa-0000-0000-0000-${String(++idCounter).padStart(12, '0')}`;

function resetStore() {
  idCounter = 0;
  teachers = [{ id: TEACHER_ID_A, auth_user_id: TEACHER_AUTH_A, school_id: SCHOOL_ID, is_active: true }];
  students = [
    { id: STUDENT_ID_X, name: 'Aarav Sharma', grade: '7' },
    { id: STUDENT_OFF, name: 'Other Kid', grade: '7' },
  ];
  classTeachers = [{ teacher_id: TEACHER_ID_A, class_id: CLASS_ID, is_active: true }];
  classEnrollments = [{ class_id: CLASS_ID, student_id: STUDENT_ID_X, is_active: true }];
  schoolAdmins = [
    { id: ADMIN_ID_1, school_id: SCHOOL_ID, is_active: true },
    { id: ADMIN_ID_2, school_id: SCHOOL_ID, is_active: true },
  ];
  notifications = [];
}

function makeBuilder(tableRows: () => Row[], onInsert?: (rows: Row[]) => Row[]) {
  function selectBuilder() {
    const filters: Array<(r: Row) => boolean> = [];
    let limitN: number | null = null;
    const apply = () => {
      let out = tableRows().filter((r) => filters.every((p) => p(r)));
      if (limitN !== null) out = out.slice(0, limitN);
      return out;
    };
    const chain = {
      eq(col: string, val: unknown) { filters.push((r) => r[col] === val); return chain; },
      in(col: string, vals: unknown[]) { filters.push((r) => vals.includes(r[col])); return chain; },
      limit(n: number) { limitN = n; return chain; },
      async maybeSingle() { const r = apply(); return { data: r[0] ?? null, error: null }; },
      then<T = { data: Row[]; error: null }>(...args: Parameters<Promise<T>['then']>) {
        return Promise.resolve({ data: apply(), error: null } as unknown as T).then(...args);
      },
    };
    return chain;
  }
  function insertChain(rowsToInsert: Row | Row[]) {
    const arr = Array.isArray(rowsToInsert) ? rowsToInsert : [rowsToInsert];
    const inserted = (onInsert?.(arr) ?? []) as Row[];
    return {
      select() {
        return {
          async single() {
            return inserted[0] ? { data: inserted[0], error: null } : { data: null, error: { message: 'insert failed' } };
          },
          then<T = { data: Row[]; error: null }>(...args: Parameters<Promise<T>['then']>) {
            return Promise.resolve({ data: inserted, error: null } as unknown as T).then(...args);
          },
        };
      },
    };
  }
  return {
    select() { return selectBuilder(); },
    insert(r: Row | Row[]) { return insertChain(r); },
  };
}

vi.mock('@alfanumrik/lib/supabase-admin', () => {
  const mockSupabaseAdmin = {
    from(table: string) {
      switch (table) {
        case 'teachers':          return makeBuilder(() => teachers as unknown as Row[]);
        case 'students':          return makeBuilder(() => students as unknown as Row[]);
        case 'class_teachers':    return makeBuilder(() => classTeachers as unknown as Row[]);
        case 'class_enrollments': return makeBuilder(() => classEnrollments as unknown as Row[]);
        case 'school_admins':     return makeBuilder(() => schoolAdmins as unknown as Row[]);
        case 'notifications':
          return makeBuilder(
            () => notifications,
            (rows) => {
              const inserted: Row[] = [];
              for (const r of rows) { const row = { id: newId(), ...r }; notifications.push(row); inserted.push(row); }
              return inserted;
            },
          );
        default:
          throw new Error(`unexpected table: ${table}`);
      }
    },
    rpc: vi.fn(),
  };
  return {
    supabaseAdmin: mockSupabaseAdmin,
    getSupabaseAdmin: () => mockSupabaseAdmin,
  };
});

import { POST } from '@/app/api/teacher/escalate/route';

function authedAs(authUserId: string, permissions: string[]) {
  mockAuthorize.mockResolvedValue({
    authorized: true,
    userId: authUserId,
    studentId: null,
    roles: ['teacher'],
    permissions,
  });
}
function unauthorized(status = 403) {
  mockAuthorize.mockResolvedValue({
    authorized: false,
    userId: null,
    studentId: null,
    roles: [],
    permissions: [],
    errorResponse: new Response(JSON.stringify({ success: false, error: 'Forbidden' }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  });
}
function postRequest(body: unknown): Request {
  return new Request('http://localhost/api/teacher/escalate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  resetStore();
});

describe('POST /api/teacher/escalate — auth', () => {
  it('returns 403 when the auth gate denies (no class.manage)', async () => {
    unauthorized(403);
    const res = await POST(postRequest({ student_id: STUDENT_ID_X, note: 'concern' }) as never);
    expect(res.status).toBe(403);
    expect(notifications).toHaveLength(0);
  });

  it('propagates a 401 from the auth gate', async () => {
    unauthorized(401);
    const res = await POST(postRequest({ student_id: STUDENT_ID_X, note: 'concern' }) as never);
    expect(res.status).toBe(401);
  });

  it('checks the class.manage permission (NOT a new permission)', async () => {
    authedAs(TEACHER_AUTH_A, ['class.manage']);
    await POST(postRequest({ student_id: STUDENT_ID_X, note: 'concern' }) as never);
    expect(mockAuthorize).toHaveBeenCalledWith(expect.anything(), 'class.manage');
  });
});

describe('POST /api/teacher/escalate — validation', () => {
  it('400 on a missing/invalid student_id', async () => {
    authedAs(TEACHER_AUTH_A, ['class.manage']);
    const res = await POST(postRequest({ note: 'concern' }) as never);
    expect(res.status).toBe(400);
  });

  it('400 on an empty note', async () => {
    authedAs(TEACHER_AUTH_A, ['class.manage']);
    const res = await POST(postRequest({ student_id: STUDENT_ID_X, note: '   ' }) as never);
    expect(res.status).toBe(400);
  });
});

describe('POST /api/teacher/escalate — roster boundary (P8)', () => {
  it('403 when the student is not on the caller-teacher roster (no write)', async () => {
    authedAs(TEACHER_AUTH_A, ['class.manage']);
    const res = await POST(postRequest({ student_id: STUDENT_OFF, note: 'concern' }) as never);
    expect(res.status).toBe(403);
    expect(notifications).toHaveLength(0);
  });

  it('403 when the caller has no teacher row', async () => {
    authedAs('00000000-0000-0000-0000-000000000000', ['class.manage']);
    const res = await POST(postRequest({ student_id: STUDENT_ID_X, note: 'concern' }) as never);
    expect(res.status).toBe(403);
  });
});

describe('POST /api/teacher/escalate — no active school admin', () => {
  it('returns 409 { no_admin: true } and writes NO notification', async () => {
    authedAs(TEACHER_AUTH_A, ['class.manage']);
    teachers[0].school_id = SCHOOL_NO_ADMIN;
    const res = await POST(postRequest({ student_id: STUDENT_ID_X, note: 'concern' }) as never);
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.no_admin).toBe(true);
    expect(notifications).toHaveLength(0);
  });
});

describe('POST /api/teacher/escalate — happy path', () => {
  it('writes ONE notification row per ACTIVE school admin, addressed correctly', async () => {
    authedAs(TEACHER_AUTH_A, ['class.manage']);
    const res = await POST(postRequest({ student_id: STUDENT_ID_X, note: 'Falling behind in Math' }) as never);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.notified_admin_count).toBe(2);

    expect(notifications).toHaveLength(2);
    const recipientIds = notifications.map((n) => n.recipient_id).sort();
    expect(recipientIds).toEqual([ADMIN_ID_1, ADMIN_ID_2].sort());
    for (const n of notifications) {
      expect(n.recipient_type).toBe('school_admin');
      expect(n.sender_type).toBe('teacher');
      expect(n.sender_id).toBe(TEACHER_ID_A);
      expect(n.type).toBe('teacher_escalation');
      expect((n.data as Record<string, unknown>).student_id).toBe(STUDENT_ID_X);
      expect((n.data as Record<string, unknown>).class_id).toBe(CLASS_ID);
      expect((n.message as string)).toContain('Falling behind in Math');
    }
  });

  it('skips an INACTIVE school admin', async () => {
    authedAs(TEACHER_AUTH_A, ['class.manage']);
    schoolAdmins[1].is_active = false;
    const res = await POST(postRequest({ student_id: STUDENT_ID_X, note: 'concern' }) as never);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.notified_admin_count).toBe(1);
    expect(notifications[0].recipient_id).toBe(ADMIN_ID_1);
  });
});
