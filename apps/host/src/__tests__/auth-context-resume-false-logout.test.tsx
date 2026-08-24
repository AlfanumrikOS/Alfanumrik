/**
 * AuthContext — false logout on mobile screen-lock resume (CEO defect #3, 2026-08-24).
 *
 * THE DEFECT
 * ==========
 * Lock the phone, unlock it, and the student lands on /login — while the Supabase
 * session in localStorage is still perfectly valid. It was never a real sign-out;
 * it was a client-state race with three compounding causes, all in AuthContext:
 *
 *   1. onAuthStateChange's TOKEN_REFRESHED branch called fetchUser() WITHOUT
 *      setIsLoading(true). SIGNED_IN had guarded that exact race for a long time
 *      (with a comment saying so); TOKEN_REFRESHED — the branch that actually
 *      fires on resume — was never fixed. Pages saw isLoading=false +
 *      isLoggedIn=false in the gap and redirected.
 *   2. The 4 s Promise.race on getSession() resolved null for BOTH "no session"
 *      and "haven't heard back yet", and that null was then treated as proof of
 *      logged-out, clearing every role.
 *   3. A frozen tab thaws with all of its pending setTimeouts firing at once, so
 *      those timeouts elapsed against suspended-CPU time, not network time.
 *
 * isLoggedIn is derived as roles.length > 0, so emptying roles IS the logout.
 *
 * THE FIX (packages/lib/src/AuthContext.tsx)
 * ==========================================
 *   1. TOKEN_REFRESHED sets isLoading=true before fetchUser, mirroring SIGNED_IN.
 *   2. probeSession returns a three-way result: 'session' | 'none' | 'unknown'.
 *      'unknown' is retried once and NEVER treated as logged-out.
 *   3. A genuine hard timeout clears state only when nothing was ever resolved
 *      and no roles are held (hasEverResolvedRef / rolesRef), so a cold boot
 *      still fails open to /login (P15) but a resume preserves last-known-good.
 *   4. A visibilitychange listener self-heals: session present + roles empty
 *      means re-run fetchUser under isLoading=true.
 *
 * APPROACH
 * ========
 * Mount the REAL AuthProvider with the supabase client mocked at the module
 * boundary (mirroring auth-context-p15-null-student-hydration.test.tsx) and
 * assert on the state the context actually exposes. No logic is replicated here.
 *
 * Owner: architect. Invariants: P15 (cold-boot fail-open preserved), P13 (no PII).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { AuthProvider, useAuth } from '@alfanumrik/lib/AuthContext';

// ── supabase client mock (module boundary) ──────────────────────────────────
const getSessionMock = vi.fn();
const getUserMock = vi.fn();
const signOutMock = vi.fn();
const rpcMock = vi.fn();
const fromMock = vi.fn();
const onAuthStateChangeMock = vi.fn((..._args: unknown[]) => ({
  data: { subscription: { unsubscribe: vi.fn() } },
}));

vi.mock('@alfanumrik/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: (...args: unknown[]) => getSessionMock(...args),
      getUser: (...args: unknown[]) => getUserMock(...args),
      onAuthStateChange: (...args: unknown[]) => onAuthStateChangeMock(...args),
      signOut: (...args: unknown[]) => signOutMock(...args),
    },
    rpc: (...args: unknown[]) => rpcMock(...args),
    from: (...args: unknown[]) => fromMock(...args),
  },
  getStudentSnapshot: vi.fn().mockResolvedValue(null),
}));

// Non-critical side-effect modules — keep the auth path light and deterministic.
const posthogResetMock = vi.fn();
const clearPendingInviteMock = vi.fn();
vi.mock('@alfanumrik/lib/swr', () => ({ clearAllCache: vi.fn() }));
vi.mock('@alfanumrik/lib/use-atlas-flag', () => ({ clearAtlasFlagCache: vi.fn() }));
vi.mock('@alfanumrik/lib/analytics', () => ({ track: vi.fn() }));
vi.mock('@alfanumrik/lib/posthog/client', () => ({
  identify: vi.fn(),
  reset: (...args: unknown[]) => posthogResetMock(...args),
}));
vi.mock('@alfanumrik/lib/school/pending-invite', () => ({
  redeemPendingInvite: vi.fn().mockResolvedValue('none'),
  clearPendingInvite: (...args: unknown[]) => clearPendingInviteMock(...args),
}));

// ── Fixtures ────────────────────────────────────────────────────────────────
const AUTH_USER_ID = 'auth-user-resume-1';
const STUDENT_ID = 'student-resume-1';

function makeUser() {
  return { id: AUTH_USER_ID, email: 'kid@example.com', user_metadata: { role: 'student' } };
}

function roleData() {
  return {
    roles: ['student'],
    primary_role: 'student',
    student: { id: STUDENT_ID, name: 'Aanya', grade: '9', onboarding_completed: true },
    teacher: null,
    guardian: null,
  };
}

/** Chainable table mock returning the given row for maybeSingle()/single(). */
function tableChain(row: unknown) {
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.maybeSingle = () => Promise.resolve({ data: row, error: null });
  chain.single = () => Promise.resolve({ data: row, error: null });
  return chain;
}

/** A getSession() that never settles — models a stalled / thawing network. */
function neverResolves(): Promise<never> {
  return new Promise<never>(() => {
    /* intentionally pending */
  });
}

/** Grab the onAuthStateChange callback the provider registered. */
function authCallback(): (event: string, session: unknown) => void {
  const call = onAuthStateChangeMock.mock.calls[0];
  return call[0] as (event: string, session: unknown) => void;
}

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}

function Probe() {
  const { roles, isLoggedIn, isLoading, student } = useAuth();
  return (
    <div>
      <span data-testid="loggedIn">{String(isLoggedIn)}</span>
      <span data-testid="loading">{String(isLoading)}</span>
      <span data-testid="rolesCount">{String(roles.length)}</span>
      <span data-testid="studentId">{student?.id ?? ''}</span>
    </div>
  );
}

function mountProvider() {
  return render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
}

/** Let pending microtasks + timers up to `ms` run, inside act(). */
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  vi.useFakeTimers();
  setVisibility('visible');

  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));

  // Default: a healthy signed-in student.
  getSessionMock.mockResolvedValue({
    data: { session: { user: makeUser(), access_token: 'tok' } },
  });
  getUserMock.mockResolvedValue({ data: { user: makeUser() }, error: null });
  signOutMock.mockResolvedValue({ error: null });
  rpcMock.mockImplementation(() => ({
    abortSignal: () => Promise.resolve({ data: roleData(), error: null }),
  }));
  fromMock.mockImplementation(() =>
    tableChain({ id: STUDENT_ID, auth_user_id: AUTH_USER_ID, name: 'Aanya', grade: '9' }),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// ════════════════════════════════════════════════════════════════════════════
// 1. TOKEN_REFRESHED must raise isLoading BEFORE fetchUser resolves.
//    Cause #1: without this, page guards observe isLoading=false +
//    isLoggedIn=false in the gap and fire router.replace('/login').
// ════════════════════════════════════════════════════════════════════════════
describe('TOKEN_REFRESHED sets isLoading before fetchUser resolves', () => {
  it('flips isLoading to true and keeps it true while fetchUser is in flight', async () => {
    mountProvider();
    await advance(100);
    expect(screen.getByTestId('loading').textContent).toBe('false');
    expect(screen.getByTestId('loggedIn').textContent).toBe('true');

    // Resume: the session read now stalls, so fetchUser cannot complete.
    getSessionMock.mockImplementation(() => neverResolves());

    await act(async () => {
      authCallback()('TOKEN_REFRESHED', { user: makeUser() });
    });

    // The whole point: loading is true, so no guard can conclude "logged out".
    expect(screen.getByTestId('loading').textContent).toBe('true');
    expect(screen.getByTestId('loggedIn').textContent).toBe('true');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 2. A session-probe timeout on a NON-first call must not empty roles.
//    Cause #2: 'unknown' was conflated with 'no session'.
// ════════════════════════════════════════════════════════════════════════════
describe('session-probe timeout on a resume preserves last-known-good state', () => {
  it('does NOT empty roles when getSession never settles after a successful first resolve', async () => {
    mountProvider();
    await advance(100);
    expect(screen.getByTestId('rolesCount').textContent).toBe('1');

    getSessionMock.mockImplementation(() => neverResolves());

    await act(async () => {
      authCallback()('TOKEN_REFRESHED', { user: makeUser() });
    });

    // Past the 4 s probe, the 750 ms backoff, the 6 s retry probe, and the 12 s
    // hard timeout — i.e. every timer that used to nuke the session.
    await advance(30_000);

    expect(screen.getByTestId('rolesCount').textContent).toBe('1');
    expect(screen.getByTestId('loggedIn').textContent).toBe('true');
    expect(screen.getByTestId('studentId').textContent).toBe(STUDENT_ID);
    // Spinner must stop, otherwise the page hangs on a skeleton forever.
    expect(screen.getByTestId('loading').textContent).toBe('false');
  });

  it('recovers roles when the retry probe answers after the first probe timed out', async () => {
    mountProvider();
    await advance(100);

    // First probe of the resume stalls past 4 s; the retry answers normally.
    let resumeCalls = 0;
    getSessionMock.mockImplementation(() => {
      resumeCalls += 1;
      if (resumeCalls === 1) return neverResolves();
      return Promise.resolve({ data: { session: { user: makeUser(), access_token: 'tok' } } });
    });

    await act(async () => {
      authCallback()('TOKEN_REFRESHED', { user: makeUser() });
    });
    await advance(30_000);

    expect(screen.getByTestId('loggedIn').textContent).toBe('true');
    expect(screen.getByTestId('rolesCount').textContent).toBe('1');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 3. P15 cold boot: a first-ever call with no session STILL fails open to
//    logged-out. The fix must not turn "never signed in" into a stuck spinner.
// ════════════════════════════════════════════════════════════════════════════
describe('cold boot fail-open (P15) is preserved', () => {
  it('an authoritative "no session" on the very first call leaves the user logged out', async () => {
    getSessionMock.mockResolvedValue({ data: { session: null } });

    mountProvider();
    await advance(100);

    expect(screen.getByTestId('loggedIn').textContent).toBe('false');
    expect(screen.getByTestId('rolesCount').textContent).toBe('0');
    // isLoading must settle so the /login redirect can actually fire.
    expect(screen.getByTestId('loading').textContent).toBe('false');
  });

  it('a cold boot whose session probe never answers still ends logged out and not loading', async () => {
    getSessionMock.mockImplementation(() => neverResolves());

    mountProvider();
    await advance(30_000);

    expect(screen.getByTestId('loggedIn').textContent).toBe('false');
    expect(screen.getByTestId('rolesCount').textContent).toBe('0');
    expect(screen.getByTestId('loading').textContent).toBe('false');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 4. A REAL sign-out must still clear everything. The fix makes state stickier,
//    so this guards that stickiness never outlives an actual SIGNED_OUT.
// ════════════════════════════════════════════════════════════════════════════
describe('SIGNED_OUT still clears everything', () => {
  it('empties roles/student and resets analytics + pending invite', async () => {
    mountProvider();
    await advance(100);
    expect(screen.getByTestId('loggedIn').textContent).toBe('true');

    await act(async () => {
      authCallback()('SIGNED_OUT', null);
    });

    expect(screen.getByTestId('loggedIn').textContent).toBe('false');
    expect(screen.getByTestId('rolesCount').textContent).toBe('0');
    expect(screen.getByTestId('studentId').textContent).toBe('');
    expect(posthogResetMock).toHaveBeenCalled();
    expect(clearPendingInviteMock).toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 5. visibilitychange self-heal: session present + roles empty means re-hydrate.
//    Backstop for any race that still manages to empty roles.
// ════════════════════════════════════════════════════════════════════════════
describe('visibilitychange re-validation', () => {
  it('re-runs fetchUser when the tab becomes visible with a valid session but empty roles', async () => {
    // Cold boot with no session, so roles land empty.
    getSessionMock.mockResolvedValue({ data: { session: null } });
    mountProvider();
    await advance(100);
    expect(screen.getByTestId('rolesCount').textContent).toBe('0');

    // The session is in fact valid by the time the screen is unlocked.
    getSessionMock.mockResolvedValue({
      data: { session: { user: makeUser(), access_token: 'tok' } },
    });

    await act(async () => {
      setVisibility('hidden');
    });
    await act(async () => {
      setVisibility('visible');
    });
    await advance(1_000);

    expect(screen.getByTestId('rolesCount').textContent).toBe('1');
    expect(screen.getByTestId('loggedIn').textContent).toBe('true');
  });

  it('does not re-run fetchUser when roles are already populated', async () => {
    mountProvider();
    await advance(100);
    expect(screen.getByTestId('rolesCount').textContent).toBe('1');

    const rpcCallsBefore = rpcMock.mock.calls.length;

    await act(async () => {
      setVisibility('hidden');
    });
    await act(async () => {
      setVisibility('visible');
    });
    await advance(1_000);

    // Already healthy — no redundant re-hydration on every unlock.
    expect(rpcMock.mock.calls.length).toBe(rpcCallsBefore);
    expect(screen.getByTestId('loggedIn').textContent).toBe('true');
  });

  it('removes the visibilitychange listener on unmount', async () => {
    const removeSpy = vi.spyOn(document, 'removeEventListener');
    const view = mountProvider();
    await advance(100);
    view.unmount();

    expect(removeSpy).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
    removeSpy.mockRestore();
  });
});
