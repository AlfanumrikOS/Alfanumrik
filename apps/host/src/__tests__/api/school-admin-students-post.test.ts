/**
 * POST /api/school-admin/students — Phase B.1 contract tests
 *
 * Pins:
 *   - Single create: 201 + student_id + remaining_seats; audit fires.
 *   - 403 when caller is not a school-admin (auth gate denies).
 *   - 403 when class_id belongs to a different school (cross-tenant rejection).
 *   - 409 + seat_cap_violation when active+1 would exceed seats_purchased.
 *   - Bulk JSON: 3 rows, 1 invalid email → created=2, errors length 1.
 *   - Bulk JSON: 1001-row payload rejected (413).
 *   - school_id is HARD-CODED from auth.schoolId, never read from body.
 *   - Logger silenced.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Hoisted mocks ────────────────────────────────────────────────────
const { mockAuthorize, mockCapture, mockLogSchoolAudit } = vi.hoisted(() => ({
  mockAuthorize: vi.fn(),
  mockCapture: vi.fn().mockResolvedValue(undefined),
  mockLogSchoolAudit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@alfanumrik/lib/school-admin-auth', () => ({
  authorizeSchoolAdmin: (...args: unknown[]) => mockAuthorize(...args),
}));
vi.mock('@alfanumrik/lib/posthog/server', () => ({
  capture: (...args: unknown[]) => mockCapture(...args),
}));
vi.mock('@alfanumrik/lib/audit', () => ({
  logSchoolAudit: (...args: unknown[]) => mockLogSchoolAudit(...args),
}));
vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ getAll: () => [] })),
}));

// ── Supabase chain mock ──────────────────────────────────────────────
// The route exercises these chains:
//   from('students')
//     .select('id', { count: 'exact', head: true }).eq().eq()        — seat count
//     .select('id').eq('email', …).maybeSingle()                     — email dedupe
//     .update({ school_id, phone? }).eq('auth_user_id', …)
//        .select('id').single()                                      — attach trigger row
//   from('school_subscriptions')
//     .select('seats_purchased').eq('school_id', …).maybeSingle()    — quota
//   from('classes')
//     .select('id, school_id').eq('id', …).maybeSingle()             — cross-tenant gate
//   from('class_students').insert({…})                               — class link
//   createSchoolAdminStudentAuthUser({…})                             — auth user
//
// We dispatch by what the route asks for. State knobs live on `state`.

interface SupabaseState {
  activeCount: number;
  seatsPurchased: number | null;
  existingEmail: string | null; // when set, email-dedup returns a hit
  classRow: { id: string; school_id: string } | null;
  authCreate: { id: string } | { error: string };
  studentRowAfterUpdate: { id: string } | null;
}

const SCHOOL_ID = '00000000-0000-0000-0000-000000000aaa';
const OTHER_SCHOOL_ID = '00000000-0000-0000-0000-000000000fff';
const ADMIN_USER = '00000000-0000-0000-0000-000000000099';
const NEW_STUDENT_ID = '00000000-0000-0000-0000-000000000111';
const NEW_AUTH_USER_ID = '00000000-0000-0000-0000-000000000222';

let state: SupabaseState;

function freshState(overrides: Partial<SupabaseState> = {}): SupabaseState {
  return {
    activeCount: 10,
    seatsPurchased: 50,
    existingEmail: null,
    classRow: null,
    authCreate: { id: NEW_AUTH_USER_ID },
    studentRowAfterUpdate: { id: NEW_STUDENT_ID },
    ...overrides,
  };
}

// classInsertCalls captures inserts into class_students for assertions.
const classInsertCalls: unknown[] = [];
const attachRpcCalls: unknown[] = [];
const preflightRpcCalls: unknown[] = [];
const authCreateCalls: unknown[] = [];

function makeSupabase() {
  return {
    from: (table: string) => {
      if (table === 'students') return studentsBuilder();
      if (table === 'school_subscriptions') return subscriptionBuilder();
      if (table === 'classes') return classesBuilder();
      if (table === 'class_students') return {
        insert: (payload: unknown) => {
          classInsertCalls.push(payload);
          return Promise.resolve({ data: null, error: null });
        },
      };
      throw new Error(`unexpected table: ${table}`);
    },
  };
}

function studentsBuilder() {
  return {
    select: (cols: string, opts?: { count?: string; head?: boolean }) => {
      // ── Seat-count: head:true ─────────────────────
      if (opts?.head) {
        return {
          eq: () => ({
            eq: () => Promise.resolve({ count: state.activeCount, error: null }),
          }),
        };
      }
      // ── Email dedupe OR post-update select ────────
      // Distinguish by what comes next: dedupe ends in .maybeSingle(); the
      // update chain ends in .single(). We don't know which yet — return a
      // proxy that supports both.
      return {
        eq: (_col: string, _val: unknown) => ({
          maybeSingle: async () => ({
            data: state.existingEmail ? { id: 'existing-id' } : null,
            error: null,
          }),
          single: async () => ({
            data: state.studentRowAfterUpdate,
            error: state.studentRowAfterUpdate ? null : { message: 'no row' },
          }),
        }),
      };
    },
    update: (_patch: Record<string, unknown>) => ({
      eq: () => ({
        select: () => ({
          single: async () => ({
            data: state.studentRowAfterUpdate,
            error: state.studentRowAfterUpdate ? null : { message: 'no row' },
          }),
        }),
      }),
    }),
  };
}

function subscriptionBuilder() {
  return {
    select: () => ({
      eq: () => ({
        maybeSingle: async () => ({
          data:
            state.seatsPurchased === null
              ? null
              : { seats_purchased: state.seatsPurchased },
          error: null,
        }),
      }),
    }),
  };
}

function classesBuilder() {
  return {
    select: () => ({
      eq: () => ({
        maybeSingle: async () => ({ data: state.classRow, error: null }),
      }),
    }),
  };
}

vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => makeSupabase(),
}));
vi.mock('@alfanumrik/lib/school-admin/student-auth-admin', () => ({
  createSchoolAdminStudentAuthUser: vi.fn(async () => {
    authCreateCalls.push(true);
    if ('error' in state.authCreate) {
      return { ok: false, message: state.authCreate.error };
    }
    return { ok: true, authUserId: state.authCreate.id };
  }),
}));
vi.mock('@supabase/ssr', () => ({
  createServerClient: vi.fn(() => ({
    rpc: vi.fn(async (name: string, params: Record<string, unknown>) => {
      if (name === 'school_admin_student_create_preflight') {
        preflightRpcCalls.push(params);
        const attemptedCount = Number(params.p_attempted_count ?? 1);
        const seatsPurchased = state.seatsPurchased;
        if (
          params.p_class_id &&
          (!state.classRow || state.classRow.school_id !== SCHOOL_ID)
        ) {
          return {
            data: {
              success: false,
              status: 403,
              error: 'class_id does not belong to your school',
            },
            error: null,
          };
        }
        return {
          data: {
            success: true,
            data: {
              emailExists: state.existingEmail === params.p_email,
              seatsUsed: state.activeCount,
              seatsPurchased,
              seatCapViolation:
                seatsPurchased !== null && state.activeCount + attemptedCount > seatsPurchased,
            },
          },
          error: null,
        };
      }
      if (name !== 'school_admin_attach_created_student') {
        return { data: null, error: { message: `unexpected rpc ${name}` } };
      }
      attachRpcCalls.push(params);
      if (!state.studentRowAfterUpdate) {
        return {
          data: { success: false, status: 500, error: 'Failed to attach student to school' },
          error: null,
        };
      }
      return {
        data: {
          success: true,
          data: { studentId: state.studentRowAfterUpdate.id },
        },
        error: null,
      };
    }),
  })),
}));

// ── Route under test ─────────────────────────────────────────────────
import { POST } from '@/app/api/school-admin/students/route';

// ── Helpers ──────────────────────────────────────────────────────────
function authedAs(schoolId: string = SCHOOL_ID) {
  mockAuthorize.mockResolvedValue({
    authorized: true,
    schoolId,
    userId: ADMIN_USER,
    schoolAdminId: 'admin-row-id',
  });
}

function unauthorized(status = 403) {
  mockAuthorize.mockResolvedValue({
    authorized: false,
    schoolId: null,
    userId: null,
    schoolAdminId: null,
    errorResponse: new Response(
      JSON.stringify({ success: false, error: 'Not a school administrator' }),
      { status, headers: { 'Content-Type': 'application/json' } },
    ),
  });
}

function makeJsonRequest(body: unknown, query = ''): Request {
  return new Request(`http://localhost/api/school-admin/students${query}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function makeCsvRequest(csv: string): Request {
  return {
    url: 'http://localhost/api/school-admin/students',
    headers: new Headers({ 'content-type': 'multipart/form-data; boundary=test' }),
    formData: async () => ({
      get: (name: string) =>
        name === 'file'
          ? {
              name: 'students.csv',
              size: new TextEncoder().encode(csv).byteLength,
              text: async () => csv,
            }
          : null,
    }),
  } as unknown as Request;
}

beforeEach(() => {
  vi.clearAllMocks();
  classInsertCalls.length = 0;
  attachRpcCalls.length = 0;
  preflightRpcCalls.length = 0;
  authCreateCalls.length = 0;
  state = freshState();
});

// ── Tests ────────────────────────────────────────────────────────────

describe('POST /api/school-admin/students — single create', () => {
  it('returns 201 with student_id and remaining_seats on happy path', async () => {
    authedAs();
    const res = await POST(
      makeJsonRequest({
        name: 'Anika Sharma',
        email: 'anika@school.edu',
        grade: '8',
      }) as never,
    );
    expect(res.status).toBe(201);
    const json = (await res.json()) as {
      success: boolean;
      data?: { student_id: string; remaining_seats: number | null };
    };
    expect(json.success).toBe(true);
    expect(json.data?.student_id).toBe(NEW_STUDENT_ID);
    // seats: used 10 + 1 new = 11, purchased 50 → 39 remaining
    expect(json.data?.remaining_seats).toBe(39);
    expect(preflightRpcCalls[0]).toMatchObject({
      p_email: 'anika@school.edu',
      p_attempted_count: 1,
    });
    expect(mockLogSchoolAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        schoolId: SCHOOL_ID,
        action: 'student.invited',
        resourceId: NEW_STUDENT_ID,
      }),
    );
    expect(attachRpcCalls[0]).toMatchObject({
      p_student_auth_user_id: NEW_AUTH_USER_ID,
      p_phone: null,
      p_class_id: null,
    });
  });

  it('returns 403 when the caller is not a school admin', async () => {
    unauthorized();
    const res = await POST(
      makeJsonRequest({ name: 'X', email: 'x@x.com', grade: '8' }) as never,
    );
    expect(res.status).toBe(403);
    // The auth gate should short-circuit BEFORE any Supabase work.
    expect(mockLogSchoolAudit).not.toHaveBeenCalled();
  });

  it('returns 403 when class_id belongs to a different school', async () => {
    authedAs();
    state = freshState({
      classRow: { id: 'class-x', school_id: OTHER_SCHOOL_ID }, // different school
    });
    const res = await POST(
      makeJsonRequest({
        name: 'Anika Sharma',
        email: 'anika@school.edu',
        grade: '8',
        class_id: 'class-x',
      }) as never,
    );
    expect(res.status).toBe(403);
    const json = (await res.json()) as { error: string };
    expect(json.error).toMatch(/class_id/i);
    // No Auth user or student attach should happen before the scoped preflight rejects.
    expect(mockLogSchoolAudit).not.toHaveBeenCalled();
    expect(authCreateCalls).toHaveLength(0);
    expect(classInsertCalls).toHaveLength(0);
    expect(attachRpcCalls).toHaveLength(0);
    expect(preflightRpcCalls).toEqual([
      {
        p_email: 'anika@school.edu',
        p_attempted_count: 1,
        p_class_id: 'class-x',
      },
    ]);
  });

  it('returns 409 with seat_cap_violation when seat cap is hit', async () => {
    authedAs();
    state = freshState({ activeCount: 50, seatsPurchased: 50 }); // full
    const res = await POST(
      makeJsonRequest({
        name: 'Anika Sharma',
        email: 'anika@school.edu',
        grade: '8',
      }) as never,
    );
    expect(res.status).toBe(409);
    const json = (await res.json()) as {
      code?: string;
      seats_used?: number;
      seats_purchased?: number;
    };
    expect(json.code).toBe('seat_cap_violation');
    expect(json.seats_used).toBe(50);
    expect(json.seats_purchased).toBe(50);
    expect(mockCapture).toHaveBeenCalledWith(
      'school_seat_cap_hit',
      ADMIN_USER,
      // Reuses the existing 'student_add' source — see SchoolSeatCapHitPayload.
      expect.objectContaining({ source: 'student_add' }),
    );
    expect(mockLogSchoolAudit).not.toHaveBeenCalled();
  });

  it('returns duplicate-email validation from scoped preflight before auth creation', async () => {
    authedAs();
    state = freshState({ existingEmail: 'anika@school.edu' });

    const res = await POST(
      makeJsonRequest({
        name: 'Anika Sharma',
        email: 'anika@school.edu',
        grade: '8',
      }) as never,
    );

    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    expect(json.error).toMatch(/already exists/i);
    expect(attachRpcCalls).toHaveLength(0);
    expect(preflightRpcCalls).toHaveLength(1);
  });

  it('rejects an invalid email at the validation gate (400)', async () => {
    authedAs();
    const res = await POST(
      makeJsonRequest({
        name: 'Anika',
        email: 'not-an-email',
        grade: '8',
      }) as never,
    );
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    expect(json.error).toMatch(/email/i);
  });

  it('ignores any school_id in the body and uses the caller school_id', async () => {
    authedAs();
    const res = await POST(
      makeJsonRequest({
        name: 'Anika',
        email: 'anika2@school.edu',
        grade: '8',
        // Hostile field; must be ignored by the route.
        school_id: OTHER_SCHOOL_ID,
      }) as never,
    );
    expect(res.status).toBe(201);
    // The audit entry pins schoolId from auth, NOT the body.
    expect(mockLogSchoolAudit).toHaveBeenCalledWith(
      expect.objectContaining({ schoolId: SCHOOL_ID }),
    );
  });
});

describe('POST /api/school-admin/students — bulk JSON', () => {
  it('processes a mixed batch: 2 valid + 1 invalid email → created=2, errors=1', async () => {
    authedAs();
    state = freshState({ activeCount: 0, seatsPurchased: 50 });

    const res = await POST(
      makeJsonRequest({
        rows: [
          { name: 'A One', email: 'a1@school.edu', grade: '6' },
          { name: 'B Two', email: 'bad-email', grade: '7' },
          { name: 'C Three', email: 'c3@school.edu', grade: '8' },
        ],
      }) as never,
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      data?: { created: number; errors: Array<{ row: number; message: string }> };
    };
    expect(json.data?.created).toBe(2);
    expect(json.data?.errors).toHaveLength(1);
    expect(json.data?.errors[0].row).toBe(3); // CSV-style: header is row 1
    expect(json.data?.errors[0].message).toMatch(/email/i);
  });

  it('rejects a 1001-row payload up-front (413)', async () => {
    authedAs();
    const rows = Array.from({ length: 1001 }, (_, i) => ({
      name: `Student ${i}`,
      email: `s${i}@school.edu`,
      grade: '8',
    }));
    const res = await POST(makeJsonRequest({ rows }) as never);
    expect(res.status).toBe(413);
    const json = (await res.json()) as { error: string };
    expect(json.error).toMatch(/1000/);
    // No Supabase writes attempted.
    expect(mockLogSchoolAudit).not.toHaveBeenCalled();
  });
});

describe('POST /api/school-admin/students — bulk CSV', () => {
  it('parses quoted commas and quoted newlines as one student row', async () => {
    authedAs();
    state = freshState({ activeCount: 0, seatsPurchased: 50 });

    const csv = [
      'name,email,grade,phone',
      '"Sharma, Asha",asha@school.edu,8,"line one',
      'line two"',
    ].join('\n');

    const res = await POST(makeCsvRequest(csv) as never);

    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      data?: {
        created: number;
        total_rows: number;
        errors: Array<{ row: number; message: string }>;
        error_count: number;
      };
    };
    expect(json.data?.created).toBe(1);
    expect(json.data?.total_rows).toBe(1);
    expect(json.data?.errors).toEqual([]);
    expect(json.data?.error_count).toBe(0);
  });
});
