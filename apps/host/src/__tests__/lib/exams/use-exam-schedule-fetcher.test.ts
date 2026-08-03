/**
 * useExamSchedule — the REAL network fetcher contract (fetchExamSchedule),
 * exercised with the real 'swr' package + a stubbed global.fetch (NOT a
 * mocked 'swr' — see use-exam-schedule.test.ts for the derived-state suite,
 * which mocks 'swr' directly and therefore never calls the real fetcher).
 *
 * Pins:
 *   - fetches GET /api/v2/exam-schedule with credentials: 'same-origin' and
 *     the auth header attached.
 *   - a 404 response resolves to `entries: []` / `next: null` (flag off),
 *     not an error.
 *   - a non-ok, non-404 response THROWS (surfaced as SWR's `error`), not a
 *     silent empty state.
 *   - unwraps the `{ data: ... }` envelope OR accepts a bare payload
 *     (`body.data ?? body`).
 *
 * IMPORTANT: SWR keeps a module-level cache keyed by the SWR key
 * (`'v2/exam-schedule/' + studentId`), and this hook sets
 * `dedupingInterval: 60_000`. Reusing the SAME studentId across test cases in
 * this file would let a later test silently reuse an earlier test's cached
 * response instead of hitting its own mocked fetch. Every test below uses a
 * DISTINCT studentId for exactly this reason — do not "clean this up" to a
 * shared constant.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

vi.mock('@alfanumrik/lib/api/auth-header', () => ({
  authHeader: vi.fn().mockResolvedValue({ Authorization: 'Bearer test-token' }),
}));

import { useExamSchedule } from '@alfanumrik/lib/exams/use-exam-schedule';

function jsonResponse(status: number, body: unknown) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useExamSchedule — real fetcher contract', () => {
  it('requests GET /api/v2/exam-schedule with credentials same-origin and the auth header', async () => {
    const fetchSpy = vi.fn().mockReturnValue(jsonResponse(200, { schemaVersion: 1, entries: [] }));
    vi.stubGlobal('fetch', fetchSpy);

    renderHook(() => useExamSchedule('stu-headers', false));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('/api/v2/exam-schedule');
    expect((init as RequestInit).credentials).toBe('same-origin');
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer test-token' });
  });

  it('does not fetch at all when studentId is null (SWR key is null)', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    renderHook(() => useExamSchedule(null, false));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('resolves a 404 to an empty schedule (flag off), not an error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(jsonResponse(404, { error: 'not_found' })));
    const { result } = renderHook(() => useExamSchedule('stu-404', false));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.entries).toEqual([]);
    expect(result.current.next).toBeNull();
    expect(result.current.error).toBeFalsy();
  });

  it('throws (surfaces as SWR error) on a non-ok, non-404 response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(jsonResponse(500, { error: 'boom' })));
    const { result } = renderHook(() => useExamSchedule('stu-500', false));
    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.entries).toEqual([]);
  });

  it('unwraps a { data: {...} } envelope', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockReturnValue(
        jsonResponse(200, {
          success: true,
          data: { schemaVersion: 1, entries: [{ id: 'e1', source: 'student', title: 'X', startsOn: '2026-08-02', endsOn: '2026-08-02' }] },
        }),
      ),
    );
    const { result } = renderHook(() => useExamSchedule('stu-envelope', false));
    await waitFor(() => expect(result.current.entries.length).toBe(1));
    expect(result.current.entries[0].id).toBe('e1');
  });

  it('accepts a bare (non-enveloped) payload too', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockReturnValue(
        jsonResponse(200, {
          schemaVersion: 1,
          entries: [{ id: 'bare-1', source: 'student', title: 'Y', startsOn: '2026-08-02', endsOn: '2026-08-02' }],
        }),
      ),
    );
    const { result } = renderHook(() => useExamSchedule('stu-bare', false));
    await waitFor(() => expect(result.current.entries.length).toBe(1));
    expect(result.current.entries[0].id).toBe('bare-1');
  });
});
