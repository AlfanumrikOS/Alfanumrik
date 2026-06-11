/**
 * PUT /api/teacher/students/[id]/notes — class-scope ownership isolation.
 *
 * Phase 3 (per-portal authorization isolation). The teacher notes route is the
 * one teacher *write* path whose ownership boundary is enforced through the
 * `canAccessStudent(authUserId, studentId)` RBAC helper (which traverses
 * class_teachers + class_enrollments via the `is_teacher_of_student` RPC) —
 * NOT through an inline roster query the way `/api/teacher/remediation` does.
 * That seam had no route-level test: `rbac.test.ts` covers `canAccessStudent`
 * in isolation, and `subject-readiness.test.ts` covers it on a `/api/v1/*`
 * student-readiness route, but nothing pinned the teacher-notes write path.
 *
 * This is defense-in-depth that complements RLS: it produces a structured
 * 403 at the application layer BEFORE any write, so a teacher cannot annotate
 * (and thereby probe the existence of) a student who is not in one of their
 * active classes — i.e. a student belonging to another teacher or another
 * school's tenant.
 *
 * Contract under test:
 *   1. RBAC gate denies (no class.manage) → route returns the gate response.
 *   2. canAccessStudent === false (cross-class / cross-tenant student) → 403
 *      Forbidden, and NO upsert is attempted.
 *   3. canAccessStudent === true (assigned student) → 200, upsert runs.
 *   4. Malformed student id → 400 before any ownership check.
 *
 * Mocks mirror the existing teacher route tests (remediation/route.test.ts):
 * authorizeRequest + canAccessStudent from '@/lib/rbac', publishEvent, and a
 * dispatch-by-table supabaseAdmin chain. No live DB, no network.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mock holders ──────────────────────────────────────────────
const holders = vi.hoisted(() => ({
  mockAuthorize: vi.fn(),
  mockCanAccess: vi.fn(),
  mockPublishEvent: vi.fn().mockResolvedValue(undefined),
  // Records every table the route touches + whether an upsert ran.
  upsertCalled: false as boolean,
  upsertPayload: undefined as unknown,
  upsertError: null as { message: string } | null,
  teacher: { id: 'teacher-1', school_id: 'school-A' } as
    | { id: string; school_id: string | null }
    | null,
  teacherError: null as { message: string } | null,
}));

vi.mock('@/lib/rbac', () => ({
  authorizeRequest: (...a: unknown[]) => holders.mockAuthorize(...a),
  canAccessStudent: (...a: unknown[]) => holders.mockCanAccess(...a),
}));

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/lib/state/events/publish', () => ({
  publishEvent: (...a: unknown[]) => holders.mockPublishEvent(...a),
}));

vi.mock('@/lib/supabase-admin', () => {
  // teachers: .select().eq().maybeSingle()
  function teachersChain() {
    const chain = {
      select() {
        return chain;
      },
      eq() {
        return chain;
      },
      maybeSingle() {
        return Promise.resolve({
          data: holders.teacher,
          error: holders.teacherError,
        });
      },
    };
    return chain;
  }

  // teacher_student_notes: .upsert(payload, opts) → awaited { error }
  function notesChain() {
    return {
      upsert(payload: unknown) {
        holders.upsertCalled = true;
        holders.upsertPayload = payload;
        return Promise.resolve({ error: holders.upsertError });
      },
    };
  }

  const supabaseAdmin = {
    from(table: string) {
      if (table === 'teachers') return teachersChain();
      if (table === 'teacher_student_notes') return notesChain();
      throw new Error(`unexpected table in test: ${table}`);
    },
  };

  return { supabaseAdmin };
});

// ── Helpers ───────────────────────────────────────────────────────────
const ASSIGNED_STUDENT = '11111111-1111-4111-8111-111111111111';
const FOREIGN_STUDENT = '22222222-2222-4222-8222-222222222222';

function setAuthorized(userId = 'teacher-auth-1') {
  holders.mockAuthorize.mockResolvedValue({
    authorized: true,
    userId,
    studentId: null,
    roles: ['teacher'],
    permissions: ['class.manage'],
  });
}

function makeRequest(body: Record<string, unknown> = { note: 'hello' }) {
  return new Request('http://localhost/api/teacher/students/x/notes', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let PUT: any;

beforeEach(async () => {
  vi.clearAllMocks();
  holders.upsertCalled = false;
  holders.upsertPayload = undefined;
  holders.upsertError = null;
  holders.teacher = { id: 'teacher-1', school_id: 'school-A' };
  holders.teacherError = null;
  holders.mockPublishEvent.mockResolvedValue(undefined);
  const mod = await import('@/app/api/teacher/students/[id]/notes/route');
  PUT = mod.PUT;
});

// ── Tests ─────────────────────────────────────────────────────────────

describe('PUT /api/teacher/students/[id]/notes — RBAC gate', () => {
  it('returns the authorizeRequest errorResponse when not authorized', async () => {
    const denied = new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
    holders.mockAuthorize.mockResolvedValue({
      authorized: false,
      userId: null,
      errorResponse: denied,
    });

    const res = await PUT(makeRequest(), { params: Promise.resolve({ id: ASSIGNED_STUDENT }) });
    expect(res.status).toBe(403);
    // The ownership helper is never consulted once the RBAC gate fails.
    expect(holders.mockCanAccess).not.toHaveBeenCalled();
    expect(holders.upsertCalled).toBe(false);
  });
});

describe('PUT /api/teacher/students/[id]/notes — class-scope isolation (P8/P9)', () => {
  it('returns 403 when the student is NOT in the caller teacher class set (cross-class / cross-tenant)', async () => {
    setAuthorized();
    holders.mockCanAccess.mockResolvedValue(false);

    const res = await PUT(makeRequest(), { params: Promise.resolve({ id: FOREIGN_STUDENT }) });

    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error).toBe('Forbidden');

    // The ownership check was made for THIS student id.
    expect(holders.mockCanAccess).toHaveBeenCalledWith('teacher-auth-1', FOREIGN_STUDENT);
    // Critical: denial happens BEFORE any write — no note row is upserted for
    // a student outside the teacher's roster.
    expect(holders.upsertCalled).toBe(false);
    expect(holders.mockPublishEvent).not.toHaveBeenCalled();
  });

  it('allows the write for an assigned student (canAccessStudent === true)', async () => {
    setAuthorized();
    holders.mockCanAccess.mockResolvedValue(true);

    const res = await PUT(
      makeRequest({ note: 'Strong on algebra', customGoal: 'Revise trig' }),
      { params: Promise.resolve({ id: ASSIGNED_STUDENT }) },
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);

    expect(holders.mockCanAccess).toHaveBeenCalledWith('teacher-auth-1', ASSIGNED_STUDENT);
    expect(holders.upsertCalled).toBe(true);
    // The upsert is keyed to the JWT-resolved teacher id and the path student
    // id — never a client-supplied teacher id.
    expect(holders.upsertPayload).toMatchObject({
      teacher_id: 'teacher-1',
      student_id: ASSIGNED_STUDENT,
      note: 'Strong on algebra',
      custom_goal: 'Revise trig',
    });
  });

  it('returns 403 when the auth user has no teacher profile (even if canAccessStudent passed)', async () => {
    setAuthorized();
    holders.mockCanAccess.mockResolvedValue(true);
    holders.teacher = null; // no teachers row for this auth user

    const res = await PUT(makeRequest(), { params: Promise.resolve({ id: ASSIGNED_STUDENT }) });

    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toBe('Teacher account not found');
    expect(holders.upsertCalled).toBe(false);
  });
});

describe('PUT /api/teacher/students/[id]/notes — input validation precedes ownership', () => {
  it('returns 400 for a malformed student id before any ownership check', async () => {
    setAuthorized();
    holders.mockCanAccess.mockResolvedValue(true);

    const res = await PUT(makeRequest(), { params: Promise.resolve({ id: 'not-a-uuid' }) });

    expect(res.status).toBe(400);
    // We never consult canAccessStudent for a structurally invalid id.
    expect(holders.mockCanAccess).not.toHaveBeenCalled();
    expect(holders.upsertCalled).toBe(false);
  });
});
