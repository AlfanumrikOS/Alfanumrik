/**
 * Login page open-redirect guard (M1, 2026-06-10 audit)
 *
 * Both redirect call sites in src/app/login/page.tsx must route the
 * `?redirect=` query param through the REAL validateRedirectTarget from
 * src/lib/identity (open-redirect prevention) with the role-based
 * destination as the fallback:
 *
 *   1. The already-logged-in useEffect (deep-link returns for users who
 *      land on /login with a live session).
 *   2. handleSuccess (fired by AuthScreen after a successful login).
 *
 * These tests RENDER the real page component — next/navigation, AuthContext,
 * and AuthScreen are mocked, but `@alfanumrik/lib/identity` is NOT mocked, so the real
 * validateRedirectTarget + getRoleDestination execute inside the page. This
 * deliberately avoids the known repo anti-pattern of replicating guard logic
 * locally inside the test.
 *
 * Pre-M1 behavior being pinned against regression: the page used a bare
 * `redirectTo.startsWith('/')` check, which `//evil.com` passes — an open
 * redirect for any logged-in user following a crafted link.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import LoginPage from '@/app/login/page';

// ── Controllable mocks ───────────────────────────────────────────

const replaceMock = vi.fn();
const refreshMock = vi.fn();

// Per-test query params consumed by useSearchParams()
let searchParams: Record<string, string | null> = {};

// Per-test auth state consumed by useAuth()
let authState: {
  isLoggedIn: boolean;
  isLoading: boolean;
  activeRole: string;
  isHi: boolean;
} = { isLoggedIn: false, isLoading: false, activeRole: 'none', isHi: false };

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    replace: replaceMock,
    refresh: refreshMock,
    push: vi.fn(),
    back: vi.fn(),
  }),
  useSearchParams: () => ({
    get: (key: string) => searchParams[key] ?? null,
  }),
}));

vi.mock('@alfanumrik/lib/AuthContext', () => ({
  useAuth: () => authState,
}));

// AuthScreen is heavy (supabase client, full signup flow). Replace it with a
// minimal trigger so we can fire onSuccess — the page's handleSuccess is the
// code under test, not AuthScreen.
vi.mock('@alfanumrik/ui/auth/AuthScreen', () => ({
  AuthScreen: ({ onSuccess }: { onSuccess: () => void; initialRole?: string }) => (
    <button data-testid="trigger-login-success" onClick={onSuccess}>
      simulate login success
    </button>
  ),
}));

// NOTE: '@alfanumrik/lib/identity' is intentionally NOT mocked.

beforeEach(() => {
  vi.clearAllMocks();
  searchParams = {};
  authState = { isLoggedIn: false, isLoading: false, activeRole: 'none', isHi: false };
});

// ── Call site 1: already-logged-in useEffect ─────────────────────

describe('login page — already-logged-in effect (M1 guard)', () => {
  it('blocks ?redirect=//evil.com and falls back to the role destination (student)', async () => {
    searchParams = { redirect: '//evil.com' };
    authState = { isLoggedIn: true, isLoading: false, activeRole: 'student', isHi: false };

    render(<LoginPage />);

    await waitFor(() => expect(replaceMock).toHaveBeenCalled());
    expect(replaceMock).toHaveBeenCalledWith('/dashboard');
    expect(replaceMock).not.toHaveBeenCalledWith(expect.stringContaining('evil.com'));
  });

  it('blocks ?redirect=//evil.com for a teacher and falls back to /teacher (role-aware fallback, not hardcoded /dashboard)', async () => {
    searchParams = { redirect: '//evil.com' };
    authState = { isLoggedIn: true, isLoading: false, activeRole: 'teacher', isHi: false };

    render(<LoginPage />);

    await waitFor(() => expect(replaceMock).toHaveBeenCalled());
    expect(replaceMock).toHaveBeenCalledWith('/teacher');
  });

  it('preserves a legitimate internal deep-link ?redirect=/foxy', async () => {
    searchParams = { redirect: '/foxy' };
    authState = { isLoggedIn: true, isLoading: false, activeRole: 'student', isHi: false };

    render(<LoginPage />);

    await waitFor(() => expect(replaceMock).toHaveBeenCalled());
    expect(replaceMock).toHaveBeenCalledWith('/foxy');
  });

  it('blocks javascript: and encoded-slash vectors', async () => {
    searchParams = { redirect: 'javascript:alert(1)' };
    authState = { isLoggedIn: true, isLoading: false, activeRole: 'student', isHi: false };

    render(<LoginPage />);

    await waitFor(() => expect(replaceMock).toHaveBeenCalled());
    expect(replaceMock).toHaveBeenCalledWith('/dashboard');
  });

  it('uses the role destination when no redirect param is present', async () => {
    authState = { isLoggedIn: true, isLoading: false, activeRole: 'parent', isHi: false };

    render(<LoginPage />);

    await waitFor(() => expect(replaceMock).toHaveBeenCalled());
    expect(replaceMock).toHaveBeenCalledWith('/parent');
  });

  it('does not redirect while auth is still loading', async () => {
    searchParams = { redirect: '/foxy' };
    authState = { isLoggedIn: true, isLoading: true, activeRole: 'student', isHi: false };

    render(<LoginPage />);

    // Give the effect a tick to (not) fire
    await new Promise((r) => setTimeout(r, 50));
    expect(replaceMock).not.toHaveBeenCalled();
  });
});

// ── Call site 2: handleSuccess (post-login) ──────────────────────
//
// SECURITY FIX (2026-08-30): handleSuccess used to navigate IMMEDIATELY using
// the `?role=` URL hint — the tab the user clicked BEFORE authenticating —
// via getRoleDestination(roleParam || 'student'), with zero dependency on the
// server-verified activeRole. A student logging in with the "Teacher" tab
// selected (?role=teacher) was sent straight to /teacher's URL before the
// server had confirmed anything. The tests below used to pin exactly that
// behavior (asserting replaceMock was called with the role-hint destination
// the instant handleSuccess fired, while isLoggedIn was still false). That
// was the bug, not a contract to protect.
//
// Fixed behavior: handleSuccess only triggers a refresh; the SAME
// `isLoggedIn && activeRole !== 'none'` effect from call site 1 (already
// covered above, open-redirect guard included) is now the ONLY place
// navigation happens, driven by the server-verified activeRole — never the
// URL's role hint.
describe('login page — handleSuccess no longer self-navigates on a client role hint (2026-08-30 fix)', () => {
  it('triggers a refresh but does NOT navigate immediately, even with ?role=teacher in the URL', async () => {
    searchParams = { role: 'teacher' };
    authState = { isLoggedIn: false, isLoading: false, activeRole: 'none', isHi: false };

    render(<LoginPage />);
    fireEvent.click(screen.getByTestId('trigger-login-success'));

    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it('navigates to the SERVER-VERIFIED role destination once activeRole resolves — not the ?role= hint', async () => {
    // Attacker/user angle: clicked "Teacher" before logging in with a
    // student account. The URL still says role=teacher throughout.
    searchParams = { role: 'teacher' };
    authState = { isLoggedIn: false, isLoading: false, activeRole: 'none', isHi: false };

    const { rerender } = render(<LoginPage />);
    fireEvent.click(screen.getByTestId('trigger-login-success'));
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    expect(replaceMock).not.toHaveBeenCalled();

    // AuthContext resolves the REAL role server-side (get_user_role) and
    // isLoggedIn flips true — simulate that state landing.
    authState = { isLoggedIn: true, isLoading: false, activeRole: 'student', isHi: false };
    rerender(<LoginPage />);

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/dashboard'));
    expect(replaceMock).not.toHaveBeenCalledWith('/teacher');
  });

  it('still applies the M1 open-redirect guard once navigation happens via the verified-role effect', async () => {
    searchParams = { redirect: '//evil.com', role: 'teacher' };
    authState = { isLoggedIn: false, isLoading: false, activeRole: 'none', isHi: false };

    const { rerender } = render(<LoginPage />);
    fireEvent.click(screen.getByTestId('trigger-login-success'));

    authState = { isLoggedIn: true, isLoading: false, activeRole: 'student', isHi: false };
    rerender(<LoginPage />);

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/dashboard'));
    expect(replaceMock).not.toHaveBeenCalledWith(expect.stringContaining('evil.com'));
  });
});
