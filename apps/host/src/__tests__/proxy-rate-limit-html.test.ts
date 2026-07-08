import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Regression — rate-limit response must be HTML for browser nav (CEO bug 2026-05-20).
 *
 * Background:
 *   The CEO reported that after login, the browser displayed raw JSON
 *   (`{"error":"Rate limit exceeded. Please slow down."}`) as the page
 *   content in Chromium's native JSON viewer (with "Pretty-print" checkbox).
 *   The login screen also flickered. Root cause: src/proxy.ts ran the
 *   general rate-limit BEFORE distinguishing browser page navigation from
 *   API/XHR calls, and always returned `Content-Type: application/json` on
 *   429. When a browser asked for HTML and got JSON, it rendered the JSON
 *   viewer — there was no app shell, no way to retry except hard refresh,
 *   and the user reasonably assumed the site was broken.
 *
 * Invariant: when src/proxy.ts hits a rate-limit cap, the 429 response
 * MUST be content-negotiated:
 *   - Accept: text/html → render an HTML error card (bilingual, branded,
 *     with meta-refresh to auto-recover after the retry window).
 *   - API / XHR (cors / x-requested-with / no html in Accept) → keep JSON.
 *
 * These are structural assertions on src/proxy.ts — middleware behavior is
 * hard to drive in vitest without spinning up the full Next runtime. If a
 * future refactor reverts to unconditionally returning JSON on 429, the
 * tests below catch it before the CEO sees the JSON viewer again.
 */

const PROXY_PATH = join(process.cwd(), 'src/proxy.ts');

describe('Rate-limit response is HTML for browser navigations (CEO bug 2026-05-20)', () => {
  const proxySource = readFileSync(PROXY_PATH, 'utf8');

  it('defines a content-negotiating rateLimitResponse helper', () => {
    // The helper must exist as a named function — agents may refactor the
    // call sites, but the helper itself is the load-bearing contract.
    expect(proxySource).toMatch(/function\s+rateLimitResponse\s*\(/);
  });

  it('inspects the Accept header to decide HTML vs JSON', () => {
    // The whole point of the helper is content negotiation. If a future
    // edit drops the Accept lookup, both HTML and JSON branches collapse
    // back to JSON-only and the bug recurs.
    expect(proxySource).toMatch(/rateLimitResponse[\s\S]{0,800}request\.headers\.get\(['"]accept['"]\)/i);
  });

  it('returns Content-Type: text/html for browser navigations', () => {
    // The HTML branch is the bug-fix branch — must be present and must
    // emit text/html (not application/json) so Chromium renders the page
    // shell instead of the native JSON viewer.
    expect(proxySource).toMatch(/['"]Content-Type['"]\s*:\s*['"]text\/html;?\s*charset=utf-8['"]/);
  });

  it('preserves the JSON branch for API / XHR callers', () => {
    // The helper must STILL return JSON when the caller is an API client.
    // Razorpay webhook + Vercel cron + analytics ingestion + the in-app
    // fetch() retry logic all parse the JSON body — breaking that would
    // surface as confusing UI bugs across the product.
    expect(proxySource).toMatch(/JSON\.stringify\(\s*\{\s*error:\s*['"]Rate limit exceeded[^"']*['"]/);
  });

  it('sets the Retry-After header on both branches', () => {
    // Both 429 responses must carry Retry-After per RFC 6585. Without it,
    // the browser meta-refresh in the HTML branch + Razorpay's exponential
    // backoff in the JSON branch both lose timing information.
    expect(proxySource).toMatch(/['"]Retry-After['"]/);
  });

  it('HTML response uses a meta-refresh so users do not need to manually retry', () => {
    // The bug report included "login screen was flickering" — users were
    // mashing reload trying to get past the JSON viewer. The HTML branch
    // includes a <meta http-equiv="refresh" content="60;..."> so the page
    // automatically recovers after the retry window without user input.
    expect(proxySource).toMatch(/<meta\s+http-equiv=["']refresh["']/);
  });

  it('HTML response is bilingual (English + Hindi) per P7', () => {
    // The product invariant P7 in .claude/CLAUDE.md requires that ALL
    // user-facing surfaces support Hindi + English. The rate-limit error
    // page is user-facing — the lang="hi" attribute on the Hindi line
    // also helps screen readers switch voices correctly.
    expect(proxySource).toMatch(/lang=["']hi["']/);
  });

  it('all three rate-limit sites route through rateLimitResponse', () => {
    // proxy.ts has three rate-limit sites: general, parent portal, admin
    // panel. Each must call rateLimitResponse() — if a future edit inlines
    // the old `new NextResponse(JSON.stringify({error: "Rate limit..."}))`
    // shape at any of them, the bug returns on whichever surface uses it.
    //
    // We count call sites (both `return rateLimitResponse(request)` and
    // `const res = rateLimitResponse(request)` shapes) rather than just
    // direct returns, because the parent-portal site stamps an extra
    // X-RateLimit-Remaining header on the response before returning.
    const matches = proxySource.match(/=\s*rateLimitResponse\s*\(\s*request|return\s+rateLimitResponse\s*\(\s*request/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBeGreaterThanOrEqual(3);
  });

  it('emits a structured warn log when the general bucket fills', () => {
    // Observability — without this log, the next CGNAT-induced rate-limit
    // event in production gives us no signal until a CEO screenshot lands.
    expect(proxySource).toMatch(/message:\s*['"]rate_limit_exceeded['"]/);
    expect(proxySource).toMatch(/bucket:\s*['"]general['"]/);
  });

  it('general rate-limit ceiling is sized for Indian CGNAT (≥ 300/min)', () => {
    // The original 200/min ceiling was too tight: a single student
    // dashboard mount fires 8-12 same-origin API calls, plus the page nav
    // itself, plus _next/data hops. Behind Jio/Airtel CGNAT, 20-30
    // concurrent users on the same egress IP exhaust the bucket within
    // seconds. The ceiling must accommodate realistic peak load.
    const match = proxySource.match(/const\s+RATE_LIMIT_MAX\s*=\s*(\d+)/);
    expect(match, 'RATE_LIMIT_MAX constant missing from proxy.ts').not.toBeNull();
    const value = Number(match![1]);
    expect(value).toBeGreaterThanOrEqual(300);
  });

  it('does NOT lower the parent or admin bucket sizes (auth brute-force protection)', () => {
    // The parent portal (login form for guardians) and the /internal/admin
    // route family carry sensitive auth surfaces. They MUST stay at the
    // tighter limits even though the general bucket grew.
    const parentMatch = proxySource.match(/const\s+RATE_LIMIT_PARENT_MAX\s*=\s*(\d+)/);
    expect(parentMatch).not.toBeNull();
    expect(Number(parentMatch![1])).toBeLessThanOrEqual(20);

    const adminMatch = proxySource.match(/const\s+RATE_LIMIT_ADMIN_MAX\s*=\s*(\d+)/);
    expect(adminMatch).not.toBeNull();
    expect(Number(adminMatch![1])).toBeLessThanOrEqual(60);
  });
});
