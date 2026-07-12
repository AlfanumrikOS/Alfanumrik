/**
 * Teacher dashboard SWR hooks + teacherDashboardFetch — contract tests.
 *
 * `src/lib/teacher/use-teacher-data.ts` is additive: thin SWR wrappers over the
 * EXISTING `teacher-dashboard` Edge actions. We pin the two load-bearing
 * contracts without mounting any page:
 *
 *   1. teacherDashboardFetch — POSTs { action, ...params } to the
 *      teacher-dashboard function URL, attaches the Bearer token from the
 *      mocked Supabase session (apikey always present), parses JSON on 200, and
 *      THROWS (with .status) on a non-ok response.
 *
 *   2. Hook key discipline — a hook is INERT (null SWR key → fetcher never
 *      runs → no network) until its required params are present:
 *        - useGradingQueue(false) is inert (the Wave B `enabled` gate),
 *        - useHeatmap(undefined) is inert (no classId).
 *      We assert global.fetch is NEVER called for the inert hooks, and that the
 *      ready path fires exactly one request with the expected envelope.
 *
 * Conventions mirror the existing hook tests (renderHook + SWRConfig wrapper
 * with a fresh provider Map per test to defeat cross-test dedupe/cache).
 *
 * Owning agent: testing.
 */

import React from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { SWRConfig } from 'swr';

// ── Mock the Supabase client + URL/key the fetcher reads. ──────────────────────
const getSession = vi.fn();
vi.mock('@alfanumrik/lib/supabase', () => ({
  supabase: { auth: { getSession: (...a: unknown[]) => getSession(...a) } },
  supabaseUrl: 'https://placeholder.supabase.co',
  supabaseAnonKey: 'anon-test-key',
}));

// ── Mock useAuth so we control the teacher session each hook reads. ────────────
const useAuthMock = vi.fn();
vi.mock('@alfanumrik/lib/AuthContext', () => ({
  useAuth: () => useAuthMock(),
}));

import {
  teacherDashboardFetch,
  useGradingQueue,
  useHeatmap,
  useTeacherDashboard,
} from '@alfanumrik/lib/teacher/use-teacher-data';

const FN_URL = 'https://placeholder.supabase.co/functions/v1/teacher-dashboard';

/** Fresh SWR cache per test → no dedupe/cache bleed between cases. */
function SwrWrapper({ children }: { children: React.ReactNode }) {
  return React.createElement(
    SWRConfig,
    { value: { provider: () => new Map(), dedupingInterval: 0 } },
    children,
  );
}

function okResponse(json: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => json,
    text: async () => JSON.stringify(json),
  } as unknown as Response;
}

beforeEach(() => {
  getSession.mockReset();
  useAuthMock.mockReset();
  getSession.mockResolvedValue({ data: { session: { access_token: 'tok-abc' } } });
  // Default: an authenticated teacher.
  useAuthMock.mockReturnValue({ teacher: { id: 'teacher-1' } });
  global.fetch = vi.fn().mockResolvedValue(okResponse({ ok: true })) as unknown as typeof fetch;
});

describe('teacherDashboardFetch — Edge envelope + auth header', () => {
  it('POSTs { action, ...params } to the teacher-dashboard function URL', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      okResponse({ classes: [] }),
    );

    const out = await teacherDashboardFetch('get_dashboard', { teacher_id: 't1' });

    expect(out).toEqual({ classes: [] });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe(FN_URL);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ action: 'get_dashboard', teacher_id: 't1' });
  });

  it('attaches the Bearer token from the mocked session (and the apikey)', async () => {
    await teacherDashboardFetch('get_dashboard');

    const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(init.headers.Authorization).toBe('Bearer tok-abc');
    expect(init.headers.apikey).toBe('anon-test-key');
    expect(init.headers['Content-Type']).toBe('application/json');
  });

  it('falls back to apikey-only when there is no session (no Authorization header)', async () => {
    getSession.mockResolvedValue({ data: { session: null } });

    await teacherDashboardFetch('get_dashboard');

    const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(init.headers.Authorization).toBeUndefined();
    expect(init.headers.apikey).toBe('anon-test-key');
  });

  it('fails soft (apikey-only, no throw) when getSession rejects', async () => {
    getSession.mockRejectedValue(new Error('supabase not initialized'));

    await expect(teacherDashboardFetch('get_dashboard')).resolves.toEqual({ ok: true });
    const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(init.headers.Authorization).toBeUndefined();
  });

  it('throws an Error carrying .status on a non-ok response', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({}),
      text: async () => 'forbidden',
    } as unknown as Response);

    await expect(teacherDashboardFetch('get_dashboard')).rejects.toMatchObject({
      status: 403,
    });
    await expect(teacherDashboardFetch('get_dashboard')).rejects.toThrow(/API error 403/);
  });
});

describe('hook key discipline — inert until required params present', () => {
  it('useGradingQueue(false) is inert: null key, no fetch', async () => {
    const { result } = renderHook(() => useGradingQueue(false), { wrapper: SwrWrapper });

    // Give any (incorrect) async fetch a chance to fire.
    await new Promise((r) => setTimeout(r, 20));

    expect(global.fetch).not.toHaveBeenCalled();
    expect(result.current.data).toBeUndefined();
    expect(result.current.error).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
  });

  it('useHeatmap(undefined) is inert: no classId → null key, no fetch', async () => {
    const { result } = renderHook(() => useHeatmap(undefined), { wrapper: SwrWrapper });

    await new Promise((r) => setTimeout(r, 20));

    expect(global.fetch).not.toHaveBeenCalled();
    expect(result.current.data).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
  });

  it('useGradingQueue(true) with no teacher session is still inert (no teacherId)', async () => {
    useAuthMock.mockReturnValue({ teacher: null });

    renderHook(() => useGradingQueue(true), { wrapper: SwrWrapper });
    await new Promise((r) => setTimeout(r, 20));

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('useTeacherDashboard fires exactly one request with the get_dashboard envelope once a teacher is present', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      okResponse({ classes: [{ id: 'c1', name: 'A', student_count: 3 }] }),
    );

    const { result } = renderHook(() => useTeacherDashboard(), { wrapper: SwrWrapper });

    await waitFor(() => expect(result.current.data).toBeDefined());

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe(FN_URL);
    expect(JSON.parse(init.body)).toEqual({
      action: 'get_dashboard',
      teacher_id: 'teacher-1',
    });
  });

  it('useHeatmap(classId) becomes active and posts the get_heatmap envelope (default subject math)', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(okResponse({ rows: [] }));

    const { result } = renderHook(() => useHeatmap('class-9'), { wrapper: SwrWrapper });

    await waitFor(() => expect(result.current.data).toBeDefined());

    const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({
      action: 'get_heatmap',
      teacher_id: 'teacher-1',
      class_id: 'class-9',
      subject: 'math',
    });
  });

  it('clears the previous class heatmap while a newly selected class is loading', async () => {
    let releaseSecond!: () => void;
    const secondResponse = new Promise<Response>((resolve) => {
      releaseSecond = () => resolve(okResponse({
        class_id: 'class-2',
        student_count: 1,
        concept_count: 0,
        concepts: [],
        matrix: [{
          student_id: 'student-2',
          class_id: 'class-2',
          student_name: 'Ravi',
          grade: '7',
          avg_mastery: null,
          cells: [],
        }],
      }));
    });

    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(
      async (_url: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body || '{}'));
        if (body.class_id === 'class-2') return secondResponse;
        return okResponse({
          class_id: 'class-1',
          student_count: 1,
          concept_count: 0,
          concepts: [],
          matrix: [{
            student_id: 'student-1',
            class_id: 'class-1',
            student_name: 'Asha',
            grade: '7',
            avg_mastery: 65,
            cells: [],
          }],
        });
      },
    );

    const { result, rerender } = renderHook(
      ({ classId }: { classId: string }) => useHeatmap(classId),
      { initialProps: { classId: 'class-1' }, wrapper: SwrWrapper },
    );

    await waitFor(() => expect(result.current.data?.class_id).toBe('class-1'));
    rerender({ classId: 'class-2' });
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));

    expect(result.current.data).toBeUndefined();

    releaseSecond();
    await waitFor(() => expect(result.current.data?.class_id).toBe('class-2'));
    expect(result.current.data?.matrix[0]?.student_name).toBe('Ravi');
  });
});
