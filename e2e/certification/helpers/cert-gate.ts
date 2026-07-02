import type { Page } from '@playwright/test';
import {
  CERTIFICATION_EMAIL_DOMAIN,
  MISSION_ROLES,
  buildAccountShape,
  runIdShortOf,
  type MissionRole,
  type RoleDef,
} from '../../../scripts/seed-certification-accounts';

/**
 * Shared gating + account-derivation helpers for e2e/certification/**.
 *
 * PREPARATION ONLY (2026-07-02). These specs exist so Stage 2/3 of the
 * certification program has real, reviewed Playwright coverage ready to run
 * the moment CERT-17 (Vercel Preview environment variables shared with
 * production — see docs/audit/2026-07-02-certification/reports/14-risk-register.md)
 * is closed by a human with Vercel dashboard access. Nothing in this
 * directory may run against a live URL until that happens.
 *
 * ── The gate (two layers of defense) ────────────────────────────────────
 * 1. `playwright.config.ts` sets `testIgnore: ['**\/certification/**']`
 *    UNLESS `CERTIFICATION_RUN_ENABLED=true` is set, so a plain
 *    `npm run test:e2e` (or CI's `npx playwright test --project=chromium`)
 *    never even collects these files — not "skipped", not present at all.
 * 2. Every spec ALSO self-gates at the top of its `test.describe` block via
 *    `test.skip(!certificationSuiteEnabled(), certificationSkipReason())`,
 *    so even a direct, deliberate invocation
 *    (`CERTIFICATION_RUN_ENABLED=true npx playwright test e2e/certification`)
 *    skips cleanly — no navigation, no browser I/O — unless
 *    `CERTIFICATION_BASE_URL` is ALSO set to a real target.
 *
 * `npx playwright test e2e/certification --list` is always safe to run (with
 * `CERTIFICATION_RUN_ENABLED=true` set so layer 1 doesn't strip the files
 * from collection) — `--list` only parses/enumerates tests, it never
 * launches a browser or contacts a URL.
 *
 * ── SSO-protected Vercel Preview targets ────────────────────────────────
 * When `CERTIFICATION_BASE_URL` points at a Vercel Preview deployment that
 * has Vercel Authentication (SSO / Deployment Protection) enabled, requests
 * are bounced to Vercel's login wall and the journeys can't reach the app.
 * To pass the wall, ALSO set `CERTIFICATION_BYPASS_SECRET` to the project's
 * "Protection Bypass for Automation" secret (Vercel dashboard → Settings →
 * Deployment Protection → Protection Bypass for Automation). When set,
 * `playwright.config.ts` sends `x-vercel-protection-bypass: <secret>` plus
 * `x-vercel-set-bypass-cookie: true` on every request (the cookie lets the
 * multi-page journeys keep bypassing after the first navigation). This
 * secret is ADDITIVE — it enables nothing by itself; the
 * CERTIFICATION_RUN_ENABLED + CERTIFICATION_BASE_URL gates still apply.
 *
 * ── Account targeting ───────────────────────────────────────────────────
 * Accounts are derived, not guessed, from the SAME pure functions
 * `scripts/seed-certification-accounts.ts` uses to create them
 * (`buildAccountShape`, `runIdShortOf`) — importing them directly (rather
 * than re-implementing the `cert-<run_id_short>-<role>-<n>@certification.
 * alfanumrik.invalid` convention here) guarantees this suite can never drift
 * from docs/runbooks/certification-traffic-traceability.md. An operator
 * just needs to supply the SAME run id the seeding script printed
 * (`CERTIFICATION_RUN_ID`, the full UUID) so both sides derive an identical
 * `run_id_short` and, by extension, identical emails/passwords.
 */

export { CERTIFICATION_EMAIL_DOMAIN, MISSION_ROLES };
export type { MissionRole, RoleDef };

// ─── Layer 2 gate — read once at module load ───────────────────────────────

export const CERTIFICATION_RUN_ENABLED = process.env.CERTIFICATION_RUN_ENABLED === 'true';
export const CERTIFICATION_BASE_URL = process.env.CERTIFICATION_BASE_URL ?? '';

/**
 * Vercel "Protection Bypass for Automation" secret. Exported for documentation
 * and in case a spec needs it to authenticate a raw `request` (Playwright's
 * APIRequestContext) that doesn't inherit `playwright.config.ts`'s
 * `extraHTTPHeaders`. NOT a gate — it enables nothing on its own; the
 * CERTIFICATION_RUN_ENABLED + CERTIFICATION_BASE_URL gates still apply. Empty
 * string when unset (normal/local runs), so no header is ever sent then.
 */
export const CERTIFICATION_BYPASS_SECRET = process.env.CERTIFICATION_BYPASS_SECRET ?? '';

/** Second, EXPLICIT guard required in addition to the above for the payments spec — see CERT-17. */
export const CERTIFICATION_PAYMENTS_CONFIRMED_SAFE =
  process.env.CERTIFICATION_PAYMENTS_CONFIRMED_SAFE === 'true';

export function certificationSuiteEnabled(): boolean {
  return CERTIFICATION_RUN_ENABLED && CERTIFICATION_BASE_URL.length > 0;
}

export function certificationSkipReason(): string {
  const missing: string[] = [];
  if (!CERTIFICATION_RUN_ENABLED) missing.push('CERTIFICATION_RUN_ENABLED=true');
  if (!CERTIFICATION_BASE_URL) missing.push('CERTIFICATION_BASE_URL=<target-url>');
  return (
    `Certification suite gated off — set ${missing.join(' and ')} to enable. ` +
    'This suite must not run against any live target until CERT-17 is closed ' +
    '(docs/audit/2026-07-02-certification/reports/14-risk-register.md).'
  );
}

/**
 * Payments (Task's "extra-clearly gated") suite gate — CERT-17.
 *
 * CERT-17: Vercel Preview currently shares its Supabase, Razorpay, and
 * AI-provider environment-variable values with Production (per Vercel's own
 * environment-variable scoping). This is an OPEN Release Blocker. A live
 * Razorpay checkout run against a misconfigured target could create REAL
 * charges or REAL subscription-state writes against the PRODUCTION payment
 * provider. This must not run until a human with Vercel dashboard access has
 * independently confirmed the target environment's payment/DB credentials
 * are sandboxed — set `CERTIFICATION_PAYMENTS_CONFIRMED_SAFE=true` only
 * after that confirmation, never as a default or a CI default.
 */
export function paymentsSuiteEnabled(): boolean {
  return certificationSuiteEnabled() && CERTIFICATION_PAYMENTS_CONFIRMED_SAFE;
}

export function paymentsSkipReason(): string {
  if (!certificationSuiteEnabled()) return certificationSkipReason();
  return (
    'CERT-17 guard: the payments journey stays gated even with the base certification suite ' +
    'enabled. Set CERTIFICATION_PAYMENTS_CONFIRMED_SAFE=true ONLY after a human with Vercel ' +
    'dashboard access has confirmed the target environment does not share live Razorpay/' +
    'Supabase credentials with production (see docs/audit/2026-07-02-certification/reports/' +
    '14-risk-register.md, CERT-17, and RC-2026-07-02-baseline.md, environment assumption #3).'
  );
}

// ─── Account derivation — reuses the seed script's own pure functions ─────

export function certificationRunIdShort(): string | undefined {
  const explicit = process.env.CERTIFICATION_RUN_ID_SHORT;
  if (explicit) return explicit.toLowerCase();
  const full = process.env.CERTIFICATION_RUN_ID;
  if (full) return runIdShortOf(full);
  return undefined;
}

export interface CertificationAccount {
  role: MissionRole;
  email: string;
  name: string;
  password: string;
}

/**
 * The deterministic password `seedCertificationAccounts()` assigns when the
 * operator does not pass a `password` override
 * (`opts.password ?? \`Cert!${runIdShort}Aa1\`` in the seed script). If the
 * seeding run used `CERTIFICATION_PASSWORD` (or a custom `--password`
 * equivalent) to override it, set the SAME value here via
 * `CERTIFICATION_PASSWORD` so this suite can log in.
 */
export function certificationPassword(runIdShort: string): string {
  return process.env.CERTIFICATION_PASSWORD ?? `Cert!${runIdShort}Aa1`;
}

/**
 * Derive the exact account shape (email/name) + password for a mission role,
 * matching byte-for-byte what `scripts/seed-certification-accounts.ts`
 * created for the same run id. Returns undefined if no run id is configured
 * (`CERTIFICATION_RUN_ID` / `CERTIFICATION_RUN_ID_SHORT`) — callers should
 * treat that as "cannot target an account" and fail loudly, not guess.
 */
export function certificationAccountFor(role: MissionRole, seq = 1): CertificationAccount | undefined {
  const runIdShort = certificationRunIdShort();
  if (!runIdShort) return undefined;
  const shape = buildAccountShape(runIdShort, role, seq);
  return {
    role: shape.role,
    email: shape.email,
    name: shape.name,
    password: certificationPassword(runIdShort),
  };
}

export function roleDef(role: MissionRole): RoleDef {
  const def = MISSION_ROLES.find((r) => r.role === role);
  if (!def) throw new Error(`Unknown mission role: ${role}`);
  return def;
}

// ─── Login helper ───────────────────────────────────────────────────────

/**
 * Drive the real /login form as a seeded certification account. Login on
 * this app is role-agnostic at the form level (email + password only —
 * role tabs on AuthScreen only apply to SIGNUP); the resulting redirect
 * destination is what each spec asserts on to prove (or document the
 * absence of) a role's dedicated portal.
 *
 * Throws (does not skip) if no run id is configured — a spec reaching this
 * point already passed the `certificationSuiteEnabled()` gate, so a missing
 * run id is a real configuration error the operator must fix, not something
 * to silently paper over.
 */
export async function loginAsCertificationAccount(
  page: Page,
  role: MissionRole,
  seq = 1,
): Promise<CertificationAccount> {
  const account = certificationAccountFor(role, seq);
  if (!account) {
    throw new Error(
      'No certification run id configured. Set CERTIFICATION_RUN_ID (the full UUID printed by ' +
        'scripts/seed-certification-accounts.ts at the start of its run) or ' +
        'CERTIFICATION_RUN_ID_SHORT before running this suite.',
    );
  }
  await page.goto('/login');
  await page.getByLabel(/^email/i).fill(account.email);
  await page.getByLabel('Password', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: /^log in$|^sign in$/i }).click();
  return account;
}
