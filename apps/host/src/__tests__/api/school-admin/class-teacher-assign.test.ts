/**
 * Tests for PATCH /api/school-admin/classes/[classId]
 * P2: assign a teacher to a class
 * P8: validates class + teacher both belong to admin school (cross-school prevention)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@alfanumrik/lib/school-admin-auth', () => ({
  authorizeSchoolAdmin: vi.fn(),
}));

vi.mock('@alfanumrik/lib/audit', () => ({ logSchoolAudit: vi.fn() }));
vi.mock('@alfanumrik/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn() } }));

// Teacher assignment lives in the class_teachers junction table — the classes
// table has NO teacher_id column. The route SELECTs the class (tenant check),
// SELECTs the teacher (cross-school check), then UPSERTs into class_teachers.
let mockClassResult: any = {
  data: { id: 'cls-1', name: 'Class 9A', grade: '9', section: 'A' },
  error: null,
};
let mockTeacherResult: any = { data: { id: 'tch-1' }, error: null };
let mockAssignmentResult: any = {
  data: {
    id: 'asg-1',
    class_id: 'cls-1',
    teacher_id: 'tch-1',
    role: 'teacher',
    is_active: true,
  },
  error: null,
};

vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      if (table === 'classes') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                is: () => ({ maybeSingle: vi.fn().mockResolvedValue(mockClassResult) }),
                maybeSingle: vi.fn().mockResolvedValue(mockClassResult),
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
        return {
          upsert: () => ({
            select: () => ({ single: vi.fn().mockResolvedValue(mockAssignmentResult) }),
          }),
        };
      }
      return {};
    },
  }),
}));

import { authorizeSchoolAdmin } from '@alfanumrik/lib/school-admin-auth';
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
      data: {
        id: 'asg-1',
        class_id: 'cls-1',
        teacher_id: 'tch-1',
        role: 'teacher',
        is_active: true,
      },
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

  it('returns 200 with updated class including teacher_id on success', async () => {
    makeAuthPassed();
    const res = await PATCH(makeReq({ teacher_id: 'tch-1' }), { params: Promise.resolve({ classId: 'cls-1' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.teacher_id).toBe('tch-1');
    expect(body.data.grade).toBe('9'); // P5: grade as string
  });
});
