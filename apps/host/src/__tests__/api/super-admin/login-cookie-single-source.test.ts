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

// @supabase/ssr stub: setSession invokes the route's cookies.setAll with a
// realistic sb-* session cookie so the route's cookie-writing path runs.
// Toggle `ssrSetSessionFails` to exercise the SESSION_COOKIE_FAILED branch.
let ssrSetSessionFails = false;

vi.mock('@supabase/ssr', () => ({
  createServerClient: (
    _url: string,
    _key: string,
    config: { cookies: { setAll: (cookies: Array<{ name: string; value: string; options: Record<string, unknown> }>) => void } },
  ) => ({
    auth: {
      setSession: async () => {
        if (ssrSetSessionFails) {
          return { error: new Error('gotrue unreachable') };
        }
        config.cookies.setAll([
          {
            name: 'sb-stub-auth-token',
            value: encodeURIComponent(JSON.stringify({ access_token: 'server-side-token', token_type: 'bearer' })),
            options: {},
          },
        ]);
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
});
