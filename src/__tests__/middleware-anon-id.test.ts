import { describe, it, expect } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { ensureAnonIdCookie } from '@/proxy';
import { ANON_ID_COOKIE, ANON_ID_MAX_AGE_SECONDS } from '@/lib/anon-id';

/**
 * Middleware tests — alf_anon_id cookie minting.
 *
 * Source: src/proxy.ts → ensureAnonIdCookie()
 *
 * Why this matters: the anon-id is the bucket key for feature-flag rollout
 * sampling on logged-out traffic (welcome v2 canary). Cookie persistence is
 * what unlocks the canary scaling beyond ~10% — without it, sampling
 * re-randomizes on every page view and the bucket is meaningless.
 *
 * Owning agent: architect (middleware/auth domain).
 */

const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function makeRequest(cookieHeader = ''): NextRequest {
  return new NextRequest('https://alfanumrik.com/welcome', {
    headers: cookieHeader ? { cookie: cookieHeader } : undefined,
  });
}

describe('ensureAnonIdCookie — minting on first request', () => {
  it('mints a fresh UUID v4 cookie when no alf_anon_id is present', () => {
    const req = makeRequest();
    const res = NextResponse.next();

    ensureAnonIdCookie(req, res);

    const set = res.cookies.get(ANON_ID_COOKIE);
    expect(set).toBeDefined();
    expect(set?.value).toMatch(UUID_V4_REGEX);
  });

  it('sets Max-Age to 365 days', () => {
    const req = makeRequest();
    const res = NextResponse.next();

    ensureAnonIdCookie(req, res);

    const set = res.cookies.get(ANON_ID_COOKIE);
    expect(set?.maxAge).toBe(ANON_ID_MAX_AGE_SECONDS);
    expect(set?.maxAge).toBe(31_536_000);
  });

  it('sets SameSite=Lax and Path=/', () => {
    const req = makeRequest();
    const res = NextResponse.next();

    ensureAnonIdCookie(req, res);

    const set = res.cookies.get(ANON_ID_COOKIE);
    expect(set?.sameSite).toBe('lax');
    expect(set?.path).toBe('/');
  });

  it('does NOT set httpOnly (so analytics/clients may read for attribution)', () => {
    const req = makeRequest();
    const res = NextResponse.next();

    ensureAnonIdCookie(req, res);

    const set = res.cookies.get(ANON_ID_COOKIE);
    // ResponseCookies.set defaults to httpOnly=false when not specified.
    // Verify our explicit `httpOnly: false` is honoured.
    expect(set?.httpOnly).toBeFalsy();
  });
});

describe('ensureAnonIdCookie — idempotency', () => {
  it('does NOT regenerate when the request already carries an alf_anon_id', () => {
    const existing = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const req = makeRequest(`${ANON_ID_COOKIE}=${existing}`);
    const res = NextResponse.next();

    ensureAnonIdCookie(req, res);

    // No Set-Cookie header should be appended for alf_anon_id.
    const set = res.cookies.get(ANON_ID_COOKIE);
    expect(set).toBeUndefined();
  });

  it('preserves an existing id even when other cookies are present', () => {
    const existing = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const req = makeRequest(
      `sb-abc-auth-token=xyz; ${ANON_ID_COOKIE}=${existing}; other=value`,
    );
    const res = NextResponse.next();

    ensureAnonIdCookie(req, res);

    expect(res.cookies.get(ANON_ID_COOKIE)).toBeUndefined();
  });

  it('mints when other cookies are present but alf_anon_id is missing', () => {
    const req = makeRequest('sb-abc-auth-token=xyz; other=value');
    const res = NextResponse.next();

    ensureAnonIdCookie(req, res);

    const set = res.cookies.get(ANON_ID_COOKIE);
    expect(set?.value).toMatch(UUID_V4_REGEX);
  });
});

describe('ensureAnonIdCookie — / → /welcome redirect path', () => {
  it('mints a cookie on the redirect response so the welcome page sees it', () => {
    // Production path (src/proxy.ts Layer 2.5): when an unauthenticated user
    // hits /, the middleware returns a redirect to /welcome. The original
    // `response` object is discarded; we must mint the cookie on the new
    // redirect response so the browser stores it before navigating.
    const req = makeRequest();
    const redirectRes = NextResponse.redirect('https://alfanumrik.com/welcome');

    ensureAnonIdCookie(req, redirectRes);

    const set = redirectRes.cookies.get(ANON_ID_COOKIE);
    expect(set?.value).toMatch(UUID_V4_REGEX);
    expect(set?.maxAge).toBe(ANON_ID_MAX_AGE_SECONDS);
  });

  it('does not append a cookie to the redirect when one already exists', () => {
    const existing = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    const req = makeRequest(`${ANON_ID_COOKIE}=${existing}`);
    const redirectRes = NextResponse.redirect('https://alfanumrik.com/welcome');

    ensureAnonIdCookie(req, redirectRes);

    expect(redirectRes.cookies.get(ANON_ID_COOKIE)).toBeUndefined();
  });
});

describe('proxy.ts middleware config matcher', () => {
  it('exports a config with matcher that covers /welcome', async () => {
    const mod = await import('@/proxy');
    expect(mod.config).toBeDefined();
    expect(Array.isArray(mod.config.matcher)).toBe(true);

    const pattern = mod.config.matcher[0] as string;
    // Static-asset exclusions
    expect(pattern).toContain('_next/static');
    expect(pattern).toContain('_next/image');
    expect(pattern).toContain('favicon');

    // The matcher uses a negative lookahead on excluded prefixes.
    // /welcome is NOT in the excluded list, so it must match.
    const re = new RegExp('^' + pattern + '$');
    expect(re.test('/welcome')).toBe(true);
    expect(re.test('/')).toBe(true);
    // Excluded paths must NOT match.
    expect(re.test('/_next/static/chunks/app.js')).toBe(false);
    expect(re.test('/favicon.ico')).toBe(false);
    expect(re.test('/sw.js')).toBe(false);
  });
});
