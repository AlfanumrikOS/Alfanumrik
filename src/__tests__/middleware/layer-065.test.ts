import { describe, it, expect } from 'vitest';
import { NextResponse } from 'next/server';

/**
 * Layer 0.65 — Role-based route protection — cookie cloning regression.
 *
 * Background (audit F26):
 * Layer 0.65 was previously DISABLED because returning
 * `NextResponse.redirect(...)` for a role mismatch dropped the Supabase
 * session cookies that were set earlier in the same middleware invocation
 * by `supabase.auth.getUser()` (PKCE refresh). The result was a
 * "AuthSessionMissingError" on the next request for teacher / parent /
 * admin users.
 *
 * The fix is the cookie-cloning idiom that the TODO referenced:
 *
 *   const redirect = NextResponse.redirect(url);
 *   response.cookies.getAll().forEach((c) => redirect.cookies.set({
 *     name: c.name, value: c.value, path: c.path, ...
 *   }));
 *   return redirect;
 *
 * This test fixes that pattern in place so we cannot regress to the
 * cookie-dropping behavior. It does NOT spin up the full proxy() pipeline
 * (that would require a live Supabase + role cache); it asserts the
 * behavior of the cloning idiom on its own, which is the load-bearing
 * line in the proxy fix.
 *
 * Owning agent: architect (middleware/auth domain).
 */

describe('Layer 0.65 cookie-cloning regression (F26)', () => {
  /**
   * The two Supabase auth cookie names produced by @supabase/ssr.
   * The chunked variant (`.0`, `.1`) is used when the session payload is
   * larger than 4 KB — common in production after the JWT carries app_metadata.
   */
  const SB_COOKIE_PRIMARY = 'sb-test-auth-token';
  const SB_COOKIE_CHUNK_0 = 'sb-test-auth-token.0';

  function buildResponseWithSupabaseCookies(): NextResponse {
    const res = NextResponse.next();
    res.cookies.set({
      name: SB_COOKIE_PRIMARY,
      value: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test.session',
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: 60 * 60,
    });
    res.cookies.set({
      name: SB_COOKIE_CHUNK_0,
      value: 'chunk-payload',
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: 60 * 60,
    });
    return res;
  }

  /** The exact idiom the proxy uses: clone all cookies from `response` to `redirect`. */
  function cloneCookies(from: NextResponse, to: NextResponse): void {
    from.cookies.getAll().forEach((c) => {
      to.cookies.set({
        name: c.name,
        value: c.value,
        path: c.path,
        domain: c.domain,
        maxAge: c.maxAge,
        expires: c.expires,
        httpOnly: c.httpOnly,
        secure: c.secure,
        sameSite: c.sameSite,
      });
    });
  }

  it('preserves the primary Supabase auth cookie on a 0.65 redirect', () => {
    const response = buildResponseWithSupabaseCookies();
    const redirect = NextResponse.redirect(new URL('https://alfanumrik.com/dashboard'));

    cloneCookies(response, redirect);

    const cookie = redirect.cookies.get(SB_COOKIE_PRIMARY);
    expect(cookie).toBeDefined();
    expect(cookie?.value).toContain('test.session');
    // Critical attributes must survive the clone — losing httpOnly would
    // make the cookie readable from JS, losing secure would let it leak
    // over plaintext on the next hop.
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.secure).toBe(true);
    expect(cookie?.sameSite).toBe('lax');
    expect(cookie?.path).toBe('/');
  });

  it('preserves chunked Supabase auth cookies (>4 KB JWT payloads)', () => {
    const response = buildResponseWithSupabaseCookies();
    const redirect = NextResponse.redirect(new URL('https://alfanumrik.com/dashboard'));

    cloneCookies(response, redirect);

    const chunk = redirect.cookies.get(SB_COOKIE_CHUNK_0);
    expect(chunk).toBeDefined();
    expect(chunk?.value).toBe('chunk-payload');
  });

  it('does not lose other middleware cookies (e.g. alf_anon_id)', () => {
    const response = NextResponse.next();
    response.cookies.set({
      name: 'alf_anon_id',
      value: '11111111-1111-4111-8111-111111111111',
      path: '/',
      sameSite: 'lax',
      maxAge: 31_536_000,
    });

    const redirect = NextResponse.redirect(new URL('https://alfanumrik.com/dashboard'));
    cloneCookies(response, redirect);

    expect(redirect.cookies.get('alf_anon_id')?.value).toBe(
      '11111111-1111-4111-8111-111111111111',
    );
  });

  it('regression sanity: a redirect WITHOUT cloning loses the auth cookie (proves the bug exists if we ever skip cloneCookies)', () => {
    // Build a response with the cookie set, but DO NOT clone it.
    const response = buildResponseWithSupabaseCookies();
    const redirect = NextResponse.redirect(new URL('https://alfanumrik.com/dashboard'));

    // Sanity: the original response has the cookie...
    expect(response.cookies.get(SB_COOKIE_PRIMARY)).toBeDefined();
    // ...but the redirect does NOT, which is exactly the F26 bug.
    expect(redirect.cookies.get(SB_COOKIE_PRIMARY)).toBeUndefined();
  });
});

describe('Layer 0.65 enable flag semantics', () => {
  /**
   * Replicates the gating block in proxy.ts so we can lock down the
   * production-default + override semantics. If the flag-resolution rule
   * ever changes, both this test and the proxy must move together.
   */
  function isEnabled(env: { ENABLE_LAYER_065?: string; NODE_ENV?: string }): boolean {
    const flag = env.ENABLE_LAYER_065;
    if (typeof flag === 'string' && flag.length > 0) {
      return flag === 'true' || flag === '1';
    }
    return env.NODE_ENV === 'production';
  }

  it('defaults to ENABLED in production when ENABLE_LAYER_065 is unset', () => {
    expect(isEnabled({ NODE_ENV: 'production' })).toBe(true);
  });

  it('defaults to DISABLED in development when ENABLE_LAYER_065 is unset', () => {
    expect(isEnabled({ NODE_ENV: 'development' })).toBe(false);
  });

  it('defaults to DISABLED in test when ENABLE_LAYER_065 is unset', () => {
    expect(isEnabled({ NODE_ENV: 'test' })).toBe(false);
  });

  it('explicit "true" enables the layer in any environment', () => {
    expect(isEnabled({ ENABLE_LAYER_065: 'true', NODE_ENV: 'development' })).toBe(true);
    expect(isEnabled({ ENABLE_LAYER_065: 'true', NODE_ENV: 'test' })).toBe(true);
  });

  it('explicit "false" disables the layer even in production', () => {
    expect(isEnabled({ ENABLE_LAYER_065: 'false', NODE_ENV: 'production' })).toBe(false);
  });

  it('numeric "1" / "0" override is supported', () => {
    expect(isEnabled({ ENABLE_LAYER_065: '1', NODE_ENV: 'development' })).toBe(true);
    expect(isEnabled({ ENABLE_LAYER_065: '0', NODE_ENV: 'production' })).toBe(false);
  });

  it('unknown flag string falls through to disabled (does NOT crash)', () => {
    expect(isEnabled({ ENABLE_LAYER_065: 'maybe', NODE_ENV: 'production' })).toBe(false);
  });
});
