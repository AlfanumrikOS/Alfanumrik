/**
 * /api/teacher/remediation — Phase 3A Wave A / A2 contract tests.
 *
 * Pins:
 *   1. authorizeRequest gate fires with `class.assign_remediation` and returns
 *      the auth errorResponse verbatim when not authorized (401/403).
 *   2. 403 when the caller has no teacher profile.
 *   3. 403 (no insert) unless the exact requested class is active in the
 *      teacher's school with active teacher and student membership rows.
 *   4. Happy path: exact-class roster verification and curriculum scope produce
 *      the assignment with internal teacher identity. 201.
 *   5. Idempotency: when an OPEN (assigned|in_progress) row already exists for
 *      (teacher, student, class, chapter), it is returned (no duplicate insert).
 *   6. 400 when class_id or student_id is not a UUID.
 *   7. GET lists the caller-teacher's assignments, roster-scoped (eq teacher_id),
 *      with optional status/class filters.
 *
 * Mocking follows the established teacher/parent route pattern
 * (src/__tests__/api/v2/parent/encourage/route.test.ts): authorizeRequest is
 * stubbed via @alfanumrik/lib/rbac, logger via @alfanumrik/lib/logger, and supabaseAdmin is replaced
 * with a tiny in-memory query builder driven by a per-table state object that
 * supports the exact chain calls the route makes.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mock holders ──────────────────────────────────────────────
const holders = vi.hoisted(() => ({
  mockAuthorize: vi.fn(),
  mockInsert: vi.fn(),
  mockState: {} as {
    teacher?: { id: string; school_id: string | null; is_active?: boolean; deleted_at?: string | null } | null;
    teacherError?: { message: string } | null;
    classRow?: { id: string; school_id: string | null; grade: string; subject: string | null; is_active?: boolean; deleted_at?: string | null } | null;
    classError?: { message: string } | null;
    teacherClass?: { class_id: string; teacher_id?: string; is_active?: boolean } | null;
    teacherClassError?: { message: string } | null;
    enrolment?: { class_id: string; student_id?: string; is_active?: boolean } | null;
    enrolmentError?: { message: string } | null;
    student?: { id: string; school_id?: string | null; is_active?: boolean; deleted_at?: string | null } | null;
    studentError?: { message: string } | null;
    topic?: { id: string; subject_id: string; grade?: string; is_active?: boolean; content_status?: string; deleted_at?: string | null } | null;
    topicError?: { message: string } | null;
    subject?: { id: string; code: string; name: string; is_active?: boolean } | null;
    subjectError?: { message: string } | null;
    sourceAlert?: { id: string; student_id?: string; class_id?: string; teacher_id?: string; is_active?: boolean } | null;
    sourceAlertError?: { message: string } | null;
    existingOpen?: Record<string, unknown> | null;
    existingOpenError?: { message: string } | null;
    insertResult?: {
      data: Record<string, unknown> | null;
      error: { code?: string; message: string } | null;
    };
    listRows?: Array<Record<string, unknown>>;
    listError?: { message: string } | null;
    // 23505 survivor-lookup result (the post-insert dedupe recovery path).
    dedupeRow?: Record<string, unknown> | null;
    dedupeRowError?: { message: string } | null;
  },
  // Capture filters applied to the list query so we can assert roster-scoping.
  listFilters: {} as Record<string, unknown>,
  tableFilters: {} as Record<string, Record<string, unknown>>,
  idempotencyFilters: {} as Record<string, unknown>,
  // Capture the idempotency chapter filter (eq vs is null).
  idempotencyChapterFilter: { kind: '', value: undefined as unknown },
  // Capture the 23505 survivor-lookup filters (natural key of the unique index).
  dedupeFilters: {} as Record<string, unknown>,
  dedupeChapterFilter: { kind: '', value: undefined as unknown },
}));

vi.mock('@alfanumrik/lib/rbac', async () => {
  // Keep the REAL resolveTeacherIdentity / resolveTeacherRosterScope (the
  // route now delegates its roster-resolution to these canonical helpers,
  // which read through the SAME mocked `supabaseAdmin` client below) — only
  // authorizeRequest is stubbed.
  const actual = await vi.importActual<typeof import('@alfanumrik/lib/rbac')>('@alfanumrik/lib/rbac');
  return {
    ...actual,
    authorizeRequest: (...a: unknown[]) => holders.mockAuthorize(...a),
  };
});

vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('@alfanumrik/lib/supabase-admin', () => {
  function singleRowChain(
    table: string,
    row: Record<string, unknown> | null | undefined,
    error: { message: string } | null | undefined,
  ) {
    const filters: Record<string, unknown> = {};
    holders.tableFilters[table] = filters;
    const matches = (candidate: Record<string, unknown>) =>
      Object.entries(filters).every(([column, value]) => {
        if (!Object.prototype.hasOwnProperty.call(candidate, column)) return true;
        return Array.isArray(value) ? value.includes(candidate[column]) : candidate[column] === value;
      });
    const chain = {
      eq(column: string, value: unknown) {
        filters[column] = value;
        return chain;
      },
      is(column: string, value: unknown) {
        filters[column] = value;
        return chain;
      },
      in(column: string, value: unknown[]) {
        filters[column] = value;
        return chain;
      },
      limit() {
        return chain;
      },
      maybeSingle() {
        const filtered = row && matches(row) ? row : null;
        return Promise.resolve({
          data: filtered,
          error: error ?? null,
        });
      },
      then(resolve: (value: { data: unknown; error: unknown }) => unknown) {
        const data = row && matches(row) ? [row] : [];
        return Promise.resolve({ data, error: error ?? null }).then(resolve);
      },
    };
    return chain;
  }

  // ── teacher_remediation_assignments SELECT chain ──
  // Serves THREE route queries, disambiguated at the terminal call:
  //   - GET list             → terminates on awaited .limit(500)   (then)
  //   - POST pre-check       → .in('status', OPEN) … .maybeSingle()
  //   - POST 23505 survivor  → .eq('status','assigned') … .maybeSingle()
  //     lookup                 (never calls .in — that's the discriminator)
  function remediationSelectChain() {
    const filters: Record<string, unknown> = {};
    const chapterFilter = { kind: '', value: undefined as unknown };
    let usedIn = false;
    const chain = {
      eq(col: string, val: unknown) {
        filters[col] = val;
        holders.listFilters[col] = val;
        if (col === 'chapter_id') {
          chapterFilter.kind = 'eq';
          chapterFilter.value = val;
        }
        return chain;
      },
      in(col: string, val: unknown[]) {
        usedIn = true;
        filters[col] = val;
        holders.listFilters[col] = val;
        return chain;
      },
      is(col: string, val: unknown) {
        if (col === 'chapter_id') {
          chapterFilter.kind = 'is_null';
          chapterFilter.value = val;
        }
        return chain;
      },
      order() {
        return chain;
      },
      limit() {
        return {
          // GET list path terminates on .limit(500) (awaited array).
          then(resolve: (v: { data: unknown; error: unknown }) => unknown) {
            return Promise.resolve({
              data: holders.mockState.listRows ?? [],
              error: holders.mockState.listError ?? null,
            }).then(resolve);
          },
          maybeSingle() {
            if (usedIn) {
              // POST idempotency pre-check (.in('status', OPEN_STATUSES)).
              holders.idempotencyFilters = { ...filters };
              holders.idempotencyChapterFilter.kind = chapterFilter.kind;
              holders.idempotencyChapterFilter.value = chapterFilter.value;
              return Promise.resolve({
                data: holders.mockState.existingOpen ?? null,
                error: holders.mockState.existingOpenError ?? null,
              });
            }
            // POST 23505 survivor lookup (.eq('status', 'assigned')).
            holders.dedupeFilters = { ...filters };
            holders.dedupeChapterFilter = { ...chapterFilter };
            return Promise.resolve({
              data: holders.mockState.dedupeRow ?? null,
              error: holders.mockState.dedupeRowError ?? null,
            });
          },
        };
      },
    };
    return chain;
  }

  // ── teacher_remediation_assignments INSERT chain ──
  function remediationInsertChain(payload: unknown) {
    holders.mockInsert(payload);
    return {
      select() {
        return {
          single() {
            const r =
              holders.mockState.insertResult ?? { data: null, error: null };
            return Promise.resolve(r);
          },
        };
      },
    };
  }

  const mockSupabaseAdmin = {
    from(table: string) {
      if (table === 'teachers') {
        return { select: () => singleRowChain(table, holders.mockState.teacher, holders.mockState.teacherError) };
      }
      if (table === 'classes') {
        return { select: () => singleRowChain(table, holders.mockState.classRow, holders.mockState.classError) };
      }
      if (table === 'class_teachers') {
        return { select: () => singleRowChain(table, holders.mockState.teacherClass, holders.mockState.teacherClassError) };
      }
      if (table === 'class_enrollments') {
        return { select: () => singleRowChain(table, holders.mockState.enrolment, holders.mockState.enrolmentError) };
      }
      if (table === 'students') {
        return { select: () => singleRowChain(table, holders.mockState.student, holders.mockState.studentError) };
      }
      if (table === 'curriculum_topics') {
        return { select: () => singleRowChain(table, holders.mockState.topic, holders.mockState.topicError) };
      }
      if (table === 'subjects') {
        return { select: () => singleRowChain(table, holders.mockState.subject, holders.mockState.subjectError) };
      }
      if (table === 'at_risk_alerts') {
        return { select: () => singleRowChain(table, holders.mockState.sourceAlert, holders.mockState.sourceAlertError) };
      }
      if (table === 'teacher_remediation_assignments') {
        return {
          select: () => remediationSelectChain(),
          insert: (payload: unknown) => remediationInsertChain(payload),
        };
      }
      throw new Error(`Unexpected table in test mock: ${table}`);
    },
  };

  return {
    supabaseAdmin: mockSupabaseAdmin,
    // The canonical roster resolver (packages/lib/src/rbac.ts) reads through
    // getSupabaseAdmin() rather than the `supabaseAdmin` proxy export — both
    // must point at the SAME mock table state.
    getSupabaseAdmin: () => mockSupabaseAdmin,
  };
});

// ── Fixture IDs (valid RFC4122 v4) ────────────────────────────────────
const TEACHER_AUTH = '11111111-1111-4111-a111-111111111111';
const TEACHER_ID = '22222222-2222-4222-a222-222222222222';
const STUDENT_ID = '33333333-3333-4333-a333-333333333333';
const CLASS_ID = '44444444-4444-4444-a444-444444444444';
const CHAPTER_ID = '55555555-5555-4555-a555-555555555555';
const ALERT_ID = '66666666-6666-4666-a666-666666666666';
const ASSIGNMENT_ID = '77777777-7777-4777-a777-777777777777';
const SCHOOL_ID = '88888888-8888-4888-a888-888888888888';
const SUBJECT_ID = '99999999-9999-4999-a999-999999999999';
const OTHER_CLASS_ID = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';

function makePost(body: unknown): Request {
  return new Request('http://localhost/api/teacher/remediation', {
    method: 'POST',
    headers: { Authorization: 'Bearer fake.jwt', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function makeScopedPost(overrides: Record<string, unknown> = {}): Request {
  return makePost({ class_id: CLASS_ID, student_id: STUDENT_ID, ...overrides });
}

function makeGet(qs = ''): Request {
  return new Request(`http://localhost/api/teacher/remediation${qs}`, {
    method: 'GET',
    headers: { Authorization: 'Bearer fake.jwt' },
  });
}

function authAsTeacher(authUserId: string = TEACHER_AUTH) {
  holders.mockAuthorize.mockResolvedValue({
    authorized: true,
    userId: authUserId,
    studentId: null,
    roles: ['teacher'],
    permissions: ['class.assign_remediation'],
  });
}

function teacherResolved() {
  holders.mockState.teacher = {
    id: TEACHER_ID,
    school_id: SCHOOL_ID,
    is_active: true,
    deleted_at: null,
  };
}

function rosterIncludes() {
  holders.mockState.classRow = {
    id: CLASS_ID,
    school_id: SCHOOL_ID,
    grade: 'Grade 7',
    subject: 'Mathematics',
    is_active: true,
    deleted_at: null,
  };
  holders.mockState.teacherClass = { class_id: CLASS_ID, teacher_id: TEACHER_ID, is_active: true };
  holders.mockState.enrolment = { class_id: CLASS_ID, student_id: STUDENT_ID, is_active: true };
  holders.mockState.student = {
    id: STUDENT_ID,
    school_id: SCHOOL_ID,
    is_active: true,
    deleted_at: null,
  };
  holders.mockState.topic = {
    id: CHAPTER_ID,
    subject_id: SUBJECT_ID,
    grade: '7',
    is_active: true,
    content_status: 'published',
    deleted_at: null,
  };
  holders.mockState.subject = {
    id: SUBJECT_ID,
    code: 'math',
    name: 'Mathematics',
    is_active: true,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  holders.mockState = {};
  holders.listFilters = {};
  holders.tableFilters = {};
  holders.idempotencyFilters = {};
  holders.idempotencyChapterFilter = { kind: '', value: undefined };
  holders.dedupeFilters = {};
  holders.dedupeChapterFilter = { kind: '', value: undefined };
  // Default insert returns a fresh assignment row.
  holders.mockState.insertResult = {
    data: {
      id: ASSIGNMENT_ID,
      teacher_id: TEACHER_ID,
      student_id: STUDENT_ID,
      class_id: CLASS_ID,
      chapter_id: null,
      source_alert_id: null,
      status: 'assigned',
      created_at: '2026-06-08T00:00:00Z',
      resolved_at: null,
    },
    error: null,
  };
});

// ── 1. Auth gate ──────────────────────────────────────────────────────
describe('POST /api/teacher/remediation — auth gate', () => {
  it('returns the authorizeRequest errorResponse when not authorized', async () => {
    const { POST } = await import('@/app/api/teacher/remediation/route');
    holders.mockAuthorize.mockResolvedValue({
      authorized: false,
      userId: null,
      studentId: null,
      roles: ['student'],
      permissions: [],
      errorResponse: new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }),
    });
    const res = await POST(makeScopedPost() as never);
    expect(res.status).toBe(403);
    expect(holders.mockInsert).not.toHaveBeenCalled();
  });

  it('asks authorizeRequest for the class.assign_remediation permission', async () => {
    const { POST } = await import('@/app/api/teacher/remediation/route');
    authAsTeacher();
    teacherResolved();
    rosterIncludes();
    await POST(makeScopedPost() as never);
    expect(holders.mockAuthorize).toHaveBeenCalledTimes(1);
    const [, perm] = holders.mockAuthorize.mock.calls[0];
    expect(perm).toBe('class.assign_remediation');
  });

  it('returns 401 verbatim when authorizeRequest yields a 401 errorResponse', async () => {
    const { POST } = await import('@/app/api/teacher/remediation/route');
    holders.mockAuthorize.mockResolvedValue({
      authorized: false,
      userId: null,
      studentId: null,
      roles: [],
      permissions: [],
      errorResponse: new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    });
    const res = await POST(makeScopedPost() as never);
    expect(res.status).toBe(401);
    expect(holders.mockInsert).not.toHaveBeenCalled();
  });
});

// ── 2. Validation ─────────────────────────────────────────────────────
describe('POST /api/teacher/remediation — validation', () => {
  it('requires a valid class_id', async () => {
    const { POST } = await import('@/app/api/teacher/remediation/route');
    authAsTeacher();

    const missing = await POST(makePost({ student_id: STUDENT_ID }) as never);
    const malformed = await POST(makeScopedPost({ class_id: 'not-a-uuid' }) as never);

    expect(missing.status).toBe(400);
    expect(malformed.status).toBe(400);
    expect(holders.mockInsert).not.toHaveBeenCalled();
  });

  it('returns 400 when student_id is not a UUID', async () => {
    const { POST } = await import('@/app/api/teacher/remediation/route');
    authAsTeacher();
    teacherResolved();
    const res = await POST(makeScopedPost({ student_id: 'not-a-uuid' }) as never);
    expect(res.status).toBe(400);
    expect(holders.mockInsert).not.toHaveBeenCalled();
  });

  it('returns 400 when chapter_id is present but not a UUID', async () => {
    const { POST } = await import('@/app/api/teacher/remediation/route');
    authAsTeacher();
    teacherResolved();
    const res = await POST(
      makeScopedPost({ chapter_id: 'nope' }) as never,
    );
    expect(res.status).toBe(400);
  });
});

// ── 3. Ownership / roster ─────────────────────────────────────────────
describe('POST /api/teacher/remediation — roster scope (P8)', () => {
  it('returns 403 when the caller has no teacher profile', async () => {
    const { POST } = await import('@/app/api/teacher/remediation/route');
    authAsTeacher();
    holders.mockState.teacher = null;
    const res = await POST(makeScopedPost() as never);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(holders.mockInsert).not.toHaveBeenCalled();
  });

  it('returns 403 (no insert) when the student is not on the caller roster', async () => {
    const { POST } = await import('@/app/api/teacher/remediation/route');
    authAsTeacher();
    teacherResolved();
    rosterIncludes();
    holders.mockState.enrolment = null;
    const res = await POST(makeScopedPost() as never);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/class or student/i);
    expect(holders.mockInsert).not.toHaveBeenCalled();
  });

  it('returns 403 when the teacher is not actively assigned to the selected class', async () => {
    const { POST } = await import('@/app/api/teacher/remediation/route');
    authAsTeacher();
    teacherResolved();
    rosterIncludes();
    holders.mockState.teacherClass = { class_id: CLASS_ID, teacher_id: TEACHER_ID, is_active: false };
    const res = await POST(makeScopedPost() as never);
    expect(res.status).toBe(403);
    expect(holders.mockInsert).not.toHaveBeenCalled();
  });

  it('does not substitute another shared class when the requested class is unauthorized', async () => {
    const { POST } = await import('@/app/api/teacher/remediation/route');
    authAsTeacher();
    teacherResolved();
    rosterIncludes();

    const res = await POST(makeScopedPost({ class_id: OTHER_CLASS_ID }) as never);

    expect(res.status).toBe(403);
    expect(holders.tableFilters.classes).toMatchObject({ id: OTHER_CLASS_ID, school_id: SCHOOL_ID });
    expect(holders.mockInsert).not.toHaveBeenCalled();
  });

  it('rejects an inactive student enrollment for the exact class', async () => {
    const { POST } = await import('@/app/api/teacher/remediation/route');
    authAsTeacher();
    teacherResolved();
    rosterIncludes();
    holders.mockState.enrolment = { class_id: CLASS_ID, student_id: STUDENT_ID, is_active: false };

    const res = await POST(makeScopedPost() as never);

    expect(res.status).toBe(403);
    expect(holders.tableFilters.class_enrollments).toMatchObject({
      class_id: CLASS_ID,
      student_id: STUDENT_ID,
      is_active: true,
    });
    expect(holders.mockInsert).not.toHaveBeenCalled();
  });

  it('rejects a class outside the teacher school', async () => {
    const { POST } = await import('@/app/api/teacher/remediation/route');
    authAsTeacher();
    teacherResolved();
    rosterIncludes();
    holders.mockState.classRow = {
      ...holders.mockState.classRow!,
      school_id: 'bbbbbbbb-bbbb-4bbb-abbb-bbbbbbbbbbbb',
    };

    const res = await POST(makeScopedPost() as never);

    expect(res.status).toBe(403);
    expect(holders.tableFilters.classes.school_id).toBe(SCHOOL_ID);
    expect(holders.mockInsert).not.toHaveBeenCalled();
  });
});

// ── 4. Happy path ─────────────────────────────────────────────────────
describe('POST /api/teacher/remediation — happy path', () => {
  it('uses the requested class when the same student belongs to multiple teacher classes', async () => {
    const { POST } = await import('@/app/api/teacher/remediation/route');
    authAsTeacher();
    teacherResolved();
    rosterIncludes();
    holders.mockState.classRow = { ...holders.mockState.classRow!, id: OTHER_CLASS_ID };
    holders.mockState.teacherClass = {
      class_id: OTHER_CLASS_ID,
      teacher_id: TEACHER_ID,
      is_active: true,
    };
    holders.mockState.enrolment = {
      class_id: OTHER_CLASS_ID,
      student_id: STUDENT_ID,
      is_active: true,
    };

    const res = await POST(makeScopedPost({ class_id: OTHER_CLASS_ID }) as never);

    expect(res.status).toBe(201);
    expect(holders.mockInsert).toHaveBeenCalledWith(expect.objectContaining({
      class_id: OTHER_CLASS_ID,
      student_id: STUDENT_ID,
      teacher_id: TEACHER_ID,
    }));
    expect(holders.idempotencyFilters.class_id).toBe(OTHER_CLASS_ID);
  });

  it('inserts a roster-verified assignment and returns it (201)', async () => {
    const { POST } = await import('@/app/api/teacher/remediation/route');
    authAsTeacher();
    teacherResolved();
    rosterIncludes();
    holders.mockState.sourceAlert = {
      id: ALERT_ID,
      student_id: STUDENT_ID,
      class_id: CLASS_ID,
      teacher_id: TEACHER_ID,
      is_active: true,
    };
    const res = await POST(
      makeScopedPost({ source_alert_id: ALERT_ID }) as never,
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.id).toBe(ASSIGNMENT_ID);
    expect(body.data.status).toBe('assigned');

    // Insert payload: teacher_id is the INTERNAL teachers.id (never auth.uid()),
    // class_id is caller-selected and verified against the exact roster rows.
    expect(holders.mockInsert).toHaveBeenCalledTimes(1);
    const payload = holders.mockInsert.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.teacher_id).toBe(TEACHER_ID);
    expect(payload.teacher_id).not.toBe(TEACHER_AUTH);
    expect(payload.student_id).toBe(STUDENT_ID);
    expect(payload.class_id).toBe(CLASS_ID);
    expect(payload.status).toBe('assigned');
    expect(payload.source_alert_id).toBe(ALERT_ID);
    expect(payload.chapter_id).toBeNull();
    expect(holders.tableFilters.class_teachers).toMatchObject({
      teacher_id: TEACHER_ID,
      class_id: CLASS_ID,
      is_active: true,
    });
    expect(holders.tableFilters.students).toMatchObject({
      id: STUDENT_ID,
      school_id: SCHOOL_ID,
      is_active: true,
      deleted_at: null,
    });
    expect(holders.tableFilters.at_risk_alerts).toMatchObject({
      id: ALERT_ID,
      student_id: STUDENT_ID,
      class_id: CLASS_ID,
      teacher_id: TEACHER_ID,
      is_active: true,
    });
  });

  it('rejects a source alert that is not owned by the roster learner and teacher', async () => {
    const { POST } = await import('@/app/api/teacher/remediation/route');
    authAsTeacher();
    teacherResolved();
    rosterIncludes();
    holders.mockState.sourceAlert = null;

    const res = await POST(
      makeScopedPost({ source_alert_id: ALERT_ID }) as never,
    );

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({
      success: false,
      error: expect.stringMatching(/source alert/i),
    });
    expect(holders.mockInsert).not.toHaveBeenCalled();
  });

  it('rejects a curriculum topic from another class grade', async () => {
    const { POST } = await import('@/app/api/teacher/remediation/route');
    authAsTeacher();
    teacherResolved();
    rosterIncludes();
    holders.mockState.topic = { ...holders.mockState.topic!, grade: '8' };

    const res = await POST(makeScopedPost({ chapter_id: CHAPTER_ID }) as never);

    expect(res.status).toBe(403);
    expect(holders.tableFilters.curriculum_topics).toMatchObject({
      id: CHAPTER_ID,
      grade: '7',
      is_active: true,
      content_status: 'published',
      deleted_at: null,
    });
    expect(holders.mockInsert).not.toHaveBeenCalled();
  });

  it('rejects a curriculum topic from another class subject', async () => {
    const { POST } = await import('@/app/api/teacher/remediation/route');
    authAsTeacher();
    teacherResolved();
    rosterIncludes();
    holders.mockState.subject = {
      id: SUBJECT_ID,
      code: 'science',
      name: 'Science',
      is_active: true,
    };

    const res = await POST(makeScopedPost({ chapter_id: CHAPTER_ID }) as never);

    expect(res.status).toBe(403);
    expect(holders.mockInsert).not.toHaveBeenCalled();
  });

  it('rejects a draft or inactive curriculum topic', async () => {
    const { POST } = await import('@/app/api/teacher/remediation/route');
    authAsTeacher();
    teacherResolved();
    rosterIncludes();
    holders.mockState.topic = {
      ...holders.mockState.topic!,
      content_status: 'draft',
      is_active: false,
    };

    const res = await POST(makeScopedPost({ chapter_id: CHAPTER_ID }) as never);

    expect(res.status).toBe(403);
    expect(holders.mockInsert).not.toHaveBeenCalled();
  });

  it('uses an eq chapter_id filter for the idempotency check when chapter_id is provided', async () => {
    const { POST } = await import('@/app/api/teacher/remediation/route');
    authAsTeacher();
    teacherResolved();
    rosterIncludes();
    await POST(makeScopedPost({ chapter_id: CHAPTER_ID }) as never);
    expect(holders.idempotencyChapterFilter.kind).toBe('eq');
    expect(holders.idempotencyChapterFilter.value).toBe(CHAPTER_ID);
    expect(holders.idempotencyFilters.class_id).toBe(CLASS_ID);
    expect(holders.tableFilters.curriculum_topics).toMatchObject({
      id: CHAPTER_ID,
      grade: '7',
      is_active: true,
      content_status: 'published',
      deleted_at: null,
    });
    expect(holders.tableFilters.subjects).toMatchObject({ id: SUBJECT_ID, is_active: true });
    const payload = holders.mockInsert.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.chapter_id).toBe(CHAPTER_ID);
  });

  it('uses an is-null chapter_id filter for general (no-chapter) remediation', async () => {
    const { POST } = await import('@/app/api/teacher/remediation/route');
    authAsTeacher();
    teacherResolved();
    rosterIncludes();
    await POST(makeScopedPost() as never);
    expect(holders.idempotencyChapterFilter.kind).toBe('is_null');
    expect(holders.idempotencyChapterFilter.value).toBeNull();
  });
});

// ── 5. Idempotency ────────────────────────────────────────────────────
describe('POST /api/teacher/remediation — idempotency', () => {
  it('returns the existing OPEN assignment without inserting a duplicate (200)', async () => {
    const { POST } = await import('@/app/api/teacher/remediation/route');
    authAsTeacher();
    teacherResolved();
    rosterIncludes();
    holders.mockState.existingOpen = {
      id: ASSIGNMENT_ID,
      teacher_id: TEACHER_ID,
      student_id: STUDENT_ID,
      class_id: CLASS_ID,
      chapter_id: CHAPTER_ID,
      source_alert_id: null,
      status: 'in_progress',
      created_at: '2026-06-01T00:00:00Z',
      resolved_at: null,
    };
    const res = await POST(
      makeScopedPost({ chapter_id: CHAPTER_ID }) as never,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.idempotent).toBe(true);
    expect(body.data.id).toBe(ASSIGNMENT_ID);
    expect(body.data.status).toBe('in_progress');
    expect(holders.idempotencyFilters.class_id).toBe(CLASS_ID);
    // No duplicate written.
    expect(holders.mockInsert).not.toHaveBeenCalled();
  });
});

// ── 5b. DB-backstop dedupe: 23505 → idempotent success ────────────────
// The partial unique index is keyed (student_id, class_id, chapter-bucket) for
// every open status. A colleague's row is intentionally invisible to the
// per-teacher pre-check and must stay private on the insert-conflict path.
describe('POST /api/teacher/remediation — 23505 unique-violation dedupe (cross-teacher)', () => {
  const UNIQUE_VIOLATION = {
    code: '23505',
    message:
      'duplicate key value violates unique constraint "uq_teacher_remediation_assignments_open_dedupe"',
  };

  it('acknowledges the named conflict without reading or disclosing the colleague row', async () => {
    const { POST } = await import('@/app/api/teacher/remediation/route');
    authAsTeacher();
    teacherResolved();
    rosterIncludes();
    holders.mockState.existingOpen = null; // per-teacher pre-check sees nothing
    holders.mockState.insertResult = { data: null, error: UNIQUE_VIOLATION };

    const res = await POST(
      makeScopedPost({ chapter_id: CHAPTER_ID }) as never,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true, idempotent: true });
    expect(JSON.stringify(body)).not.toContain('teacher_id');
    expect(JSON.stringify(body)).not.toContain(ASSIGNMENT_ID);

    // The insert WAS attempted (the pre-check could not see the colleague's
    // row) — this is the post-insert recovery path, not the pre-check path.
    expect(holders.mockInsert).toHaveBeenCalledTimes(1);

    expect(holders.dedupeFilters).toEqual({});
  });

  it('does not treat an unrelated 23505 as the remediation idempotency contract', async () => {
    const { POST } = await import('@/app/api/teacher/remediation/route');
    authAsTeacher();
    teacherResolved();
    rosterIncludes();
    holders.mockState.existingOpen = null;
    holders.mockState.insertResult = {
      data: null,
      error: { code: '23505', message: 'duplicate key value violates unique constraint "other_key"' },
    };

    const res = await POST(makeScopedPost() as never);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toMatchObject({ success: false, error: 'Failed to assign remediation' });
  });

  it('a NON-23505 insert error still fails with 500 (handling not widened)', async () => {
    const { POST } = await import('@/app/api/teacher/remediation/route');
    authAsTeacher();
    teacherResolved();
    rosterIncludes();
    holders.mockState.existingOpen = null;
    holders.mockState.insertResult = {
      data: null,
      error: { code: '23503', message: 'foreign key violation' },
    };
    const res = await POST(
      makeScopedPost({ chapter_id: CHAPTER_ID }) as never,
    );
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(holders.dedupeFilters).toEqual({});
  });
});

// ── 6. GET list ───────────────────────────────────────────────────────
describe('GET /api/teacher/remediation — list', () => {
  it('returns the authorizeRequest errorResponse when not authorized', async () => {
    const { GET } = await import('@/app/api/teacher/remediation/route');
    holders.mockAuthorize.mockResolvedValue({
      authorized: false,
      userId: null,
      studentId: null,
      roles: [],
      permissions: [],
      errorResponse: new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    });
    const res = await GET(makeGet() as never);
    expect(res.status).toBe(401);
  });

  it('lists the caller-teacher assignments scoped by teacher_id (200)', async () => {
    const { GET } = await import('@/app/api/teacher/remediation/route');
    authAsTeacher();
    teacherResolved();
    rosterIncludes();
    holders.mockState.listRows = [
      {
        id: ASSIGNMENT_ID,
        teacher_id: TEACHER_ID,
        student_id: STUDENT_ID,
        class_id: CLASS_ID,
        chapter_id: CHAPTER_ID,
        source_alert_id: null,
        status: 'assigned',
        created_at: '2026-06-08T00:00:00Z',
        resolved_at: null,
      },
    ];
    const res = await GET(makeGet() as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data).toHaveLength(1);
    // Roster scope: the list query filtered by the internal teacher id.
    expect(holders.listFilters.teacher_id).toBe(TEACHER_ID);
    expect(holders.listFilters.class_id).toEqual([CLASS_ID]);
  });

  it('applies a status filter when provided', async () => {
    const { GET } = await import('@/app/api/teacher/remediation/route');
    authAsTeacher();
    teacherResolved();
    rosterIncludes();
    holders.mockState.listRows = [];
    const res = await GET(makeGet('?status=resolved') as never);
    expect(res.status).toBe(200);
    expect(holders.listFilters.status).toBe('resolved');
  });

  it('hides historical rows after the teacher-class membership is revoked', async () => {
    const { GET } = await import('@/app/api/teacher/remediation/route');
    authAsTeacher();
    teacherResolved();
    rosterIncludes();
    holders.mockState.teacherClass = {
      class_id: CLASS_ID,
      teacher_id: TEACHER_ID,
      is_active: false,
    };
    holders.mockState.listRows = [{
      id: ASSIGNMENT_ID,
      teacher_id: TEACHER_ID,
      student_id: STUDENT_ID,
      class_id: CLASS_ID,
    }];

    const res = await GET(makeGet() as never);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: [] });
  });

  it.each([
    { label: 'the class is inactive', schoolId: SCHOOL_ID, isActive: false },
    {
      label: 'the class no longer belongs to the teacher school',
      schoolId: 'bbbbbbbb-bbbb-4bbb-abbb-bbbbbbbbbbbb',
      isActive: true,
    },
  ])('hides rows when $label', async ({ schoolId, isActive }) => {
    const { GET } = await import('@/app/api/teacher/remediation/route');
    authAsTeacher();
    teacherResolved();
    rosterIncludes();
    holders.mockState.classRow = {
      id: CLASS_ID,
      school_id: schoolId,
      grade: 'Grade 7',
      subject: 'Mathematics',
      is_active: isActive,
      deleted_at: null,
    };
    holders.mockState.listRows = [{
      id: ASSIGNMENT_ID,
      teacher_id: TEACHER_ID,
      student_id: STUDENT_ID,
      class_id: CLASS_ID,
    }];

    const res = await GET(makeGet() as never);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: [] });
  });

  it('hides historical rows after the class enrollment is revoked', async () => {
    const { GET } = await import('@/app/api/teacher/remediation/route');
    authAsTeacher();
    teacherResolved();
    rosterIncludes();
    holders.mockState.enrolment = {
      class_id: CLASS_ID,
      student_id: STUDENT_ID,
      is_active: false,
    };
    holders.mockState.listRows = [{
      id: ASSIGNMENT_ID,
      teacher_id: TEACHER_ID,
      student_id: STUDENT_ID,
      class_id: CLASS_ID,
    }];

    const res = await GET(makeGet() as never);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: [] });
  });

  it('filters by the exact active class-student enrollment pair', async () => {
    const { GET } = await import('@/app/api/teacher/remediation/route');
    authAsTeacher();
    teacherResolved();
    rosterIncludes();
    holders.mockState.enrolment = {
      class_id: CLASS_ID,
      student_id: 'cccccccc-cccc-4ccc-accc-cccccccccccc',
      is_active: true,
    };
    holders.mockState.listRows = [{
      id: ASSIGNMENT_ID,
      teacher_id: TEACHER_ID,
      student_id: STUDENT_ID,
      class_id: CLASS_ID,
    }];

    const res = await GET(makeGet() as never);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: [] });
  });

  it('rejects an explicitly requested class outside the live teacher scope', async () => {
    const { GET } = await import('@/app/api/teacher/remediation/route');
    authAsTeacher();
    teacherResolved();
    rosterIncludes();

    const res = await GET(makeGet(`?class_id=${OTHER_CLASS_ID}`) as never);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ success: false });
  });

  it('rejects an invalid status filter (400)', async () => {
    const { GET } = await import('@/app/api/teacher/remediation/route');
    authAsTeacher();
    teacherResolved();
    const res = await GET(makeGet('?status=bogus') as never);
    expect(res.status).toBe(400);
  });

  it('returns 403 when the caller has no teacher profile', async () => {
    const { GET } = await import('@/app/api/teacher/remediation/route');
    authAsTeacher();
    holders.mockState.teacher = null;
    const res = await GET(makeGet() as never);
    expect(res.status).toBe(403);
  });
});
