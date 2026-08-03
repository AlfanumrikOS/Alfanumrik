/**
 * packages/lib/src/cron-auth.ts — verifyCronAuth unit pins.
 *
 * P1 batch 2026-08-03 (verifyCronAuth consolidation): every /api/cron/* and
 * /api/internal/cron/* route now authenticates through this ONE helper,
 * replacing ~14 hand-copied per-route implementations. These pins freeze the
 * behavior contract at the helper level (the per-route suites pin the same
 * contract at the route level):
 *
 *   1. FAIL CLOSED — CRON_SECRET unset ⇒ reject even a correct header.
 *   2. Carriers: `Authorization: Bearer` and `x-cron-secret` ONLY.
 *   3. NO query-param carrier — `?token=` was REMOVED (query strings land in
 *      access/CDN logs, so a secret there is a secret leaked). The query
 *      string is never even consulted as a credential.
 *   4. FIRST-PRESENT-WINS — a wrong higher-precedence carrier is not rescued
 *      by a correct lower one; exactly one compare per request.
 *   5. Constant-time compare — node:crypto timingSafeEqual with an explicit
 *      length guard (pinned at source level below; a behavioral timing
 *      assertion would be flaky by construction).
 *
 * Owning agent: testing.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NextRequest } from 'next/server';
import { verifyCronAuth, unauthorizedResponse } from '@alfanumrik/lib/cron-auth';

const SECRET = 'cron-auth-unit-fixture-secret';
const ORIGINAL_CRON_SECRET = process.env.CRON_SECRET;

function req(
  headers: Record<string, string> = {},
  url = 'http://localhost/api/cron/anything',
): NextRequest {
  return new NextRequest(url, { headers });
}

beforeEach(() => {
  process.env.CRON_SECRET = SECRET;
});

afterEach(() => {
  if (ORIGINAL_CRON_SECRET === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = ORIGINAL_CRON_SECRET;
});

describe('verifyCronAuth — fail-closed posture', () => {
  it('CRON_SECRET unset → rejected even with a CORRECT header (missing_secret)', () => {
    delete process.env.CRON_SECRET;
    expect(verifyCronAuth(req({ 'x-cron-secret': SECRET }))).toEqual({
      ok: false,
      reason: 'missing_secret',
    });
    expect(verifyCronAuth(req({ authorization: `Bearer ${SECRET}` }))).toEqual({
      ok: false,
      reason: 'missing_secret',
    });
  });

  it('no carrier at all → missing_credentials', () => {
    expect(verifyCronAuth(req())).toEqual({ ok: false, reason: 'missing_credentials' });
  });

  it('wrong Bearer → invalid_credentials', () => {
    expect(verifyCronAuth(req({ authorization: 'Bearer wrong-value' }))).toEqual({
      ok: false,
      reason: 'invalid_credentials',
    });
  });

  it('wrong x-cron-secret → invalid_credentials', () => {
    expect(verifyCronAuth(req({ 'x-cron-secret': 'wrong-value' }))).toEqual({
      ok: false,
      reason: 'invalid_credentials',
    });
  });

  it('a length-mismatched secret is an ordinary reject, not a throw (timingSafeEqual length guard)', () => {
    expect(() => verifyCronAuth(req({ 'x-cron-secret': `${SECRET}-longer` }))).not.toThrow();
    expect(verifyCronAuth(req({ 'x-cron-secret': `${SECRET}-longer` })).ok).toBe(false);
    expect(verifyCronAuth(req({ 'x-cron-secret': SECRET.slice(0, 4) })).ok).toBe(false);
  });
});

describe('verifyCronAuth — accepted carriers', () => {
  it('correct Authorization: Bearer → ok (the Vercel Cron carrier)', () => {
    expect(verifyCronAuth(req({ authorization: `Bearer ${SECRET}` }))).toEqual({ ok: true });
  });

  it('correct x-cron-secret → ok (the daily-cron fan-out / run-production-crons carrier)', () => {
    expect(verifyCronAuth(req({ 'x-cron-secret': SECRET }))).toEqual({ ok: true });
  });

  it('FIRST-PRESENT-WINS: a wrong Bearer is NOT rescued by a correct x-cron-secret', () => {
    expect(
      verifyCronAuth(req({ authorization: 'Bearer wrong', 'x-cron-secret': SECRET })),
    ).toEqual({ ok: false, reason: 'invalid_credentials' });
  });
});

describe('verifyCronAuth — the ?token= query carrier is REMOVED (2026-08-03)', () => {
  it('a CORRECT ?token= with no headers is not a credential at all → missing_credentials', () => {
    // missing_credentials (not invalid_credentials) proves the query string is
    // never even consulted — a leaked-into-logs token grants nothing.
    expect(
      verifyCronAuth(req({}, `http://localhost/api/cron/anything?token=${SECRET}`)),
    ).toEqual({ ok: false, reason: 'missing_credentials' });
  });

  it('a CORRECT ?token= does not rescue a wrong header carrier → invalid_credentials', () => {
    expect(
      verifyCronAuth(
        req({ 'x-cron-secret': 'wrong' }, `http://localhost/api/cron/anything?token=${SECRET}`),
      ),
    ).toEqual({ ok: false, reason: 'invalid_credentials' });
  });
});

describe('verifyCronAuth — source-level pins (constant-time + no query parsing)', () => {
  // Behavioral timing assertions are flaky by construction, so the
  // constant-time property is pinned at source level instead.
  const source = readFileSync(
    resolve(__dirname, '../../../../../packages/lib/src/cron-auth.ts'),
    'utf8',
  );

  it("uses node:crypto timingSafeEqual for the compare (no ===/!== on the secret)", () => {
    expect(source).toMatch(/import\s*\{\s*timingSafeEqual\s*\}\s*from\s*'node:crypto'/);
    expect(source).toMatch(/timingSafeEqual\(a,\s*b\)/);
  });

  it('never parses the request URL/query for a credential', () => {
    // No URL/searchParams access and no 'token' extraction anywhere in the
    // helper — the query carrier cannot silently come back.
    expect(source).not.toMatch(/searchParams|nextUrl|new URL\(/);
    expect(source).not.toMatch(/get\(\s*['"]token['"]\s*\)/);
  });
});

describe('unauthorizedResponse — the house cron 401', () => {
  it('is a 401 with the { success: false, error: "Unauthorized" } body', async () => {
    const res = unauthorizedResponse();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ success: false, error: 'Unauthorized' });
  });
});
