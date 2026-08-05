/**
 * GET /api/learner/srs/due — server-side count of due SRS quiz-wrong-answer
 * cards, exposed to client components (wave 3b of E4: replaces the
 * DailyRhythmQueue's direct browser-supabase read).
 *
 * Pins:
 *   - auth gate via authorizeRequest('progress.view_own', { requireStudentId })
 *   - no student profile → 403 (no payload)
 *   - reads via the RLS-scoped server client, never supabase-admin (P8)
 *   - predicate parity: the query is BUILT by buildSrsDueQuery from
 *     srs-predicate.ts (spy captures the (client, studentId, opts) tuple),
 *     so a future drift in the predicate can only be introduced by touching
 *     the shared helper — and the whole SRS lane moves with it.
 *   - default response shape: { success: true, count: <n> } (no items)
 *   - withItems=1 → { success: true, count: <n>, items: [{id,sourceId,subject}] }
 *   - Cache-Control: private, max-age=60
 *   - DB error → 500 with generic body (no PII, no studentId in the payload)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const authorizeRequestMock = vi.fn();
vi.mock('@alfanumrik/lib/rbac', () => ({
  authorizeRequest: (...args: unknown[]) => authorizeRequestMock(...(args as [])),
}));

const serverClient = { __kind: 'rls-server-client' };
vi.mock('@alfanumrik/lib/supabase-server', () => ({
  createSupabaseServerClient: vi.fn(async () => serverClient),
}));

// Spy on the shared predicate builder — its call site + argument shape is
// the contract. The mock returns a thenable that resolves like a supabase
// query builder ({ data, error }).
const buildSrsDueQueryMock = vi.fn();
vi.mock('@alfanumrik/lib/learn/srs-predicate', () => ({
  buildSrsDueQuery: (...args: unknown[]) => buildSrsDueQueryMock(...(args as [])),
}));

vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { GET } from '@/app/api/learner/srs/due/route';

function mkReq(qs = ''): NextRequest {
  return new NextRequest(`http://localhost/api/learner/srs/due${qs ? `?${qs}` : ''}`);
}

function stubQuery(result: { data: unknown; error: unknown }) {
  buildSrsDueQueryMock.mockImplementation(() => ({
    then: (resolve: (r: unknown) => unknown) => Promise.resolve(result).then(resolve),
  }));
}

beforeEach(() => {
  authorizeRequestMock.mockReset();
  authorizeRequestMock.mockResolvedValue({
    authorized: true,
    userId: 'auth-user-1',
    studentId: 'student-1',
  });
  buildSrsDueQueryMock.mockReset();
});

describe('GET /api/learner/srs/due', () => {
  it('returns the auth errorResponse when unauthorized', async () => {
    authorizeRequestMock.mockResolvedValue({
      authorized: false,
      errorResponse: new Response('{}', { status: 401 }),
    });
    const res = await GET(mkReq());
    expect(res.status).toBe(401);
    expect(buildSrsDueQueryMock).not.toHaveBeenCalled();
  });

  it('demands requireStudentId (matches route auth options)', async () => {
    stubQuery({ data: [], error: null });
    await GET(mkReq());
    expect(authorizeRequestMock).toHaveBeenCalledWith(
      expect.anything(),
      'progress.view_own',
      { requireStudentId: true },
    );
  });

  it('returns 403 when authorized but no studentId is resolved', async () => {
    authorizeRequestMock.mockResolvedValue({
      authorized: true,
      userId: 'u1',
      studentId: null,
    });
    const res = await GET(mkReq());
    expect(res.status).toBe(403);
    expect(buildSrsDueQueryMock).not.toHaveBeenCalled();
  });

  it('applies the shared predicate against the RLS server client (predicate parity)', async () => {
    stubQuery({ data: [], error: null });
    await GET(mkReq());
    expect(buildSrsDueQueryMock).toHaveBeenCalledTimes(1);
    const [client, studentId, opts] = buildSrsDueQueryMock.mock.calls[0];
    expect(client).toBe(serverClient);
    expect(studentId).toBe('student-1');
    // Contract: null subject (no filter), 50 cap, id/source_id/subject cols.
    expect(opts).toMatchObject({ subject: null, limit: 50, columns: 'id, source_id, subject' });
  });

  it('forwards the subject query param (lowercased, trimmed) to the predicate', async () => {
    stubQuery({ data: [], error: null });
    await GET(mkReq('subject=Math'));
    const [, , opts] = buildSrsDueQueryMock.mock.calls[0];
    expect(opts).toMatchObject({ subject: 'math' });
  });

  it('default response omits items and reports the raw count', async () => {
    stubQuery({
      data: [
        { id: 'c1', source_id: 'q1', subject: 'science' },
        { id: 'c2', source_id: 'q2', subject: 'science' },
      ],
      error: null,
    });
    const res = await GET(mkReq());
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, max-age=60');
    const body = await res.json();
    expect(body).toEqual({ success: true, count: 2 });
  });

  it('withItems=1 → returns items with camelCase sourceId (client-side selectSrsReviewSet shape)', async () => {
    stubQuery({
      data: [
        { id: 'c1', source_id: 'q1', subject: 'science' },
        { id: 'c2', source_id: null, subject: 'science' },
      ],
      error: null,
    });
    const res = await GET(mkReq('withItems=1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      success: true,
      count: 2,
      items: [
        { id: 'c1', sourceId: 'q1', subject: 'science' },
        { id: 'c2', sourceId: null, subject: 'science' },
      ],
    });
  });

  it('DB error returns 500 with generic body (no studentId in payload)', async () => {
    stubQuery({ data: null, error: { message: 'internal db failure' } });
    const res = await GET(mkReq());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ success: false, error: 'srs_due_query_failed' });
    // Defense-in-depth: no student identifier in any field.
    expect(JSON.stringify(body)).not.toContain('student-1');
  });

  it('unexpected throw returns 500 with generic body', async () => {
    buildSrsDueQueryMock.mockImplementation(() => {
      throw new Error('boom');
    });
    const res = await GET(mkReq());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ success: false, error: 'srs_due_query_failed' });
  });
});
