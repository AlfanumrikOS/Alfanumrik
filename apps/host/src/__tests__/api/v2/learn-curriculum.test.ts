/**
 * Contract tests for GET /api/v2/learn/curriculum.
 * Pins: auth 401 + study_plan.view, get_available_subjects reuse, subject →
 * chapter → topic tree assembly, subject filter, envelope (schemaVersion 1).
 *
 * 2026-08-12 E2E batch (P2-7c): an unknown `subject` filter (display name
 * "Mathematics", garbage) is a 400 UNKNOWN_SUBJECT with details
 * { subject, reason, allowed } — NEVER the empty-success 200, which is
 * indistinguishable from "this grade has no curriculum loaded" (the symptom
 * of a content-integrity incident). Zero subjects + NO filter stays a 200
 * empty success (a real state).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const _authorizeImpl = vi.fn();
vi.mock('@alfanumrik/lib/rbac', () => ({ authorizeRequest: (...a: unknown[]) => _authorizeImpl(...a) }));
vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const STUDENT_A = '11111111-1111-4111-8111-111111111111';
const SUBJECT_ID = 'sub11111-1111-4111-8111-111111111111';
const TOPIC_ID = 'top11111-1111-4111-8111-111111111111';

let _student: { data: { grade: string } | null } = { data: { grade: '9' } };
let _subjectsMeta: { data: unknown[] } = { data: [{ id: SUBJECT_ID, code: 'math' }] };
let _topics: { data: unknown[] } = { data: [] };
let _availableSubjects: { data: unknown; error: unknown } = { data: [], error: null };

vi.mock('@alfanumrik/lib/supabase-admin', () => ({
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

  it('filters to the requested subject when the code is valid', async () => {
    _availableSubjects = {
      data: [
        { code: 'math', name: 'Mathematics', name_hi: 'गणित', is_locked: false },
        { code: 'science', name: 'Science', name_hi: 'विज्ञान', is_locked: false },
      ],
      error: null,
    };
    const res = await GET(url({ subject: 'math' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.subjects).toHaveLength(1);
    expect(body.data.subjects[0].code).toBe('math');
  });

  it('a locked subject is a VALID filter value (param validation, not plan gating)', async () => {
    _availableSubjects = {
      data: [{ code: 'math', name: 'Mathematics', name_hi: 'गणित', is_locked: true }],
      error: null,
    };
    const res = await GET(url({ subject: 'math' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.subjects).toHaveLength(1);
    expect(body.data.subjects[0].is_locked).toBe(true);
  });

  // ── P2-7c: unknown subject must NOT be a silent empty success ─────────────
  it('returns 400 UNKNOWN_SUBJECT with the allowed codes for an unknown subject filter', async () => {
    // Only 'math' is available; 'science' matches nothing here.
    const res = await GET(url({ subject: 'science' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.code).toBe('UNKNOWN_SUBJECT');
    expect(body.error).toContain("'science'");
    expect(body.details).toEqual({ subject: 'science', reason: 'unknown_subject', allowed: ['math'] });
  });

  it('returns 400 (never an empty 200) when the filter is a display name like "Mathematics"', async () => {
    // The API itself returns "Mathematics" in subjects[].name — the classic
    // client mistake is echoing it back as the filter. Production observed
    // 200 {subjects: []} here, indistinguishable from missing curriculum.
    const res = await GET(url({ subject: 'Mathematics' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('UNKNOWN_SUBJECT');
    expect(body.details.subject).toBe('Mathematics');
    expect(body.details.allowed).toEqual(['math']);
  });

  it('still returns empty success for a student with zero subjects and NO filter (real state)', async () => {
    _availableSubjects = { data: [], error: null };
    const res = await GET(url());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.subjects).toEqual([]);
  });

  it('zero subjects + a filter is 400 UNKNOWN_SUBJECT with allowed:[] — the empty 200 is reserved for NO filter (branch-order pin)', async () => {
    // Boundary between the two branches above: a fresh profile (zero
    // subjects) that DID send a filter cannot match anything, so it must get
    // the explicit 400 — flipping the branch order would silently revert this
    // to the ambiguous empty success the fix exists to kill.
    _availableSubjects = { data: [], error: null };
    const res = await GET(url({ subject: 'math' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('UNKNOWN_SUBJECT');
    expect(body.details).toEqual({ subject: 'math', reason: 'unknown_subject', allowed: [] });
  });

  it('returns 500 when get_available_subjects errors', async () => {
    _availableSubjects = { data: null, error: { message: 'down' } };
    const res = await GET(url());
    expect(res.status).toBe(500);
  });
});
