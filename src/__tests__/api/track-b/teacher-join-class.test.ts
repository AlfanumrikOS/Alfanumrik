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

const _authorizeImpl = vi.fn();
vi.mock('@/lib/rbac', () => ({
  authorizeRequest: (...args: unknown[]) => _authorizeImpl(...args),
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ── supabase-admin: teachers / classes / class_teachers ──────────────────────
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
  forceUniqueViolation = false;
}

function builder(table: 'teachers' | 'classes' | 'class_teachers') {
  const preds: Array<(r: Record<string, unknown>) => boolean> = [];
  let pendingInsert: Record<string, unknown> | null = null;
  let pendingPatch: Record<string, unknown> | null = null;

  const rows = (): Record<string, unknown>[] => {
    if (table === 'teachers') return teachers as unknown as Record<string, unknown>[];
    if (table === 'classes') return classes as unknown as Record<string, unknown>[];
    return classTeachers as unknown as Record<string, unknown>[];
  };

  function settle() {
    if (pendingInsert) {
      insertCount++;
      if (table === 'class_teachers' && forceUniqueViolation) {
        return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
      }
      const row = { id: `ct-${ctSeq++}`, ...pendingInsert } as unknown as CTRow;
      if (table === 'class_teachers') classTeachers.push(row);
      return { data: { id: row.id }, error: null };
    }
    if (pendingPatch) {
      const matched = rows().filter((r) => preds.every((p) => p(r)));
      for (const m of matched) Object.assign(m, pendingPatch);
      return { data: matched[0] ?? null, error: null };
    }
    const matched = rows().filter((r) => preds.every((p) => p(r)));
    return { data: matched, error: null };
  }

  const chain: Record<string, unknown> = {
    select: () => chain,
    insert: (v: Record<string, unknown>) => {
      pendingInsert = v;
      // Insert without .select()/.maybeSingle() resolves via thenable.
      return chain;
    },
    update: (v: Record<string, unknown>) => {
      pendingPatch = v;
      return chain;
    },
    eq: (col: string, val: unknown) => {
      preds.push((r) => r[col] === val);
      return chain;
    },
    is: (col: string, val: unknown) => {
      preds.push((r) => (val === null ? r[col] === null : r[col] === val));
      return chain;
    },
    maybeSingle: () => {
      const s = settle();
      const d = Array.isArray(s.data) ? s.data[0] ?? null : s.data;
      return Promise.resolve({ data: d, error: s.error });
    },
    // The insert/update paths are awaited directly (no maybeSingle) — thenable.
    then: (onF: (v: { data: unknown; error: unknown }) => unknown, onR?: (e: unknown) => unknown) =>
      Promise.resolve(settle()).then(onF, onR),
  };
  return chain;
}

vi.mock('@/lib/supabase-admin', () => {
  const client = { from: (t: string) => builder(t as 'teachers' | 'classes' | 'class_teachers') };
  return { supabaseAdmin: client, getSupabaseAdmin: () => client };
});

import { POST } from '@/app/api/teacher/join-class/route';

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
