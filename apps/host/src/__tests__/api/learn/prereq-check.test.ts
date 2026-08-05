/**
 * GET /api/learn/prereq-check — prerequisite-readiness route.
 *
 * Pins (Foxy North-Star Phase 3, E5/D12):
 *   - auth gate via authorizeRequest('progress.view_own', { requireStudentId })
 *   - param validation: subject/grade/chapter (grade is a STRING "6".."12", P5)
 *   - ff_prereq_gating_v1 OFF → HTTP 200 null body (mirrors /api/learn/remediation)
 *   - ON → checkPrereqs(RLS client, { studentId, subject, grade, chapterNumber })
 *     with Cache-Control: private, max-age=300
 *   - checkPrereqs throwing → fail-open null 200 (suggest UI, never a gate error)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const authorizeRequestMock = vi.fn();
vi.mock('@alfanumrik/lib/rbac', () => ({
  authorizeRequest: (...args: unknown[]) => authorizeRequestMock(...(args as [])),
}));

const isFeatureEnabledMock = vi.fn();
vi.mock('@alfanumrik/lib/feature-flags', () => ({
  isFeatureEnabled: (...args: unknown[]) => isFeatureEnabledMock(...(args as [])),
}));

const serverClient = { __kind: 'rls-server-client' };
vi.mock('@alfanumrik/lib/supabase-server', () => ({
  createSupabaseServerClient: vi.fn(async () => serverClient),
}));

const checkPrereqsMock = vi.fn();
vi.mock('@alfanumrik/lib/learn/prereq-gating', () => ({
  checkPrereqs: (...args: unknown[]) => checkPrereqsMock(...(args as [])),
}));

vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { GET } from '@/app/api/learn/prereq-check/route';

function mkReq(qs: string): NextRequest {
  return new NextRequest(`http://localhost/api/learn/prereq-check?${qs}`);
}

const GOOD_QS = 'subject=math&grade=9&chapter=4';

beforeEach(() => {
  authorizeRequestMock.mockReset();
  authorizeRequestMock.mockResolvedValue({
    authorized: true,
    userId: 'auth-user-1',
    studentId: 'student-1',
  });
  isFeatureEnabledMock.mockReset();
  isFeatureEnabledMock.mockResolvedValue(true);
  checkPrereqsMock.mockReset();
  checkPrereqsMock.mockResolvedValue({ suggestion: null });
});

describe('GET /api/learn/prereq-check', () => {
  it('returns the auth errorResponse when unauthorized', async () => {
    authorizeRequestMock.mockResolvedValue({
      authorized: false,
      errorResponse: new Response('{}', { status: 401 }),
    });
    const res = await GET(mkReq(GOOD_QS));
    expect(res.status).toBe(401);
    expect(checkPrereqsMock).not.toHaveBeenCalled();
  });

  it.each([
    ['missing subject', 'grade=9&chapter=4'],
    ['bad grade (P5: strings 6-12)', 'subject=math&grade=13&chapter=4'],
    ['integer-ish grade out of band', 'subject=math&grade=05&chapter=4'],
    ['missing chapter', 'subject=math&grade=9'],
    ['chapter zero', 'subject=math&grade=9&chapter=0'],
    ['chapter non-integer', 'subject=math&grade=9&chapter=4.5'],
  ])('rejects %s with 400', async (_label, qs) => {
    const res = await GET(mkReq(qs));
    expect(res.status).toBe(400);
    expect(checkPrereqsMock).not.toHaveBeenCalled();
  });

  it('flag OFF → 200 with a null body and no checkPrereqs call (null-when-off contract)', async () => {
    isFeatureEnabledMock.mockResolvedValue(false);
    const res = await GET(mkReq(GOOD_QS));
    expect(res.status).toBe(200);
    expect(await res.json()).toBeNull();
    expect(checkPrereqsMock).not.toHaveBeenCalled();
    expect(isFeatureEnabledMock).toHaveBeenCalledWith(
      'ff_prereq_gating_v1',
      expect.objectContaining({ userId: 'auth-user-1', role: 'student' }),
    );
  });

  it('flag ON → calls checkPrereqs with the RLS client + chapterNumber, private cache header', async () => {
    const suggestion = {
      prereqTopicId: 't-1', prereqTitle: 'Fractions', prereqTitleHi: null,
      chapterNumber: 2, masteryProbability: 0.31, reason: 'r', reasonHi: 'r-hi',
    };
    checkPrereqsMock.mockResolvedValue({ suggestion });
    const res = await GET(mkReq(GOOD_QS));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ suggestion });
    expect(res.headers.get('Cache-Control')).toBe('private, max-age=300');
    expect(checkPrereqsMock).toHaveBeenCalledExactlyOnceWith(serverClient, {
      studentId: 'student-1',
      subject: 'math',
      grade: '9',
      chapterNumber: 4,
    });
  });

  it('lowercases the subject before the check', async () => {
    await GET(mkReq('subject=MATH&grade=9&chapter=4'));
    expect(checkPrereqsMock.mock.calls[0][1]).toMatchObject({ subject: 'math' });
  });

  it('fail-open: checkPrereqs throwing → 200 null body (never a 500 gate)', async () => {
    checkPrereqsMock.mockRejectedValue(new Error('graph unavailable'));
    const res = await GET(mkReq(GOOD_QS));
    expect(res.status).toBe(200);
    expect(await res.json()).toBeNull();
  });
});
