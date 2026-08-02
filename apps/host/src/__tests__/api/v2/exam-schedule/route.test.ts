/**
 * Contract tests for GET /api/v2/exam-schedule (Wave B exam schedule, tier 3
 * — student_exam_entries only; tiers 1-2 are a documented fast-follow).
 *
 * Pins:
 *   - auth: study_plan.view + requireStudentId; errorResponse passthrough.
 *   - flag gate: 404 NOT_FOUND when ff_exam_schedule_v1 is off, BEFORE any
 *     supabase client / DB read happens.
 *   - RLS reliance (P8 / item 5): the route never adds an explicit
 *     `student_id` filter of its own — it relies entirely on RLS scoping
 *     `student_exam_entries` reads to the caller. The route only ever calls
 *     `createSupabaseServerClient()` (RLS-respecting), never the
 *     RLS-bypassing admin client. Cross-student isolation itself is a DB-RLS
 *     property this suite mocks around (see the sibling migration-source
 *     test for the policy text pin) — what THIS suite proves is that the
 *     route never reintroduces a leak vector on top of RLS (no client-
 *     supplied student id is read from query/body and used as a filter).
 *   - mastery band wiring: uses the REAL resolveExamReadinessBand() (not
 *     mocked) so this test also proves the wiring end-to-end, not just that
 *     a mock was called.
 *   - topic label filtering: a chapter topic with no resolvable title is
 *     dropped from `chapters`; an entry with zero resolvable chapters gets
 *     `chapters: undefined`, not `[]`.
 *   - sort order: entries sorted by startsOn ascending.
 *   - graceful degradation: a read error on student_exam_entries logs a
 *     warning and returns `entries: []` (200), not a 500.
 *   - batch-fetch skip: when no entry has ANY topic scope, concept_mastery
 *     and getTopicTitlesByIds are never called.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const holders = vi.hoisted(() => ({
  mockAuthorize: vi.fn(),
  mockIsFeatureEnabled: vi.fn(),
  mockGetTopicTitlesByIds: vi.fn(),
}));

vi.mock('@alfanumrik/lib/rbac', () => ({
  authorizeRequest: (...a: unknown[]) => holders.mockAuthorize(...a),
}));
vi.mock('@alfanumrik/lib/feature-flags', () => ({
  isFeatureEnabled: (...a: unknown[]) => holders.mockIsFeatureEnabled(...a),
}));
vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
// The REAL resolveExamReadinessBand is intentionally left UNMOCKED — this
// suite drives fixtures with real mastery_level values so the wiring between
// the route and that pure function is genuinely exercised.
vi.mock('@/lib/curriculum/cached-taxonomy', () => ({
  getTopicTitlesByIds: (...a: unknown[]) => holders.mockGetTopicTitlesByIds(...a),
}));

// ── Mock Supabase server client ─────────────────────────────────────────────
interface StudentExamEntriesState {
  data: Array<{
    id: string;
    title: string;
    starts_on: string;
    ends_on: string;
    student_exam_entry_topics: Array<{ topic_id: string }> | null;
  }> | null;
  error: { message: string } | null;
}
interface ConceptMasteryState {
  data: Array<{ topic_id: string; mastery_probability: number | null; mastery_level: string | null }> | null;
  error: { message: string } | null;
}

let examEntriesState: StudentExamEntriesState = { data: [], error: null };
let conceptMasteryState: ConceptMasteryState = { data: [], error: null };
const examEntriesOrderSpy = vi.fn();
const conceptMasteryInSpy = vi.fn();
let fromCallOrder: string[] = [];

vi.mock('@alfanumrik/lib/supabase-server', () => ({
  createSupabaseServerClient: vi.fn().mockResolvedValue({
    from: (table: string) => {
      fromCallOrder.push(table);
      if (table === 'student_exam_entries') {
        return {
          select: () => ({
            order: (col: string, opts: unknown) => {
              examEntriesOrderSpy(col, opts);
              return Promise.resolve(examEntriesState);
            },
          }),
        };
      }
      if (table === 'concept_mastery') {
        return {
          select: () => ({
            in: (col: string, ids: string[]) => {
              conceptMasteryInSpy(col, ids);
              return Promise.resolve(conceptMasteryState);
            },
          }),
        };
      }
      throw new Error(`unexpected table in test: ${table}`);
    },
  }),
}));

const AUTH_USER_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

function authOk() {
  holders.mockAuthorize.mockResolvedValue({
    authorized: true,
    userId: AUTH_USER_ID,
    studentId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    roles: ['student'],
    permissions: ['study_plan.view'],
  });
}

function authDenied401() {
  holders.mockAuthorize.mockResolvedValue({
    authorized: false,
    userId: null,
    errorResponse: new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }),
  });
}

function makeRequest(): Request {
  return new Request('http://localhost/api/v2/exam-schedule', { method: 'GET' });
}

beforeEach(() => {
  vi.clearAllMocks();
  authOk();
  holders.mockIsFeatureEnabled.mockResolvedValue(true);
  holders.mockGetTopicTitlesByIds.mockResolvedValue([]);
  examEntriesState = { data: [], error: null };
  conceptMasteryState = { data: [], error: null };
  fromCallOrder = [];
});

describe('GET /api/v2/exam-schedule — auth gate', () => {
  it('returns the authorizeRequest errorResponse verbatim when not authorized', async () => {
    authDenied401();
    const { GET } = await import('@/app/api/v2/exam-schedule/route');
    const res = await GET(makeRequest() as never);
    expect(res.status).toBe(401);
  });

  it('uses the study_plan.view permission with requireStudentId', async () => {
    const { GET } = await import('@/app/api/v2/exam-schedule/route');
    await GET(makeRequest() as never);
    expect(holders.mockAuthorize).toHaveBeenCalledWith(
      expect.anything(),
      'study_plan.view',
      expect.objectContaining({ requireStudentId: true }),
    );
  });
});

describe('GET /api/v2/exam-schedule — flag gate', () => {
  it('returns 404 NOT_FOUND when ff_exam_schedule_v1 is off, before any DB read', async () => {
    holders.mockIsFeatureEnabled.mockResolvedValue(false);
    const { GET } = await import('@/app/api/v2/exam-schedule/route');
    const res = await GET(makeRequest() as never);
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe('NOT_FOUND');
    expect(fromCallOrder).toEqual([]);
  });

  it('reads ff_exam_schedule_v1 with a student role context', async () => {
    const { GET } = await import('@/app/api/v2/exam-schedule/route');
    await GET(makeRequest() as never);
    expect(holders.mockIsFeatureEnabled).toHaveBeenCalledWith(
      'ff_exam_schedule_v1',
      expect.objectContaining({ userId: AUTH_USER_ID, role: 'student' }),
    );
  });
});

describe('GET /api/v2/exam-schedule — RLS reliance (no route-level student filter)', () => {
  it('never reads a student/user id from the request to use as a query filter — the route takes no params at all', async () => {
    // The request carries no query string / body the route could read a
    // caller-supplied student id from; the ONLY identity in play is
    // auth.userId from the verified JWT via authorizeRequest, and RLS (not
    // this route) is what scopes the read to that student's own rows.
    const { GET } = await import('@/app/api/v2/exam-schedule/route');
    const res = await GET(makeRequest() as never);
    expect(res.status).toBe(200);
    // .order() is called with no .eq('student_id', ...) in between select()
    // and order() in the mock chain above — if the route added one, the
    // chain shape mocked here would not match and this call would throw
    // (select() -> order() directly, no .eq link).
    expect(examEntriesOrderSpy).toHaveBeenCalledWith('starts_on', { ascending: true });
  });

  it('uses createSupabaseServerClient (RLS-respecting), not the admin/service-role client', async () => {
    const { createSupabaseServerClient } = await import('@alfanumrik/lib/supabase-server');
    const { GET } = await import('@/app/api/v2/exam-schedule/route');
    await GET(makeRequest() as never);
    expect(createSupabaseServerClient).toHaveBeenCalled();
  });
});

describe('GET /api/v2/exam-schedule — envelope + mastery band wiring (real function)', () => {
  it('returns an empty entries array when the student has no exam entries', async () => {
    const { GET } = await import('@/app/api/v2/exam-schedule/route');
    const res = await GET(makeRequest() as never);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toEqual({ schemaVersion: 1, entries: [] });
  });

  it('projects a student entry with source="student" and editable=true', async () => {
    examEntriesState = {
      data: [
        {
          id: 'entry-1',
          title: 'Unit test Friday',
          starts_on: '2026-09-05',
          ends_on: '2026-09-05',
          student_exam_entry_topics: null,
        },
      ],
      error: null,
    };
    const { GET } = await import('@/app/api/v2/exam-schedule/route');
    const res = await GET(makeRequest() as never);
    const body = await res.json();
    expect(body.data.entries).toEqual([
      {
        id: 'entry-1',
        source: 'student',
        title: 'Unit test Friday',
        startsOn: '2026-09-05',
        endsOn: '2026-09-05',
        editable: true,
      },
    ]);
  });

  it('resolves a chapter band using the REAL resolveExamReadinessBand mapping (mastered -> exam_ready)', async () => {
    examEntriesState = {
      data: [
        {
          id: 'entry-1',
          title: 'Half-yearly',
          starts_on: '2026-09-05',
          ends_on: '2026-09-10',
          student_exam_entry_topics: [{ topic_id: 'topic-1' }],
        },
      ],
      error: null,
    };
    conceptMasteryState = {
      data: [{ topic_id: 'topic-1', mastery_probability: 0.5, mastery_level: 'mastered' }],
      error: null,
    };
    holders.mockGetTopicTitlesByIds.mockResolvedValue([{ id: 'topic-1', title: 'Number Systems' }]);

    const { GET } = await import('@/app/api/v2/exam-schedule/route');
    const res = await GET(makeRequest() as never);
    const body = await res.json();
    expect(body.data.entries[0].chapters).toEqual([{ id: 'topic-1', label: 'Number Systems', band: 'exam_ready' }]);
  });

  it('maps every mastery_level to its documented band end-to-end', async () => {
    const cases: Array<[string, string]> = [
      ['mastered', 'exam_ready'],
      ['proficient', 'getting_it'],
      ['developing', 'shaky'],
      ['beginner', 'shaky'],
      ['not_started', 'new'],
    ];
    for (const [level, expectedBand] of cases) {
      examEntriesState = {
        data: [
          {
            id: 'entry-1',
            title: 'Test',
            starts_on: '2026-09-05',
            ends_on: '2026-09-05',
            student_exam_entry_topics: [{ topic_id: 'topic-1' }],
          },
        ],
        error: null,
      };
      conceptMasteryState = { data: [{ topic_id: 'topic-1', mastery_probability: null, mastery_level: level }], error: null };
      holders.mockGetTopicTitlesByIds.mockResolvedValue([{ id: 'topic-1', title: 'Chapter X' }]);
      const { GET } = await import('@/app/api/v2/exam-schedule/route');
      const res = await GET(makeRequest() as never);
      const body = await res.json();
      expect(body.data.entries[0].chapters[0].band, `level=${level}`).toBe(expectedBand);
    }
  });

  it('defaults to band "new" when a topic has no concept_mastery row at all', async () => {
    examEntriesState = {
      data: [
        {
          id: 'entry-1',
          title: 'Test',
          starts_on: '2026-09-05',
          ends_on: '2026-09-05',
          student_exam_entry_topics: [{ topic_id: 'topic-never-attempted' }],
        },
      ],
      error: null,
    };
    conceptMasteryState = { data: [], error: null }; // no row for this topic
    holders.mockGetTopicTitlesByIds.mockResolvedValue([{ id: 'topic-never-attempted', title: 'Untouched Chapter' }]);
    const { GET } = await import('@/app/api/v2/exam-schedule/route');
    const res = await GET(makeRequest() as never);
    const body = await res.json();
    expect(body.data.entries[0].chapters[0]).toEqual({ id: 'topic-never-attempted', label: 'Untouched Chapter', band: 'new' });
  });

  it('drops a chapter topic whose title cannot be resolved (empty label filtered out)', async () => {
    examEntriesState = {
      data: [
        {
          id: 'entry-1',
          title: 'Test',
          starts_on: '2026-09-05',
          ends_on: '2026-09-05',
          student_exam_entry_topics: [{ topic_id: 'orphan-topic' }],
        },
      ],
      error: null,
    };
    conceptMasteryState = { data: [], error: null };
    holders.mockGetTopicTitlesByIds.mockResolvedValue([]); // title never resolves
    const { GET } = await import('@/app/api/v2/exam-schedule/route');
    const res = await GET(makeRequest() as never);
    const body = await res.json();
    // No resolvable chapters at all -> `chapters` is omitted (undefined), not [].
    expect(body.data.entries[0].chapters).toBeUndefined();
  });

  it('sorts entries by startsOn ascending', async () => {
    examEntriesState = {
      data: [
        { id: 'later', title: 'Later exam', starts_on: '2026-12-01', ends_on: '2026-12-01', student_exam_entry_topics: null },
        { id: 'sooner', title: 'Sooner exam', starts_on: '2026-08-05', ends_on: '2026-08-05', student_exam_entry_topics: null },
      ],
      error: null,
    };
    const { GET } = await import('@/app/api/v2/exam-schedule/route');
    const res = await GET(makeRequest() as never);
    const body = await res.json();
    expect(body.data.entries.map((e: { id: string }) => e.id)).toEqual(['sooner', 'later']);
  });

  it('skips the concept_mastery + getTopicTitlesByIds batch fetch entirely when no entry has any topic scope', async () => {
    examEntriesState = {
      data: [
        { id: 'entry-1', title: 'No scope', starts_on: '2026-09-05', ends_on: '2026-09-05', student_exam_entry_topics: [] },
      ],
      error: null,
    };
    const { GET } = await import('@/app/api/v2/exam-schedule/route');
    await GET(makeRequest() as never);
    expect(conceptMasteryInSpy).not.toHaveBeenCalled();
    expect(holders.mockGetTopicTitlesByIds).not.toHaveBeenCalled();
  });
});

describe('GET /api/v2/exam-schedule — graceful degradation', () => {
  it('returns 200 with entries: [] (not a 500) when the student_exam_entries read errors', async () => {
    examEntriesState = { data: null, error: { message: 'permission denied' } };
    const { GET } = await import('@/app/api/v2/exam-schedule/route');
    const res = await GET(makeRequest() as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.entries).toEqual([]);
  });
});

describe('GET /api/v2/exam-schedule — unexpected failures', () => {
  it('returns 500 INTERNAL_ERROR without leaking raw error text when the client construction throws', async () => {
    const { createSupabaseServerClient } = await import('@alfanumrik/lib/supabase-server');
    (createSupabaseServerClient as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('boom: leaked connection info'),
    );
    const { GET } = await import('@/app/api/v2/exam-schedule/route');
    const res = await GET(makeRequest() as never);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.code).toBe('INTERNAL_ERROR');
    expect(body.error).not.toMatch(/leaked/);
  });
});
