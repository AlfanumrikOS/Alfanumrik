/**
 * P15 Onboarding Integrity — /auth/callback (PKCE) + /auth/confirm (token_hash)
 * BEHAVIORAL resilience tests.
 *
 * Existing coverage for these two routes (auth-flows.test.ts,
 * auth-callback-role-redirect.test.ts) is STRUCTURAL (source-text + helper
 * unit) — it asserts the GET export exists and that the role-destination helper
 * behaves, but it never INVOKES the GET handlers. These tests close that gap by
 * driving the real handlers with a mocked Supabase seam and asserting the two
 * P15 contracts that matter at launch:
 *
 *   (rule 3) BOTH flows are handled: /auth/callback exchanges a PKCE `code`;
 *            /auth/confirm verifies a `token_hash` + `type`.
 *   (no funnel break) the handlers NEVER throw / 500 — every branch returns a
 *            redirect: success → role/next destination; failure → /login (with
 *            an error marker); missing param → /login.
 *
 * We pin behavior (the Response status 3xx + Location), not implementation.
 * supabaseAdmin session-registration is a fail-open best-effort side effect; we
 * stub it so it cannot throw the funnel.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Hoisted seam holders ──────────────────────────────────────────────
const holders = vi.hoisted(() => ({
  exchangeCodeForSession: vi.fn(),
  verifyOtp: vi.fn(),
  getUser: vi.fn(),
  getSession: vi.fn(),
  // student-profile existence probes used by the signup branch. Default: a
  // profile already exists so the signup path takes the "detect role" branch
  // and never calls bootstrap (keeps these tests focused on flow handling).
  profileExists: { value: true },
}));

// Build a Supabase server client whose `.from(table).select().eq().single()`
// resolves to a row when holders.profileExists.value is true (students table),
// null otherwise.
function makeServerClient() {
  return {
    auth: {
      exchangeCodeForSession: (...a: unknown[]) => holders.exchangeCodeForSession(...a),
      verifyOtp: (...a: unknown[]) => holders.verifyOtp(...a),
      getUser: (...a: unknown[]) => holders.getUser(...a),
      getSession: (...a: unknown[]) => holders.getSession(...a),
    },
    from: (table: string) => ({
      select: (_c: string) => ({
        eq: (_col: string, _val: unknown) => ({
          single: () =>
            Promise.resolve({
              // Only the students probe returns a row, and only when profileExists.
              data: table === 'students' && holders.profileExists.value ? { id: 'stu-1' } : null,
              error: null,
            }),
        }),
      }),
    }),
  };
}

vi.mock('@alfanumrik/lib/supabase-server', () => ({
  createSupabaseServerClient: vi.fn(async () => makeServerClient()),
}));

// Admin client: session registration (insert/select/update) + any bootstrap RPC.
// All resolve harmlessly so the fail-open side effects can never throw.
vi.mock('@alfanumrik/lib/supabase-admin', () => {
  const adminChain = {
    select: () => adminChain,
    eq: () => adminChain,
    order: () => Promise.resolve({ data: [] }),
    insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: { id: 'sess-1' } }) }) }),
    update: () => ({ eq: () => Promise.resolve({ data: null }) }),
  };
  const admin = {
    from: () => adminChain,
    rpc: vi.fn(async () => ({ data: { status: 'success' }, error: null })),
    auth: { getUser: vi.fn(async () => ({ data: { user: null } })) },
  };
  return { getSupabaseAdmin: () => admin, supabaseAdmin: admin };
});

// Faithful, dependency-free reimplementations of the two identity helpers the
// routes use (the real ones; reimplemented to avoid pulling the full barrel).
vi.mock('@alfanumrik/lib/identity', () => ({
  getRoleDestination: (role: string) => {
    const map: Record<string, string> = {
      student: '/dashboard',
      teacher: '/teacher',
      parent: '/parent',
      guardian: '/parent',
      institution_admin: '/school-admin',
    };
    return map[role] ?? '/dashboard';
  },
  validateRedirectTarget: (next: string, fallback = '/dashboard') =>
    next.startsWith('/') && !next.startsWith('//') && !next.includes('\\') ? next : fallback,
}));

vi.mock('@alfanumrik/lib/identity/bootstrap-profile', () => ({
  profileParamsFromMetadata: (user: { email?: string; user_metadata?: Record<string, unknown> }) => ({
    email: user.email ?? 'x@y.com',
    name: (user.user_metadata?.name as string) ?? 'Test',
    role: (user.user_metadata?.role as string) ?? 'student',
    grade: '9',
    board: 'CBSE',
    school_name: '',
    school_city: '',
    school_state: '',
    subjects: [],
    grades_taught: [],
    phone: null,
    link_code: null,
  }),
}));

// Phase 3b: the school-admin onboarding helper was renamed
// bootstrapSchoolAdminProfile → ensureSchoolAdminOnboarding (RPC-first +
// city/state patch + fail-soft fallback). complete-signup.ts (which both auth
// routes now share) imports THIS name, so the mock must export it or the
// institution_admin signup branch would call `undefined(...)`. These resilience
// tests default to profileExists=true so the branch isn't exercised, but the
// mock must still match the real module's export surface.
vi.mock('@alfanumrik/lib/identity/school-admin-bootstrap', () => ({
  ensureSchoolAdminOnboarding: vi.fn(async () => ({
    ok: true,
    schoolId: 'school-1',
    schoolAdminId: 'school-admin-1',
    onboardingStateWritten: true,
  })),
}));

function makeReq(path: string): NextRequest {
  return new NextRequest(new Request(`http://localhost${path}`, { method: 'GET' }));
}

/** Pull the redirect Location out of a NextResponse.redirect result. */
function location(res: Response): string {
  return res.headers.get('location') ?? '';
}

/**
 * The exact set of URL-hash fields @supabase/auth-js's implicit-grant parser
 * requires to hydrate a client-side session, sourced directly from the
 * INSTALLED @supabase/auth-js@2.108.2 GoTrueClient.ts `_getSessionFromURL()`:
 *
 *   const { provider_token, provider_refresh_token, access_token, refresh_token,
 *           expires_in, expires_at, token_type } = params
 *   if (!access_token || !expires_in || !refresh_token || !token_type) {
 *     throw new AuthImplicitGrantRedirectError('No session defined in URL')
 *   }
 *
 * `expires_in` is the field the original bug omitted — its absence makes the
 * SDK throw inside detectSessionInUrl, so no client session is ever created
 * and /auth/reset shows "Invalid or Expired Link" even though the token was
 * already correctly verified server-side. This constant intentionally
 * duplicates that requirement (not sourced from the app's own hash-builder
 * code) so a regression in the builder can't silently satisfy its own test.
 */
const REQUIRED_IMPLICIT_GRANT_HASH_FIELDS = [
  'access_token',
  'refresh_token',
  'expires_in',
  'token_type',
] as const;

/** Parse the `#...` fragment of a redirect Location into a URLSearchParams. */
function hashParams(loc: string): URLSearchParams {
  const hashIndex = loc.indexOf('#');
  expect(hashIndex).toBeGreaterThan(-1); // must actually carry a hash fragment
  return new URLSearchParams(loc.slice(hashIndex + 1));
}

/**
 * Asserts a redirect Location to /auth/reset carries every field the real,
 * installed @supabase/auth-js hash parser requires to build a session — and
 * that the values round-trip correctly. This is the genuine regression test
 * for the 2026-07-20 "Invalid or Expired Link" incident: the OLD test only
 * asserted `location(res)).toContain('/auth/reset')`, which a hash missing
 * `expires_in` would still pass.
 */
function expectValidRecoverySessionHash(
  loc: string,
  expected: { access_token: string; refresh_token: string; type: string }
) {
  const params = hashParams(loc);
  for (const field of REQUIRED_IMPLICIT_GRANT_HASH_FIELDS) {
    expect(params.get(field), `hash is missing required field "${field}"`).toBeTruthy();
  }
  expect(params.get('access_token')).toBe(expected.access_token);
  expect(params.get('refresh_token')).toBe(expected.refresh_token);
  expect(params.get('type')).toBe(expected.type);
  expect(params.get('token_type')).toBe('bearer');
  // expires_in must parse to a positive integer — a non-numeric or missing
  // value is exactly what let the SDK's `!expires_in` guard fail.
  expect(Number(params.get('expires_in'))).toBeGreaterThan(0);
  // expires_at is optional per the SDK (falls back to now + expires_in) but
  // the route always has it available from the server session, so require it.
  expect(Number(params.get('expires_at'))).toBeGreaterThan(0);
}

// Phase 3b unification: both auth routes now delegate the signup branch to
// completeSignupBootstrap, which fires a best-effort, UNAWAITED fetch() to the
// send-welcome-email Edge Function whenever a session token exists (the default
// getSession stub below supplies access_token 'a', and setup.ts sets
// NEXT_PUBLIC_SUPABASE_URL to a placeholder host). An UNMOCKED fetch would issue
// a real network call that rejects asynchronously; its `.catch()` runs
// console.warn AFTER the test body returns, surfacing under worker teardown as
// the flaky `EnvironmentTeardownError: Closing rpc while "onUserConsoleLog" was
// pending`. Stub fetch so the welcome-email call resolves synchronously in-test
// (mirrors auth-onboarding.test.ts §5). The route never reads the response.
const fetchSpy = vi.fn().mockResolvedValue(
  new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
);

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchSpy);
  holders.profileExists.value = true;
  // Realistic session shape — a REAL Supabase Session always carries
  // expires_in/expires_at/token_type alongside the tokens. The original bug
  // (2026-07-20 RCA) was invisible to these tests specifically because this
  // mock previously omitted expires_in/expires_at/token_type, so a hash
  // builder that dropped those fields still "looked" correct here. Do not
  // shrink this mock back down without also removing
  // expectValidRecoverySessionHash() below.
  holders.getSession.mockResolvedValue({
    data: {
      session: {
        access_token: 'a',
        refresh_token: 'r',
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        token_type: 'bearer',
      },
    },
  });
  holders.getUser.mockResolvedValue({ data: { user: { id: 'auth-1', email: 'x@y.com', user_metadata: { role: 'student' } } } });
});

afterEach(async () => {
  // Drain the microtask queue so the fire-and-forget welcome-email .catch()
  // chain settles inside the test (fetchSpy resolves synchronously) before the
  // worker tears down, then restore the real global fetch so the stub cannot
  // leak into sibling suites.
  await new Promise((resolve) => setTimeout(resolve, 0));
  vi.unstubAllGlobals();
});

// ───────────────────────── /auth/callback (PKCE code flow) ─────────────────────────

describe('/auth/callback — PKCE code flow (P15 rule 3)', () => {
  it('exchanges a valid code and redirects (no 500)', async () => {
    const { GET } = await import('@/app/auth/callback/route');
    holders.exchangeCodeForSession.mockResolvedValue({ error: null });

    const res = await GET(makeReq('/auth/callback?code=valid-code&next=/dashboard'));

    expect(holders.exchangeCodeForSession).toHaveBeenCalledWith('valid-code');
    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.status).toBeLessThan(400);
    // Redirects somewhere internal — never errors out the funnel.
    expect(location(res)).toContain('/dashboard');
  });

  it('redirects to /login?error when the code exchange fails (no 500)', async () => {
    const { GET } = await import('@/app/auth/callback/route');
    holders.exchangeCodeForSession.mockResolvedValue({ error: { message: 'bad code' } });

    const res = await GET(makeReq('/auth/callback?code=bad-code'));

    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.status).toBeLessThan(400);
    expect(location(res)).toContain('/login');
    expect(location(res)).toMatch(/error=/);
  });

  it('redirects to /login when NO code param is present (missing param ≠ 500)', async () => {
    const { GET } = await import('@/app/auth/callback/route');

    const res = await GET(makeReq('/auth/callback'));

    expect(holders.exchangeCodeForSession).not.toHaveBeenCalled();
    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.status).toBeLessThan(400);
    expect(location(res)).toContain('/login');
  });

  it('does not 500 even when getUser throws on the signup branch', async () => {
    const { GET } = await import('@/app/auth/callback/route');
    holders.exchangeCodeForSession.mockResolvedValue({ error: null });
    holders.getUser.mockRejectedValue(new Error('user lookup blew up'));

    const res = await GET(makeReq('/auth/callback?code=ok&type=signup'));

    // The signup branch wraps user/bootstrap work in try/catch and always
    // redirects. A thrown getUser must NOT break the funnel.
    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.status).toBeLessThan(400);
  });

  // P15 fix (2026-07-20, admin-user-invite-flow incident): Supabase-Dashboard
  // invited users (type=invite) MUST land on /auth/reset to set a password —
  // NOT silently fall through to /dashboard with a registered session.
  it('redirects type=invite to /auth/reset (not /dashboard) with a complete session hash', async () => {
    const { GET } = await import('@/app/auth/callback/route');
    holders.exchangeCodeForSession.mockResolvedValue({ error: null });

    const res = await GET(makeReq('/auth/callback?code=valid-code&type=invite'));

    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.status).toBeLessThan(400);
    expect(location(res)).toContain('/auth/reset');
    expect(location(res)).not.toContain('/dashboard');
    // Genuine regression check for the 2026-07-20 "Invalid or Expired Link"
    // incident — the hash must carry every field the real, installed
    // @supabase/auth-js hash parser requires (expires_in was the one missing).
    expectValidRecoverySessionHash(location(res), {
      access_token: 'a',
      refresh_token: 'r',
      type: 'invite',
    });
  });

  // Password-reset ('recovery') follows the SAME hash-building path as
  // 'invite'. Prior to the 2026-07-20 fix, both were missing expires_in.
  it('redirects type=recovery to /auth/reset with a complete session hash', async () => {
    const { GET } = await import('@/app/auth/callback/route');
    holders.exchangeCodeForSession.mockResolvedValue({ error: null });

    const res = await GET(makeReq('/auth/callback?code=valid-code&type=recovery'));

    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.status).toBeLessThan(400);
    expect(location(res)).toContain('/auth/reset');
    expectValidRecoverySessionHash(location(res), {
      access_token: 'a',
      refresh_token: 'r',
      type: 'recovery',
    });
  });
});

// ───────────────────────── /auth/confirm (token_hash flow) ─────────────────────────

describe('/auth/confirm — token_hash flow (P15 rule 3)', () => {
  it('verifies a token_hash + type and redirects (no 500)', async () => {
    const { GET } = await import('@/app/auth/confirm/route');
    holders.verifyOtp.mockResolvedValue({ error: null });

    const res = await GET(makeReq('/auth/confirm?token_hash=abc123&type=email&next=/dashboard'));

    expect(holders.verifyOtp).toHaveBeenCalledWith({ token_hash: 'abc123', type: 'email' });
    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.status).toBeLessThan(400);
    expect(location(res)).toContain('/dashboard');
  });

  it('redirects to /login?error=verification_failed when verifyOtp fails (no 500)', async () => {
    const { GET } = await import('@/app/auth/confirm/route');
    holders.verifyOtp.mockResolvedValue({ error: { message: 'token expired' } });

    const res = await GET(makeReq('/auth/confirm?token_hash=expired&type=signup'));

    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.status).toBeLessThan(400);
    expect(location(res)).toContain('/login');
    expect(location(res)).toMatch(/error=verification_failed/);
  });

  it('redirects to /login when token_hash OR type is missing (missing param ≠ 500)', async () => {
    const { GET } = await import('@/app/auth/confirm/route');

    // token_hash present but type missing → the `if (token_hash && type)` guard
    // is false → fall through to /login.
    const res = await GET(makeReq('/auth/confirm?token_hash=abc'));

    expect(holders.verifyOtp).not.toHaveBeenCalled();
    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.status).toBeLessThan(400);
    expect(location(res)).toContain('/login');
  });

  it('routes a confirmed teacher signup to the role destination', async () => {
    const { GET } = await import('@/app/auth/confirm/route');
    holders.verifyOtp.mockResolvedValue({ error: null });
    // No existing profile → bootstrap branch; metadata role = teacher.
    holders.profileExists.value = false;
    holders.getUser.mockResolvedValue({
      data: { user: { id: 'auth-2', email: 't@y.com', user_metadata: { role: 'teacher', name: 'T' } } },
    });

    const res = await GET(makeReq('/auth/confirm?token_hash=ok&type=signup'));

    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.status).toBeLessThan(400);
    expect(location(res)).toContain('/teacher');
  });

  // P15 fix (2026-07-20, admin-user-invite-flow incident): Supabase-Dashboard
  // invited users (type=invite) MUST land on /auth/reset to set a password —
  // NOT silently fall through to /dashboard with a registered session.
  it('redirects type=invite to /auth/reset (not /dashboard) with a complete session hash', async () => {
    const { GET } = await import('@/app/auth/confirm/route');
    holders.verifyOtp.mockResolvedValue({ error: null });

    const res = await GET(makeReq('/auth/confirm?token_hash=invite-token&type=invite'));

    expect(holders.verifyOtp).toHaveBeenCalledWith({ token_hash: 'invite-token', type: 'invite' });
    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.status).toBeLessThan(400);
    expect(location(res)).toContain('/auth/reset');
    expect(location(res)).not.toContain('/dashboard');
    expectValidRecoverySessionHash(location(res), {
      access_token: 'a',
      refresh_token: 'r',
      type: 'invite',
    });
  });

  it('redirects type=recovery (token_hash flow) to /auth/reset with a complete session hash', async () => {
    const { GET } = await import('@/app/auth/confirm/route');
    holders.verifyOtp.mockResolvedValue({ error: null });

    const res = await GET(makeReq('/auth/confirm?token_hash=recovery-token&type=recovery'));

    expect(holders.verifyOtp).toHaveBeenCalledWith({ token_hash: 'recovery-token', type: 'recovery' });
    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.status).toBeLessThan(400);
    expect(location(res)).toContain('/auth/reset');
    expectValidRecoverySessionHash(location(res), {
      access_token: 'a',
      refresh_token: 'r',
      type: 'recovery',
    });
  });
});

describe('/auth/confirm — legacy token flow', () => {
  it('verifies token + email + type and redirects (no 500)', async () => {
    const { GET } = await import('@/app/auth/confirm/route');
    holders.verifyOtp.mockResolvedValue({ error: null });

    const res = await GET(makeReq('/auth/confirm?token=legacy-token&email=user%40example.com&type=magic_link&next=/dashboard'));

    expect(holders.verifyOtp).toHaveBeenCalledWith({
      token: 'legacy-token',
      email: 'user@example.com',
      type: 'magic_link',
    });
    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.status).toBeLessThan(400);
    expect(location(res)).toContain('/dashboard');
  });

  // P15 fix (2026-07-20, admin-user-invite-flow incident, fast-follow): the
  // LEGACY token+email+type flow must handle type=invite with the same
  // /auth/reset routing as the token_hash flow above — previously it fell
  // through to the generic default branch and silently registered a session
  // on /dashboard with no way to ever set a password.
  it('redirects type=invite to /auth/reset (not /dashboard) with a complete session hash', async () => {
    const { GET } = await import('@/app/auth/confirm/route');
    holders.verifyOtp.mockResolvedValue({ error: null });

    const res = await GET(makeReq('/auth/confirm?token=legacy-invite-token&email=user%40example.com&type=invite'));

    expect(holders.verifyOtp).toHaveBeenCalledWith({
      token: 'legacy-invite-token',
      email: 'user@example.com',
      type: 'invite',
    });
    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.status).toBeLessThan(400);
    expect(location(res)).toContain('/auth/reset');
    expect(location(res)).not.toContain('/dashboard');
    expectValidRecoverySessionHash(location(res), {
      access_token: 'a',
      refresh_token: 'r',
      type: 'invite',
    });
  });

  it('redirects type=recovery (legacy token flow) to /auth/reset with a complete session hash', async () => {
    const { GET } = await import('@/app/auth/confirm/route');
    holders.verifyOtp.mockResolvedValue({ error: null });

    const res = await GET(makeReq('/auth/confirm?token=legacy-recovery-token&email=user%40example.com&type=recovery'));

    expect(holders.verifyOtp).toHaveBeenCalledWith({
      token: 'legacy-recovery-token',
      email: 'user@example.com',
      type: 'recovery',
    });
    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.status).toBeLessThan(400);
    expect(location(res)).toContain('/auth/reset');
    expectValidRecoverySessionHash(location(res), {
      access_token: 'a',
      refresh_token: 'r',
      type: 'recovery',
    });
  });
});
