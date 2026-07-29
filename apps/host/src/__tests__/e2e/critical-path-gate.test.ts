import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * ── ANTI-VACUITY GUARD for the blocking E2E critical-path gate ────────────
 *
 * Failure mode being fixed (found 2026-07-28): the `e2e-critical-paths` CI job
 * is BLOCKING and exists so that "a scoring or Razorpay regression must not
 * ship through CI green". It ran 13 tests. ALL 13 were inert — 10 disabled by
 * passing a literal boolean to `test.fixme` (so the skip could never expire)
 * and 3 short-circuited by a placeholder NEXT_PUBLIC_SUPABASE_URL. The gate
 * was green and checked nothing for months.
 *
 * This test runs in the ALWAYS-ON unit lane (the e2e job only runs on
 * main/staging PRs), so the vacuous state is detectable on every PR.
 *
 * Ownership note: this file only READS `.github/workflows/ci.yml`; it never
 * modifies it.
 */

const REPO_ROOT = path.resolve(__dirname, '../../../../..');
const E2E_DIR = path.join(REPO_ROOT, 'e2e');
const CI_WORKFLOW = path.join(REPO_ROOT, '.github/workflows/ci.yml');

/** The two specs the blocking `e2e-critical-paths` job invokes by name. */
const CRITICAL_SPECS = ['quiz-happy-path.spec.ts', 'payment-checkout.spec.ts'] as const;

/**
 * Floor for the number of tests across the two critical specs that carry NO
 * skip/fixme guard at all — i.e. that actually execute in CI.
 *
 * Measured 2026-07-28 after the revival: 13 (11 asserting current behaviour +
 * 2 `test.fail()`-pinned open defects, which still execute). The floor sits
 * slightly below to leave refactor headroom; LOWERING it further requires
 * user approval per the regression-catalog rules.
 */
const ACTIVE_ASSERTION_FLOOR = 11;

/**
 * FROZEN legacy debt: specs that still disable tests with a literal boolean.
 * None of these is in the BLOCKING gate (certification specs are excluded from
 * collection entirely; the rest run only in the advisory / label-gated `e2e`
 * job). The list is frozen: no new file may join it, and shrinking it is
 * always welcome.
 *
 * TODO(testing): audit each of these the way the two critical specs were
 * audited on 2026-07-28. At least one — foxy-structured-rendering.spec.ts —
 * repeats verbatim the "mocked-session fallback cannot drive the composer
 * because AuthContext checks several nested SDK calls" claim that was proven
 * FALSE for the quiz and pricing surfaces, so it is likely revivable too.
 */
const LEGACY_LITERAL_DISABLE_DEBT = new Set([
  'e2e/alfabot.spec.ts',
  'e2e/certification/content-author.spec.ts',
  'e2e/certification/parent.spec.ts',
  'e2e/certification/payments.spec.ts',
  'e2e/certification/student.spec.ts',
  'e2e/certification/support-staff.spec.ts',
  'e2e/foxy-structured-rendering.spec.ts',
  'e2e/school-admin.spec.ts',
]);

/** Built from fragments so this guard's own source never matches its patterns. */
const LITERAL_DISABLE = new RegExp('test\\.(fixme|skip)\\(\\s*(true|false)\\b');
const ANY_DISABLE = new RegExp('test\\.(fixme|skip)\\(');
const TEST_SPLIT = /\n\s*test\(/;

function listSpecFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...listSpecFiles(full));
    else if (entry.endsWith('.spec.ts')) out.push(full);
  }
  return out;
}

describe('E2E critical-path gate integrity', () => {
  it('the blocking CI job still targets exactly the specs this guard audits', () => {
    const ci = readFileSync(CI_WORKFLOW, 'utf8');
    const invocation = ci
      .split('\n')
      .find((line) => line.includes('npx playwright test') && line.includes('quiz-happy-path.spec.ts'));

    expect(
      invocation,
      'The e2e-critical-paths job no longer invokes quiz-happy-path.spec.ts. ' +
        'If the blocking gate moved, update CRITICAL_SPECS here so the anti-vacuity ' +
        'audit follows it.',
    ).toBeTruthy();
    for (const spec of CRITICAL_SPECS) {
      expect(invocation).toContain(spec);
    }
  });

  it('no NEW spec in e2e/ is disabled with a literal boolean', () => {
    const offenders: string[] = [];
    for (const file of listSpecFiles(E2E_DIR)) {
      const rel = path.relative(REPO_ROOT, file).split(path.sep).join('/');
      if (LEGACY_LITERAL_DISABLE_DEBT.has(rel)) continue;
      const src = readFileSync(file, 'utf8');
      if (LITERAL_DISABLE.test(src)) offenders.push(rel);
    }
    expect(
      offenders,
      'These specs disable tests with a literal boolean argument, which can never ' +
        'stop applying — the skip is permanent and its stated reason is unverifiable. ' +
        'Use a machine-checkable condition (an env-var or capability check) instead ' +
        'so the test self-enables the moment the prerequisite exists:\n' +
        offenders.join('\n'),
    ).toEqual([]);
  });

  it('the blocking critical-path specs run at least the floor of active assertions', () => {
    let unconditional = 0;
    const perFile: Record<string, number> = {};

    for (const spec of CRITICAL_SPECS) {
      const src = readFileSync(path.join(E2E_DIR, spec), 'utf8');
      let count = 0;
      for (const block of src.split(TEST_SPLIT).slice(1)) {
        if (!ANY_DISABLE.test(block)) count++;
      }
      perFile[spec] = count;
      unconditional += count;
    }

    expect(
      unconditional,
      `Only ${unconditional} unconditionally-active tests remain across the blocking ` +
        `critical-path specs (floor ${ACTIVE_ASSERTION_FLOOR}). Per-file: ` +
        `${JSON.stringify(perFile)}. The gate that protects P1 (score), P2 (XP), ` +
        'P3 (anti-cheat) and P11 (payment integrity) must never regress toward ' +
        'asserting nothing.',
    ).toBeGreaterThanOrEqual(ACTIVE_ASSERTION_FLOOR);
  });

  it('every conditionally-skipped critical-path test names a checkable prerequisite', () => {
    const bad: string[] = [];
    for (const spec of CRITICAL_SPECS) {
      const src = readFileSync(path.join(E2E_DIR, spec), 'utf8');
      // Capture the first argument of each skip/fixme call.
      const calls = src.match(new RegExp('test\\.(fixme|skip)\\(\\s*[^,]+', 'g')) ?? [];
      for (const call of calls) {
        const arg = call.replace(new RegExp('^test\\.(fixme|skip)\\(\\s*'), '');
        // Must reference an env var directly or via a named capability helper.
        if (!/process\.env|hasRealStudentCreds|has[A-Z]\w*\(/.test(arg)) {
          bad.push(`${spec}: ${call.trim()}`);
        }
      }
    }
    expect(
      bad,
      'These skip conditions are not machine-checkable against the environment, ' +
        'so nothing can ever flip them back on:\n' + bad.join('\n'),
    ).toEqual([]);
  });

  it('the helper that unblocked these tests is still wired (regression pin)', () => {
    // The 10 permanent fixmes existed because mockStudentSession() seeded the
    // Supabase session under a localStorage key derived from the TEST
    // PROCESS's NEXT_PUBLIC_SUPABASE_URL, which never matches the key the
    // browser SDK reads when the app under test was built against a different
    // project ref. Removing the project-ref-agnostic read shim silently
    // re-breaks every mocked-session flow, so pin it.
    const auth = readFileSync(path.join(E2E_DIR, 'helpers/auth.ts'), 'utf8');
    expect(auth).toContain('installSessionForAnyProjectRef');
    expect(auth).toMatch(/Storage\.prototype\.getItem/);
    expect(auth).toMatch(/sb-.*-auth-token/);
  });
});
