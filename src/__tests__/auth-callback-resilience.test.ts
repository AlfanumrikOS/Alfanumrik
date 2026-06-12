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

import { describe, it, expect, vi, beforeEach } from 'vitest';
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

vi.mock('@/lib/supabase-server', () => ({
  createSupabaseServerClient: vi.fn(async () => makeServerClient()),
}));

// Admin client: session registration (insert/select/update) + any bootstrap RPC.
// All resolve harmlessly so the fail-open side effects can never throw.
vi.mock('@/lib/supabase-admin', () => {
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
vi.mock('@/lib/identity', () => ({
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

vi.mock('@/lib/identity/bootstrap-profile', () => ({
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

vi.mock('@/lib/identity/school-admin-bootstrap', () => ({
  bootstrapSchoolAdminProfile: vi.fn(async () => {}),
}));

function makeReq(path: string): NextRequest {
  return new NextRequest(new Request(`http://localhost${path}`, { method: 'GET' }));
}

/** Pull the redirect Location out of a NextResponse.redirect result. */
function location(res: Response): string {
  return res.headers.get('location') ?? '';
}

beforeEach(() => {
  vi.clearAllMocks();
  holders.profileExists.value = true;
  holders.getSession.mockResolvedValue({ data: { session: { access_token: 'a', refresh_token: 'r' } } });
  holders.getUser.mockResolvedValue({ data: { user: { id: 'auth-1', email: 'x@y.com', user_metadata: { role: 'student' } } } });
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
});
