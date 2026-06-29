/**
 * REG-204 — Tier-2 PR C: Durable parent-login rate limiter (P15 / abuse-hardening).
 *
 * The prior `parent_login` per-IP bound used the per-instance in-memory limiter
 * (`_shared/rate-limiter.ts::createRateLimiter`), which resets on every Edge
 * cold start — a brute-forcer who lands on a fresh instance gets a fresh budget.
 * Tier-2 PR C introduces `_shared/durable-rate-limiter.ts::createDurableRateLimiter`,
 * a cross-instance Upstash `fixedWindow` limiter with a TRANSPARENT in-memory
 * fallback that preserves the SAME bound (5 / 1h) when the Upstash secrets are
 * absent OR Redis errors. The limiter must NEVER fail open (no unconditional
 * `allowed: true`) and NEVER throw on the request path, and the check must stay
 * BEFORE any DB lookup in `handleParentLogin` (fail-closed-before-DB).
 *
 * Lane: the Edge files import Deno globals + `https://esm.sh/...` specifiers and
 * cannot be imported under Vitest, so — matching the repo's edge-functions
 * convention (see parent-login-rate-limit / parent-login-consent / mol-shadow
 * source pins) — this is a SOURCE-LEVEL pin on the comment-stripped file text.
 *
 * Invariants: P15 (onboarding/abuse path stays bounded + never breaks the
 * request), abuse-hardening (durable cross-instance bound).
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ── comment-stripping reader ────────────────────────────────────────────────
// Walks char-by-char tracking string state so that // and /* */ inside string
// literals (e.g. the `https://esm.sh/...` import specifiers) are PRESERVED,
// while real line/block comments are removed. This keeps comment prose (e.g.
// "never fail open") from creating false positives/negatives in the assertions.
function stripComments(src: string): string {
  let out = '';
  let i = 0;
  const n = src.length;
  type State = 'code' | 'line' | 'block' | 'sq' | 'dq' | 'tpl';
  let state: State = 'code';
  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];
    if (state === 'code') {
      if (c === '/' && c2 === '/') { state = 'line'; i += 2; continue; }
      if (c === '/' && c2 === '*') { state = 'block'; i += 2; continue; }
      if (c === "'") { state = 'sq'; out += c; i++; continue; }
      if (c === '"') { state = 'dq'; out += c; i++; continue; }
      if (c === '`') { state = 'tpl'; out += c; i++; continue; }
      out += c; i++; continue;
    }
    if (state === 'line') {
      if (c === '\n') { state = 'code'; out += c; }
      i++; continue;
    }
    if (state === 'block') {
      if (c === '*' && c2 === '/') { state = 'code'; i += 2; continue; }
      i++; continue;
    }
    // string states — copy verbatim, honour escapes
    out += c;
    if (c === '\\') { out += c2 ?? ''; i += 2; continue; }
    if (state === 'sq' && c === "'") state = 'code';
    else if (state === 'dq' && c === '"') state = 'code';
    else if (state === 'tpl' && c === '`') state = 'code';
    i++;
  }
  return out;
}

function readStripped(rel: string): string {
  const raw = fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8');
  return stripComments(raw);
}

const durable = readStripped('supabase/functions/_shared/durable-rate-limiter.ts');
const portal = readStripped('supabase/functions/parent-portal/index.ts');

describe('REG-204 — durable-rate-limiter.ts source contract', () => {
  it('exports the createDurableRateLimiter factory', () => {
    expect(durable).toMatch(/export\s+function\s+createDurableRateLimiter\s*\(/);
  });

  it('reads BOTH UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN via Deno.env.get', () => {
    expect(durable).toMatch(/Deno\.env\.get\(\s*['"]UPSTASH_REDIS_REST_URL['"]\s*\)/);
    expect(durable).toMatch(/Deno\.env\.get\(\s*['"]UPSTASH_REDIS_REST_TOKEN['"]\s*\)/);
  });

  it('imports @upstash/ratelimit + @upstash/redis from esm.sh (version-pin tolerant)', () => {
    // Match on the package path, tolerant of a trailing @version so an architect
    // pin (e.g. @upstash/ratelimit@2.0.0) does not break the assertion.
    expect(durable).toMatch(/from\s*['"]https:\/\/esm\.sh\/@upstash\/ratelimit(@[^'"]*)?['"]/);
    expect(durable).toMatch(/from\s*['"]https:\/\/esm\.sh\/@upstash\/redis(@[^'"]*)?['"]/);
  });

  it('imports createRateLimiter from ./rate-limiter.ts and uses it as the in-memory fallback (memCheck)', () => {
    expect(durable).toMatch(/import\s*\{\s*createRateLimiter\s*\}\s*from\s*['"]\.\/rate-limiter\.ts['"]/);
    // The fallback is bound to the SAME limit/window the factory received.
    expect(durable).toMatch(/const\s+memCheck\s*=\s*createRateLimiter\(\s*limit\s*,\s*windowMs\s*\)/);
  });

  it('constructs Ratelimit.fixedWindow( ONLY inside the `if (url && token)` both-present guard', () => {
    const guardIdx = durable.search(/if\s*\(\s*url\s*&&\s*token\s*\)/);
    const fixedIdx = durable.indexOf('Ratelimit.fixedWindow(');
    expect(guardIdx).toBeGreaterThan(-1);
    expect(fixedIdx).toBeGreaterThan(-1);
    // fixedWindow is built only after the both-present guard opens.
    expect(fixedIdx).toBeGreaterThan(guardIdx);
    // Exactly one construction site — no stray unconditional one.
    expect((durable.match(/Ratelimit\.fixedWindow\(/g) || []).length).toBe(1);
    expect((durable.match(/new\s+Ratelimit\(/g) || []).length).toBe(1);
    // 5/1h → "3600 s" fixed window (windowMs/1000 seconds string).
    expect(durable).toMatch(/Ratelimit\.fixedWindow\(\s*limit\s*,\s*`\$\{Math\.round\(windowMs\s*\/\s*1000\)\}\s*s`\s*\)/);
  });

  it('returns an async check(key) → { allowed, retryAfterMs }', () => {
    expect(durable).toMatch(/return\s+async\s+function\s+check\s*\(\s*key:\s*string\s*\)/);
    // The result interface carries exactly the two-key shape.
    expect(durable).toMatch(/interface\s+DurableRateLimitResult\s*\{[\s\S]*allowed:\s*boolean[\s\S]*retryAfterMs:\s*number[\s\S]*\}/);
    // The Redis-success return uses the same shape.
    expect(durable).toMatch(/allowed:\s*success/);
    expect(durable).toMatch(/retryAfterMs:\s*success\s*\?\s*0\s*:/);
  });

  it('wraps the redisLimiter.limit( call in try/catch and returns memCheck OUTSIDE it', () => {
    const tryIdx = durable.search(/try\s*\{[\s\S]*await\s+redisLimiter\.limit\(/);
    const limitIdx = durable.indexOf('redisLimiter.limit(');
    const catchIdx = durable.indexOf('catch', limitIdx);
    const memReturnIdx = durable.search(/return\s+memCheck\(\s*key\s*\)/);
    expect(tryIdx).toBeGreaterThan(-1);
    expect(limitIdx).toBeGreaterThan(-1);
    expect(catchIdx).toBeGreaterThan(limitIdx);          // catch follows the limit call
    expect(memReturnIdx).toBeGreaterThan(catchIdx);      // fallback return sits after the catch block
  });
});

describe('REG-204 — fail-safe: never fails open, never throws on the request path', () => {
  it('has NO unconditional `return { allowed: true }` bypass anywhere', () => {
    // The only allowed:true would be a no-op fail-open — it must not exist.
    expect(durable).not.toMatch(/return\s*\{\s*allowed:\s*true/);
  });

  it('the env-absent branch falls through to memCheck (not a no-op true)', () => {
    // redisLimiter starts null; the check guards on `if (redisLimiter)`, so when
    // the secrets are absent the function reaches `return memCheck(key)`.
    expect(durable).toMatch(/let\s+redisLimiter[^\n]*=\s*null/);
    expect(durable).toMatch(/if\s*\(\s*redisLimiter\s*\)/);
    // The final statement of check is the in-memory fallback return.
    expect(durable).toMatch(/return\s+memCheck\(\s*key\s*\)\s*\n?\s*\}/);
  });

  it('the ONLY await redisLimiter.limit( is inside the try (cannot throw on the request path)', () => {
    // Exactly one .limit( await, and it is preceded by `try {` with no
    // intervening close brace — i.e. it lives inside the try block.
    const matches = durable.match(/await\s+redisLimiter\.limit\(/g) || [];
    expect(matches.length).toBe(1);
    const limitIdx = durable.indexOf('await redisLimiter.limit(');
    const precedingTry = durable.lastIndexOf('try {', limitIdx);
    expect(precedingTry).toBeGreaterThan(-1);
    // No catch/close-of-try between the `try {` and the limit call.
    const between = durable.slice(precedingTry, limitIdx);
    expect(between).not.toMatch(/\bcatch\b/);
  });
});

describe('REG-204 — parent-portal/index.ts wiring (fail-closed-before-DB)', () => {
  it('imports createDurableRateLimiter from ../_shared/durable-rate-limiter.ts', () => {
    expect(portal).toMatch(/import\s*\{\s*createDurableRateLimiter\s*\}\s*from\s*['"]\.\.\/_shared\/durable-rate-limiter\.ts['"]/);
  });

  it('builds the limiter with the unchanged 5 / 1h constants and the rl:parent_login prefix', () => {
    expect(portal).toMatch(/PARENT_LOGIN_IP_LIMIT\s*=\s*5\b/);
    expect(portal).toMatch(/PARENT_LOGIN_IP_WINDOW_MS\s*=\s*60\s*\*\s*60\s*\*\s*1000/);
    expect(portal).toMatch(
      /createDurableRateLimiter\(\s*PARENT_LOGIN_IP_LIMIT\s*,\s*PARENT_LOGIN_IP_WINDOW_MS\s*,\s*['"]rl:parent_login['"]\s*\)/,
    );
  });

  it('awaits the limiter check BEFORE getServiceClient() and the students .or() lookup in handleParentLogin', () => {
    const fnStart = portal.indexOf('async function handleParentLogin');
    expect(fnStart).toBeGreaterThan(-1);
    const fnBody = portal.slice(fnStart);

    const awaitLimiterIdx = fnBody.search(/await\s+parentLoginIpLimiter\(/);
    const serviceIdx = fnBody.indexOf('getServiceClient()');
    const orIdx = fnBody.indexOf('.or(`invite_code.eq.');

    expect(awaitLimiterIdx).toBeGreaterThan(-1); // call site is awaited
    expect(serviceIdx).toBeGreaterThan(-1);
    expect(orIdx).toBeGreaterThan(-1);
    // limiter check → service client → DB filter (fail-closed-before-DB ordering).
    expect(awaitLimiterIdx).toBeLessThan(serviceIdx);
    expect(awaitLimiterIdx).toBeLessThan(orIdx);
    expect(serviceIdx).toBeLessThan(orIdx);
  });
});

describe('REG-204 — non-vacuity (the files were actually read)', () => {
  it('both Edge files have real content and the key tokens are present', () => {
    expect(durable.length).toBeGreaterThan(400);
    expect(portal.length).toBeGreaterThan(2000);
    expect(durable).toContain('createDurableRateLimiter');
    expect(durable).toContain('memCheck');
    expect(portal).toContain('parentLoginIpLimiter');
    expect(portal).toContain('handleParentLogin');
  });
});
