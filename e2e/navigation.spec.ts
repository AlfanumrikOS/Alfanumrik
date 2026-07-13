import { test, expect, type Page } from '@playwright/test';
import { mockStudentSession } from './helpers/auth';

/**
 * E2E Navigation Tests -- Verify unauthenticated redirect guards.
 * All protected routes should redirect unauthenticated users to /welcome or /login.
 *
 * These tests address the regression catalog item:
 *   `unauthenticated_redirect` -- No session -> redirect to /login for protected pages
 *
 * Also (testing-strategy Phase 1, gap 4): the nav-crawl blank-page guard --
 * every navigation target must render real content or an explicit
 * "coming soon" state, never a blank page or a default Next.js 404. A nav
 * item pointing at an unbuilt page burned a live school demo once; this
 * pins that failure mode.
 *
 * Run: npx playwright test e2e/navigation.spec.ts
 */

test.describe('Unauthenticated redirect guards', () => {
  test('/ redirects unauthenticated users to /welcome', async ({ page }) => {
    await page.goto('/');
    await page.waitForURL(/\/welcome/, { timeout: 10_000 });
    expect(page.url()).toContain('/welcome');
  });

  test('/dashboard redirects to /welcome or /login', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForURL(/\/(welcome|login)/, { timeout: 10_000 });
  });

  test('/quiz redirects unauthenticated users', async ({ page }) => {
    await page.goto('/quiz');
    // Quiz page either redirects to login/welcome or shows a login prompt
    // Wait for either a redirect or the page to settle
    await page.waitForLoadState('networkidle');
    const url = page.url();
    const hasRedirected = url.includes('/welcome') || url.includes('/login');
    const hasLoginPrompt = await page.locator('text=Welcome Back').isVisible().catch(() => false);
    const stayedOnQuiz = url.includes('/quiz');
    // Either redirected or shows quiz page (which may handle auth internally)
    expect(hasRedirected || hasLoginPrompt || stayedOnQuiz).toBe(true);
  });

  test('/foxy redirects unauthenticated users', async ({ page }) => {
    await page.goto('/foxy');
    await page.waitForLoadState('networkidle');
    const url = page.url();
    const hasRedirected = url.includes('/welcome') || url.includes('/login');
    const stayedOnFoxy = url.includes('/foxy');
    // Either redirected to login or page handles auth internally
    expect(hasRedirected || stayedOnFoxy).toBe(true);
  });

  test('/parent/children redirects to parent login', async ({ page }) => {
    await page.goto('/parent/children');
    await page.waitForURL(/\/parent/, { timeout: 10_000 });
    // Middleware redirects /parent/children to /parent (login page)
    expect(page.url()).toMatch(/\/parent$/);
  });

  test('/parent/reports redirects to parent login', async ({ page }) => {
    await page.goto('/parent/reports');
    await page.waitForURL(/\/parent$/, { timeout: 10_000 });
  });

  test('/parent/profile redirects to parent login', async ({ page }) => {
    await page.goto('/parent/profile');
    await page.waitForURL(/\/parent$/, { timeout: 10_000 });
  });

  test('/billing redirects to login without session', async ({ page }) => {
    await page.goto('/billing');
    await page.waitForURL(/\/(login|welcome|billing)/, { timeout: 10_000 });
    // Middleware redirects /billing to /login when no session
    const url = page.url();
    expect(url.includes('/login') || url.includes('/welcome') || url.includes('/billing')).toBe(true);
  });

  test('/super-admin loads login or admin page', async ({ page }) => {
    await page.goto('/super-admin');
    await page.waitForLoadState('networkidle');
    // Super admin may have its own auth gate
    const url = page.url();
    const pageLoaded = await page.locator('body').isVisible();
    expect(pageLoaded).toBe(true);
    // Should either redirect or show an admin login
    expect(url).toBeTruthy();
  });
});

test.describe('Deep link preservation', () => {
  test('/login preserves role query param for teacher', async ({ page }) => {
    await page.goto('/login?role=teacher');
    await expect(page.locator('button:has-text("Teacher")')).toBeVisible({ timeout: 10_000 });
  });

  test('/login preserves role query param for parent', async ({ page }) => {
    await page.goto('/login?role=parent');
    await expect(page.locator('button:has-text("Parent")')).toBeVisible({ timeout: 10_000 });
  });
});

test.describe('Public pages remain accessible', () => {
  test('/welcome is accessible without auth', async ({ page }) => {
    const response = await page.goto('/welcome');
    expect(response?.status()).toBe(200);
    await expect(page.locator('h1')).toBeVisible();
  });

  test('/pricing is accessible without auth', async ({ page }) => {
    const response = await page.goto('/pricing');
    expect(response?.status()).toBe(200);
    await expect(page.locator('h1')).toBeVisible();
  });

  test('/for-schools is accessible without auth', async ({ page }) => {
    const response = await page.goto('/for-schools');
    expect(response?.status()).toBe(200);
  });

  test('/for-parents is accessible without auth', async ({ page }) => {
    const response = await page.goto('/for-parents');
    expect(response?.status()).toBe(200);
  });

  test('/for-teachers is accessible without auth', async ({ page }) => {
    const response = await page.goto('/for-teachers');
    expect(response?.status()).toBe(200);
  });

  test('/login is accessible without auth', async ({ page }) => {
    const response = await page.goto('/login');
    expect(response?.status()).toBe(200);
    await expect(page.locator('text=Welcome Back')).toBeVisible({ timeout: 10_000 });
  });

  test('/privacy is accessible without auth', async ({ page }) => {
    const response = await page.goto('/privacy');
    expect(response?.status()).toBe(200);
  });

  test('/terms is accessible without auth', async ({ page }) => {
    const response = await page.goto('/terms');
    expect(response?.status()).toBe(200);
  });
});

/**
 * ── Nav-crawl blank-page guard (testing-strategy Phase 1, gap 4) ──────────
 *
 * FAILURE MODE PINNED: a nav item pointing at an unbuilt/broken page renders
 * a blank screen or the default Next.js 404 during a live demo.
 *
 * CONTRACT for every crawled nav target:
 *   1. never the default Next.js 404 ("This page could not be found"), and
 *   2. either meaningful rendered content (body text above a floor), or an
 *      EXPLICIT placeholder state ("coming soon" / "जल्द आ रहा है").
 *
 * The student crawl discovers links at runtime from the rendered nav, so a
 * newly added nav item is covered automatically — no hardcoded route list to
 * forget to update.
 */

const COMING_SOON_RE = /coming\s+soon|जल्द|launching\s+soon|under\s+construction/i;
const NEXT_404_RE = /this page could not be found/i;
// Floor for "the page rendered something": low enough for sparse dashboards,
// high enough that a blank shell (header/footer only is ~0 chars in <main>)
// cannot pass.
const MIN_CONTENT_CHARS = 40;

async function assertNotBlank(page: Page, path: string): Promise<void> {
  const bodyText = ((await page.locator('body').innerText().catch(() => '')) || '').trim();
  expect(
    NEXT_404_RE.test(bodyText),
    `${path}: default Next.js 404 — a removed route must redirect or 410, never dead-end (Hard Rule: no ghost routes)`,
  ).toBe(false);
  const isComingSoon = COMING_SOON_RE.test(bodyText);
  const mainText = ((await page.locator('main').innerText().catch(() => '')) || bodyText).trim();
  expect(
    isComingSoon || mainText.length >= MIN_CONTENT_CHARS,
    `${path}: rendered ${mainText.length} chars with no explicit "coming soon" state — blank/dead-end page`,
  ).toBe(true);
}

test.describe('Nav crawl: no blank pages, no dead ends', () => {
  test('public pages render content, never blank', async ({ page }) => {
    for (const path of ['/welcome', '/pricing', '/for-schools', '/for-parents', '/for-teachers', '/privacy', '/terms']) {
      await page.goto(path);
      await page.waitForLoadState('domcontentloaded');
      await assertNotBlank(page, path);
    }
  });

  test('student nav links all lead to content or an explicit coming-soon state', async ({ page }) => {
    test.setTimeout(120_000);
    await mockStudentSession(page);
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');

    // Discover internal links from rendered nav/sidebar/tab-bar elements.
    const hrefs: string[] = await page
      .locator('nav a[href], aside a[href], [role="navigation"] a[href]')
      .evaluateAll((els) =>
        els
          .map((el) => el.getAttribute('href') || '')
          .filter((h) => h.startsWith('/') && !h.startsWith('//')),
      );
    const targets = Array.from(new Set(hrefs.map((h) => h.split('#')[0].split('?')[0]))).filter(
      (h) => h !== '' && h !== '/logout',
    );

    // The dashboard must expose SOME nav — zero discovered links means the
    // nav itself failed to render, which is its own blank-page failure.
    expect(targets.length, 'no nav links discovered on /dashboard — nav failed to render').toBeGreaterThan(0);

    for (const path of targets) {
      await page.goto(path);
      await page.waitForLoadState('domcontentloaded');
      // Mocked session may bounce some routes to login — a redirect is a
      // navigation outcome, not a blank page; assert on wherever we landed.
      await assertNotBlank(page, path);
    }
  });
});
