/**
 * POST /api/school-admin/students/bulk-import — Track A.4 contract tests
 *
 * S1 FIX (2026-06-21): the per-row enroll path no longer probes-once + decrements
 * a local seat budget (a cross-request TOCTOU race). It now calls the ATOMIC RPC
 * wrapper `atomicEnrollStudent` (→ enroll_student_with_seat_check), which takes a
 * per-school advisory lock, recomputes the ceiling UNDER the lock, and
 * inserts-or-blocks in ONE transaction. These tests mock that wrapper and assert
 * the route trusts its PER-CALL granted/blocked verdict — it can never over-commit
 * from a stale pre-read snapshot. `probeSeatCapacity` is now best-effort headroom
 * only (the response `seats_remaining`), NOT a gate.
 *
 * CRITICAL coverage:
 *   1. Tenant isolation — a body school_id is ignored; create-or-link, class
 *      resolution and enrollment are all scoped to auth.schoolId. A student
 *      already OWNED by another school is NOT re-homed (failed, not moved).
 *   2. Seat ceiling (ATOMIC) — the atomic enroll RPC returns granted/blocked PER
 *      ROW; granted rows → created, blocked rows → seat_limit_reached. No local
 *      budget; the route never pre-reads a snapshot to decide.
 *   2b. Concurrency-intent regression — two same-school enrolls competing for the
 *       LAST seat: exactly one granted/created, the other blocked; used never
 *       exceeds ceiling because the route trusts the RPC verdict, not a snapshot.
 *   3. Idempotency / partial success — re-running dedupes by (school, email);
 *      per-row result shape { index, status, code, id? }.
 *   4. Auth gate (P9) with permission institution.manage_students.
 *   5. P13 — logger/audit carry counts + indices + codes only, never PII.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mockAuthorize, mockLogSchoolAudit, mockLoggerInfo, mockProbe, mockAtomicEnroll } =
  vi.hoisted(() => ({
    mockAuthorize: vi.fn(),
    mockLogSchoolAudit: vi.fn().mockResolvedValue(undefined),
    mockLoggerInfo: vi.fn(),
    mockProbe: vi.fn(),
    mockAtomicEnroll: vi.fn(),
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

// Mock the ATOMIC enroll wrapper + the (now best-effort) probe + class index out of
// the lib so the route's seat decisions are driven by the RPC verdict, deterministically.
// The real helpers are unit-tested in school-admin-bulk-roster-lib.test.ts.
vi.mock('@alfanumrik/lib/school-admin/bulk-roster', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alfanumrik/lib/school-admin/bulk-roster')>();
  return {
    ...actual,
    probeSeatCapacity: (...a: unknown[]) => mockProbe(...a),
    atomicEnrollStudent: (...a: unknown[]) => mockAtomicEnroll(...a),
    loadClassIndex: async () => ({
      bySection: new Map([['A', 'class-a'], ['B', 'class-b']]),
      byCode: new Map<string, string>(),
    }),
  };
});

const SCHOOL_ID = '00000000-0000-0000-0000-000000000aaa';
const OTHER_SCHOOL_ID = '00000000-0000-0000-0000-000000000fff';
const ADMIN_USER = '00000000-0000-0000-0000-000000000099';

// ── Supabase mock (students table + auth.admin only — enrollment goes through the
// atomic RPC wrapper, which is mocked above, NOT through class_students here) ──────
//   .select('id, school_id').eq('email', …).maybeSingle()      — dedupe / cross-tenant
//   .update({ school_id }).eq('auth_user_id', …).select('id').single()  — attach trigger row
//   .update({ school_id }).eq('id', …)                         — claim unclaimed student

interface StudentSeed {
  existingByEmail: Record<string, { id: string; school_id: string | null }>;
}
let seed: StudentSeed;
const studentUpdates: Array<{ patch: Record<string, unknown> }> = [];
let authCreateSeq = 0;

function studentsBuilder() {
  return {
    select: () => ({
      eq: (col: string, val: unknown) => ({
        maybeSingle: async () => {
          if (col === 'email') {
            const hit = seed.existingByEmail[String(val).toLowerCase()];
            return { data: hit ?? null, error: null };
          }
          return { data: null, error: null };
        },
      }),
    }),
    update: (patch: Record<string, unknown>) => {
      studentUpdates.push({ patch });
      return {
        eq: (col: string, _val: unknown) => {
          // .update().eq('auth_user_id', …).select('id').single() (new student)
          if (col === 'auth_user_id') {
            return {
              select: () => ({
                single: async () => ({ data: { id: `new-student-${authCreateSeq}` }, error: null }),
              }),
            };
          }
          // .update().eq('id', …) (claim unclaimed) — terminal thenable
          return Promise.resolve({ data: null, error: null });
        },
      };
    },
  };
}

vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => ({
    auth: {
      admin: {
        createUser: vi.fn(async () => {
          authCreateSeq++;
          return { data: { user: { id: `auth-${authCreateSeq}` } }, error: null };
        }),
      },
    },
    from: (table: string) => {
      if (table === 'students') return studentsBuilder();
      // The route MUST NOT touch class_students directly anymore — enrollment is the
      // atomic RPC's job. A direct class_students access here is a regression.
      throw new Error(`unexpected table: ${table}`);
    },
  }),
}));

import { POST } from '@/app/api/school-admin/students/bulk-import/route';

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
/**
 * Drive the atomic enroll RPC so it grants the first `grantCount` enroll calls and
 * blocks the rest — exactly what enroll_student_with_seat_check does once the ceiling
 * is reached under the lock. The verdict is PER CALL; the route never sees the budget.
 */
function atomicGrantsThenBlocks(grantCount: number) {
  let granted = 0;
  mockAtomicEnroll.mockImplementation(async () => {
    if (granted < grantCount) {
      granted++;
      return { ok: true, granted: true, status: 'created' };
    }
    return { ok: true, granted: false, status: 'blocked' };
  });
}
function req(body: unknown): Request {
  return new Request('http://localhost/api/school-admin/students/bulk-import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}
function mkStudents(n: number, enroll = true) {
  return Array.from({ length: n }, (_, i) => ({
    name: `Student ${i}`,
    email: `s${i}@school.edu`,
    grade: '8',
    ...(enroll ? { section: 'A' } : {}),
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  studentUpdates.length = 0;
  authCreateSeq = 0;
  seed = { existingByEmail: {} };
  okSeats(1000);
  // Default: every atomic enroll is granted (plenty of seats).
  mockAtomicEnroll.mockResolvedValue({ ok: true, granted: true, status: 'created' });
});

// ── Auth gate ─────────────────────────────────────────────────────────
describe('students bulk-import — auth gate (P9)', () => {
  it('returns the authorizeSchoolAdmin errorResponse when not authorized', async () => {
    denied(403);
    const res = await POST(req({ students: mkStudents(2) }) as never);
    expect(res.status).toBe(403);
    expect(mockAtomicEnroll).not.toHaveBeenCalled();
    expect(mockLogSchoolAudit).not.toHaveBeenCalled();
  });

  it('requests institution.manage_students', async () => {
    authedAs();
    await POST(req({ students: mkStudents(1) }) as never);
    expect(mockAuthorize).toHaveBeenCalledWith(expect.anything(), 'institution.manage_students');
  });
});

// ── Tenant isolation (CRITICAL) ───────────────────────────────────────
describe('students bulk-import — tenant isolation (CRITICAL)', () => {
  it('IGNORES a body school_id — audit + atomic enroll use auth.schoolId', async () => {
    authedAs(SCHOOL_ID);
    const res = await POST(
      req({ school_id: OTHER_SCHOOL_ID, students: mkStudents(1) }) as never,
    );
    expect(res.status).toBe(200);
    expect(mockLogSchoolAudit).toHaveBeenCalledWith(expect.objectContaining({ schoolId: SCHOOL_ID }));
    // New student claimed into the AUTH school, not the body school.
    expect(studentUpdates.some((u) => u.patch.school_id === SCHOOL_ID)).toBe(true);
    expect(studentUpdates.some((u) => u.patch.school_id === OTHER_SCHOOL_ID)).toBe(false);
    // The atomic enroll RPC is keyed by the AUTH school, never the body school.
    expect(mockAtomicEnroll).toHaveBeenCalledWith(SCHOOL_ID, expect.anything(), 'class-a', null);
    expect(mockAtomicEnroll).not.toHaveBeenCalledWith(OTHER_SCHOOL_ID, expect.anything(), expect.anything(), expect.anything());
  });

  it('does NOT re-home a student already owned by ANOTHER school (failed, not moved)', async () => {
    authedAs(SCHOOL_ID);
    seed.existingByEmail['s0@school.edu'] = { id: 'foreign-student', school_id: OTHER_SCHOOL_ID };
    const res = await POST(req({ students: mkStudents(1) }) as never);
    const json = (await res.json()) as { data: { failed: number; created: number; rows: Array<{ status: string; code: string }> } };
    expect(json.data.failed).toBe(1);
    expect(json.data.created).toBe(0);
    expect(json.data.rows[0]).toMatchObject({ status: 'failed', code: 'create_failed' });
    // No update re-homing the foreign student, and no enroll attempted.
    expect(studentUpdates).toHaveLength(0);
    expect(mockAtomicEnroll).not.toHaveBeenCalled();
  });

  it('CLAIMS an unclaimed (school_id null) student into the auth school and enrolls', async () => {
    authedAs(SCHOOL_ID);
    seed.existingByEmail['s0@school.edu'] = { id: 'orphan-student', school_id: null };
    const res = await POST(req({ students: mkStudents(1) }) as never);
    const json = (await res.json()) as { data: { skipped: number; rows: Array<{ id?: string; code: string }> } };
    // Claimed: school_id patched to the AUTH school.
    expect(studentUpdates.some((u) => u.patch.school_id === SCHOOL_ID)).toBe(true);
    expect(json.data.rows[0].id).toBe('orphan-student');
    expect(json.data.rows[0].code).toBe('already_exists');
    // Enrolled through the atomic RPC, keyed by the auth school + the orphan id.
    expect(mockAtomicEnroll).toHaveBeenCalledWith(SCHOOL_ID, 'orphan-student', 'class-a', null);
  });
});

// ── Seat ceiling (ATOMIC, per-row RPC verdict) ────────────────────────
describe('students bulk-import — seat ceiling (atomic RPC)', () => {
  it('atomic enroll grants 2, blocks 3 → creates 2, blocks 3 as seat_limit_reached', async () => {
    authedAs();
    atomicGrantsThenBlocks(2);
    const res = await POST(req({ students: mkStudents(5) }) as never);
    const json = (await res.json()) as {
      data: { created: number; blocked: number; rows: Array<{ status: string; code: string }> };
    };
    expect(json.data.created).toBe(2);
    expect(json.data.blocked).toBe(3);
    // The route attempts an atomic enroll for EVERY enrolling row (no pre-read budget
    // short-circuit) and trusts each per-call verdict.
    expect(mockAtomicEnroll).toHaveBeenCalledTimes(5);
    const blockedRows = json.data.rows.filter((r) => r.status === 'blocked');
    expect(blockedRows).toHaveLength(3);
    expect(blockedRows.every((r) => r.code === 'seat_limit_reached')).toBe(true);
  });

  it('every atomic enroll blocked (at ceiling) → 0 created, all blocked', async () => {
    authedAs();
    mockAtomicEnroll.mockResolvedValue({ ok: true, granted: false, status: 'blocked' });
    const res = await POST(req({ students: mkStudents(3) }) as never);
    const json = (await res.json()) as { data: { created: number; blocked: number; rows: Array<{ code: string }> } };
    expect(json.data.created).toBe(0);
    expect(json.data.blocked).toBe(3);
    expect(json.data.rows.every((r) => r.code === 'seat_limit_reached')).toBe(true);
  });

  it('students WITHOUT a class ref are created and NEVER call the enroll RPC (no seat)', async () => {
    authedAs();
    // Even if the RPC would block, an unenrolled student consumes no seat: the route
    // must not even attempt an enroll for a student with no class_ref.
    mockAtomicEnroll.mockResolvedValue({ ok: true, granted: false, status: 'blocked' });
    const res = await POST(req({ students: mkStudents(2, false) }) as never);
    const json = (await res.json()) as { data: { created: number; blocked: number } };
    expect(json.data.created).toBe(2);
    expect(json.data.blocked).toBe(0);
    expect(mockAtomicEnroll).not.toHaveBeenCalled();
  });

  it('an atomic enroll RPC infra error (ok:false) → row failed (enroll_failed), no over-commit', async () => {
    authedAs();
    mockAtomicEnroll.mockResolvedValue({ ok: false });
    const res = await POST(req({ students: mkStudents(2) }) as never);
    const json = (await res.json()) as { data: { created: number; failed: number; rows: Array<{ status: string; code: string }> } };
    expect(json.data.created).toBe(0);
    expect(json.data.failed).toBe(2);
    expect(json.data.rows.every((r) => r.status === 'failed' && r.code === 'enroll_failed')).toBe(true);
  });

  it('best-effort headroom probe being unavailable does NOT fail the request (200, seats_remaining 0)', async () => {
    authedAs();
    // The probe is now ONLY a post-write headroom snapshot, never a gate. An
    // unavailable probe must not 503 (that was the old probe-once gate behavior).
    mockProbe.mockResolvedValue({ ok: false, reason: 'unavailable' });
    const res = await POST(req({ students: mkStudents(2) }) as never);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { created: number; seats_remaining: number } };
    expect(json.data.created).toBe(2);
    expect(json.data.seats_remaining).toBe(0);
    // No SQL leaked into the response either way.
    const text = JSON.stringify(json);
    expect(text).not.toMatch(/assert_seat_capacity|P0001|SQLSTATE|relation|function/i);
  });
});

// ── Concurrency-intent regression (S1) ────────────────────────────────
describe('students bulk-import — concurrency intent (S1: cannot over-commit)', () => {
  it('two same-school enrolls competing for the LAST seat → exactly one created, one blocked; used never exceeds ceiling', async () => {
    authedAs();
    // Model the atomic RPC's behavior under contention for a single remaining seat:
    // the FIRST caller to acquire the lock recomputes used<ceiling and is granted
    // (used→ceiling); the SECOND recomputes used>=ceiling under the lock and is
    // blocked. The route trusts these PER-CALL verdicts — it has NO pre-read snapshot
    // that could let both through.
    const CEILING = 5;
    let used = 4; // one seat left
    mockAtomicEnroll.mockImplementation(async () => {
      if (used >= CEILING) return { ok: true, granted: false, status: 'blocked' };
      used += 1; // commit one seat under the (modeled) lock
      return { ok: true, granted: true, status: 'created' };
    });

    const res = await POST(req({ students: mkStudents(2) }) as never);
    const json = (await res.json()) as {
      data: { created: number; blocked: number; rows: Array<{ status: string }> };
    };

    // Exactly one wins the last seat; the other is blocked.
    expect(json.data.created).toBe(1);
    expect(json.data.blocked).toBe(1);
    expect(json.data.rows.filter((r) => r.status === 'created')).toHaveLength(1);
    expect(json.data.rows.filter((r) => r.status === 'blocked')).toHaveLength(1);
    // Invariant: used never crept past the ceiling.
    expect(used).toBe(CEILING);
    expect(used).toBeLessThanOrEqual(CEILING);
  });

  it('the route does not pre-read a seat snapshot to gate enrollment (no over-commit from a stale read)', async () => {
    authedAs();
    // Even if a stale snapshot said "0 remaining", the route must STILL attempt the
    // atomic enroll and honor the RPC's granted verdict — it cannot block a row from a
    // pre-read. Here the snapshot is exhausted but the RPC grants: the row is created.
    okSeats(0);
    mockAtomicEnroll.mockResolvedValue({ ok: true, granted: true, status: 'created' });
    const res = await POST(req({ students: mkStudents(1) }) as never);
    const json = (await res.json()) as { data: { created: number; blocked: number } };
    expect(json.data.created).toBe(1);
    expect(json.data.blocked).toBe(0);
    expect(mockAtomicEnroll).toHaveBeenCalledTimes(1);
  });
});

// ── Idempotency / partial success / validation ────────────────────────
describe('students bulk-import — idempotency & partial success', () => {
  it('per-row result shape is { index, status, code, id? }', async () => {
    authedAs();
    const res = await POST(req({ students: mkStudents(1) }) as never);
    const json = (await res.json()) as { data: { rows: Array<Record<string, unknown>> } };
    const row = json.data.rows[0];
    expect(row).toHaveProperty('index', 0);
    expect(row).toHaveProperty('status');
    expect(row).toHaveProperty('code');
    expect(typeof row.id).toBe('string');
  });

  it('re-running with an EXISTING same-school student does not duplicate (skipped/already_exists)', async () => {
    authedAs();
    seed.existingByEmail['s0@school.edu'] = { id: 'existing-student', school_id: SCHOOL_ID };
    // Atomic enroll returns granted with an idempotent status; the per-row status is
    // driven by whether the STUDENT was newly created, not by the enroll grant.
    mockAtomicEnroll.mockResolvedValue({ ok: true, granted: true, status: 'already_active' });
    const res = await POST(req({ students: mkStudents(1) }) as never);
    const json = (await res.json()) as { data: { created: number; skipped: number; rows: Array<{ code: string; id?: string }> } };
    expect(json.data.created).toBe(0);
    expect(json.data.skipped).toBe(1);
    expect(json.data.rows[0].code).toBe('already_exists');
    expect(json.data.rows[0].id).toBe('existing-student');
  });

  it('dedupes a duplicate email WITHIN the same batch (case-insensitive)', async () => {
    authedAs();
    const res = await POST(
      req({
        students: [
          { name: 'Dup One', email: 'dup@school.edu', grade: '8', section: 'A' },
          { name: 'Dup Two', email: 'DUP@school.edu', grade: '8', section: 'A' },
        ],
      }) as never,
    );
    const json = (await res.json()) as { data: { rows: Array<{ index: number; status: string; code: string }> } };
    // Results aren't input-ordered (validation/dedupe pushed first); find by index.
    const second = json.data.rows.find((r) => r.index === 1);
    expect(second).toMatchObject({ status: 'skipped', code: 'duplicate_in_batch' });
  });

  it('marks a bad-grade row failed and an unknown class missing, processing the rest', async () => {
    authedAs();
    const res = await POST(
      req({
        students: [
          { name: 'Good One', email: 'g1@school.edu', grade: '8', section: 'A' },
          { name: 'Bad Grade', email: 'bg@school.edu', grade: '13', section: 'A' },
          { name: 'No Class', email: 'nc@school.edu', grade: '8', section: 'Z' },
        ],
      }) as never,
    );
    const json = (await res.json()) as { data: { created: number; rows: Array<{ index: number; status: string; code: string }> } };
    expect(json.data.created).toBe(1);
    // Per-row truth (the summary `failed` counter excludes validation-time failures
    // by design — only the create/enroll loop bumps the counters).
    const byIndex = (i: number) => json.data.rows.find((r) => r.index === i)!;
    expect(byIndex(0)).toMatchObject({ status: 'created', code: 'created' });
    expect(byIndex(1)).toMatchObject({ status: 'failed', code: 'invalid_grade' });
    expect(byIndex(2)).toMatchObject({ status: 'failed', code: 'class_not_found' });
    expect(json.data.rows.filter((r) => r.status === 'failed')).toHaveLength(2);
    // The unknown-class row never reached the enroll RPC; only the good row did.
    expect(mockAtomicEnroll).toHaveBeenCalledTimes(1);
  });

  it('rejects more than MAX_BULK_ROWS (501 rows) → 413', async () => {
    authedAs();
    const res = await POST(req({ students: mkStudents(501) }) as never);
    expect(res.status).toBe(413);
    expect(mockAtomicEnroll).not.toHaveBeenCalled();
  });
});

// ── P13 ───────────────────────────────────────────────────────────────
describe('students bulk-import — P13 no PII in logs', () => {
  it('logger + audit never receive student name/email/phone — counts + indices only', async () => {
    authedAs();
    await POST(
      req({
        students: [
          {
            name: 'Priya Nair',
            email: 'priya.nair@school.edu',
            grade: '8',
            section: 'A',
            parent_phone: '9876501234',
          },
        ],
      }) as never,
    );
    const loggedArgs = JSON.stringify(mockLoggerInfo.mock.calls);
    const auditArgs = JSON.stringify(mockLogSchoolAudit.mock.calls);
    for (const blob of [loggedArgs, auditArgs]) {
      expect(blob).not.toMatch(/Priya Nair/);
      expect(blob).not.toMatch(/priya\.nair@school\.edu/);
      expect(blob).not.toMatch(/9876501234/);
    }
    // Counts present.
    expect(loggedArgs).toMatch(/"created"/);
    expect(loggedArgs).toMatch(/"total"/);
  });
});
