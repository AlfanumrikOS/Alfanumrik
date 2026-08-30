/**
 * /parent/children — a failed read never renders "No children linked yet".
 *
 * Frontend audit, Phase 3 Wave B (parent portal).
 *
 *   `usePortalAction` only THROWS on non-2xx. The parent-portal Edge Function
 *   also returns HTTP 200 carrying `{ error }` (e.g. `getChildDashboardData`
 *   returns `{ error: 'Student not found', id }`). That body matched none of
 *   the response normalizers, so `childrenList` stayed `[]`, `loadError` stayed
 *   empty, and the page rendered the first-run empty state — telling a paying
 *   parent their child is NOT LINKED when the read had actually failed. The
 *   empty state also invites re-linking, so the lie is actionable.
 *
 *   Separately, `handleUnlinkConfirm` awaited a PostgREST update and caught
 *   nothing: the builder RESOLVES with { data, error } rather than rejecting,
 *   so the catch was dead code and a FAILED unlink closed the modal exactly
 *   like a successful one.
 *
 *   Both directions are asserted: on failure the error card renders and the
 *   "No children linked yet" copy does NOT; on a successful-but-empty read the
 *   empty copy renders and the error card does NOT.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import React from 'react';

const { authState } = vi.hoisted(() => ({
  authState: {
    guardian: { id: 'guardian-1', name: 'Parent' },
    authUserId: 'user-1',
    activeRole: 'guardian',
    isLoggedIn: true,
    isLoading: false,
    isHi: false,
  },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/parent/children',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@alfanumrik/lib/AuthContext', () => ({
  useAuth: () => authState,
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('@alfanumrik/lib/usePermissions', () => ({
  usePermissions: () => ({ can: () => true, loading: false }),
}));

vi.mock('@alfanumrik/lib/pulse/use-pulse', () => ({
  usePulse: () => ({ data: null, error: null, isLoading: false, mutate: vi.fn() }),
}));

vi.mock('@alfanumrik/lib/analytics', () => ({ track: vi.fn() }));

const { warnSpy } = vi.hoisted(() => ({ warnSpy: vi.fn() }));
vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { warn: warnSpy, error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

/* Stable api function — the page lists it in effect deps (see the sibling
 * reports test for why an unstable mock spins forever). */
const { portalResults } = vi.hoisted(() => {
  const map = new Map<string, () => Promise<unknown>>();
  const stableApi = (action: string) => {
    const handler = map.get(action);
    if (!handler) return Promise.resolve({});
    return handler();
  };
  return { portalResults: { map, stableApi } };
});

vi.mock('@alfanumrik/lib/usePortalFetch', () => ({
  usePortalAction: () => portalResults.stableApi,
  usePortalFetch: () => vi.fn(),
  PORTAL_TIMEOUT_MESSAGE_EN: 'Request timed out. Please try again.',
  PORTAL_TIMEOUT_MESSAGE_HI: 'अनुरोध का समय समाप्त हो गया। कृपया पुनः प्रयास करें।',
}));

vi.mock('@alfanumrik/lib/supabase', () => ({
  supabase: {
    from: () => {
      const b: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'update', 'insert', 'in', 'order', 'limit']) {
        b[m] = () => b;
      }
      b.then = (r: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(r);
      b.maybeSingle = () => Promise.resolve({ data: null, error: null });
      b.single = () => Promise.resolve({ data: null, error: null });
      return b;
    },
    auth: { getSession: () => Promise.resolve({ data: { session: { access_token: 'jwt' } } }) },
  },
}));

vi.mock('@alfanumrik/ui/parent/ParentChildChat', () => ({ default: () => null }));
vi.mock('@alfanumrik/ui/pulse', () => ({ StudentPulse: () => null }));

import ParentChildrenPage from '@/app/parent/children/page';

const EMPTY_EN = 'No children linked yet';
const FAIL_EN = 'Could not load your children';

beforeEach(() => {
  vi.clearAllMocks();
  portalResults.map.clear();
  authState.isHi = false;
});

afterEach(() => cleanup());

describe('/parent/children — a failed read is not "no children linked"', () => {
  it('a THROWN failure (non-2xx) renders the error card, NOT the empty state', async () => {
    portalResults.map.set('get_child_dashboard', () =>
      Promise.reject(new Error('API error 500: Failed to load children')),
    );

    render(<ParentChildrenPage />);

    expect(await screen.findByText(FAIL_EN)).toBeTruthy();
    expect(screen.queryByText(EMPTY_EN)).toBeNull();
  });

  it('an HTTP 200 carrying { error } ALSO renders the error card, NOT the empty state', async () => {
    // The exact shape getChildDashboardData returns on a missing student.
    portalResults.map.set('get_child_dashboard', () =>
      Promise.resolve({ error: 'Student not found', id: 'child-1' }),
    );

    render(<ParentChildrenPage />);

    expect(await screen.findByText(FAIL_EN)).toBeTruthy();
    expect(screen.queryByText(EMPTY_EN)).toBeNull();
  });

  it('a genuinely empty result renders the empty state and NO error card', async () => {
    portalResults.map.set('get_child_dashboard', () => Promise.resolve({ students: [] }));

    render(<ParentChildrenPage />);

    expect(await screen.findByText(EMPTY_EN)).toBeTruthy();
    expect(screen.queryByText(FAIL_EN)).toBeNull();
  });

  it('logs the failure with a reason only — no child id or name (P13)', async () => {
    portalResults.map.set('get_child_dashboard', () =>
      Promise.resolve({ error: 'Student not found', id: 'child-secret-id' }),
    );

    render(<ParentChildrenPage />);
    await screen.findByText(FAIL_EN);

    const call = warnSpy.mock.calls.find((c) => c[0] === 'parent.children.load_failed');
    expect(call).toBeTruthy();
    expect(Object.keys(call?.[1] ?? {})).toEqual(['reason']);
  });
});
