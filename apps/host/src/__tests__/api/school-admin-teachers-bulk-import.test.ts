/**
 * POST /api/school-admin/teachers/bulk-import — Track A.4 contract tests
 *
 * S1 FIX (2026-06-21): the per-row create path no longer probes-once + decrements a
 * local seat budget. It now calls the ATOMIC RPC wrapper `atomicRegisterTeacher`
 * (→ register_teacher_with_seat_check), which takes a per-school advisory lock,
 * recomputes the ceiling UNDER the lock, and creates-or-blocks in ONE transaction.
 * These tests mock that wrapper and assert the route trusts its PER-CALL
 * granted/blocked verdict (+ returned teacher_id) — it can never over-commit from a
 * stale pre-read snapshot. `probeSeatCapacity` is now best-effort headroom only.
 *
 * Pins:
 *   - Tenant isolation — body school_id ignored; the atomic register RPC is keyed
 *     to auth.schoolId.
 *   - Seat ceiling (ATOMIC) — the RPC returns granted (created/already_exists with a
 *     teacher_id) or blocked PER ROW; granted-new → created, granted-existing →
 *     already_exists (no seat), blocked → seat_limit_reached.
 *   - Concurrency-intent regression — two same-school creates competing for the
 *     LAST seat: exactly one created, one blocked; used never exceeds ceiling.
 *   - Idempotency — re-link existing teacher; per-row shape { index, status, code, id? };
 *     class assignment still upserted into class_teachers.
 *   - Auth gate (P9) with permission institution.manage_teachers.
 *   - P13 — logger/audit carry counts only, never PII.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mockAuthorize, mockLogSchoolAudit, mockLoggerInfo, mockProbe, mockAtomicRegister } =
  vi.hoisted(() => ({
    mockAuthorize: vi.fn(),
    mockLogSchoolAudit: vi.fn().mockResolvedValue(undefined),
    mockLoggerInfo: vi.fn(),
    mockProbe: vi.fn(),
    mockAtomicRegister: vi.fn(),
  }));

vi.mock('@alfanumrik/lib/school-admin-auth', () => ({
  authorizeSchoolAdmin: (...a: unknown[]) => mockAuthorize(...a),
}));
vi.mock('@alfanumrik/lib/audit', () => ({
  logSchoolAudit: (...a: unknown[]) => mockLogSchoolAudit(...a),
}));
vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: (...a: unknown[]) => mockLoggerInfo(...a) },
}));
vi.mock('@alfanumrik/lib/school-admin/bulk-roster', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alfanumrik/lib/school-admin/bulk-roster')>();
  return {
    ...actual,
    probeSeatCapacity: (...a: unknown[]) => mockProbe(...a),
    atomicRegisterTeacher: (...a: unknown[]) => mockAtomicRegister(...a),
    loadClassIndex: async () => ({
      bySection: new Map([['A', 'class-a']]),
      byCode: new Map<string, string>(),
    }),
  };
});

const SCHOOL_ID = '00000000-0000-0000-0000-000000000aaa';
const OTHER_SCHOOL_ID = '00000000-0000-0000-0000-000000000fff';
const ADMIN_USER = '00000000-0000-0000-0000-000000000099';

// Supabase mock: teacher create/dedupe now lives INSIDE the atomic RPC (mocked
// above). The route only touches class_teachers directly for assignments. Direct
// access to the `teachers` table here would be a regression → throw loudly.
const assignUpserts: Array<Record<string, unknown>> = [];

vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      if (table === 'class_teachers') {
        return {
          upsert: (payload: Record<string, unknown>) => {
            assignUpserts.push(payload);
            return Promise.resolve({ data: null, error: null });
          },
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  }),
}));

import { POST } from '@/app/api/school-admin/teachers/bulk-import/route';

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
  mockProbe.mockResolvedValue({ ok: true, snapshot: { ceiling: 1000, used: 1000 - remaining, remaining } });
}
let teacherIdSeq = 0;
/**
 * Drive the atomic register RPC: grant (create a new teacher with a fresh id) for the
 * first `grantCount` NEW-teacher calls, then block — exactly what
 * register_teacher_with_seat_check does at the ceiling under the lock.
 */
function atomicGrantsThenBlocks(grantCount: number) {
  let granted = 0;
  mockAtomicRegister.mockImplementation(async () => {
    if (granted < grantCount) {
      granted++;
      return { ok: true, granted: true, status: 'created', teacherId: `new-teacher-${teacherIdSeq++}` };
    }
    return { ok: true, granted: false, status: 'blocked' };
  });
}
function req(body: unknown): Request {
  return new Request('http://localhost/api/school-admin/teachers/bulk-import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}
function mkTeachers(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    name: `Teacher ${i}`,
    email: `t${i}@school.edu`,
    subjects_taught: ['Math'],
    grades_taught: ['8'],
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  assignUpserts.length = 0;
  teacherIdSeq = 0;
  okSeats(1000);
  // Default: every atomic register is granted as a brand-new teacher.
  mockAtomicRegister.mockImplementation(async () => ({
    ok: true,
    granted: true,
    status: 'created',
    teacherId: `new-teacher-${teacherIdSeq++}`,
  }));
});

describe('teachers bulk-import — auth gate (P9)', () => {
  it('returns the authorizeSchoolAdmin errorResponse when not authorized', async () => {
    denied(403);
    const res = await POST(req({ teachers: mkTeachers(2) }) as never);
    expect(res.status).toBe(403);
    expect(mockAtomicRegister).not.toHaveBeenCalled();
    expect(mockLogSchoolAudit).not.toHaveBeenCalled();
  });

  it('requests institution.manage_teachers', async () => {
    authedAs();
    await POST(req({ teachers: mkTeachers(1) }) as never);
    expect(mockAuthorize).toHaveBeenCalledWith(expect.anything(), 'institution.manage_teachers');
  });
});

describe('teachers bulk-import — tenant isolation', () => {
  it('IGNORES a body school_id — the atomic register RPC is keyed to auth.schoolId', async () => {
    authedAs(SCHOOL_ID);
    const res = await POST(req({ school_id: OTHER_SCHOOL_ID, teachers: mkTeachers(1) }) as never);
    expect(res.status).toBe(200);
    // First positional arg to atomicRegisterTeacher is the AUTH school, never the body.
    expect(mockAtomicRegister).toHaveBeenCalledWith(
      SCHOOL_ID,
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
    const calledSchools = mockAtomicRegister.mock.calls.map((c) => c[0]);
    expect(calledSchools).not.toContain(OTHER_SCHOOL_ID);
    expect(mockLogSchoolAudit).toHaveBeenCalledWith(expect.objectContaining({ schoolId: SCHOOL_ID }));
  });
});

describe('teachers bulk-import — seat ceiling (atomic RPC)', () => {
  it('atomic register grants 2, blocks 3 → creates 2, blocks 3', async () => {
    authedAs();
    atomicGrantsThenBlocks(2);
    const res = await POST(req({ teachers: mkTeachers(5) }) as never);
    const json = (await res.json()) as { data: { created: number; blocked: number; rows: Array<{ status: string; code: string }> } };
    expect(json.data.created).toBe(2);
    expect(json.data.blocked).toBe(3);
    // The route attempts an atomic register for EVERY row and trusts the per-call verdict.
    expect(mockAtomicRegister).toHaveBeenCalledTimes(5);
    expect(json.data.rows.filter((r) => r.status === 'blocked').every((r) => r.code === 'seat_limit_reached')).toBe(true);
  });

  it('every atomic register blocked (at ceiling) → 0 created, all blocked', async () => {
    authedAs();
    mockAtomicRegister.mockResolvedValue({ ok: true, granted: false, status: 'blocked' });
    const res = await POST(req({ teachers: mkTeachers(3) }) as never);
    const json = (await res.json()) as { data: { created: number; blocked: number } };
    expect(json.data.created).toBe(0);
    expect(json.data.blocked).toBe(3);
    expect(assignUpserts).toHaveLength(0);
  });

  it('an EXISTING teacher (granted already_exists) consumes NO seat — skipped/already_exists', async () => {
    authedAs();
    mockAtomicRegister.mockResolvedValue({
      ok: true,
      granted: true,
      status: 'already_exists',
      teacherId: 'existing-teacher',
    });
    const res = await POST(req({ teachers: mkTeachers(1) }) as never);
    const json = (await res.json()) as { data: { created: number; blocked: number; skipped: number; rows: Array<{ code: string; id?: string }> } };
    expect(json.data.blocked).toBe(0);
    expect(json.data.created).toBe(0);
    expect(json.data.skipped).toBe(1);
    expect(json.data.rows[0].code).toBe('already_exists');
    expect(json.data.rows[0].id).toBe('existing-teacher');
  });

  it('an atomic register RPC infra error (ok:false) → row failed (create_failed)', async () => {
    authedAs();
    mockAtomicRegister.mockResolvedValue({ ok: false });
    const res = await POST(req({ teachers: mkTeachers(2) }) as never);
    const json = (await res.json()) as { data: { created: number; failed: number; rows: Array<{ status: string; code: string }> } };
    expect(json.data.created).toBe(0);
    expect(json.data.failed).toBe(2);
    expect(json.data.rows.every((r) => r.status === 'failed' && r.code === 'create_failed')).toBe(true);
  });

  it('best-effort headroom probe being unavailable does NOT fail the request (200)', async () => {
    authedAs();
    mockProbe.mockResolvedValue({ ok: false, reason: 'unavailable' });
    const res = await POST(req({ teachers: mkTeachers(2) }) as never);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { created: number; seats_remaining: number } };
    expect(json.data.created).toBe(2);
    expect(json.data.seats_remaining).toBe(0);
    const text = JSON.stringify(json);
    expect(text).not.toMatch(/assert_seat_capacity|P0001|SQLSTATE/i);
  });
});

describe('teachers bulk-import — concurrency intent (S1: cannot over-commit)', () => {
  it('two same-school creates competing for the LAST seat → exactly one created, one blocked; used never exceeds ceiling', async () => {
    authedAs();
    const CEILING = 10;
    let used = 9; // one seat left
    mockAtomicRegister.mockImplementation(async () => {
      if (used >= CEILING) return { ok: true, granted: false, status: 'blocked' };
      used += 1; // commit the seat under the (modeled) lock
      return { ok: true, granted: true, status: 'created', teacherId: `new-teacher-${teacherIdSeq++}` };
    });

    const res = await POST(req({ teachers: mkTeachers(2) }) as never);
    const json = (await res.json()) as { data: { created: number; blocked: number; rows: Array<{ status: string }> } };

    expect(json.data.created).toBe(1);
    expect(json.data.blocked).toBe(1);
    expect(json.data.rows.filter((r) => r.status === 'created')).toHaveLength(1);
    expect(json.data.rows.filter((r) => r.status === 'blocked')).toHaveLength(1);
    // Invariant: never over-committed.
    expect(used).toBe(CEILING);
    expect(used).toBeLessThanOrEqual(CEILING);
  });

  it('the route does not pre-read a seat snapshot to gate creation (no over-commit from a stale read)', async () => {
    authedAs();
    // Stale snapshot says 0 remaining, but the atomic RPC grants → the teacher IS
    // created. The route honors the per-call RPC verdict, never a pre-read.
    okSeats(0);
    const res = await POST(req({ teachers: mkTeachers(1) }) as never);
    const json = (await res.json()) as { data: { created: number; blocked: number } };
    expect(json.data.created).toBe(1);
    expect(json.data.blocked).toBe(0);
    expect(mockAtomicRegister).toHaveBeenCalledTimes(1);
  });
});

describe('teachers bulk-import — idempotency & shape', () => {
  it('per-row result shape { index, status, code, id? }; class assignment upserted', async () => {
    authedAs();
    mockAtomicRegister.mockResolvedValue({
      ok: true,
      granted: true,
      status: 'created',
      teacherId: 'tid-1',
    });
    const res = await POST(
      req({ teachers: [{ name: 'Mr Rao', email: 'rao@school.edu', grades_taught: ['8'], class_refs: ['A'] }] }) as never,
    );
    const json = (await res.json()) as { data: { rows: Array<Record<string, unknown>> } };
    const row = json.data.rows[0];
    expect(row).toMatchObject({ index: 0, status: 'created', code: 'created', id: 'tid-1' });
    expect(assignUpserts).toHaveLength(1);
    expect(assignUpserts[0]).toMatchObject({ class_id: 'class-a', teacher_id: 'tid-1', role: 'teacher' });
  });

  it('dedupes a duplicate email within the batch (no second register RPC call)', async () => {
    authedAs();
    const res = await POST(
      req({
        teachers: [
          { name: 'A One', email: 'dup@school.edu', grades_taught: ['8'] },
          { name: 'B Two', email: 'DUP@school.edu', grades_taught: ['8'] },
        ],
      }) as never,
    );
    const json = (await res.json()) as { data: { rows: Array<{ index: number; status: string; code: string }> } };
    // Results aren't input-ordered; find the row by its original index.
    const second = json.data.rows.find((r) => r.index === 1);
    expect(second).toMatchObject({ status: 'skipped', code: 'duplicate_in_batch' });
    // Only the first (unique) email reached the atomic register RPC.
    expect(mockAtomicRegister).toHaveBeenCalledTimes(1);
  });

  it('rejects more than MAX_BULK_ROWS (501) → 413', async () => {
    authedAs();
    const res = await POST(req({ teachers: mkTeachers(501) }) as never);
    expect(res.status).toBe(413);
    expect(mockAtomicRegister).not.toHaveBeenCalled();
  });
});

describe('teachers bulk-import — P13 no PII in logs', () => {
  it('logger + audit never receive teacher name/email — counts only', async () => {
    authedAs();
    await POST(
      req({ teachers: [{ name: 'Sunita Verma', email: 'sunita.verma@school.edu', grades_taught: ['8'] }] }) as never,
    );
    const loggedArgs = JSON.stringify(mockLoggerInfo.mock.calls);
    const auditArgs = JSON.stringify(mockLogSchoolAudit.mock.calls);
    for (const blob of [loggedArgs, auditArgs]) {
      expect(blob).not.toMatch(/Sunita Verma/);
      expect(blob).not.toMatch(/sunita\.verma@school\.edu/);
    }
    expect(loggedArgs).toMatch(/"created"/);
  });
});
