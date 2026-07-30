/**
 * Route-level pins for `POST /api/board-score` —
 * `apps/host/src/app/api/board-score/route.ts`.
 *
 * Spec acceptance criterion AC5 (docs/superpowers/specs/
 * 2026-07-30-boardscore-subject-scoping.md §8): the route must return
 * `422 { error: 'subject_not_eligible' }` and make ZERO calls to the
 * `board-score` Edge Function when `subject_code` is not in the requesting
 * student's `getStudentBoardSubjects(studentId, grade)` result — including
 * subjects that DO have `cbse_chapter_weights` at that grade but that this
 * specific student never selected.
 *
 * `getStudentBoardSubjects` itself is mocked here (it has its own dedicated
 * unit-test file, `get-student-board-subjects.test.ts`) — this file pins
 * only the ROUTE's behavior: it must call the eligibility function, gate on
 * its result BEFORE touching `fetch`, and short-circuit correctly.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const STUDENT_ID = '22222222-2222-4222-8222-222222222222';

// ── env (getEdgeConfig() must succeed to reach the eligibility check) ──────────
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test-key';

// ── RBAC mock ────────────────────────────────────────────────────────────────
let _authImpl: () => Promise<unknown> = async () => ({
  authorized: true,
  studentId: STUDENT_ID,
});
vi.mock('@alfanumrik/lib/rbac', () => ({
  authorizeRequest: () => _authImpl(),
}));

// ── logger mock ──────────────────────────────────────────────────────────────
vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ── supabase-server mock (unused on this route's POST path, but imported) ──────
vi.mock('@alfanumrik/lib/supabase-server', () => ({
  createSupabaseServerClient: vi.fn(),
}));

// ── supabaseAdmin mock — only used by resolveStudentGrade() ────────────────────
let _gradeResponse: { data: { grade: string } | null; error: unknown } = {
  data: { grade: '10' },
  error: null,
};
vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: vi.fn(() => {
      const chain: Record<string, unknown> = {};
      chain.select = vi.fn(() => chain);
      chain.eq = vi.fn(() => chain);
      chain.is = vi.fn(() => chain);
      chain.single = vi.fn(() => Promise.resolve(_gradeResponse));
      return chain;
    }),
  },
}));

// ── getStudentBoardSubjects mock — the eligibility gate under test ─────────────
let _eligibleSubjects: string[] = ['math'];
const getStudentBoardSubjectsMock = vi.fn(() => Promise.resolve(_eligibleSubjects));
vi.mock('@/app/api/cron/board-score/_lib/get-student-board-subjects', () => ({
  getStudentBoardSubjects: (...args: unknown[]) => getStudentBoardSubjectsMock(...args),
}));

// ── fetch mock ───────────────────────────────────────────────────────────────
const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

function postRequest(body: unknown): Request {
  return new Request('http://localhost/api/board-score', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let POST: any;

beforeEach(async () => {
  vi.clearAllMocks();
  _authImpl = async () => ({ authorized: true, studentId: STUDENT_ID });
  _gradeResponse = { data: { grade: '10' }, error: null };
  _eligibleSubjects = ['math'];
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify({ code: 'ok', data: {} }), { status: 200 }),
  );

  const mod = await import('@/app/api/board-score/route');
  POST = mod.POST;
});

describe('POST /api/board-score — subject eligibility gate (spec AC5)', () => {
  it('returns 422 { error: "subject_not_eligible" } and makes ZERO fetch calls for a subject the student never selected', async () => {
    // Student's eligible set is only 'math' — 'science' has weights at
    // grade 10 but this student never selected it.
    _eligibleSubjects = ['math'];

    const res = await POST(postRequest({ subject_code: 'science' }));

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe('subject_not_eligible');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never calls the Edge Function even for a subject that HAS cbse_chapter_weights at this grade but was not elected', async () => {
    // This is the exact AC5 nuance: eligibility, not weights-table
    // existence, is the gate. 'english' commonly has grade-10 weights.
    _eligibleSubjects = ['math'];

    const res = await POST(postRequest({ subject_code: 'english' }));

    expect(res.status).toBe(422);
    expect(fetchMock).toHaveBeenCalledTimes(0);
  });

  it('calls getStudentBoardSubjects with the resolved (studentId, grade) before deciding', async () => {
    _eligibleSubjects = ['math'];
    await POST(postRequest({ subject_code: 'science' }));
    expect(getStudentBoardSubjectsMock).toHaveBeenCalledWith(STUDENT_ID, '10');
  });

  it('DOES forward to the Edge Function when subject_code IS in the eligible set', async () => {
    _eligibleSubjects = ['math'];

    const res = await POST(postRequest({ subject_code: 'math' }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);
  });

  it('returns 422 invalid_subject_code before ever reaching the eligibility check for a malformed body', async () => {
    const res = await POST(postRequest({ subject_code: '' }));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe('invalid_subject_code');
    expect(getStudentBoardSubjectsMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
