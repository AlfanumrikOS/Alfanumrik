/**
 * use-setup.ts — the /onboarding v2 write hook (SetupFlow.tsx's data layer).
 *
 * Pins that every write reuses an EXISTING mechanism rather than inventing
 * a new one:
 *   - saveGrade / finish: direct `students` table update, same shape as the
 *     v1 onboarding/page.tsx write (grade as a bare string, board,
 *     onboarding_completed).
 *   - saveSubjects: PATCH /api/student/preferences with
 *     action: 'set_selected_subjects' (the governed, RPC-backed path).
 *   - inviteGuardian: POST /api/students/[id]/invite-guardian (the existing
 *     idempotent guardian-invite route).
 *   - getMinorSignal: reads is_minor / parent_consent_email from the
 *     CURRENT user's own auth metadata (client-side supabase.auth.getUser()),
 *     the same pair AuthScreen.tsx writes at signup and
 *     api/auth/bootstrap/route.ts already reads server-side. Fails closed to
 *     "not a minor" on any error.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('@alfanumrik/lib/api/auth-header', () => ({
  authHeader: vi.fn().mockResolvedValue({ Authorization: 'Bearer test-token' }),
}));

const mockEq = vi.fn();
const mockUpdate = vi.fn(() => ({ eq: mockEq }));
const mockFrom = vi.fn(() => ({ update: mockUpdate }));
const mockGetUser = vi.fn();

vi.mock('@alfanumrik/lib/supabase', () => ({
  supabase: {
    from: (...args: unknown[]) => mockFrom(...args),
    auth: { getUser: () => mockGetUser() },
  },
}));

import { useSetup, getMinorSignal } from '@alfanumrik/lib/onboarding/use-setup';

function jsonResponse(status: number, body: unknown) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('useSetup.saveGrade', () => {
  it('writes grade (bare string, P5) + board via the students table, keyed by id', async () => {
    mockEq.mockResolvedValue({ error: null });
    const { result } = renderHook(() => useSetup('student-1'));

    let res: { ok: boolean; error?: string } | undefined;
    await act(async () => {
      res = await result.current.saveGrade('9', 'CBSE');
    });

    expect(res).toEqual({ ok: true });
    expect(mockFrom).toHaveBeenCalledWith('students');
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ grade: '9', board: 'CBSE' }));
    // Never "Grade 9" — P5 bare string.
    expect(mockUpdate.mock.calls[0][0].grade).toBe('9');
    expect(mockEq).toHaveBeenCalledWith('id', 'student-1');
  });

  it('surfaces the supabase error message on failure', async () => {
    mockEq.mockResolvedValue({ error: { message: 'db down' } });
    const { result } = renderHook(() => useSetup('student-1'));

    let res: { ok: boolean; error?: string } | undefined;
    await act(async () => {
      res = await result.current.saveGrade('9', 'CBSE');
    });

    expect(res).toEqual({ ok: false, error: 'db down' });
  });

  it('short-circuits with no_student when studentId is undefined (never touches supabase)', async () => {
    const { result } = renderHook(() => useSetup(undefined));

    let res: { ok: boolean; error?: string } | undefined;
    await act(async () => {
      res = await result.current.saveGrade('9', 'CBSE');
    });

    expect(res).toEqual({ ok: false, error: 'no_student' });
    expect(mockFrom).not.toHaveBeenCalled();
  });
});

describe('useSetup.finish', () => {
  it('sets onboarding_completed: true via the same students table update', async () => {
    mockEq.mockResolvedValue({ error: null });
    const { result } = renderHook(() => useSetup('student-1'));

    let res: { ok: boolean; error?: string } | undefined;
    await act(async () => {
      res = await result.current.finish();
    });

    expect(res).toEqual({ ok: true });
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ onboarding_completed: true }));
  });
});

describe('useSetup.saveSubjects', () => {
  it('PATCHes /api/student/preferences with action set_selected_subjects and the auth header', async () => {
    const fetchSpy = vi.fn().mockReturnValue(jsonResponse(200, { success: true }));
    vi.stubGlobal('fetch', fetchSpy);

    const { result } = renderHook(() => useSetup('student-1'));
    let res: { ok: boolean; error?: string } | undefined;
    await act(async () => {
      res = await result.current.saveSubjects(['math', 'science'], 'math');
    });

    expect(res).toEqual({ ok: true });
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('/api/student/preferences');
    expect((init as RequestInit).method).toBe('PATCH');
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer test-token' });
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      action: 'set_selected_subjects',
      subjects: ['math', 'science'],
      preferred_subject: 'math',
    });
  });

  it('surfaces a governance rejection (e.g. subject_not_allowed) as ok:false', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockReturnValue(jsonResponse(422, { error: 'subject_not_allowed', detail: 'not allowed for grade' })),
    );
    const { result } = renderHook(() => useSetup('student-1'));
    let res: { ok: boolean; error?: string } | undefined;
    await act(async () => {
      res = await result.current.saveSubjects(['physics'], 'physics');
    });
    expect(res?.ok).toBe(false);
    expect(res?.error).toBe('not allowed for grade');
  });
});

describe('useSetup.inviteGuardian', () => {
  it('POSTs /api/students/[id]/invite-guardian with the email + locale', async () => {
    const fetchSpy = vi.fn().mockReturnValue(jsonResponse(200, { success: true, data: { linkId: 'l1' } }));
    vi.stubGlobal('fetch', fetchSpy);

    const { result } = renderHook(() => useSetup('student-42'));
    let res: { ok: boolean; error?: string } | undefined;
    await act(async () => {
      res = await result.current.inviteGuardian('parent@example.com', 'hi');
    });

    expect(res).toEqual({ ok: true });
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('/api/students/student-42/invite-guardian');
    expect((init as RequestInit).method).toBe('POST');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      guardian_email: 'parent@example.com',
      locale: 'hi',
    });
  });

  it('surfaces a 4xx failure as ok:false with the route error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(jsonResponse(400, { success: false, error: 'guardian_email must be a valid email' })));
    const { result } = renderHook(() => useSetup('student-42'));
    let res: { ok: boolean; error?: string } | undefined;
    await act(async () => {
      res = await result.current.inviteGuardian('not-an-email', 'en');
    });
    expect(res?.ok).toBe(false);
    expect(res?.error).toBe('guardian_email must be a valid email');
  });
});

describe('getMinorSignal', () => {
  it('reads is_minor + parent_consent_email from the current auth user metadata', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { user_metadata: { is_minor: true, parent_consent_email: 'p@x.com' } } },
      error: null,
    });
    const signal = await getMinorSignal();
    expect(signal).toEqual({ isMinor: true, parentConsentEmail: 'p@x.com' });
  });

  it('treats the string "true" as true (parity with the bootstrap route reader)', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { user_metadata: { is_minor: 'true' } } }, error: null });
    const signal = await getMinorSignal();
    expect(signal.isMinor).toBe(true);
    expect(signal.parentConsentEmail).toBeNull();
  });

  it('is not a minor when the signup metadata says so', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { user_metadata: { is_minor: false, parent_consent_email: 'p@x.com' } } },
      error: null,
    });
    const signal = await getMinorSignal();
    expect(signal.isMinor).toBe(false);
  });

  it('fails closed to not-a-minor when getUser returns an error', async () => {
    mockGetUser.mockResolvedValue({ data: null, error: { message: 'no session' } });
    const signal = await getMinorSignal();
    expect(signal).toEqual({ isMinor: false, parentConsentEmail: null });
  });

  it('fails closed to not-a-minor when getUser throws', async () => {
    mockGetUser.mockRejectedValue(new Error('boom'));
    const signal = await getMinorSignal();
    expect(signal).toEqual({ isMinor: false, parentConsentEmail: null });
  });
});
