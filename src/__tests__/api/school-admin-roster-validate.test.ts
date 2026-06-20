/**
 * POST /api/school-admin/roster/validate — Track A.4 DRY-RUN contract tests
 *
 * Pins:
 *   - NO DB WRITES occur — no insert/upsert/update mock is ever called, and no
 *     student/teacher/class row is created. Only reads (existing classes) + the
 *     seat-capacity probe run.
 *   - Row-level errors surfaced: bad grade, malformed email, missing/unknown
 *     class, duplicate-in-batch.
 *   - Seat preview returns needed vs remaining + will_exceed.
 *   - Tenant isolation — class-ref resolution reads only the auth school.
 *   - Auth gate (P9) with permission institution.manage_students.
 *   - P13 — logger carries counts only, never PII.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mockAuthorize, mockLoggerInfo, mockProbe } = vi.hoisted(() => ({
  mockAuthorize: vi.fn(),
  mockLoggerInfo: vi.fn(),
  mockProbe: vi.fn(),
}));

vi.mock('@/lib/school-admin-auth', () => ({
  authorizeSchoolAdmin: (...a: unknown[]) => mockAuthorize(...a),
}));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: (...a: unknown[]) => mockLoggerInfo(...a) },
}));
vi.mock('@/lib/school-admin/bulk-roster', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/school-admin/bulk-roster')>();
  return {
    ...actual,
    probeSeatCapacity: (...a: unknown[]) => mockProbe(...a),
    loadClassIndex: async () => ({
      bySection: new Map([['A', 'class-a'], ['B', 'class-b']]),
      byCode: new Map<string, string>(),
    }),
  };
});

const SCHOOL_ID = '00000000-0000-0000-0000-000000000aaa';
const OTHER_SCHOOL_ID = '00000000-0000-0000-0000-000000000fff';
const ADMIN_USER = '00000000-0000-0000-0000-000000000099';

// WRITE PROBES: these MUST never be called in a dry-run.
const writeProbe = {
  insert: vi.fn(() => {
    throw new Error('DRY-RUN VIOLATION: insert called');
  }),
  upsert: vi.fn(() => {
    throw new Error('DRY-RUN VIOLATION: upsert called');
  }),
  update: vi.fn(() => {
    throw new Error('DRY-RUN VIOLATION: update called');
  }),
};
const eqCalls: Array<{ col: string; val: unknown }> = [];

function classesBuilder() {
  return {
    select: () => ({
      eq: (col: string, val: unknown) => {
        eqCalls.push({ col, val });
        return { is: () => Promise.resolve({ data: [], error: null }) };
      },
    }),
    insert: writeProbe.insert,
    upsert: writeProbe.upsert,
    update: writeProbe.update,
  };
}

vi.mock('@/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => ({
    auth: {
      admin: {
        createUser: vi.fn(() => {
          throw new Error('DRY-RUN VIOLATION: createUser called');
        }),
      },
    },
    from: (table: string) => {
      if (table === 'classes') return classesBuilder();
      // Any other table in a dry-run is a write surface → fail loudly.
      return {
        insert: writeProbe.insert,
        upsert: writeProbe.upsert,
        update: writeProbe.update,
        select: () => ({ eq: () => ({ is: () => Promise.resolve({ data: [], error: null }) }) }),
      };
    },
  }),
}));

import { POST } from '@/app/api/school-admin/roster/validate/route';

function authedAs(schoolId = SCHOOL_ID) {
  mockAuthorize.mockResolvedValue({ authorized: true, schoolId, userId: ADMIN_USER, schoolAdminId: 'admin-row' });
}
function denied(status = 403) {
  mockAuthorize.mockResolvedValue({
    authorized: false,
    schoolId: null,
    userId: null,
    errorResponse: new Response(
      JSON.stringify({ success: false, error: 'Not a school administrator' }),
      { status, headers: { 'Content-Type': 'application/json' } },
    ),
  });
}
function okSeats(remaining: number) {
  mockProbe.mockResolvedValue({ ok: true, snapshot: { ceiling: 100, used: 100 - remaining, remaining } });
}
function req(body: unknown): Request {
  return new Request('http://localhost/api/school-admin/roster/validate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  eqCalls.length = 0;
  okSeats(100);
});

describe('roster/validate — auth gate (P9)', () => {
  it('returns the authorizeSchoolAdmin errorResponse when not authorized', async () => {
    denied(403);
    const res = await POST(req({ students: [{ name: 'A', email: 'a@b.com', grade: '8' }] }) as never);
    expect(res.status).toBe(403);
    expect(writeProbe.insert).not.toHaveBeenCalled();
  });

  it('requests institution.manage_students', async () => {
    authedAs();
    await POST(req({ students: [] }) as never);
    expect(mockAuthorize).toHaveBeenCalledWith(expect.anything(), 'institution.manage_students');
  });
});

describe('roster/validate — NO WRITES (dry-run invariant)', () => {
  it('never calls insert/upsert/update/createUser for a full mixed payload', async () => {
    authedAs();
    const res = await POST(
      req({
        classes: [{ grade: '6', section: 'C' }],
        students: [{ name: 'Anika', email: 'anika@school.edu', grade: '8', section: 'A' }],
        teachers: [{ name: 'Mr Rao', email: 'rao@school.edu', grades_taught: ['8'], class_refs: ['A'] }],
      }) as never,
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { dry_run: boolean } };
    expect(json.data.dry_run).toBe(true);
    expect(writeProbe.insert).not.toHaveBeenCalled();
    expect(writeProbe.upsert).not.toHaveBeenCalled();
    expect(writeProbe.update).not.toHaveBeenCalled();
  });
});

describe('roster/validate — row-level errors', () => {
  it('flags bad grade, malformed email, unknown class, and duplicate-in-batch', async () => {
    authedAs();
    const res = await POST(
      req({
        students: [
          { name: 'Good', email: 'good@school.edu', grade: '8', section: 'A' }, // ok
          { name: 'Bad Grade', email: 'bg@school.edu', grade: '13', section: 'A' }, // invalid_grade
          { name: 'Bad Email', email: 'not-an-email', grade: '8', section: 'A' }, // invalid_email
          { name: 'No Class', email: 'nc@school.edu', grade: '8', section: 'Z' }, // class_not_found
          { name: 'Dup', email: 'good@school.edu', grade: '8', section: 'A' }, // duplicate_in_batch
        ],
      }) as never,
    );
    const json = (await res.json()) as {
      data: { students: { total: number; valid: number; errors: number; rows: Array<{ index: number; code: string }> } };
    };
    const rows = json.data.students.rows;
    expect(rows[0].code).toBe('created');
    expect(rows[1].code).toBe('invalid_grade');
    expect(rows[2].code).toBe('invalid_email');
    expect(rows[3].code).toBe('class_not_found');
    expect(rows[4].code).toBe('duplicate_in_batch');
    expect(json.data.students.errors).toBe(3); // grade + email + class_not_found are 'failed'
  });

  it('resolves a student class ref against a TO-BE-CREATED class in the same payload', async () => {
    authedAs();
    const res = await POST(
      req({
        classes: [{ grade: '9', section: 'C' }],
        students: [{ name: 'New Sec', email: 'ns@school.edu', grade: '9', section: 'C' }],
      }) as never,
    );
    const json = (await res.json()) as { data: { students: { rows: Array<{ code: string }> } } };
    expect(json.data.students.rows[0].code).toBe('created'); // not class_not_found
  });
});

describe('roster/validate — seat preview', () => {
  it('reports seats_needed vs remaining and will_exceed=true when short', async () => {
    authedAs();
    okSeats(1); // only 1 seat left
    const res = await POST(
      req({
        students: [
          { name: 'S1', email: 's1@school.edu', grade: '8', section: 'A' },
          { name: 'S2', email: 's2@school.edu', grade: '8', section: 'B' },
        ],
        teachers: [{ name: 'T1', email: 't1@school.edu', grades_taught: ['8'] }],
      }) as never,
    );
    const json = (await res.json()) as {
      data: { seat_preview: { seats_needed: number; remaining: number; will_exceed: boolean; available: boolean } };
    };
    // 2 students enrolling + 1 teacher = 3 seats needed.
    expect(json.data.seat_preview.seats_needed).toBe(3);
    expect(json.data.seat_preview.remaining).toBe(1);
    expect(json.data.seat_preview.will_exceed).toBe(true);
    expect(json.data.seat_preview.available).toBe(true);
  });

  it('surfaces available=false when the probe is unavailable (no crash, no write)', async () => {
    authedAs();
    mockProbe.mockResolvedValue({ ok: false, reason: 'unavailable' });
    const res = await POST(
      req({ students: [{ name: 'S1', email: 's1@school.edu', grade: '8', section: 'A' }] }) as never,
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { seat_preview: { available: boolean; remaining: number | null } } };
    expect(json.data.seat_preview.available).toBe(false);
    expect(json.data.seat_preview.remaining).toBeNull();
    expect(writeProbe.insert).not.toHaveBeenCalled();
  });
});

describe('roster/validate — tenant isolation + P13', () => {
  it('reads existing classes scoped to auth.schoolId, ignoring a body school_id', async () => {
    authedAs(SCHOOL_ID);
    await POST(
      req({ school_id: OTHER_SCHOOL_ID, students: [{ name: 'A', email: 'a@school.edu', grade: '8' }] }) as never,
    );
    expect(eqCalls).toContainEqual({ col: 'school_id', val: SCHOOL_ID });
    expect(eqCalls).not.toContainEqual({ col: 'school_id', val: OTHER_SCHOOL_ID });
  });

  it('logger carries counts only, never validated PII', async () => {
    authedAs();
    await POST(
      req({ students: [{ name: 'Kavya Iyer', email: 'kavya.iyer@school.edu', grade: '8', section: 'A' }] }) as never,
    );
    const loggedArgs = JSON.stringify(mockLoggerInfo.mock.calls);
    expect(loggedArgs).not.toMatch(/Kavya Iyer/);
    expect(loggedArgs).not.toMatch(/kavya\.iyer@school\.edu/);
    expect(loggedArgs).toMatch(/"students"/);
  });
});
