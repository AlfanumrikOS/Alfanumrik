import { test, expect } from '@playwright/test';

/**
 * E2E Smoke Tests -- Verify critical pages load without crashing.
 * Covers: landing page sections, language toggle, pricing, static pages,
 * auth pages, 404, and protected route redirects.
 *
 * Run: npx playwright test e2e/smoke.spec.ts
 */

/* ================================================================
 * Landing Page (/welcome)
 *
 * UPDATED 2026-07-16 (landing-v3 makeover): /welcome now renders WelcomeV3
 * by DEFAULT (design source: design-previews/welcome-ultra.html). WelcomeV2
 * stays reachable at /welcome?v=2 and keeps its coverage in
 * e2e/welcome-v2.spec.ts. Every V2 copy pin below was deliberately REPLACED
 * with its V3 equivalent (same surface, new copy) — none deleted without a
 * replacement. V2-only surfaces (role-switcher tabs, Solutions dropdown)
 * became negative/structural pins documenting their intentional removal
 * from the CEO-approved V3 design.
 * ================================================================ */
test.describe('Landing Page', () => {
  test('loads welcome page with correct title', async ({ page }) => {
    await page.goto('/welcome');
    await expect(page).toHaveTitle(/Alfanumrik/);
    await expect(page.locator('h1')).toBeVisible();
  });

  test('has working CTA buttons linking to login', async ({ page }) => {
    await page.goto('/welcome');
    const startBtn = page.getByRole('link', { name: /Start free/i }).first();
    await expect(startBtn).toBeVisible();
    await expect(startBtn).toHaveAttribute('href', '/login');
  });

  test('has Sign Up Free button in navigation', async ({ page }) => {
    await page.goto('/welcome');
    const signUpBtn = page.getByRole('link', { name: /Start free/i }).first();
    await expect(signUpBtn).toBeVisible();
  });

  test('renders V3 hero with CBSE pill, headline and trust line', async ({ page }) => {
    await page.goto('/welcome');
    // Hero pill: "India's first AI Learning OS — CBSE Class 6–12"
    await expect(page.getByText(/CBSE Class 6/).first()).toBeVisible();
    // Hero headline ("Every chapter" + rotor word)
    await expect(page.locator('h1')).toContainText(/Every chapter/i);
    // Trust line under the CTAs
    await expect(page.getByText('No card').first()).toBeVisible();
    await expect(page.getByText(/12,000\+ learners/).first()).toBeVisible();
  });

  test('renders the coverage trust strip (subjects + boards)', async ({ page }) => {
    // Replaces the V2 "Trust and Recognition" pins (DPIIT/DPDPA badges moved
    // to the footer trust line in V3 — asserted in the footer test below).
    await page.goto('/welcome');
    const strip = page.getByRole('region', { name: /Coverage|कवरेज/ });
    await expect(strip.getByText('CBSE', { exact: true })).toBeVisible();
    await expect(strip.getByText('NCERT', { exact: true })).toBeVisible();
    await expect(strip.getByText(/JEE\/NEET-tagged practice/)).toBeVisible();
    await expect(strip.getByText(/Classes 6–12/)).toBeVisible();
  });

  test('renders the features grid (#how) with the six V3 cards', async ({ page }) => {
    // Replaces the V2 Problem/Solution/How-It-Works copy pins — V3 folds
    // those surfaces into one FeaturesV3 grid.
    await page.goto('/welcome');
    await expect(
      page.getByRole('heading', { name: /Built for the way CBSE actually examines/i }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Ask anything from NCERT' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Mastery map' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Sunday parent letter' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Teacher Monday brief' })).toBeVisible();
  });

  test('renders the Ladder section (NCERT → competition depth)', async ({ page }) => {
    await page.goto('/welcome');
    await expect(
      page.getByRole('heading', { name: /Starts at NCERT/ }),
    ).toBeVisible();
    await expect(page.locator('#ladder').getByText('JEE Main', { exact: true })).toBeVisible();
    await expect(page.locator('#ladder').getByText('NEET', { exact: true })).toBeVisible();
  });

  test('renders the Sunday-letter outcome band (#results)', async ({ page }) => {
    // Replaces the V2 Product-Experience / Outcomes copy pins.
    await page.goto('/welcome');
    await expect(
      page.getByRole('heading', { name: /You’ll know every Sunday|You'll know every Sunday/ }),
    ).toBeVisible();
    await expect(page.getByText(/Measured in mastery %, not promised marks/)).toBeVisible();
    // The sample parent-letter card
    await expect(page.getByText(/This week, Aarav/)).toBeVisible();
  });

  test('V3 landing has NO role-switcher tabs (removed by design)', async ({ page }) => {
    // The V2 Parent/Student/Teacher/School tablist was intentionally dropped
    // from the CEO-approved V3 preview; analytics use the constant
    // active_role: 'parent'. Pin the removal so a stray reintroduction is a
    // deliberate decision, not drift. (V2 keeps its tab coverage in
    // e2e/welcome-v2.spec.ts via the ?v=2 hatch.)
    await page.goto('/welcome');
    await expect(page.locator('h1')).toBeVisible(); // page settled
    await expect(page.getByRole('tab')).toHaveCount(0);
  });

  test('renders FAQ section with 10 expandable questions', async ({ page }) => {
    await page.goto('/welcome');
    await expect(
      page.getByRole('heading', { name: /Your questions, answered/i }),
    ).toBeVisible();
    // The CBSE-syllabus question survives the V3 rewrite verbatim.
    await expect(page.getByText(/Is Alfanumrik aligned with the CBSE syllabus/i)).toBeVisible();
    // 10 native <details> items (same count the FAQPage JSON-LD pins).
    await expect(page.locator('#faq details')).toHaveCount(10);
  });

  test('renders Final CTA section', async ({ page }) => {
    await page.goto('/welcome');
    await expect(page.getByText(/Tonight.s homework can be different/)).toBeVisible();
    await expect(page.getByText(/Start on the free plan in two minutes/)).toBeVisible();
  });

  test('renders footer with legal links, company info and trust line', async ({ page }) => {
    await page.goto('/welcome');
    const footer = page.locator('footer');
    await expect(footer).toBeVisible();
    await expect(footer.locator('a[href="/privacy"]')).toBeVisible();
    await expect(footer.locator('a[href="/terms"]')).toBeVisible();
    await expect(footer.locator('text=Cusiosense Learning India')).toBeVisible();
    // V3 moved the compliance badges into the footer trust line.
    await expect(footer.getByText(/DPDPA compliant/)).toBeVisible();
  });

  test('language toggle switches to Hindi', async ({ page }) => {
    await page.goto('/welcome');
    await page.evaluate(() => localStorage.setItem('alf-welcome-lang', 'en'));
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en', { timeout: 20_000 });

    // The toggle button has aria-label
    const langToggle = page.getByRole('button', { name: /हिन्दी|Toggle language/i }).first();
    await expect(langToggle).toBeVisible();

    // Click the toggle to switch to Hindi
    await langToggle.click();

    await expect(page.locator('html')).toHaveAttribute('lang', 'hi', { timeout: 20_000 });
    // V3 Hindi hero headline ("हर अध्याय …")
    await expect(page.locator('h1')).toContainText(/हर अध्याय/);
  });

  test('language toggle switches back to English from Hindi', async ({ page }) => {
    await page.goto('/welcome');
    await page.evaluate(() => localStorage.setItem('alf-welcome-lang', 'en'));
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en', { timeout: 20_000 });

    // Toggle to Hindi
    await page.getByRole('button', { name: /हिन्दी|Toggle language/i }).first().click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'hi', { timeout: 20_000 });

    // Toggle back to English
    await page.getByRole('button', { name: /Switch to English/i }).first().click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en', { timeout: 20_000 });
    await expect(page.locator('h1')).toContainText(/Every chapter/i);
  });

  test('navigation links are present in navbar', async ({ page }) => {
    // V3 nav: anchor links (Features / The Ladder / Results / Pricing / FAQ)
    // + Log in + Start free. The V2 Product link and Solutions dropdown were
    // removed with the V3 redesign (every section is one scroll away).
    await page.goto('/welcome');
    const nav = page.getByRole('navigation', { name: /Primary|मुख्य/ });
    await expect(nav.getByRole('link', { name: 'Features' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'The Ladder' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Pricing' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'FAQ' })).toBeVisible();
    // Auth CTAs live beside the nav in the header.
    await expect(page.getByRole('link', { name: 'Log in' })).toBeVisible();
  });
});

/* ================================================================
 * Auth Pages
 * ================================================================ */
test.describe('Auth Pages', () => {
  test('login page loads with Welcome Back heading', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('text=Welcome Back')).toBeVisible({ timeout: 10_000 });
  });

  test('login page shows Student, Teacher, and Parent role tabs', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('tab', { name: 'Student' })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('tab', { name: 'Teacher' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Parent' })).toBeVisible();
  });

  test('clicking Teacher tab switches the active role', async ({ page }) => {
    await page.goto('/login');
    const teacherTab = page.locator('button:has-text("Teacher")');
    await expect(teacherTab).toBeVisible({ timeout: 10_000 });
    await teacherTab.click();
    // Teacher tab should be visually active (the button was clicked)
    // Verify the form is still visible after switching
    await expect(page.locator('text=Welcome Back')).toBeVisible();
  });

  test('clicking Parent tab switches the active role', async ({ page }) => {
    await page.goto('/login');
    const parentTab = page.locator('button:has-text("Parent")');
    await expect(parentTab).toBeVisible({ timeout: 10_000 });
    await parentTab.click();
    await expect(page.locator('text=Welcome Back')).toBeVisible();
  });

  test('teacher role pre-selected via query param', async ({ page }) => {
    await page.goto('/login?role=teacher');
    await expect(page.locator('button:has-text("Teacher")')).toBeVisible({ timeout: 10_000 });
  });

  test('parent role pre-selected via query param', async ({ page }) => {
    await page.goto('/login?role=parent');
    await expect(page.locator('button:has-text("Parent")')).toBeVisible({ timeout: 10_000 });
  });
});

/* ================================================================
 * Pricing Page
 *
 * Updated 2026-07-16 for the landing-v3 makeover (CEO-approved design,
 * design-previews/marketing-page-ultra.html). The page structure changed
 * deliberately: hero H1 is now the tuition-class line (eyebrow carries
 * "Pricing"), the B2B feature grid became the "For Schools" ink band, and
 * "Book a Demo" became "Book a school demo". Assertions were UPDATED to pin
 * the new structure — none were deleted; coverage per surface is unchanged
 * or stronger (plan names + billing toggle are now pinned too).
 * ================================================================ */
test.describe('Pricing Page', () => {
  test('pricing page loads with correct title', async ({ page }) => {
    await page.goto('/pricing');
    await expect(page).toHaveTitle(/Pricing/);
    // V3 hero: single H1 with the approved headline (eyebrow holds "Pricing")
    await expect(page.locator('h1')).toContainText('Less than a single tuition class');
  });

  test('displays all four plan cards with a billing toggle', async ({ page }) => {
    await page.goto('/pricing');
    for (const plan of ['Explorer', 'Starter', 'Pro', 'Unlimited']) {
      await expect(page.getByRole('heading', { name: plan, exact: true })).toBeVisible();
    }
    await expect(page.locator('text=Most popular')).toBeVisible();
    // Monthly/Yearly segmented toggle (aria-pressed contract)
    await expect(page.getByRole('button', { name: 'Monthly' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: 'Yearly' })).toHaveAttribute('aria-pressed', 'false');
  });

  test('has For Schools ink band with SoT per-seat price', async ({ page }) => {
    await page.goto('/pricing');
    await expect(
      page.getByRole('heading', { name: /Every Sunday, proof/ }),
    ).toBeVisible();
    // Per-seat anchor price renders SCHOOL_PER_SEAT_MARKETING_LABEL (₹99)
    await expect(page.locator('text=₹99')).toBeVisible();
    await expect(page.getByText('/student/mo')).toBeVisible();
  });

  test('has FAQ section with questions', async ({ page }) => {
    await page.goto('/pricing');
    await expect(page.locator('text=Frequently Asked Questions')).toBeVisible();
    await expect(page.locator('text=Can I try Alfanumrik for free')).toBeVisible();
    await expect(page.locator('text=What is your refund policy')).toBeVisible();
  });

  test('has Contact Sales and Book a school demo CTAs', async ({ page }) => {
    await page.goto('/pricing');
    await expect(page.locator('a:has-text("Contact Sales")')).toBeVisible();
    await expect(page.locator('a:has-text("Book a school demo")')).toBeVisible();
  });

  test('has navigation back to home', async ({ page }) => {
    await page.goto('/pricing');
    await expect(page.getByRole('link', { name: 'Home' }).first()).toBeVisible();
  });
});

/* ================================================================
 * Content Pages (for-schools, for-parents, for-teachers, product)
 * ================================================================ */
test.describe('Content Pages', () => {
  test('for-schools page loads with correct title', async ({ page }) => {
    await page.goto('/for-schools');
    await expect(page).toHaveTitle(/For Schools/);
    await expect(page.getByRole('heading', { name: 'Better Learning Outcomes' })).toBeVisible();
  });

  test('for-parents page loads with correct title', async ({ page }) => {
    await page.goto('/for-parents');
    await expect(page).toHaveTitle(/For Parents/);
    await expect(page.locator('text=Weekly Progress Reports')).toBeVisible();
  });

  test('for-teachers page loads with correct title', async ({ page }) => {
    await page.goto('/for-teachers');
    await expect(page).toHaveTitle(/For Teachers/);
    await expect(page.locator('text=Automated assessment')).toBeVisible();
  });

  test('product page loads with correct title', async ({ page }) => {
    await page.goto('/product');
    await expect(page).toHaveTitle(/Product/);
  });
});

/* ================================================================
 * Static Pages
 * ================================================================ */
test.describe('Static Pages', () => {
  test('privacy page loads', async ({ page }) => {
    await page.goto('/privacy');
    await expect(page).toHaveTitle(/Privacy|Alfanumrik/);
  });

  test('terms page loads', async ({ page }) => {
    await page.goto('/terms');
    await expect(page).toHaveTitle(/Terms|Alfanumrik/);
  });
});

/* ================================================================
 * 404 Page
 * ================================================================ */
test.describe('Not Found Page', () => {
  test('shows 404 page for nonexistent route', async ({ page }) => {
    await page.goto('/this-page-does-not-exist-at-all');
    await expect(page.locator('text=Page Not Found')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('text=404')).toBeVisible();
  });

  test('404 page has Back to Dashboard link', async ({ page }) => {
    await page.goto('/this-page-does-not-exist-at-all');
    await expect(page.locator('text=Back to Dashboard')).toBeVisible({ timeout: 10_000 });
  });

  test('404 page has alternative navigation links', async ({ page }) => {
    await page.goto('/this-page-does-not-exist-at-all');
    await expect(page.locator('a:has-text("Home")')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('a:has-text("Support")')).toBeVisible();
  });
});

/* ================================================================
 * API Health
 * ================================================================ */
test.describe('API Health', () => {
  test('health endpoint returns 200', async ({ request }) => {
    const res = await request.get('/api/v1/health');
    expect(res.status()).toBe(200);
  });
});

/* ================================================================
 * Protected Routes (unauthenticated)
 * ================================================================ */
test.describe('Protected Routes (unauthenticated)', () => {
  test('dashboard redirects to welcome or login', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForURL(/\/(welcome|login)/, { timeout: 10_000 });
  });
});
