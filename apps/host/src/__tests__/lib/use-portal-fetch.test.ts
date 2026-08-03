/**
 * packages/lib/src/usePortalFetch.ts — timeout path + request envelope pins.
 *
 * usePortalFetch/usePortalAction are the unified Edge-Function fetch helpers
 * for the Teacher/Parent portals (and nep-compliance). Pins:
 *
 *   1. TIMEOUT PATH — when the AbortController fires, the raw AbortError is
 *      translated into a FRIENDLY message: the caller-supplied
 *      `timeoutMessage`, else PORTAL_TIMEOUT_MESSAGE_EN. usePortalAction
 *      selects the bilingual copy (P7) from `isHi` AT CALL TIME.
 *   2. HEADERS — every request carries the anon `apikey` header, and the
 *      current session's Bearer token is attached when a session exists.
 *   3. usePortalAction envelope — POST `{ action, ...params }` to the given
 *      endpoint; the returned function is referentially stable across
 *      renders (including language toggles).
 *
 * Conventions mirror the existing hook tests (renderHook; mocked
 * @alfanumrik/lib/supabase session; stubbed global fetch).
 *
 * Owning agent: testing.
 */

import { renderHook } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// ── Mock the Supabase client the hook reads the session from ────────────────
const getSession = vi.fn();
vi.mock('@alfanumrik/lib/supabase', () => ({
  supabase: { auth: { getSession: (...a: unknown[]) => getSession(...a) } },
}));

import {
  usePortalFetch,
  usePortalAction,
  PORTAL_TIMEOUT_MESSAGE_EN,
  PORTAL_TIMEOUT_MESSAGE_HI,
} from '@alfanumrik/lib/usePortalFetch';

/**
 * A fetch that NEVER resolves on its own and rejects with a real AbortError
 * when the hook's AbortController fires — the browser-faithful timeout shape.
 */
function hangingFetch() {
  return vi.fn(
    (_url: unknown, init?: RequestInit) =>
      new Promise<Response>((_res, reject) => {
        const signal = init?.signal as AbortSignal | undefined;
        const fail = () => {
          const err = new Error('The operation was aborted.');
          err.name = 'AbortError';
          reject(err);
        };
        if (signal?.aborted) fail();
        else signal?.addEventListener('abort', fail);
      }),
  );
}

function okFetch(json: unknown) {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => json,
    text: async () => JSON.stringify(json),
  }) as unknown as Response);
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://stub.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-test-key';
  getSession.mockResolvedValue({ data: { session: { access_token: 'tok-abc' } } });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('usePortalFetch — timeout path (friendly message, never a raw AbortError)', () => {
  it('abort → rejects with the friendly EN default, not the AbortError', async () => {
    vi.stubGlobal('fetch', hangingFetch());
    const { result } = renderHook(() => usePortalFetch());

    await expect(
      result.current('/functions/v1/teacher-dashboard', { timeoutMs: 10 }),
    ).rejects.toThrow(PORTAL_TIMEOUT_MESSAGE_EN);
  });

  it('abort → a caller-supplied timeoutMessage wins over the default', async () => {
    vi.stubGlobal('fetch', hangingFetch());
    const { result } = renderHook(() => usePortalFetch());

    await expect(
      result.current('/functions/v1/parent-portal', {
        timeoutMs: 10,
        timeoutMessage: 'custom copy',
      }),
    ).rejects.toThrow('custom copy');
  });

  it('a NON-abort failure is rethrown as-is (the friendly copy is timeout-only)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('network down');
    }));
    const { result } = renderHook(() => usePortalFetch());

    await expect(
      result.current('/functions/v1/teacher-dashboard', { timeoutMs: 5_000 }),
    ).rejects.toThrow('network down');
  });
});

describe('usePortalAction — bilingual timeout copy chosen by isHi AT CALL TIME (P7)', () => {
  it('isHi=true → Hindi timeout copy', async () => {
    vi.stubGlobal('fetch', hangingFetch());
    const { result } = renderHook(() => usePortalAction('/functions/v1/parent-portal', true, 10));

    await expect(result.current('get_children')).rejects.toThrow(PORTAL_TIMEOUT_MESSAGE_HI);
  });

  it('isHi=false → English timeout copy', async () => {
    vi.stubGlobal('fetch', hangingFetch());
    const { result } = renderHook(() => usePortalAction('/functions/v1/parent-portal', false, 10));

    await expect(result.current('get_children')).rejects.toThrow(PORTAL_TIMEOUT_MESSAGE_EN);
  });

  it('language toggle keeps the SAME function reference but switches the copy', async () => {
    vi.stubGlobal('fetch', hangingFetch());
    const { result, rerender } = renderHook(
      ({ hi }: { hi: boolean }) => usePortalAction('/functions/v1/parent-portal', hi, 10),
      { initialProps: { hi: false } },
    );

    const stableRef = result.current;
    rerender({ hi: true });
    // Referential stability — safe in useEffect/useCallback dep arrays.
    expect(result.current).toBe(stableRef);
    // ...and yet the copy follows the CURRENT language at call time.
    await expect(result.current('get_children')).rejects.toThrow(PORTAL_TIMEOUT_MESSAGE_HI);
  });
});

describe('usePortalFetch/usePortalAction — request envelope (apikey + Bearer)', () => {
  it('attaches the anon apikey and the session Bearer token; POSTs { action, ...params }', async () => {
    const fetchMock = okFetch({ ok: true, children: [] });
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => usePortalAction('/functions/v1/parent-portal', false));

    await result.current('get_children', { child_id: 'c1' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://stub.supabase.co/functions/v1/parent-portal');
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers.apikey).toBe('anon-test-key');
    expect(headers.Authorization).toBe('Bearer tok-abc');
    expect(headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body as string)).toEqual({ action: 'get_children', child_id: 'c1' });
  });

  it('fails soft when no session can be read: request still goes out with apikey, WITHOUT Bearer', async () => {
    getSession.mockRejectedValue(new Error('no session'));
    const fetchMock = okFetch({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => usePortalFetch());

    await result.current('/functions/v1/nep-compliance', { method: 'POST', body: { action: 'x' } });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers.apikey).toBe('anon-test-key');
    expect(headers.Authorization).toBeUndefined();
  });
});
