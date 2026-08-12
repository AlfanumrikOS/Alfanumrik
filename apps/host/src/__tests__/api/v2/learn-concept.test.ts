/**
 * Contract tests for GET /api/v2/learn/concept.
 * Pins: auth 401 + study_plan.view, param validation (400), grade-mismatch
 * (403), fetchChapterContent reuse, 404 on no content, envelope (schemaVersion 1).
 *
 * 2026-08-12 E2E batch (P2-7c sibling): an unknown `subject` (display name
 * "Mathematics", garbage) is a 400 UNKNOWN_SUBJECT with details
 * { subject, reason, allowed } — it must never fall through to the 404
 * NO_CONTENT path, which is reserved for a KNOWN subject whose chapter
 * genuinely has no content. Subject validation fails CLOSED (503) when the
 * get_available_subjects RPC errors.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const _authorizeImpl = vi.fn();
vi.mock('@alfanumrik/lib/rbac', () => ({ authorizeRequest: (...a: unknown[]) => _authorizeImpl(...a) }));
vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const STUDENT_A = '11111111-1111-4111-8111-111111111111';

let _student: { data: { grade: string; preferred_language: string } | null } = {
  data: { grade: '9', preferred_language: 'en' },
};
// get_available_subjects — subject-code validation source (P2-7c sibling).
let _availableSubjects: { data: unknown; error: unknown } = {
  data: [{ code: 'science' }, { code: 'math' }],
  error: null,
};
const subjectsRpcSpy = vi.fn();
vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => ({
    from: () => {
      const chain: Record<string, unknown> = {};
      for (const m of ['select', 'eq']) chain[m] = () => chain;
      chain.maybeSingle = () => Promise.resolve(_student);
      return chain;
    },
    rpc: (...args: unknown[]) => {
      subjectsRpcSpy(...args);
      return Promise.resolve(_availableSubjects);
    },
  }),
}));

let _content: unknown = {
  markdown: '# Atoms\nText',
  sources: [{ chunk_id: 'c1', chapter_title: 'Atoms', chunk_index: 0, page_number: 12 }],
  truncated: false,
  language: 'en',
  fellBackFromHindi: false,
};
const fetchSpy = vi.fn();
vi.mock('@alfanumrik/lib/learn/fetchChapterContent', () => ({
  fetchChapterContent: (...args: unknown[]) => {
    fetchSpy(...args);
    return Promise.resolve(_content);
  },
}));

function setAuthorized() {
  _authorizeImpl.mockResolvedValue({
    authorized: true, userId: 'auth-user-1', studentId: STUDENT_A,
    roles: ['student'], permissions: ['study_plan.view'],
  });
}

const url = (params: Record<string, string>) =>
  new Request(`http://localhost/api/v2/learn/concept?${new URLSearchParams(params)}`, { method: 'GET' });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let GET: any;
beforeEach(async () => {
  vi.clearAllMocks();
  setAuthorized();
  _student = { data: { grade: '9', preferred_language: 'en' } };
  _availableSubjects = { data: [{ code: 'science' }, { code: 'math' }], error: null };
  _content = {
    markdown: '# Atoms\nText',
    sources: [{ chunk_id: 'c1', chapter_title: 'Atoms', chunk_index: 0, page_number: 12 }],
    truncated: false,
    language: 'en',
    fellBackFromHindi: false,
  };
  GET = (await import('@/app/api/v2/learn/concept/route')).GET;
});

describe('GET /api/v2/learn/concept', () => {
  it('returns 401 when unauthenticated', async () => {
    _authorizeImpl.mockResolvedValueOnce({
      authorized: false, userId: null,
      errorResponse: new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }),
    });
    expect((await GET(url({ subject: 'science', grade: '9', chapter: '3' }))).status).toBe(401);
  });

  it('uses study_plan.view with requireStudentId', async () => {
    await GET(url({ subject: 'science', grade: '9', chapter: '3' }));
    expect(_authorizeImpl).toHaveBeenCalledWith(
      expect.anything(), 'study_plan.view', expect.objectContaining({ requireStudentId: true }),
    );
  });

  it('returns 400 when params missing', async () => {
    expect((await GET(url({ subject: 'science' }))).status).toBe(400);
  });

  it('returns 400 on invalid chapter', async () => {
    const res = await GET(url({ subject: 'science', grade: '9', chapter: '0' }));
    expect(res.status).toBe(400);
  });

  it('returns 403 when requested grade mismatches profile grade', async () => {
    _student = { data: { grade: '10', preferred_language: 'en' } };
    const res = await GET(url({ subject: 'science', grade: '9', chapter: '3' }));
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('GRADE_MISMATCH');
  });

  it('reuses fetchChapterContent and returns the concept envelope', async () => {
    const res = await GET(url({ subject: 'science', grade: '9', chapter: '3' }));
    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.objectContaining({ subjectCode: 'science', grade: '9', chapterNumber: 3, language: 'en' }),
    );
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.schemaVersion).toBe(1);
    expect(body.data.markdown).toContain('# Atoms');
    expect(body.data.sources[0].chunk_id).toBe('c1');
    expect(body.data.fell_back_from_hindi).toBe(false);
  });

  it('passes the student preferred language (hi) to the reader', async () => {
    _student = { data: { grade: '9', preferred_language: 'hi' } };
    await GET(url({ subject: 'science', grade: '9', chapter: '3' }));
    expect(fetchSpy).toHaveBeenCalledWith(expect.objectContaining({ language: 'hi' }));
  });

  it('returns 404 when no content exists for the chapter', async () => {
    _content = null;
    const res = await GET(url({ subject: 'science', grade: '9', chapter: '3' }));
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe('NO_CONTENT');
  });

  // ── P2-7c sibling: unknown subject must not masquerade as NO_CONTENT ──────
  it('returns 400 UNKNOWN_SUBJECT (not 404 NO_CONTENT) for a display-name subject like "Mathematics"', async () => {
    const res = await GET(url({ subject: 'Mathematics', grade: '9', chapter: '3' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.code).toBe('UNKNOWN_SUBJECT');
    expect(body.error).toContain("'Mathematics'");
    expect(body.details).toEqual({
      subject: 'Mathematics',
      reason: 'unknown_subject',
      allowed: ['science', 'math'],
    });
    // The content reader must never have been consulted for a bad param.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('FAILS CLOSED with 503 SUBJECT_GOVERNANCE_UNAVAILABLE (retryable:true) when the subjects RPC errors', async () => {
    _availableSubjects = { data: null, error: { message: 'down' } };
    const res = await GET(url({ subject: 'science', grade: '9', chapter: '3' }));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.code).toBe('SUBJECT_GOVERNANCE_UNAVAILABLE');
    expect(body.retryable).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('a LOCKED subject is still a valid read param (param validation, not plan gating)', async () => {
    // The curriculum sibling pins this for the filter; pin it here too — the
    // concept route validates against ALL of the student's subject codes,
    // locked included. Reading chapter prose for a plan-locked subject must
    // not 400 (and this route deliberately adds no 403 plan gate).
    _availableSubjects = { data: [{ code: 'science', is_locked: true }], error: null };
    const res = await GET(url({ subject: 'science', grade: '9', chapter: '3' }));
    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.objectContaining({ subjectCode: 'science', chapterNumber: 3 }),
    );
  });

  it('keys the subjects lookup by the AUTH user id (same as /v2/learn/curriculum), not the students.id', async () => {
    // get_available_subjects takes the auth.users UUID (curriculum precedent).
    // Silently swapping to studentId would resolve nobody's subjects and turn
    // every request into a spurious 400 UNKNOWN_SUBJECT.
    await GET(url({ subject: 'science', grade: '9', chapter: '3' }));
    expect(subjectsRpcSpy).toHaveBeenCalledWith('get_available_subjects', {
      p_student_id: 'auth-user-1',
    });
  });
});
