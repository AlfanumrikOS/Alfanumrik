import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Regression pin: the unit-test lane's environment is HERMETIC.
 *
 * ── The incident this pins (2026-08-08) ────────────────────────────────────
 * `src/__tests__/setup.ts` used to seed its environment with the pattern
 *
 *     process.env.X = process.env.X || 'placeholder'
 *
 * for exactly three Supabase variables, and neutralised nothing else. That
 * fallback only fires when the variable is ABSENT. On any developer machine
 * that exports real credentials into the shell — the normal state for anyone
 * who also runs `supabase`, `vercel env pull`, or sources a `.env` from their
 * profile — the placeholder never applied and the ENTIRE unit suite executed
 * against production infrastructure.
 *
 * Measured on one such shell (real SUPABASE_SERVICE_ROLE_KEY, real project
 * ref, real Upstash Redis, `rzp_live_` Razorpay key):
 *   • `npm test` → 13 failed files / 62 failed tests / 41 errors / 24 "Worker
 *     exited unexpectedly" crashes, 63 minutes wall clock
 *   • the same 13 files with the environment scrubbed → 13 passed, 199 tests,
 *     44.1 seconds
 *   • genuine product defects among those 62 failures: ZERO
 *
 * The dominant mechanism was `acquireIdempotencyLock()` writing REAL keys into
 * production Upstash Redis: `/api/auth/bootstrap` takes a 30-second lock on
 * `bootstrap:<userId>`, so the first test claimed it and every later test
 * short-circuited to `{ status: 'deduplicated' }` HTTP 200 — "expected 200 to
 * be 400". That lock OUTLIVED the process, making the red set differ run to
 * run. A test suite that is non-deterministically red is a suite nobody reads,
 * which is the real damage: 19,600 tests' worth of signal became untrustworthy.
 *
 * ── What this file guards ─────────────────────────────────────────────────
 * Two independent layers, because either alone is defeatable:
 *   1. RUNTIME — the process this test runs in must actually be hermetic.
 *      Catches a scrub that silently stops covering a variable.
 *   2. STATIC — setup.ts must not reintroduce the `||` fallback shape.
 *      Catches the "tidy up this weird unconditional assignment" refactor
 *      BEFORE it silently repoints someone's suite at production.
 *
 * These assertions describe the TEST HARNESS, not product behaviour. Nothing
 * here may be relaxed to make an application test pass — a test that needs a
 * credential sets and restores it itself, which is already the house pattern
 * (see the payments, alfabot, health, env-accessors and internal-caller-signing
 * suites).
 */

const SETUP_PATH = path.resolve(process.cwd(), 'src/__tests__/setup.ts');

describe('unit-test environment is hermetic (runtime)', () => {
  it('points Supabase at the CI placeholder, never a real project ref', () => {
    // The exact literal from .github/workflows/ci.yml's top-level `env:`.
    // Byte-parity with CI is the point: it removes the "passes for me" class
    // of bug in both directions.
    expect(process.env.NEXT_PUBLIC_SUPABASE_URL).toBe('https://placeholder.supabase.co');
    expect(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY).toBe(
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.placeholder',
    );
    expect(process.env.SUPABASE_SERVICE_ROLE_KEY).toBe(
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.ci-placeholder-service-role',
    );
  });

  it('never leaves a *.supabase.co host other than the placeholder', () => {
    // A real project ref is 20 lowercase chars; the placeholder is the literal
    // word "placeholder". This catches a partial scrub that force-assigns the
    // anon key but inherits a real URL.
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
    expect(url).not.toMatch(/^https:\/\/(?!placeholder\.)[a-z]{20}\.supabase\.co/);
  });

  it('keeps the service-role key distinct from the anon key (env.ts anti-leak check)', () => {
    expect(process.env.SUPABASE_SERVICE_ROLE_KEY).not.toBe(
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    );
  });

  it('has NO Upstash Redis credentials, so callers take their in-memory path', () => {
    // getRedis() returns null when either is absent (packages/lib/src/redis.ts,
    // rbac.ts, middleware-helpers.ts, api-rate-limit.ts, and proxy.ts's
    // ensureUpstash()), which makes acquireIdempotencyLock() return true (allow) instead of deduping
    // against a shared production key space.
    expect(process.env.UPSTASH_REDIS_REST_URL).toBeUndefined();
    expect(process.env.UPSTASH_REDIS_REST_TOKEN).toBeUndefined();
    expect(process.env.UPSTASH_VECTOR_REST_URL).toBeUndefined();
    expect(process.env.UPSTASH_VECTOR_REST_TOKEN).toBeUndefined();
  });

  it('has NO NEXT_PUBLIC_APP_URL, so appHost() uses its production default', () => {
    // packages/lib/src/school-provisioning.ts appHost() and
    // packages/lib/src/identity/guardian-invite.ts both read
    // `process.env.NEXT_PUBLIC_APP_URL || 'https://alfanumrik.com'`. A dev
    // shell exporting http://localhost:3000 broke every claim-URL assertion.
    expect(process.env.NEXT_PUBLIC_APP_URL).toBeUndefined();
  });

  it('has NO bare SUPABASE_URL, so live-DB-gated suites stay skipped', () => {
    // observability-migration-1a/1b.test.ts live in the UNIT lane and gate
    // `describeIfSupabase` on `SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY`.
    // Since the service-role key is force-assigned above, SUPABASE_URL is the
    // only thing keeping them from dialling a live Postgres. It must stay
    // unset — do NOT "helpfully" force-assign it to a placeholder, or those
    // suites wake up and hang on a non-resolving host.
    expect(process.env.SUPABASE_URL).toBeUndefined();
    expect(process.env.SUPABASE_ANON_KEY).toBeUndefined();
  });

  it('has NO payment or AI provider credentials', () => {
    for (const name of [
      'RAZORPAY_KEY_ID',
      'RAZORPAY_KEY_SECRET',
      'RAZORPAY_WEBHOOK_SECRET',
      'ANTHROPIC_API_KEY',
      'ANTHROPIC_BASE_URL',
      'OPENAI_API_KEY',
      'VOYAGE_API_KEY',
      'GEMINI_API_KEY',
    ]) {
      expect(process.env[name], `${name} leaked into the unit lane`).toBeUndefined();
    }
  });

  it('carries no live-looking credential material at all', () => {
    // Shape-based backstop for credentials nobody thought to name. A real
    // Razorpay live key and a signed 3-segment JWT are the two shapes most
    // likely to appear in a developer shell.
    const offenders = Object.entries(process.env)
      .filter(([, v]) => typeof v === 'string')
      .filter(([, v]) => /\brzp_live_/.test(v!) || /^eyJ[\w-]+\.[\w-]+\.[\w-]+$/.test(v!))
      .map(([k]) => k);
    expect(offenders).toEqual([]);
  });
});

describe('setup.ts force-assigns rather than falling back (static)', () => {
  const source = fs.readFileSync(SETUP_PATH, 'utf8');

  // Comment-stripped view, for assertions that must look at CODE only. The
  // incident comment in setup.ts quotes the forbidden pattern verbatim (that
  // is the point of it), so a naive source-wide regex flags the very warning
  // that exists to prevent the regression. setup.ts uses `//` line comments
  // exclusively, so dropping comment-leading lines is sufficient and avoids
  // mangling the `https://…` literals that a blind `//`-strip would truncate.
  const code = source
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line))
    .join('\n');

  it('does NOT use the `process.env.X = process.env.X || ...` fallback shape', () => {
    // THE regression. `||` reads "use the ambient value when present", which
    // is precisely backwards for a hermetic harness: the protection evaporates
    // exactly on the machines that need it. Also matches `??`, the equally
    // wrong "modernised" rewrite.
    const fallback = /process\.env\.(\w+)\s*=\s*process\.env\.\1\s*(\|\||\?\?)/;
    expect(
      fallback.test(code),
      'setup.ts reintroduced the `process.env.X = process.env.X || ...` fallback. ' +
        'That pattern only fires when the variable is ABSENT, so a developer shell ' +
        'with real credentials silently runs the whole suite against production. ' +
        'Force-assign unconditionally instead.',
    ).toBe(false);
  });

  it('force-assigns each of the three CI-parity Supabase variables', () => {
    for (const name of [
      'NEXT_PUBLIC_SUPABASE_URL',
      'NEXT_PUBLIC_SUPABASE_ANON_KEY',
      'SUPABASE_SERVICE_ROLE_KEY',
    ]) {
      expect(
        new RegExp(`process\\.env\\.${name}\\s*=\\s*['"]`).test(code),
        `${name} must be force-assigned to a literal in setup.ts`,
      ).toBe(true);
    }
  });

  it('scrubs the credential prefixes that produced the incident', () => {
    for (const prefix of ["'UPSTASH_'", "'SUPABASE_'", "'RAZORPAY_'", "'ANTHROPIC_'", "'OPENAI_'"]) {
      expect(code, `${prefix} missing from the scrub prefix list`).toContain(prefix);
    }
    expect(code).toContain("'NEXT_PUBLIC_APP_URL'");
    expect(code).toContain('delete process.env[name]');
  });

  it('exempts only the explicit RUN_INTEGRATION_TESTS opt-in lane', () => {
    // The integration lane talks to a real staging project on purpose and
    // shares this setup file. That is the ONE supported escape hatch; if a
    // second one appears, this test should be the thing that argues about it.
    expect(code).toContain("process.env.RUN_INTEGRATION_TESTS === '1'");
  });

  it('keeps the incident narrative next to the code', () => {
    // The comment is load-bearing: without the "why", `||` is an obvious
    // simplification and someone will make it.
    expect(source).toMatch(/DO NOT "SIMPLIFY" THIS BACK/);
  });
});
