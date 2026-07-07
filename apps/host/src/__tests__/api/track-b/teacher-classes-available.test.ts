/**
 * Track B, Feature 2 — GET /api/teacher/classes/available?code=XXXX
 *
 * Contract under test:
 *   1. Valid code → 200 with non-PII class metadata (classId, name, grade,
 *      section, schoolName, alreadyJoined). Grade is a string (P5).
 *   2. Unknown / inactive / soft-deleted code → generic 404 (no existence leak,
 *      no school-tenant disclosure).
 *   3. Response carries NO student rows / emails / PII.
 *   4. alreadyJoined reflects an existing class_teachers membership.
 *   5. Auth gate — authorizeRequest('class.manage') failure propagates.
 *   6. Missing/invalid code → 400.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const _authorizeImpl = vi.fn();
vi.mock('@alfanumrik/lib/rbac', () => ({
  authorizeRequest: (...args: unknown[]) => _authorizeImpl(...args),
}));

vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ── supabase-admin: teachers / classes / schools / class_teachers ────────────
const TEACHER_AUTH = 'auth-teacher-1';
const TEACHER_ID = 'teacher-id-1';
const CLASS_ID = 'class-id-1';
const SCHOOL_ID = 'school-id-1';

interface ClassRow {
  id: string;
  name: string;
  grade: string;
  section: string;
  school_id: string | null;
  class_code: string;
  is_active: boolean;
  deleted_at: string | null;
}

let teachers: Array<{ id: string; auth_user_id: string; school_id: string | null }>;
let classes: ClassRow[];
let schools: Array<{ id: string; name: string }>;
let classTeachers: Array<{ id: string; class_id: string; teacher_id: string }>;

function freshStore() {
  teachers = [{ id: TEACHER_ID, auth_user_id: TEACHER_AUTH, school_id: null }];
  classes = [
    {
      id: CLASS_ID,
      name: 'Grade 8 Science',
      grade: '8',
      section: 'A',
      school_id: SCHOOL_ID,
      class_code: 'JOINME8A',
      is_active: true,
      deleted_at: null,
    },
    {
      id: 'class-inactive',
      name: 'Old Class',
      grade: '9',
      section: 'B',
      school_id: SCHOOL_ID,
      class_code: 'INACTIVE9',
      is_active: false,
      deleted_at: null,
    },
    {
      id: 'class-deleted',
      name: 'Deleted Class',
      grade: '10',
      section: 'C',
      school_id: SCHOOL_ID,
      class_code: 'DELETED10',
      is_active: true,
      deleted_at: '2026-01-01T00:00:00Z',
    },
  ];
  schools = [{ id: SCHOOL_ID, name: 'Sunrise Public School' }];
  classTeachers = [];
}

function builder(table: 'teachers' | 'classes' | 'schools' | 'class_teachers') {
  const preds: Array<(r: Record<string, unknown>) => boolean> = [];
  const rows = (): Record<string, unknown>[] => {
    if (table === 'teachers') return teachers as unknown as Record<string, unknown>[];
    if (table === 'classes') return classes as unknown as Record<string, unknown>[];
    if (table === 'schools') return schools as unknown as Record<string, unknown>[];
    return classTeachers as unknown as Record<string, unknown>[];
  };
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: (col: string, val: unknown) => {
      preds.push((r) => r[col] === val);
      return chain;
    },
    is: (col: string, val: unknown) => {
      preds.push((r) => (val === null ? r[col] === null : r[col] === val));
      return chain;
    },
    maybeSingle: () => {
      const matched = rows().filter((r) => preds.every((p) => p(r)));
      return Promise.resolve({ data: matched[0] ?? null, error: null });
    },
  };
  return chain;
}

vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  supabaseAdmin: { from: (t: string) => builder(t as 'teachers' | 'classes' | 'schools' | 'class_teachers') },
  getSupabaseAdmin: () => ({ from: (t: string) => builder(t as 'teachers' | 'classes' | 'schools' | 'class_teachers') }),
}));

import { GET } from '@/app/api/teacher/classes/available/route';

function setAuth(opts: { authorized?: boolean; userId?: string } = {}) {
  if (opts.authorized === false) {
    _authorizeImpl.mockResolvedValue({
      authorized: false,
      errorResponse: new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }),
    });
    return;
  }
  _authorizeImpl.mockResolvedValue({
    authorized: true,
    userId: opts.userId ?? TEACHER_AUTH,
    studentId: null,
    roles: ['teacher'],
    permissions: ['class.manage'],
    schoolId: null,
  });
}

function makeGet(code?: string) {
  const url = code === undefined
    ? 'http://localhost/api/teacher/classes/available'
    : `http://localhost/api/teacher/classes/available?code=${encodeURIComponent(code)}`;
  return new NextRequest(url, { method: 'GET' });
}

beforeEach(() => {
  vi.clearAllMocks();
  freshStore();
  setAuth();
});

describe('GET /api/teacher/classes/available', () => {
  it('returns non-PII class metadata for a valid code', async () => {
    const res = await GET(makeGet('JOINME8A'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data).toEqual({
      classId: CLASS_ID,
      name: 'Grade 8 Science',
      grade: '8',
      section: 'A',
      schoolName: 'Sunrise Public School',
      alreadyJoined: false,
    });
    // P5: grade is a string.
    expect(typeof json.data.grade).toBe('string');
    // No student rosters / emails / PII leaked.
    const text = JSON.stringify(json);
    expect(text).not.toMatch(/student|email|phone|roster/i);
  });

  it('reports alreadyJoined:true when the teacher is already a member', async () => {
    classTeachers.push({ id: 'ct-1', class_id: CLASS_ID, teacher_id: TEACHER_ID });
    const res = await GET(makeGet('JOINME8A'));
    const json = await res.json();
    expect(json.data.alreadyJoined).toBe(true);
  });

  it('returns a generic 404 for an unknown code (no existence leak)', async () => {
    const res = await GET(makeGet('NOPECODE'));
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.success).toBe(false);
  });

  it('returns 404 for an inactive class code', async () => {
    const res = await GET(makeGet('INACTIVE9'));
    expect(res.status).toBe(404);
  });

  it('returns 404 for a soft-deleted class code', async () => {
    const res = await GET(makeGet('DELETED10'));
    expect(res.status).toBe(404);
  });

  it('returns 400 when the code is missing', async () => {
    const res = await GET(makeGet(undefined));
    expect(res.status).toBe(400);
  });

  it('returns 400 when the code has invalid characters', async () => {
    const res = await GET(makeGet('bad code!!'));
    expect(res.status).toBe(400);
  });

  it('propagates the auth failure from authorizeRequest', async () => {
    setAuth({ authorized: false });
    const res = await GET(makeGet('JOINME8A'));
    expect(res.status).toBe(403);
  });

  it('returns 403 when the auth user has no teacher record', async () => {
    setAuth({ userId: 'auth-unknown' });
    const res = await GET(makeGet('JOINME8A'));
    expect(res.status).toBe(403);
  });
});
