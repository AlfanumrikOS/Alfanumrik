/**
 * /api/teacher/remediation — Phase 3A Wave A / A2 contract tests.
 *
 * Pins:
 *   1. authorizeRequest gate fires with `class.assign_remediation` and returns
 *      the auth errorResponse verbatim when not authorized (401/403).
 *   2. 403 when the caller has no teacher profile.
 *   3. 403 (no insert) when the requested student is NOT on the caller's roster
 *      (class_enrollments × class_teachers) — even with a well-formed UUID.
 *   4. Happy path: roster-verified insert returns the created assignment
 *      (status 'assigned', teacher_id = internal teachers.id, class_id from the
 *      roster join). 201.
 *   5. Idempotency: when an OPEN (assigned|in_progress) row already exists for
 *      (teacher, student, chapter), it is returned (no duplicate insert). 200.
 *   6. 400 when student_id is not a UUID.
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
    teacher?: { id: string; school_id: string | null } | null;
    teacherError?: { message: string } | null;
    teacherClasses?: Array<{ class_id: string | null }> | null;
    teacherClassesError?: { message: string } | null;
    enrolment?: { class_id: string } | null;
    enrolmentError?: { message: string } | null;
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
  // Capture the idempotency chapter filter (eq vs is null).
  idempotencyChapterFilter: { kind: '', value: undefined as unknown },
  // Capture the 23505 survivor-lookup filters (natural key of the unique index).
  dedupeFilters: {} as Record<string, unknown>,
  dedupeChapterFilter: { kind: '', value: undefined as unknown },
}));

vi.mock('@alfanumrik/lib/rbac', () => ({
  authorizeRequest: (...a: unknown[]) => holders.mockAuthorize(...a),
}));

vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('@alfanumrik/lib/supabase-admin', () => {
  // ── teachers: .select().eq().maybeSingle() ──
  function teachersChain() {
    const chain = {
      eq() {
        return chain;
      },
      maybeSingle() {
        return Promise.resolve({
          data: holders.mockState.teacher ?? null,
          error: holders.mockState.teacherError ?? null,
        });
      },
    };
    return chain;
  }

  // ── class_teachers: .select('class_id').eq('teacher_id', x)  (awaited array) ──
  function classTeachersChain() {
    const result = {
      data: holders.mockState.teacherClasses ?? [],
      error: holders.mockState.teacherClassesError ?? null,
    };
    const chain = {
      eq() {
        return chain;
      },
      then(resolve: (v: typeof result) => unknown) {
        return Promise.resolve(result).then(resolve);
      },
    };
    return chain;
  }

  // ── class_enrollments: .select().eq().in().limit().maybeSingle() ──
  function classEnrollmentsChain() {
    const chain = {
      eq() {
        return chain;
      },
      in() {
        return chain;
      },
      limit() {
        return chain;
      },
      maybeSingle() {
        return Promise.resolve({
          data: holders.mockState.enrolment ?? null,
          error: holders.mockState.enrolmentError ?? null,
        });
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
      in() {
        usedIn = true;
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

  return {
    supabaseAdmin: {
      from(table: string) {
        if (table === 'teachers') {
          return { select: () => teachersChain() };
        }
        if (table === 'class_teachers') {
          return { select: () => classTeachersChain() };
        }
        if (table === 'class_enrollments') {
          return { select: () => classEnrollmentsChain() };
        }
        if (table === 'teacher_remediation_assignments') {
          return {
            select: () => remediationSelectChain(),
            insert: (payload: unknown) => remediationInsertChain(payload),
          };
        }
        throw new Error(`Unexpected table in test mock: ${table}`);
      },
    },
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

function makePost(body: unknown): Request {
  return new Request('http://localhost/api/teacher/remediation', {
    method: 'POST',
    headers: { Authorization: 'Bearer fake.jwt', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
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
  holders.mockState.teacher = { id: TEACHER_ID, school_id: null };
}

function rosterIncludes() {
  holders.mockState.teacherClasses = [{ class_id: CLASS_ID }];
  holders.mockState.enrolment = { class_id: CLASS_ID };
}

beforeEach(() => {
  vi.clearAllMocks();
  holders.mockState = {};
  holders.listFilters = {};
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
    const res = await POST(makePost({ student_id: STUDENT_ID }) as never);
    expect(res.status).toBe(403);
    expect(holders.mockInsert).not.toHaveBeenCalled();
  });

  it('asks authorizeRequest for the class.assign_remediation permission', async () => {
    const { POST } = await import('@/app/api/teacher/remediation/route');
    authAsTeacher();
    teacherResolved();
    rosterIncludes();
    await POST(makePost({ student_id: STUDENT_ID }) as never);
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
    const res = await POST(makePost({ student_id: STUDENT_ID }) as never);
    expect(res.status).toBe(401);
    expect(holders.mockInsert).not.toHaveBeenCalled();
  });
});

// ── 2. Validation ─────────────────────────────────────────────────────
describe('POST /api/teacher/remediation — validation', () => {
  it('returns 400 when student_id is not a UUID', async () => {
    const { POST } = await import('@/app/api/teacher/remediation/route');
    authAsTeacher();
    teacherResolved();
    const res = await POST(makePost({ student_id: 'not-a-uuid' }) as never);
    expect(res.status).toBe(400);
    expect(holders.mockInsert).not.toHaveBeenCalled();
  });

  it('returns 400 when chapter_id is present but not a UUID', async () => {
    const { POST } = await import('@/app/api/teacher/remediation/route');
    authAsTeacher();
    teacherResolved();
    const res = await POST(
      makePost({ student_id: STUDENT_ID, chapter_id: 'nope' }) as never,
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
    const res = await POST(makePost({ student_id: STUDENT_ID }) as never);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(holders.mockInsert).not.toHaveBeenCalled();
  });

  it('returns 403 (no insert) when the student is not on the caller roster', async () => {
    const { POST } = await import('@/app/api/teacher/remediation/route');
    authAsTeacher();
    teacherResolved();
    // Teacher has classes, but the student is enrolled in none of them.
    holders.mockState.teacherClasses = [{ class_id: CLASS_ID }];
    holders.mockState.enrolment = null;
    const res = await POST(makePost({ student_id: STUDENT_ID }) as never);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/roster/i);
    expect(holders.mockInsert).not.toHaveBeenCalled();
  });

  it('returns 403 (no insert) when the teacher has no classes at all', async () => {
    const { POST } = await import('@/app/api/teacher/remediation/route');
    authAsTeacher();
    teacherResolved();
    holders.mockState.teacherClasses = [];
    const res = await POST(makePost({ student_id: STUDENT_ID }) as never);
    expect(res.status).toBe(403);
    expect(holders.mockInsert).not.toHaveBeenCalled();
  });
});

// ── 4. Happy path ─────────────────────────────────────────────────────
describe('POST /api/teacher/remediation — happy path', () => {
  it('inserts a roster-verified assignment and returns it (201)', async () => {
    const { POST } = await import('@/app/api/teacher/remediation/route');
    authAsTeacher();
    teacherResolved();
    rosterIncludes();
    const res = await POST(
      makePost({ student_id: STUDENT_ID, source_alert_id: ALERT_ID }) as never,
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.id).toBe(ASSIGNMENT_ID);
    expect(body.data.status).toBe('assigned');

    // Insert payload: teacher_id is the INTERNAL teachers.id (never auth.uid()),
    // class_id is derived from the roster join, status seeded 'assigned'.
    expect(holders.mockInsert).toHaveBeenCalledTimes(1);
    const payload = holders.mockInsert.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.teacher_id).toBe(TEACHER_ID);
    expect(payload.teacher_id).not.toBe(TEACHER_AUTH);
    expect(payload.student_id).toBe(STUDENT_ID);
    expect(payload.class_id).toBe(CLASS_ID);
    expect(payload.status).toBe('assigned');
    expect(payload.source_alert_id).toBe(ALERT_ID);
    expect(payload.chapter_id).toBeNull();
  });

  it('uses an eq chapter_id filter for the idempotency check when chapter_id is provided', async () => {
    const { POST } = await import('@/app/api/teacher/remediation/route');
    authAsTeacher();
    teacherResolved();
    rosterIncludes();
    await POST(makePost({ student_id: STUDENT_ID, chapter_id: CHAPTER_ID }) as never);
    expect(holders.idempotencyChapterFilter.kind).toBe('eq');
    expect(holders.idempotencyChapterFilter.value).toBe(CHAPTER_ID);
    const payload = holders.mockInsert.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.chapter_id).toBe(CHAPTER_ID);
  });

  it('uses an is-null chapter_id filter for general (no-chapter) remediation', async () => {
    const { POST } = await import('@/app/api/teacher/remediation/route');
    authAsTeacher();
    teacherResolved();
    rosterIncludes();
    await POST(makePost({ student_id: STUDENT_ID }) as never);
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
      makePost({ student_id: STUDENT_ID, chapter_id: CHAPTER_ID }) as never,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.idempotent).toBe(true);
    expect(body.data.id).toBe(ASSIGNMENT_ID);
    expect(body.data.status).toBe('in_progress');
    // No duplicate written.
    expect(holders.mockInsert).not.toHaveBeenCalled();
  });
});

// ── 5b. DB-backstop dedupe: 23505 → idempotent success ────────────────
// The partial unique index uq_teacher_remediation_assignments_open_dedupe
// (migration 20260619000400) is keyed (student_id, class_id, chapter-bucket)
// WHERE status='assigned' — teacher_id is NOT in the key. The route's
// per-teacher pre-check cannot see a COLLEAGUE's open row, so a cross-teacher
// duplicate surfaces as a 23505 on INSERT. The route must treat that as the
// idempotent-success path (200, surviving row), never a 500.
describe('POST /api/teacher/remediation — 23505 unique-violation dedupe (cross-teacher)', () => {
  const OTHER_TEACHER_ID = '88888888-8888-4888-a888-888888888888';
  const UNIQUE_VIOLATION = {
    code: '23505',
    message:
      'duplicate key value violates unique constraint "uq_teacher_remediation_assignments_open_dedupe"',
  };

  function survivorRow(chapterId: string | null) {
    return {
      id: ASSIGNMENT_ID,
      teacher_id: OTHER_TEACHER_ID, // a colleague's row — invisible to the pre-check
      student_id: STUDENT_ID,
      class_id: CLASS_ID,
      chapter_id: chapterId,
      source_alert_id: null,
      status: 'assigned',
      created_at: '2026-06-01T00:00:00Z',
      resolved_at: null,
    };
  }

  it('cross-teacher duplicate: 23505 returns the surviving row as idempotent success (200, not 500)', async () => {
    const { POST } = await import('@/app/api/teacher/remediation/route');
    authAsTeacher();
    teacherResolved();
    rosterIncludes();
    holders.mockState.existingOpen = null; // per-teacher pre-check sees nothing
    holders.mockState.insertResult = { data: null, error: UNIQUE_VIOLATION };
    holders.mockState.dedupeRow = survivorRow(CHAPTER_ID);

    const res = await POST(
      makePost({ student_id: STUDENT_ID, chapter_id: CHAPTER_ID }) as never,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    // Exact same envelope as the pre-check idempotent path.
    expect(body.success).toBe(true);
    expect(body.idempotent).toBe(true);
    expect(body.data.id).toBe(ASSIGNMENT_ID);
    expect(body.data.status).toBe('assigned');
    expect(body.data.teacher_id).toBe(OTHER_TEACHER_ID);

    // The insert WAS attempted (the pre-check could not see the colleague's
    // row) — this is the post-insert recovery path, not the pre-check path.
    expect(holders.mockInsert).toHaveBeenCalledTimes(1);

    // Survivor lookup keyed on the unique index's natural key — student,
    // class, chapter (eq), status='assigned' — and NOT teacher_id (a
    // teacher-scoped lookup would never find the colleague's row).
    expect(holders.dedupeFilters.student_id).toBe(STUDENT_ID);
    expect(holders.dedupeFilters.class_id).toBe(CLASS_ID);
    expect(holders.dedupeFilters.status).toBe('assigned');
    expect(holders.dedupeFilters.teacher_id).toBeUndefined();
    expect(holders.dedupeChapterFilter.kind).toBe('eq');
    expect(holders.dedupeChapterFilter.value).toBe(CHAPTER_ID);
  });

  it('general (no-chapter) duplicate: survivor lookup uses chapter_id IS NULL', async () => {
    const { POST } = await import('@/app/api/teacher/remediation/route');
    authAsTeacher();
    teacherResolved();
    rosterIncludes();
    holders.mockState.existingOpen = null;
    holders.mockState.insertResult = { data: null, error: UNIQUE_VIOLATION };
    holders.mockState.dedupeRow = survivorRow(null);

    const res = await POST(makePost({ student_id: STUDENT_ID }) as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.idempotent).toBe(true);
    expect(holders.dedupeChapterFilter.kind).toBe('is_null');
    expect(holders.dedupeChapterFilter.value).toBeNull();
    expect(holders.dedupeFilters.class_id).toBe(CLASS_ID);
  });

  it('23505 but the surviving row cannot be resolved → 500 (established failure response)', async () => {
    const { POST } = await import('@/app/api/teacher/remediation/route');
    authAsTeacher();
    teacherResolved();
    rosterIncludes();
    holders.mockState.existingOpen = null;
    holders.mockState.insertResult = { data: null, error: UNIQUE_VIOLATION };
    holders.mockState.dedupeRow = null; // conflict reported, no row found

    const res = await POST(
      makePost({ student_id: STUDENT_ID, chapter_id: CHAPTER_ID }) as never,
    );
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
    // Even with a survivor available, a non-23505 error must NOT recover.
    holders.mockState.dedupeRow = survivorRow(CHAPTER_ID);

    const res = await POST(
      makePost({ student_id: STUDENT_ID, chapter_id: CHAPTER_ID }) as never,
    );
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.success).toBe(false);
    // No survivor lookup ran on the non-23505 branch.
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
  });

  it('applies a status filter when provided', async () => {
    const { GET } = await import('@/app/api/teacher/remediation/route');
    authAsTeacher();
    teacherResolved();
    holders.mockState.listRows = [];
    const res = await GET(makeGet('?status=resolved') as never);
    expect(res.status).toBe(200);
    expect(holders.listFilters.status).toBe('resolved');
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
