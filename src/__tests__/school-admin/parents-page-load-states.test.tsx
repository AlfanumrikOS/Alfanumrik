/**
 * SchoolAdminParentsPage — admin-record load resilience + empty state (render unit).
 *
 * WHY THIS EXISTS
 *   fetchAdminRecord was refactored to try/catch/finally so loadingAdmin ALWAYS
 *   clears — even on the redirect branch — preventing an infinite full-page
 *   skeleton. Three distinct outcomes are now pinned:
 *     (a) school_admins query ERROR → inline, retryable error card; loading clears;
 *         the admin is NOT bounced to /login (they can retry).
 *     (b) NO record (genuine "not a school admin") → redirect to /login AND
 *         loading clears (finally runs even on the early return).
 *     (c) record OK + parents list EMPTY → the friendly empty state renders; an
 *         empty list is NOT treated as an error.
 *
 *   Seams: AuthContext (authed), supabase (school_admins + auth.getSession),
 *   next/navigation (router.replace spy), global fetch (parents API). The real
 *   @/components/ui primitives render (they are dependency-light), so the
 *   page's own copy is assertable on screen.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';

const SCHOOL_ID = '11111111-1111-4111-a111-111111111111';

// ── Auth: signed in, English ──────────────────────────────────────────────────
vi.mock('@/lib/AuthContext', () => ({
  useAuth: () => ({
    authUserId: 'admin-user-1',
    isLoading: false,
    isHi: false,
    setLanguage: vi.fn(),
  }),
}));

// ── Router spy ────────────────────────────────────────────────────────────────
// IMPORTANT: useRouter MUST return a STABLE object. fetchAdminRecord is a
// useCallback that lists `router` in its deps; a fresh object each render would
// change its identity every render and re-fire the admin-record effect in an
// infinite loop (loadingAdmin would never settle).
const routerReplace = vi.fn();
const routerPush = vi.fn();
const stableRouter = { replace: routerReplace, push: routerPush };
vi.mock('next/navigation', () => ({
  useRouter: () => stableRouter,
}));

// ── Supabase: school_admins maybeSingle() result is controllable per test ─────
const adminResult: { value: { data: unknown; error: unknown } } = {
  value: { data: { school_id: SCHOOL_ID, name: 'Principal Sharma' }, error: null },
};

vi.mock('@/lib/supabase', () => {
  const builder: Record<string, unknown> = {};
  ['select', 'eq'].forEach((m) => { builder[m] = vi.fn().mockReturnValue(builder); });
  builder.maybeSingle = vi.fn().mockImplementation(() => Promise.resolve(adminResult.value));
  return {
    supabase: {
      from: vi.fn(() => builder),
      auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'tok-123' } } }),
      },
    },
  };
});

import SchoolAdminParentsPage from '@/app/school-admin/parents/page';

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  routerReplace.mockClear();
  // Default: parents API returns an empty links list (success, no error).
  fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ success: true, data: { links: [] } }),
  });
  vi.stubGlobal('fetch', fetchMock);
  // Reset admin result to the happy default; per-test overrides below.
  adminResult.value = { data: { school_id: SCHOOL_ID, name: 'Principal Sharma' }, error: null };
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('parents page — (a) admin-record query error', () => {
  it('clears loading and shows a retryable error card instead of spinning forever', async () => {
    adminResult.value = { data: null, error: { message: 'db down' } };

    render(React.createElement(SchoolAdminParentsPage));

    // The inline error copy from the page renders…
    await waitFor(() =>
      expect(
        screen.getByText('We couldn’t load your school admin account. Please try again.'),
      ).toBeDefined(),
    );
    // …with a Retry affordance…
    expect(screen.getByRole('button', { name: 'Retry' })).toBeDefined();
    // …and the admin is NOT redirected (they can retry in place).
    expect(routerReplace).not.toHaveBeenCalled();
  });
});

describe('parents page — (b) no school-admin record', () => {
  it('redirects to /login and clears loading (finally runs on the early return)', async () => {
    adminResult.value = { data: null, error: null };

    render(React.createElement(SchoolAdminParentsPage));

    await waitFor(() => expect(routerReplace).toHaveBeenCalledWith('/login'));
    // No error card on a genuine "not a school admin" — it's a redirect, not a failure.
    expect(
      screen.queryByText('We couldn’t load your school admin account. Please try again.'),
    ).toBeNull();
  });
});

describe('parents page — (c) empty parents list is NOT an error', () => {
  it('renders the friendly empty state, not an error card', async () => {
    // adminResult + fetch defaults: valid admin, empty links.
    render(React.createElement(SchoolAdminParentsPage));

    await waitFor(() => expect(screen.getByText('No parents linked yet')).toBeDefined());
    // The empty state's guidance copy is present…
    expect(screen.getByText(/Parents can join via your school invite code/)).toBeDefined();
    // …and the admin-record error card is NOT shown for an empty (successful) list.
    expect(
      screen.queryByText('We couldn’t load your school admin account. Please try again.'),
    ).toBeNull();
  });
});
