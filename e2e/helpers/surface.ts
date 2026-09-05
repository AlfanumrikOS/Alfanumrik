import { expect, type Page } from '@playwright/test';
import { seedCookieConsent } from './auth';

/**
 * Shared helpers for authenticated surface walks.
 *
 * `assertNotBlank` was module-private in `e2e/navigation.spec.ts`; it is moved
 * here verbatim so the surface walk and the nav crawl enforce the *same*
 * contract rather than two drifting copies. navigation.spec.ts now imports it.
 *
 * `loginViaDevImpersonate` exists because neither existing auth helper fits an
 * all-roles walk: `mockStudentSession()` is mocked and student-only, and
 * `loginViaUI()` needs TEST_STUDENT_* credentials plus a Turnstile-clean
 * environment. Impersonation yields a real Supabase session for four roles
 * with no credentials at all.
 */

const COMING_SOON_RE = /coming\s+soon|जल्द|launching\s+soon|under\s+construction/i;
const NEXT_404_RE = /this page could not be found/i;
// Floor for "the page rendered something": low enough for sparse dashboards,
// high enough that a blank shell (header/footer only is ~0 chars in <main>)
// cannot pass.
const MIN_CONTENT_CHARS = 40;

// innerText() inherits Playwright's actionTimeout, which defaults to 0 (infinite).
// `.catch()` handles a rejection but NOT a hang, so an unbounded read here stalls
// the whole walk on a single busy page. Always pass an explicit timeout.
const READ_TIMEOUT_MS = 10_000;

export async function assertNotBlank(page: Page, path: string): Promise<void> {
  const bodyText = (
    (await page
      .locator('body')
      .innerText({ timeout: READ_TIMEOUT_MS })
      .catch(() => '')) || ''
  ).trim();
  expect(
    NEXT_404_RE.test(bodyText),
    `${path}: default Next.js 404 — a removed route must redirect or 410, never dead-end (Hard Rule: no ghost routes)`,
  ).toBe(false);
  const isComingSoon = COMING_SOON_RE.test(bodyText);
  const mainText = (
    (await page
      .locator('main')
      .innerText({ timeout: READ_TIMEOUT_MS })
      .catch(() => '')) || bodyText
  ).trim();
  expect(
    isComingSoon || mainText.length >= MIN_CONTENT_CHARS,
    `${path}: rendered ${mainText.length} chars with no explicit "coming soon" state — blank/dead-end page`,
  ).toBe(true);
}

export type ImpersonationRole = 'student' | 'teacher' | 'parent' | 'institution_admin';

/** Where each role lands after login (packages/lib/src/identity/constants.ts). */
export const ROLE_DESTINATION: Record<ImpersonationRole, string> = {
  student: '/dashboard',
  teacher: '/teacher',
  parent: '/parent',
  institution_admin: '/school-admin',
};

/**
 * Establish a REAL Supabase session for `role` via the dev-only impersonation
 * route. Returns false when the route is unavailable (it 404s whenever
 * NODE_ENV or VERCEL_ENV is 'production' — see apps/host/src/proxy.ts and the
 * route's own isProdLocked()), so callers can skip rather than fail.
 *
 * Note the route replies 303 to `<destination>#access_token=…`; the client
 * Supabase instance picks that up via detectSessionInUrl, so we must wait for
 * the destination rather than for the API URL itself.
 */
export async function loginViaDevImpersonate(page: Page, role: ImpersonationRole): Promise<boolean> {
  await seedCookieConsent(page);

  const probe = await page.request.get(`/api/dev/impersonate?role=${role}`, { maxRedirects: 0 });
  if (probe.status() === 404) return false;

  await page.goto(`/api/dev/impersonate?role=${role}`);
  try {
    await page.waitForURL((url) => url.pathname.startsWith(ROLE_DESTINATION[role]), {
      timeout: 30_000,
    });
  } catch {
    return false;
  }
  await page.waitForLoadState('domcontentloaded');
  return true;
}

/** Collect internal nav hrefs from the rendered shell for the current role. */
export async function discoverNavTargets(page: Page): Promise<string[]> {
  const hrefs: string[] = await page
    .locator('nav a[href], aside a[href], [role="navigation"] a[href]')
    .evaluateAll((els) =>
      els.map((el) => el.getAttribute('href') || '').filter((h) => h.startsWith('/') && !h.startsWith('//')),
    );
  return Array.from(new Set(hrefs.map((h) => h.split('#')[0].split('?')[0]))).filter(
    (h) => h !== '' && h !== '/logout',
  );
}

/** One row of the surface-walk ledger. */
export interface WalkResult {
  route: string;
  role: string;
  verdict: 'PASS' | 'BLANK' | 'NOT_FOUND' | 'ERROR';
  detail: string;
  consoleErrors: number;
}

/**
 * Visit `path`, capture console errors, and classify the result. Never throws —
 * the caller aggregates a ledger and asserts at the end, so one bad route does
 * not hide the other 140.
 */
export async function walkRoute(page: Page, path: string, role: string): Promise<WalkResult> {
  const errors: string[] = [];
  const onConsole = (msg: { type(): string; text(): string }) => {
    if (msg.type() === 'error') errors.push(msg.text());
  };
  page.on('console', onConsole as never);

  try {
    await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    // NOT networkidle: the dev server holds an HMR websocket open, so the page
    // never reaches idle and every route would burn the full timeout. Instead
    // wait for <main> to carry content, which is the thing we actually assert.
    await page
      .waitForFunction(
        () => {
          const m = document.querySelector('main');
          const t = ((m as HTMLElement | null)?.innerText || document.body.innerText || '').trim();
          return t.length >= 40 || /coming\s+soon|जल्द/i.test(t);
        },
        undefined,
        { timeout: 8_000 },
      )
      .catch(() => {});
    await assertNotBlank(page, path);
    return { route: path, role, verdict: 'PASS', detail: '', consoleErrors: errors.length };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const verdict: WalkResult['verdict'] = /could not be found/i.test(message)
      ? 'NOT_FOUND'
      : /blank\/dead-end|no explicit "coming soon"/i.test(message)
        ? 'BLANK'
        : 'ERROR';
    return {
      route: path,
      role,
      verdict,
      detail: message.split('\n')[0].slice(0, 200),
      consoleErrors: errors.length,
    };
  } finally {
    page.off('console', onConsole as never);
  }
}

/** Render the ledger as a fixed-width table for the test report. */
export function formatLedger(rows: WalkResult[]): string {
  const width = Math.max(...rows.map((r) => r.route.length), 10);
  const lines = rows.map(
    (r) =>
      `${r.route.padEnd(width)}  ${r.verdict.padEnd(9)}  errs=${String(r.consoleErrors).padEnd(3)}  ${r.detail}`,
  );
  const failed = rows.filter((r) => r.verdict !== 'PASS');
  return [
    `\n=== SURFACE WALK LEDGER (${rows.length} routes) ===`,
    ...lines,
    `--- ${rows.length - failed.length} PASS / ${failed.length} FAIL ---`,
  ].join('\n');
}
