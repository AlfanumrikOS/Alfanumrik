import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useExperienceV3 } from '@alfanumrik/lib/use-experience-v3';

const navigation = vi.hoisted(() => ({
  pathname: '/parent/messages',
  search: 'childId=11111111-1111-1111-1111-111111111111',
}));

const session = vi.hoisted(() => ({
  authenticated: true,
  userId: 'guardian-0',
}));

vi.mock('next/navigation', () => ({
  usePathname: () => navigation.pathname,
  useSearchParams: () => new URLSearchParams(navigation.search),
}));

vi.mock('@alfanumrik/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(async () => ({
        data: {
          session: session.authenticated
            ? { access_token: 'test-token', user: { id: session.userId } }
            : null,
        },
      })),
    },
  },
}));

const manifest = {
  role: 'parent',
  homeHref: '/parent/home',
  primary: [],
  more: [],
  desktop: [],
};

describe('useExperienceV3 authorization and scope resolution', () => {
  let userSequence = 0;

  beforeEach(() => {
    userSequence += 1;
    session.authenticated = true;
    session.userId = `guardian-${userSequence}`;
    navigation.pathname = '/parent/messages';
    navigation.search = 'childId=11111111-1111-1111-1111-111111111111';
    vi.restoreAllMocks();
  });

  it.each([401, 403])('fails closed on an authenticated server %s', async (status) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status, ok: false }));

    const { result } = renderHook(() => useExperienceV3('parent'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.denied).toBe(true);
    expect(result.current.legacyAllowed).toBe(false);
    expect(result.current.enabled).toBe(false);
  });

  it('keeps the unauthenticated legacy login boundary reachable', async () => {
    session.authenticated = false;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useExperienceV3('parent'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.legacyAllowed).toBe(true);
    expect(result.current.denied).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('re-resolves the parent assignment when the active child changes', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({
        enabled: true,
        capabilities: {},
        manifest,
        routeMapped: true,
        routeAllowed: true,
        scope: { childId: '11111111-1111-1111-1111-111111111111' },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result, rerender } = renderHook(() => useExperienceV3('parent'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('childId=11111111-1111-1111-1111-111111111111');

    navigation.search = 'childId=22222222-2222-2222-2222-222222222222';
    rerender();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('childId=22222222-2222-2222-2222-222222222222');
  });
});
