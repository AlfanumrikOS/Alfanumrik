/**
 * Contract tests for GET /api/v2/learn/concept.
 * Pins: auth 401 + study_plan.view, param validation (400), grade-mismatch
 * (403), fetchChapterContent reuse, 404 on no content, envelope (schemaVersion 1).
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
vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => ({
    from: () => {
      const chain: Record<string, unknown> = {};
      for (const m of ['select', 'eq']) chain[m] = () => chain;
      chain.maybeSingle = () => Promise.resolve(_student);
      return chain;
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
});
