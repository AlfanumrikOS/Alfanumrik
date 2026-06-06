/**
 * Contract tests for GET /api/v2/learn/curriculum.
 * Pins: auth 401 + study_plan.view, get_available_subjects reuse, subject →
 * chapter → topic tree assembly, subject filter, envelope (schemaVersion 1).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const _authorizeImpl = vi.fn();
vi.mock('@/lib/rbac', () => ({ authorizeRequest: (...a: unknown[]) => _authorizeImpl(...a) }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const STUDENT_A = '11111111-1111-4111-8111-111111111111';
const SUBJECT_ID = 'sub11111-1111-4111-8111-111111111111';
const TOPIC_ID = 'top11111-1111-4111-8111-111111111111';

let _student: { data: { grade: string } | null } = { data: { grade: '9' } };
let _subjectsMeta: { data: unknown[] } = { data: [{ id: SUBJECT_ID, code: 'math' }] };
let _topics: { data: unknown[] } = { data: [] };
let _availableSubjects: { data: unknown; error: unknown } = { data: [], error: null };

vi.mock('@/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      const result =
        table === 'students' ? _student :
        table === 'subjects' ? _subjectsMeta :
        _topics;
      for (const m of ['select', 'eq', 'in', 'order']) chain[m] = () => chain;
      chain.maybeSingle = () => Promise.resolve(result);
      // topics/subjects chains end on .order/.in — make thenable.
      chain.then = (res: (v: unknown) => unknown) => res(result);
      return chain;
    },
    rpc: () => Promise.resolve(_availableSubjects),
  }),
}));

function setAuthorized() {
  _authorizeImpl.mockResolvedValue({
    authorized: true, userId: 'auth-user-1', studentId: STUDENT_A,
    roles: ['student'], permissions: ['study_plan.view'],
  });
}

const url = (params: Record<string, string> = {}) =>
  new Request(`http://localhost/api/v2/learn/curriculum?${new URLSearchParams(params)}`, { method: 'GET' });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let GET: any;
beforeEach(async () => {
  vi.clearAllMocks();
  setAuthorized();
  _student = { data: { grade: '9' } };
  _subjectsMeta = { data: [{ id: SUBJECT_ID, code: 'math' }] };
  _availableSubjects = {
    data: [{ code: 'math', name: 'Mathematics', name_hi: 'गणित', is_locked: false }],
    error: null,
  };
  _topics = {
    data: [
      { id: TOPIC_ID, subject_id: SUBJECT_ID, chapter_number: 1, title: 'Number Systems', title_hi: 'संख्या', parent_topic_id: null },
    ],
  };
  GET = (await import('@/app/api/v2/learn/curriculum/route')).GET;
});

describe('GET /api/v2/learn/curriculum', () => {
  it('returns 401 when unauthenticated', async () => {
    _authorizeImpl.mockResolvedValueOnce({
      authorized: false, userId: null,
      errorResponse: new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }),
    });
    expect((await GET(url())).status).toBe(401);
  });

  it('uses study_plan.view with requireStudentId', async () => {
    await GET(url());
    expect(_authorizeImpl).toHaveBeenCalledWith(
      expect.anything(), 'study_plan.view', expect.objectContaining({ requireStudentId: true }),
    );
  });

  it('returns 404 when no student profile', async () => {
    _student = { data: null };
    const res = await GET(url());
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe('NO_STUDENT_PROFILE');
  });

  it('returns the curriculum tree (subject → chapters → topics)', async () => {
    const res = await GET(url());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.schemaVersion).toBe(1);
    expect(body.data.grade).toBe('9');
    expect(body.data.subjects).toHaveLength(1);
    const subj = body.data.subjects[0];
    expect(subj.code).toBe('math');
    expect(subj.is_locked).toBe(false);
    expect(subj.chapters).toHaveLength(1);
    expect(subj.chapters[0].chapter_number).toBe(1);
    expect(subj.chapters[0].title).toBe('Number Systems');
    expect(subj.chapters[0].topics[0].id).toBe(TOPIC_ID);
  });

  it('filters to the requested subject', async () => {
    const res = await GET(url({ subject: 'science' }));
    const body = await res.json();
    // No 'science' in available subjects → empty.
    expect(body.data.subjects).toHaveLength(0);
  });

  it('returns 500 when get_available_subjects errors', async () => {
    _availableSubjects = { data: null, error: { message: 'down' } };
    const res = await GET(url());
    expect(res.status).toBe(500);
  });
});
