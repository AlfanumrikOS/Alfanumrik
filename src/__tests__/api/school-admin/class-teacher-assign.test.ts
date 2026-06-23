/**
 * Tests for PATCH /api/school-admin/classes/[classId]
 * P2: assign a teacher to a class via class_teachers junction table
 * P8: validates class + teacher both belong to admin school (cross-school prevention)
 * P5: grade returned as string
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/school-admin-auth', () => ({
  authorizeSchoolAdmin: vi.fn(),
}));

vi.mock('@/lib/audit', () => ({ logSchoolAudit: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn() } }));

// Route checks class (with .is(deleted_at)) then teacher, then UPSERTs into class_teachers.
// mockClassResult.data must include all fields the response reads (name, grade, section).
let mockClassResult: any = {
  data: { id: 'cls-1', name: 'Class 9A', grade: '9', section: 'A' },
  error: null,
};
let mockTeacherResult: any = { data: { id: 'tch-1' }, error: null };
let mockAssignmentResult: any = {
  data: { id: 'assign-1', class_id: 'cls-1', teacher_id: 'tch-1', role: 'teacher', is_active: true },
  error: null,
};

vi.mock('@/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      if (table === 'classes') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                // Route calls .is('deleted_at', null).maybeSingle()
                is: () => ({ maybeSingle: vi.fn().mockResolvedValue(mockClassResult) }),
              }),
            }),
          }),
        };
      }
      if (table === 'teachers') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({ maybeSingle: vi.fn().mockResolvedValue(mockTeacherResult) }),
            }),
          }),
        };
      }
      if (table === 'class_teachers') {
        // Route calls .upsert(...).select(...).single()
        return {
          upsert: () => ({
            select: () => ({
              single: vi.fn().mockResolvedValue(mockAssignmentResult),
            }),
          }),
        };
      }
      // Strict catch-all: any unmocked table call throws so future route changes surface immediately
      return new Proxy({}, {
        get(_: any, prop: string) {
          throw new Error(`Unmocked Supabase table method called on table other than classes/teachers/class_teachers: .${prop}`);
        },
      });
    },
  }),
}));

import { authorizeSchoolAdmin } from '@/lib/school-admin-auth';
import { PATCH } from '@/app/api/school-admin/classes/[classId]/route';

function makeAuthPassed() {
  vi.mocked(authorizeSchoolAdmin).mockResolvedValue({
    authorized: true,
    schoolId: 'school-1',
    userId: 'admin-1',
    errorResponse: undefined,
  } as any);
}

function makeAuthFailed() {
  vi.mocked(authorizeSchoolAdmin).mockResolvedValue({
    authorized: false,
    errorResponse: NextResponse.json({ error: 'Unauthorized' }, { status: 403 }),
  } as any);
}

function makeReq(body: unknown) {
  return new NextRequest('http://localhost/api/school-admin/classes/cls-1', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('PATCH /api/school-admin/classes/[classId]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClassResult = {
      data: { id: 'cls-1', name: 'Class 9A', grade: '9', section: 'A' },
      error: null,
    };
    mockTeacherResult = { data: { id: 'tch-1' }, error: null };
    mockAssignmentResult = {
      data: { id: 'assign-1', class_id: 'cls-1', teacher_id: 'tch-1', role: 'teacher', is_active: true },
      error: null,
    };
  });

  it('returns 403 when not authorized', async () => {
    makeAuthFailed();
    const res = await PATCH(makeReq({ teacher_id: 'tch-1' }), { params: Promise.resolve({ classId: 'cls-1' }) });
    expect(res.status).toBe(403);
  });

  it('returns 400 when teacher_id is missing', async () => {
    makeAuthPassed();
    const res = await PATCH(makeReq({}), { params: Promise.resolve({ classId: 'cls-1' }) });
    expect(res.status).toBe(400);
  });

  it('returns 404 when class does not exist in this school', async () => {
    makeAuthPassed();
    mockClassResult = { data: null, error: null };
    const res = await PATCH(makeReq({ teacher_id: 'tch-1' }), { params: Promise.resolve({ classId: 'nonexistent' }) });
    expect(res.status).toBe(404);
  });

  it('returns 404 when teacher does not belong to this school (cross-school protection)', async () => {
    makeAuthPassed();
    mockTeacherResult = { data: null, error: null };
    const res = await PATCH(makeReq({ teacher_id: 'tch-other-school' }), {
      params: Promise.resolve({ classId: 'cls-1' }),
    });
    expect(res.status).toBe(404);
  });

  it('returns 200 with assignment data and teacher_id on success', async () => {
    makeAuthPassed();
    const res = await PATCH(makeReq({ teacher_id: 'tch-1' }), { params: Promise.resolve({ classId: 'cls-1' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.teacher_id).toBe('tch-1');      // assigned teacher
    expect(body.data.grade).toBe('9');                // P5: grade as string
    expect(body.data.assignment_id).toBe('assign-1'); // from class_teachers row
    expect(body.data.role).toBe('teacher');
    expect(body.data.is_active).toBe(true);
  });

  it('returns 500 when class_teachers upsert fails', async () => {
    makeAuthPassed();
    mockAssignmentResult = { data: null, error: { message: 'DB error' } };
    const res = await PATCH(makeReq({ teacher_id: 'tch-1' }), { params: Promise.resolve({ classId: 'cls-1' }) });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.success).toBe(false);
  });
});
