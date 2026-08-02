/**
 * Contract tests for GET /api/v2/placement (Wave B placement check).
 *
 * Pins:
 *   - auth: study_plan.view permission with requireStudentId, errorResponse
 *     passed through verbatim when not authorized.
 *   - flag gate: 404 NOT_FOUND when ff_placement_v1 is OFF (checked BEFORE
 *     query-param validation and BEFORE any profile lookup).
 *   - query validation: subject required (1-40 chars), lang must be 'en'/'hi'
 *     when present.
 *   - profile resolution: 500 on lookup failure, 404 NO_STUDENT_PROFILE when
 *     absent, 409 NO_GRADE when the student has no grade set.
 *   - P5: grade is coerced to a string via String() and passed through to
 *     selectPlacementQuestions verbatim (never parsed as a number).
 *   - selectPlacementQuestions is called with the cold-start selector, isHi
 *     derived from ?lang=hi, and PROBE_COUNT (6).
 *   - envelope: { success: true, data: { schemaVersion: 1, subject, grade,
 *     questions } }.
 *   - unexpected errors -> 500 INTERNAL_ERROR, never a raw stack leak.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const holders = vi.hoisted(() => ({
  mockAuthorize: vi.fn(),
  mockIsFeatureEnabled: vi.fn(),
  mockGetStudent: vi.fn(),
  mockSelectPlacementQuestions: vi.fn(),
}));

vi.mock('@alfanumrik/lib/rbac', () => ({
  authorizeRequest: (...a: unknown[]) => holders.mockAuthorize(...a),
}));
vi.mock('@alfanumrik/lib/feature-flags', () => ({
  isFeatureEnabled: (...a: unknown[]) => holders.mockIsFeatureEnabled(...a),
}));
vi.mock('@alfanumrik/lib/domains/identity', () => ({
  getStudentByAuthUserId: (...a: unknown[]) => holders.mockGetStudent(...a),
}));
vi.mock('@alfanumrik/lib/supabase-server', () => ({
  createSupabaseServerClient: vi.fn().mockResolvedValue({ __sb: true }),
}));
vi.mock('@alfanumrik/lib/adaptive/select-placement-questions', () => ({
  selectPlacementQuestions: (...a: unknown[]) => holders.mockSelectPlacementQuestions(...a),
}));
vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const AUTH_USER_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const STUDENT_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

function authOk() {
  holders.mockAuthorize.mockResolvedValue({
    authorized: true,
    userId: AUTH_USER_ID,
    studentId: STUDENT_ID,
    roles: ['student'],
    permissions: ['study_plan.view'],
  });
}

function authDenied401() {
  holders.mockAuthorize.mockResolvedValue({
    authorized: false,
    userId: null,
    errorResponse: new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    }),
  });
}

function makeRequest(params: Record<string, string> = { subject: 'math' }): Request {
  const qs = new URLSearchParams(params).toString();
  return new Request(`http://localhost/api/v2/placement${qs ? `?${qs}` : ''}`, { method: 'GET' });
}

beforeEach(() => {
  vi.clearAllMocks();
  authOk();
  holders.mockIsFeatureEnabled.mockResolvedValue(true);
  holders.mockGetStudent.mockResolvedValue({ ok: true, data: { id: STUDENT_ID, grade: '9' } });
  holders.mockSelectPlacementQuestions.mockResolvedValue([]);
});

describe('GET /api/v2/placement — auth gate', () => {
  it('returns the authorizeRequest errorResponse verbatim when not authorized', async () => {
    authDenied401();
    const { GET } = await import('@/app/api/v2/placement/route');
    const res = await GET(makeRequest() as never);
    expect(res.status).toBe(401);
    expect(holders.mockIsFeatureEnabled).not.toHaveBeenCalled();
  });

  it('uses the study_plan.view permission with requireStudentId', async () => {
    const { GET } = await import('@/app/api/v2/placement/route');
    await GET(makeRequest() as never);
    expect(holders.mockAuthorize).toHaveBeenCalledWith(
      expect.anything(),
      'study_plan.view',
      expect.objectContaining({ requireStudentId: true }),
    );
  });
});

describe('GET /api/v2/placement — flag gate', () => {
  it('returns 404 NOT_FOUND when ff_placement_v1 is off', async () => {
    holders.mockIsFeatureEnabled.mockResolvedValue(false);
    const { GET } = await import('@/app/api/v2/placement/route');
    const res = await GET(makeRequest() as never);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe('NOT_FOUND');
    // Flag gate short-circuits before any profile lookup or selector call.
    expect(holders.mockGetStudent).not.toHaveBeenCalled();
    expect(holders.mockSelectPlacementQuestions).not.toHaveBeenCalled();
  });

  it('reads ff_placement_v1 with a student role context', async () => {
    const { GET } = await import('@/app/api/v2/placement/route');
    await GET(makeRequest() as never);
    expect(holders.mockIsFeatureEnabled).toHaveBeenCalledWith(
      'ff_placement_v1',
      expect.objectContaining({ userId: AUTH_USER_ID, role: 'student' }),
    );
  });
});

describe('GET /api/v2/placement — query validation', () => {
  it('returns 400 VALIDATION_ERROR when subject is missing', async () => {
    const { GET } = await import('@/app/api/v2/placement/route');
    const res = await GET(makeRequest({}) as never);
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 VALIDATION_ERROR when subject exceeds 40 characters', async () => {
    const { GET } = await import('@/app/api/v2/placement/route');
    const res = await GET(makeRequest({ subject: 'x'.repeat(41) }) as never);
    expect(res.status).toBe(400);
  });

  it('accepts a subject exactly at the 40-character boundary', async () => {
    const { GET } = await import('@/app/api/v2/placement/route');
    const res = await GET(makeRequest({ subject: 'x'.repeat(40) }) as never);
    expect(res.status).toBe(200);
  });

  it('returns 400 VALIDATION_ERROR when lang is neither en nor hi', async () => {
    const { GET } = await import('@/app/api/v2/placement/route');
    const res = await GET(makeRequest({ subject: 'math', lang: 'fr' }) as never);
    expect(res.status).toBe(400);
  });

  it('accepts an absent lang param (defaults to English downstream)', async () => {
    const { GET } = await import('@/app/api/v2/placement/route');
    const res = await GET(makeRequest({ subject: 'math' }) as never);
    expect(res.status).toBe(200);
    expect(holders.mockSelectPlacementQuestions).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      false,
    );
  });

  it('passes isHi=true to the selector when lang=hi', async () => {
    const { GET } = await import('@/app/api/v2/placement/route');
    await GET(makeRequest({ subject: 'math', lang: 'hi' }) as never);
    expect(holders.mockSelectPlacementQuestions).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      true,
    );
  });
});

describe('GET /api/v2/placement — profile resolution', () => {
  it('returns 500 INTERNAL_ERROR when the identity lookup fails', async () => {
    holders.mockGetStudent.mockResolvedValue({ ok: false, error: 'db down' });
    const { GET } = await import('@/app/api/v2/placement/route');
    const res = await GET(makeRequest() as never);
    expect(res.status).toBe(500);
    expect((await res.json()).code).toBe('INTERNAL_ERROR');
  });

  it('returns 404 NO_STUDENT_PROFILE when the caller has no student row', async () => {
    holders.mockGetStudent.mockResolvedValue({ ok: true, data: null });
    const { GET } = await import('@/app/api/v2/placement/route');
    const res = await GET(makeRequest() as never);
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe('NO_STUDENT_PROFILE');
  });

  it('returns 409 NO_GRADE when the student profile has no grade set', async () => {
    holders.mockGetStudent.mockResolvedValue({ ok: true, data: { id: STUDENT_ID, grade: null } });
    const { GET } = await import('@/app/api/v2/placement/route');
    const res = await GET(makeRequest() as never);
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('NO_GRADE');
  });

  it('P5: coerces a non-string grade to a string before use (defensive)', async () => {
    // Defends against a legacy row where grade was ever stored as a number.
    holders.mockGetStudent.mockResolvedValue({ ok: true, data: { id: STUDENT_ID, grade: 9 as unknown as string } });
    const { GET } = await import('@/app/api/v2/placement/route');
    const res = await GET(makeRequest({ subject: 'math' }) as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.grade).toBe('9');
    expect(typeof body.data.grade).toBe('string');
    expect(holders.mockSelectPlacementQuestions).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ grade: '9' }),
      expect.anything(),
    );
  });
});

describe('GET /api/v2/placement — envelope (happy path)', () => {
  it('returns the PlacementResponse envelope with the selector output', async () => {
    const questions = [
      { id: 'q1', topicId: null, chapterNumber: 1, stem: 'What is 2+2?', options: [{ id: '0', label: '4' }] },
    ];
    holders.mockSelectPlacementQuestions.mockResolvedValue(questions);
    const { GET } = await import('@/app/api/v2/placement/route');
    const res = await GET(makeRequest({ subject: 'math' }) as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toEqual({
      schemaVersion: 1,
      subject: 'math',
      grade: '9',
      questions,
    });
  });

  it('calls selectPlacementQuestions with subject/grade/count=6', async () => {
    const { GET } = await import('@/app/api/v2/placement/route');
    await GET(makeRequest({ subject: 'science' }) as never);
    expect(holders.mockSelectPlacementQuestions).toHaveBeenCalledWith(
      expect.anything(),
      { subject: 'science', grade: '9', count: 6 },
      false,
    );
  });
});

describe('GET /api/v2/placement — unexpected failures', () => {
  it('returns 500 INTERNAL_ERROR (no raw error text) when the selector throws', async () => {
    holders.mockSelectPlacementQuestions.mockRejectedValue(new Error('boom: leaked secret path'));
    const { GET } = await import('@/app/api/v2/placement/route');
    const res = await GET(makeRequest() as never);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.code).toBe('INTERNAL_ERROR');
    expect(body.error).not.toMatch(/leaked secret/);
  });
});
