/**
 * Track B, Feature 2 — POST /api/teacher/join-class
 *
 * Contract under test:
 *   1. Joins via class_code → inserts a class_teachers row (role 'teacher'),
 *      returns 200 alreadyJoined:false.
 *   2. Idempotent: an already-joined teacher → 200 alreadyJoined:true, no second
 *      insert.
 *   3. Idempotent under race: a 23505 unique-violation on insert is treated as
 *      an idempotent success (alreadyJoined:true), not a 500.
 *   4. Tenant-safe: a body-supplied school_id is IGNORED; a teacher with no
 *      school ADOPTS the class's school (never a foreign one). A teacher who
 *      already has a school is never reassigned.
 *   5. Unknown / inactive / deleted code → generic 404.
 *   6. Auth gate — authorizeRequest('class.manage') failure propagates.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { readFileSync } from 'fs';
import path from 'path';

const _authorizeImpl = vi.fn();
vi.mock('@alfanumrik/lib/rbac', () => ({
  authorizeRequest: (...args: unknown[]) => _authorizeImpl(...args),
}));

vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ getAll: () => [] })),
}));

// ── RLS-scoped RPC backing store: teachers / classes / class_teachers ───────
const TEACHER_AUTH = 'auth-teacher-1';
const TEACHER_ID = 'teacher-id-1';
const CLASS_ID = 'class-id-1';
const CLASS_SCHOOL = 'school-of-class';
const FOREIGN_SCHOOL = 'foreign-school-999';

interface TeacherRow {
  id: string;
  auth_user_id: string;
  school_id: string | null;
}
interface ClassRow {
  id: string;
  school_id: string | null;
  class_code: string;
  is_active: boolean;
  deleted_at: string | null;
}
interface CTRow {
  id: string;
  class_id: string;
  teacher_id: string;
  role: string;
  is_active: boolean;
}

let teachers: TeacherRow[];
let classes: ClassRow[];
let classTeachers: CTRow[];
let ctSeq: number;
let insertCount: number;
let currentAuthUserId: string;
// When true, the next class_teachers insert simulates a 23505 race loser.
let forceUniqueViolation: boolean;

function freshStore() {
  teachers = [{ id: TEACHER_ID, auth_user_id: TEACHER_AUTH, school_id: null }];
  classes = [
    {
      id: CLASS_ID,
      school_id: CLASS_SCHOOL,
      class_code: 'JOINME8A',
      is_active: true,
      deleted_at: null,
    },
    {
      id: 'class-inactive',
      school_id: CLASS_SCHOOL,
      class_code: 'INACTIVE9',
      is_active: false,
      deleted_at: null,
    },
  ];
  classTeachers = [];
  ctSeq = 1;
  insertCount = 0;
  currentAuthUserId = TEACHER_AUTH;
  forceUniqueViolation = false;
}

function rpcTeacherJoinClassByCode(params: { p_class_code: string }) {
  const teacher = teachers.find((row) => row.auth_user_id === currentAuthUserId);
  if (!teacher) {
    return { success: false, status: 403, error: 'Teacher account not found' };
  }

  const klass = classes.find(
    (row) =>
      row.class_code === params.p_class_code &&
      row.is_active === true &&
      row.deleted_at === null,
  );
  if (!klass) {
    return { success: false, status: 404, error: 'No active class found for this code' };
  }

  const existing = classTeachers.find(
    (row) => row.class_id === klass.id && row.teacher_id === teacher.id,
  );
  if (existing) {
    if (!teacher.school_id && klass.school_id) teacher.school_id = klass.school_id;
    return { success: true, data: { classId: klass.id, alreadyJoined: true } };
  }

  insertCount++;
  if (forceUniqueViolation) {
    if (!teacher.school_id && klass.school_id) teacher.school_id = klass.school_id;
    return { success: true, data: { classId: klass.id, alreadyJoined: true } };
  }

  classTeachers.push({
    id: `ct-${ctSeq++}`,
    class_id: klass.id,
    teacher_id: teacher.id,
    role: 'teacher',
    is_active: true,
  });
  if (!teacher.school_id && klass.school_id) teacher.school_id = klass.school_id;
  return { success: true, data: { classId: klass.id, alreadyJoined: false } };
}

vi.mock('@supabase/ssr', () => ({
  createServerClient: vi.fn(() => ({
    rpc: vi.fn(async (name: string, params: { p_class_code: string }) => {
      if (name !== 'teacher_join_class_by_code') {
        return { data: null, error: { message: `unexpected rpc ${name}` } };
      }
      return { data: rpcTeacherJoinClassByCode(params), error: null };
    }),
  })),
}));

import { POST } from '@/app/api/teacher/join-class/route';

function setAuth(opts: { authorized?: boolean; userId?: string } = {}) {
  if (opts.authorized === false) {
    _authorizeImpl.mockResolvedValue({
      authorized: false,
      errorResponse: new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }),
    });
    return;
  }
  currentAuthUserId = opts.userId ?? TEACHER_AUTH;
  _authorizeImpl.mockResolvedValue({
    authorized: true,
    userId: opts.userId ?? TEACHER_AUTH,
    studentId: null,
    roles: ['teacher'],
    permissions: ['class.manage'],
    schoolId: null,
  });
}

function makePost(body: unknown) {
  return new NextRequest('http://localhost/api/teacher/join-class', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  freshStore();
  setAuth();
});

describe('POST /api/teacher/join-class', () => {
  it('uses the authenticated RPC path instead of importing a service-role client', () => {
    const routeSource = readFileSync(
      path.resolve(__dirname, '../../../app/api/teacher/join-class/route.ts'),
      'utf8',
    );
    expect(routeSource).not.toContain('@alfanumrik/lib/supabase-admin');
    expect(routeSource).toContain('createServerClient');
    expect(routeSource).toContain('teacher_join_class_by_code');
    expect(routeSource).toContain('RLS-scoped');
  });

  it('joins a class via code and inserts a class_teachers row (role teacher)', async () => {
    const res = await POST(makePost({ class_code: 'JOINME8A' }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data).toEqual({ classId: CLASS_ID, alreadyJoined: false });

    expect(classTeachers).toHaveLength(1);
    expect(classTeachers[0]).toMatchObject({
      class_id: CLASS_ID,
      teacher_id: TEACHER_ID,
      role: 'teacher',
      is_active: true,
    });
  });

  it('is idempotent: an already-joined teacher returns 200 alreadyJoined:true with no new insert', async () => {
    classTeachers.push({ id: 'ct-existing', class_id: CLASS_ID, teacher_id: TEACHER_ID, role: 'teacher', is_active: true });
    const res = await POST(makePost({ class_code: 'JOINME8A' }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.alreadyJoined).toBe(true);
    // No additional class_teachers insert.
    expect(insertCount).toBe(0);
    expect(classTeachers).toHaveLength(1);
  });

  it('treats a 23505 insert race as idempotent success (alreadyJoined:true), not a 500', async () => {
    forceUniqueViolation = true;
    const res = await POST(makePost({ class_code: 'JOINME8A' }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.alreadyJoined).toBe(true);
  });

  it('tenant-safe: a body school_id is IGNORED; the teacher adopts the class\'s school', async () => {
    const res = await POST(makePost({ class_code: 'JOINME8A', school_id: FOREIGN_SCHOOL }));
    expect(res.status).toBe(200);
    // Teacher adopted the CLASS's school, never the body-supplied foreign one.
    expect(teachers[0].school_id).toBe(CLASS_SCHOOL);
    expect(teachers[0].school_id).not.toBe(FOREIGN_SCHOOL);
  });

  it('does not overwrite a teacher\'s existing school when joining', async () => {
    teachers[0].school_id = 'teacher-existing-school';
    const res = await POST(makePost({ class_code: 'JOINME8A' }));
    expect(res.status).toBe(200);
    // Existing school preserved (adoptClassSchool guards on null).
    expect(teachers[0].school_id).toBe('teacher-existing-school');
  });

  it('returns a generic 404 for an unknown code', async () => {
    const res = await POST(makePost({ class_code: 'NOPECODE' }));
    expect(res.status).toBe(404);
    expect(classTeachers).toHaveLength(0);
  });

  it('returns 404 for an inactive class code', async () => {
    const res = await POST(makePost({ class_code: 'INACTIVE9' }));
    expect(res.status).toBe(404);
  });

  it('returns 400 when class_code is missing/invalid', async () => {
    const res = await POST(makePost({ class_code: 'bad code!' }));
    expect(res.status).toBe(400);
  });

  it('returns 403 when the auth user has no teacher record', async () => {
    setAuth({ userId: 'auth-unknown' });
    const res = await POST(makePost({ class_code: 'JOINME8A' }));
    expect(res.status).toBe(403);
  });

  it('propagates the auth failure from authorizeRequest', async () => {
    setAuth({ authorized: false });
    const res = await POST(makePost({ class_code: 'JOINME8A' }));
    expect(res.status).toBe(403);
  });
});
