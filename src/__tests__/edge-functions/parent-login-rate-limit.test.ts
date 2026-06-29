/**
 * PP-1 — `handleParentLogin` per-IP brute-force rate limit (engineering-audit
 * Cycle 7). The legacy Edge `parent_login` action grants an `active` guardian
 * link from a bare link-code match; it had only a (bypassable) client-side
 * lockout. PP-1 adds a SERVER-side per-IP bound (PARENT_LOGIN_IP_LIMIT = 5/hr)
 * that runs BEFORE any DB lookup → 429 + Retry-After on exceed.
 *
 * Lane: the Edge function (`supabase/functions/parent-portal/index.ts`) imports
 * Deno globals + `npm:`/`jsr:` specifiers and cannot be imported under Vitest,
 * so PP-1 is pinned two ways (mirrors the repo's edge-functions lane —
 * deno-check / ts-parse-guard / *-structure tests):
 *
 *   1. BEHAVIOUR — the exact `createRateLimiter(5, 60*60*1000)` primitive the
 *      function is built on: 5 attempts from one IP pass, the 6th is denied with
 *      a positive retryAfterMs (the value that becomes the 429 Retry-After), and
 *      a different IP is independent. Clock is injected (no real timers).
 *   2. SOURCE CONTRACT — the limiter check is the FIRST thing in
 *      handleParentLogin, strictly BEFORE getServiceClient()/`.from('students')`
 *      and before the `.or()` interpolation; denial is 429 + Retry-After; the
 *      PII-safe warn logs limits/counts only (P13).
 *
 * Invariants: P13 (no IP/link-code/PII in the rate-limit log), P9-adjacent
 * (server-side enforcement, not client-only).
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
// Pure ESM, no Deno globals — the SAME factory the Edge function imports.
import { createRateLimiter } from '../../../supabase/functions/_shared/rate-limiter';

const PARENT_LOGIN_IP_LIMIT = 5;
const PARENT_LOGIN_IP_WINDOW_MS = 60 * 60 * 1000;

describe('PP-1 behaviour — per-IP limiter backing handleParentLogin', () => {
  it('allows exactly PARENT_LOGIN_IP_LIMIT attempts from one IP, denies the next', () => {
    const limit = createRateLimiter(PARENT_LOGIN_IP_LIMIT, PARENT_LOGIN_IP_WINDOW_MS);
    const key = 'parent_login:203.0.113.9';
    const t0 = 1_000_000;

    for (let i = 0; i < PARENT_LOGIN_IP_LIMIT; i++) {
      const r = limit(key, t0 + i); // same window
      expect(r.allowed).toBe(true);
      expect(r.retryAfterMs).toBe(0);
    }

    // The 6th attempt within the window is denied with a positive backoff that
    // the route renders as the `Retry-After` header (ceil(ms/1000)).
    const denied = limit(key, t0 + PARENT_LOGIN_IP_LIMIT);
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterMs).toBeGreaterThan(0);
    expect(Math.ceil(denied.retryAfterMs / 1000)).toBeGreaterThan(0);
  });

  it('keys by IP — a different IP is unaffected by another IP hitting the cap', () => {
    const limit = createRateLimiter(PARENT_LOGIN_IP_LIMIT, PARENT_LOGIN_IP_WINDOW_MS);
    const t0 = 2_000_000;
    for (let i = 0; i <= PARENT_LOGIN_IP_LIMIT; i++) limit('parent_login:1.1.1.1', t0 + i);
    // Attacker IP is now capped; a clean IP still gets through.
    expect(limit('parent_login:8.8.8.8', t0).allowed).toBe(true);
  });

  it('resets after the window elapses (per-hour bound, not permanent)', () => {
    const limit = createRateLimiter(PARENT_LOGIN_IP_LIMIT, PARENT_LOGIN_IP_WINDOW_MS);
    const key = 'parent_login:203.0.113.9';
    const t0 = 3_000_000;
    for (let i = 0; i < PARENT_LOGIN_IP_LIMIT; i++) limit(key, t0 + i);
    expect(limit(key, t0 + PARENT_LOGIN_IP_LIMIT).allowed).toBe(false);
    // One window later, the IP is allowed again.
    expect(limit(key, t0 + PARENT_LOGIN_IP_WINDOW_MS + 1).allowed).toBe(true);
  });
});

describe('PP-1 source contract — limiter runs before any DB lookup', () => {
  const src = fs.readFileSync(
    path.resolve(process.cwd(), 'supabase/functions/parent-portal/index.ts'),
    'utf8',
  );
  // Body of handleParentLogin (used for ordering assertions).
  const fnStart = src.indexOf('async function handleParentLogin');
  const fnBody = src.slice(fnStart);

  it('declares the per-IP limit = 5 over a 1-hour window', () => {
    expect(src).toMatch(/PARENT_LOGIN_IP_LIMIT\s*=\s*5\b/);
    expect(src).toMatch(/PARENT_LOGIN_IP_WINDOW_MS\s*=\s*60\s*\*\s*60\s*\*\s*1000/);
    expect(src).toMatch(/createRateLimiter\(\s*PARENT_LOGIN_IP_LIMIT\s*,\s*PARENT_LOGIN_IP_WINDOW_MS\s*\)/);
  });

  it('checks the limiter BEFORE getServiceClient() and before the students .or() lookup', () => {
    const limiterIdx = fnBody.indexOf('parentLoginIpLimiter(');
    const serviceIdx = fnBody.indexOf('getServiceClient()');
    const orIdx = fnBody.indexOf('.or(`invite_code.eq.');
    const validatorIdx = fnBody.indexOf('isValidLinkCode(');
    expect(limiterIdx).toBeGreaterThan(-1);
    expect(serviceIdx).toBeGreaterThan(-1);
    expect(orIdx).toBeGreaterThan(-1);
    expect(validatorIdx).toBeGreaterThan(-1);
    // limiter → validator → service client → .or() filter.
    expect(limiterIdx).toBeLessThan(validatorIdx);
    expect(limiterIdx).toBeLessThan(serviceIdx);
    expect(validatorIdx).toBeLessThan(orIdx);
    expect(serviceIdx).toBeLessThan(orIdx);
  });

  it('returns 429 + Retry-After on the deny path', () => {
    // The 429 + Retry-After block sits inside the `if (!rl.allowed)` branch.
    const denyBlock = fnBody.slice(fnBody.indexOf('if (!rl.allowed)'), fnBody.indexOf('const linkCode'));
    expect(denyBlock).toMatch(/429/);
    expect(denyBlock).toMatch(/'Retry-After':\s*String\(Math\.ceil\(rl\.retryAfterMs\s*\/\s*1000\)\)/);
  });

  it('P13 — the rate-limit warn logs limits/counts only, never IP / link code / PII', () => {
    const denyBlock = fnBody.slice(fnBody.indexOf('if (!rl.allowed)'), fnBody.indexOf('const linkCode'));
    expect(denyBlock).toMatch(/console\.warn/);
    expect(denyBlock).toMatch(/limit:\s*PARENT_LOGIN_IP_LIMIT/);
    expect(denyBlock).toMatch(/retry_after_ms:\s*rl\.retryAfterMs/);
    // No PII / identifying values are logged.
    expect(denyBlock).not.toMatch(/\bclientIp\b/);
    expect(denyBlock).not.toMatch(/\blinkCode\b/);
    expect(denyBlock).not.toMatch(/\blink_code\b/);
    expect(denyBlock).not.toMatch(/email|phone|parentName/i);
  });
});
