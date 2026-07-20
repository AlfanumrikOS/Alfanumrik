/**
 * POST /api/super-admin/login — httpOnly-cookie single-source contract.
 *
 * 2026-07-20 RCA fix (admin session split-brain): the login route previously
 * returned the raw Supabase session (access_token + refresh_token) in the JSON
 * body, which the login page fed to supabase.auth.setSession — creating a
 * localStorage copy of the SAME refresh-token family as the httpOnly sb-*
 * cookie. Both stores auto-refreshed and stranded each other on rotation
 * (~2.5-min observed session life).
 *
 * This test pins the fixed contract:
 *   1. Success body is `{ success: true, user: { id, email } }` — NO
 *      access_token / refresh_token / session object anywhere in the body.
 *   2. The httpOnly sb-* session cookie IS set on the success response
 *      (the single session source).
 *   3. If the SSR cookie write fails, the route returns 500
 *      SESSION_COOKIE_FAILED (no cookie ⇒ no half-authenticated state).
 *
 * Mocking pattern mirrors login-standard-redirect.test.ts (admin-auth +
 * admin-login-throttle stubbed, global fetch scripted), plus a @supabase/ssr
 * stub whose setSession drives the route's cookies.setAll callback.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── module mocks (hoisted before route import) ────────────────────────

const logAdminAuditByUserId = vi.fn();

vi.mock('@alfanumrik/lib/admin-auth', () => ({
  logAdminAuditByUserId: (...args: unknown[]) => logAdminAuditByUserId(...args),
}));

vi.mock('@alfanumrik/lib/admin-login-throttle', () => ({
  checkLockout: vi.fn().mockResolvedValue({ locked: false, attemptsInWindow: 0, windowMinutes: 15 }),
  recordLoginAttempt: vi.fn().mockResolvedValue(undefined),
  LOCKOUT_CONSTANTS: { WINDOW_MIN: 15, THRESHOLD: 5 },
}));

vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// @supabase/ssr stub: setSession invokes the route's cookies.setAll with the
// SAME cookie shape the real v0.12 library writes (verified in
// node_modules/@supabase/ssr/dist/main/cookies.js + utils/chunker.js):
//   value  = 'base64-' + base64url(JSON.stringify(session))   [default cookieEncoding]
//   chunks = `sb-<ref>-auth-token.0`, `.1`, ... when the URI-encoded value
//            exceeds MAX_CHUNK_SIZE (3180) — always true for real sessions.
// The stub pads the session so chunking occurs, making the round-trip test
// below a true pin of the production handoff (2026-07-20 lockout RCA).
// Toggle `ssrSetSessionFails` to exercise the SESSION_COOKIE_FAILED branch.
let ssrSetSessionFails = false;

vi.mock('@supabase/ssr', () => ({
  createServerClient: (
    _url: string,
    _key: string,
    config: { cookies: { setAll: (cookies: Array<{ name: string; value: string; options: Record<string, unknown> }>) => void } },
  ) => ({
    auth: {
      setSession: async ({ access_token, refresh_token }: { access_token: string; refresh_token: string }) => {
        if (ssrSetSessionFails) {
          return { error: new Error('gotrue unreachable') };
        }
        // Real setSession persists the FULL session object (tokens + user).
        const session = {
          access_token,
          refresh_token,
          token_type: 'bearer',
          expires_at: 1999999999,
          expires_in: 3600,
          user: {
            id: AUTH_USER_ID,
            email: LOGIN_BODY.email,
            // Padding stands in for real JWT/user-metadata bulk so the
            // encoded value exceeds MAX_CHUNK_SIZE and chunks, as in prod.
            app_metadata: { padding: 'x'.repeat(4000) },
          },
        };
        const encoded = 'base64-' + Buffer.from(JSON.stringify(session), 'utf-8').toString('base64url');
        const MAX_CHUNK_SIZE = 3180;
        const name = 'sb-stub-auth-token';
        const cookiesToSet =
          encodeURIComponent(encoded).length <= MAX_CHUNK_SIZE
            ? [{ name, value: encoded, options: {} }]
            : Array.from({ length: Math.ceil(encoded.length / MAX_CHUNK_SIZE) }, (_, i) => ({
                name: `${name}.${i}`,
                value: encoded.slice(i * MAX_CHUNK_SIZE, (i + 1) * MAX_CHUNK_SIZE),
                options: {},
              }));
        config.cookies.setAll(cookiesToSet);
        return { error: null };
      },
    },
  }),
}));

const AUTH_USER_ID = '99999999-9999-4999-8999-999999999999';
const LOGIN_BODY = { email: 'ops@alfanumrik.com', password: 'correct-horse-battery' };

beforeEach(() => {
  ssrSetSessionFails = false;
  logAdminAuditByUserId.mockReset();
  logAdminAuditByUserId.mockResolvedValue(undefined);

  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://stub.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'stub-anon-key';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'stub-service-role-key';

  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = typeof input === 'string' ? input : (input as URL | Request).toString();
    // 1. GoTrue password grant → session
    if (url.includes('/auth/v1/token')) {
      return new Response(JSON.stringify({
        access_token: 'raw-access-token',
        refresh_token: 'raw-refresh-token',
        expires_at: 1999999999,
        expires_in: 3600,
        token_type: 'bearer',
        user: { id: AUTH_USER_ID, email: LOGIN_BODY.email },
      }), { status: 200 });
    }
    // 2. admin_users membership check → active super_admin
    if (url.includes('/rest/v1/admin_users')) {
      return new Response(JSON.stringify([{ id: 'admin-row-1', admin_level: 'super_admin' }]), { status: 200 });
    }
    return new Response(JSON.stringify([]), { status: 200 });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});

import { POST } from '@/app/api/super-admin/login/route';

function makeRequest(): NextRequest {
  return new NextRequest('http://localhost/api/super-admin/login', {
    method: 'POST',
    body: JSON.stringify(LOGIN_BODY),
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '198.51.100.9' },
  });
}

describe('POST /api/super-admin/login — cookie single-source contract', () => {
  it('success body contains NO session tokens — only { success, user }', async () => {
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.user).toEqual({ id: AUTH_USER_ID, email: LOGIN_BODY.email });

    // The split-brain pin: no token material anywhere in the body.
    expect(json.session).toBeUndefined();
    const serialized = JSON.stringify(json);
    expect(serialized).not.toContain('raw-access-token');
    expect(serialized).not.toContain('raw-refresh-token');
    expect(serialized).not.toContain('refresh_token');
    expect(serialized).not.toContain('access_token');
  });

  it('sets the httpOnly sb-* session cookie on the success response', async () => {
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);

    const setCookie = res.headers.get('set-cookie') || '';
    expect(setCookie).toMatch(/sb-.+-auth-token/);
    expect(setCookie.toLowerCase()).toContain('httponly');
  });

  it('returns 500 SESSION_COOKIE_FAILED when the SSR cookie write fails (no half-auth state)', async () => {
    ssrSetSessionFails = true;
    const res = await POST(makeRequest());
    expect(res.status).toBe(500);

    const json = await res.json();
    expect(json.code).toBe('SESSION_COOKIE_FAILED');
    expect(JSON.stringify(json)).not.toContain('raw-access-token');
  });

  // ── 2026-07-20 lockout RCA: login→authorizeAdmin cookie handoff pin ────────
  // The cookie(s) the login route writes (chunked, base64- prefixed — the real
  // @supabase/ssr v0.12 wire shape) MUST be readable by the REAL
  // extractCookieAccessToken that authorizeAdmin uses on the very next request
  // (AdminShell's /api/super-admin/stats probe). This is the exact seam that
  // broke in production: cookie written fine, parser returned null, 401 bounce.
  it('round-trip: chunked base64- session cookie written by login is readable by extractCookieAccessToken', async () => {
    // vi.importActual bypasses the module mock at the top of this file.
    const { extractCookieAccessToken } = await vi.importActual<
      typeof import('@alfanumrik/lib/admin-auth')
    >('@alfanumrik/lib/admin-auth');

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);

    // Reconstruct the Cookie header a browser would send back from the actual
    // Set-Cookie wire format (name=value up to the first attribute).
    const setCookies = res.headers.getSetCookie();
    const authSetCookies = setCookies.filter((sc) => /^sb-.+-auth-token/.test(sc));
    // The realistic session chunks — production's exact failure shape.
    expect(authSetCookies.length).toBeGreaterThanOrEqual(2);
    expect(authSetCookies.some((sc) => sc.startsWith('sb-stub-auth-token.0='))).toBe(true);

    const cookieHeader = setCookies.map((sc) => sc.split(';')[0]).join('; ');
    expect(extractCookieAccessToken(cookieHeader)).toBe('raw-access-token');
  });
});
