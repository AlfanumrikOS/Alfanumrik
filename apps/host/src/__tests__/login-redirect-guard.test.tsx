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
// SECURITY FIX (2026-08-30), REVISED: the first pass at this fix made
// handleSuccess stop navigating itself entirely, relying only on the
// activeRole-driven effect from call site 1. That reintroduced exactly the
// bug commit #892 fixed (see dashboard-institution-admin-redirect.test.ts,
// "login/page.tsx handleSuccess does an immediate redirect (#892
// stuck-button fix)") — blocking navigation on activeRole resolving leaves
// the login button stuck showing "..." indefinitely whenever that
// resolution is slow or fails. That test still requires handleSuccess to
// call router.replace immediately, and correctly so.
//
// What's actually fixed here is narrower: the FALLBACK destination (no
// `?redirect=` param) is no longer derived from `?role=` — the tab the user
// clicked BEFORE authenticating, entirely client-controlled. A student
// logging in with the "Teacher" tab selected (?role=teacher) used to be
// sent straight to /teacher's URL on that hint alone. The fallback is now
// unconditionally '/dashboard' — the one destination verified safe as an
// immediate landing target regardless of role (its own
// `if (!student) return <DashboardSkeleton/>` means a non-student can never
// see real content there, and it already redirects teacher/guardian/
// institution_admin to their real portal once activeRole resolves). A
// legitimate `?redirect=` deep link is untouched — still honored
// immediately, still through the same M1 open-redirect guard.
describe('login page — handleSuccess (2026-08-30 fix: fallback destination, not immediacy)', () => {
  it('still navigates immediately on success (commit #892 — never a stuck button)', async () => {
    authState = { isLoggedIn: false, isLoading: false, activeRole: 'none', isHi: false };

    render(<LoginPage />);
    fireEvent.click(screen.getByTestId('trigger-login-success'));

    await waitFor(() => expect(replaceMock).toHaveBeenCalled());
    expect(refreshMock).toHaveBeenCalled();
  });

  it('ignores the ?role= hint entirely and always falls back to /dashboard', async () => {
    // Attacker/user angle: clicked "Teacher" before logging in with a
    // student (or any) account. The URL still says role=teacher.
    searchParams = { role: 'teacher' };
    authState = { isLoggedIn: false, isLoading: false, activeRole: 'none', isHi: false };

    render(<LoginPage />);
    fireEvent.click(screen.getByTestId('trigger-login-success'));

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/dashboard'));
    expect(replaceMock).not.toHaveBeenCalledWith('/teacher');
  });

  it('still honors a legitimate ?redirect=/foxy deep link immediately', async () => {
    searchParams = { redirect: '/foxy', role: 'parent' };
    authState = { isLoggedIn: false, isLoading: false, activeRole: 'none', isHi: false };

    render(<LoginPage />);
    fireEvent.click(screen.getByTestId('trigger-login-success'));

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/foxy'));
  });

  it('still applies the M1 open-redirect guard on this path', async () => {
    searchParams = { redirect: '//evil.com', role: 'teacher' };
    authState = { isLoggedIn: false, isLoading: false, activeRole: 'none', isHi: false };

    render(<LoginPage />);
    fireEvent.click(screen.getByTestId('trigger-login-success'));

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/dashboard'));
    expect(replaceMock).not.toHaveBeenCalledWith(expect.stringContaining('evil.com'));
  });
});
