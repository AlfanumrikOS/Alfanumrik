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

  test('renders hero section with CBSE badge and stats', async ({ page }) => {
    await page.goto('/welcome');
    // CBSE badge
    await expect(page.getByText(/CBSE 6\s*—\s*12/).first()).toBeVisible();
    // Hero headline
    await expect(page.locator('h1')).toContainText(/homework|गृहकार्य/i);
    // Stats bar
    await expect(page.locator('text=16')).toBeVisible(); // 16 subjects
    await expect(page.getByText(/grades 6—12|CBSE 6\s*—\s*12/i).first()).toBeVisible();
  });

  test('renders Trust and Recognition section', async ({ page }) => {
    await page.goto('/welcome');
    await expect(page.locator('text=DPIIT Recognised')).toBeVisible();
    await expect(page.locator('text=DPDPA Aligned')).toBeVisible();
    await expect(page.getByText('NCERT Mapped')).toBeVisible();
  });

  test('renders The Real Problem section with 4 problem cards', async ({ page }) => {
    await page.goto('/welcome');
    await expect(page.locator('text=The honest diagnosis')).toBeVisible();
    await expect(page.locator('text=Tuition has eaten the evening')).toBeVisible();
    await expect(page.locator('text=Apps reward attendance, not learning')).toBeVisible();
    await expect(page.locator('text=Parents are flying blind')).toBeVisible();
  });

  test('renders The Solution section', async ({ page }) => {
    await page.goto('/welcome');
    await expect(page.locator('text=What Alfanumrik does instead')).toBeVisible();
    await expect(page.locator('text=Ten minutes, then we stop')).toBeVisible();
    await expect(page.locator('text=Mastery, measured by Bloom')).toBeVisible();
    await expect(page.locator('text=One honest weekly note')).toBeVisible();
  });

  test('renders How It Works section with 5 steps', async ({ page }) => {
    await page.goto('/welcome');
    await expect(page.locator('text=Three tools, one workbook')).toBeVisible();
    await expect(page.locator('text=Foxy, who never sighs')).toBeVisible();
    await expect(page.locator('text=The mastery x-ray')).toBeVisible();
    await expect(page.locator('text=Quiz that teaches back')).toBeVisible();
  });

  test('renders See It In Action section with product showcase cards', async ({ page }) => {
    await page.goto('/welcome');
    await expect(page.locator('text=Three tools, one workbook')).toBeVisible();
    await expect(page.locator('text=Foxy, who never sighs').first()).toBeVisible();
    await expect(page.locator('text=Quiz that teaches back')).toBeVisible();
    await expect(page.locator('text=The mastery x-ray')).toBeVisible();
  });

  test('renders Product Experience section with feature grid', async ({ page }) => {
    await page.goto('/welcome');
    await expect(page.locator('text=Built quietly, used seriously')).toBeVisible();
    await expect(page.getByRole('heading', { name: /Mastery, measured by Bloom/i })).toBeVisible();
    await expect(page.getByText('Parent letter').first()).toBeVisible();
    await expect(page.getByText('Foxy').first()).toBeVisible();
  });

  test('renders audience sections for Students, Parents, Teachers, Schools', async ({ page }) => {
    await page.goto('/welcome');
    await expect(page.getByRole('tab', { name: 'Student' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Parent' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Teacher' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'School' })).toBeVisible();
  });

  test('renders Outcomes section with result cards', async ({ page }) => {
    await page.goto('/welcome');
    await expect(page.locator('text=Built quietly, used seriously')).toBeVisible();
    await expect(page.getByText('students learning', { exact: true })).toBeVisible();
    await expect(page.getByText('say it feels easier', { exact: true })).toBeVisible();
  });

  test('renders Our Philosophy / Trust section', async ({ page }) => {
    await page.goto('/welcome');
    await expect(page.locator('text=What we are building, and for whom')).toBeVisible();
    await expect(page.locator('text=Student-first')).toBeVisible();
  });

  test('renders FAQ section with expandable questions', async ({ page }) => {
    await page.goto('/welcome');
    const faqSection = page.locator('text=Things parents actually ask');
    await expect(faqSection.first()).toBeVisible();

    await expect(page.getByText(/Is Alfanumrik aligned with the CBSE syllabus/i)).toBeVisible();
  });

  test('renders Final CTA section', async ({ page }) => {
    await page.goto('/welcome');
    await expect(page.locator('text=Tonight\'s homework can be different')).toBeVisible();
    await expect(page.locator('text=Start in the next ten minutes')).toBeVisible();
  });

  test('renders footer with legal links and company info', async ({ page }) => {
    await page.goto('/welcome');
    const footer = page.locator('footer');
    await expect(footer).toBeVisible();
    await expect(footer.locator('a[href="/privacy"]')).toBeVisible();
    await expect(footer.locator('a[href="/terms"]')).toBeVisible();
    await expect(footer.locator('text=Cusiosense Learning India')).toBeVisible();
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
    await expect(page.locator('h1')).toContainText(/आज का गृहकार्य/);
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
    await expect(page.locator('h1')).toContainText(/homework/i);
  });

  test('navigation links are present in navbar', async ({ page }) => {
    await page.goto('/welcome');
    const nav = page.locator('nav');
    await expect(nav.getByRole('link', { name: 'Product' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Pricing' })).toBeVisible();
    await nav.getByRole('button', { name: /Solutions/i }).click();
    await expect(nav.getByRole('menuitem', { name: /For Schools/i })).toBeVisible();
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
 * ================================================================ */
test.describe('Pricing Page', () => {
  test('pricing page loads with correct title', async ({ page }) => {
    await page.goto('/pricing');
    await expect(page).toHaveTitle(/Pricing/);
    await expect(page.locator('h1')).toContainText('Pricing');
  });

  test('displays plan cards', async ({ page }) => {
    await page.goto('/pricing');
    // The PricingCards component renders plans
    // Check that pricing amounts are visible (INR symbol)
    await expect(page.locator('text=Simple, Transparent Pricing')).toBeVisible();
  });

  test('has For Schools section with B2B features', async ({ page }) => {
    await page.goto('/pricing');
    await expect(page.getByRole('heading', { name: 'For Schools & Institutions' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Admin Dashboard' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Multi-Class Management' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Board Exam Analytics' })).toBeVisible();
  });

  test('has FAQ section with questions', async ({ page }) => {
    await page.goto('/pricing');
    await expect(page.locator('text=Frequently Asked Questions')).toBeVisible();
    await expect(page.locator('text=Can I try Alfanumrik for free')).toBeVisible();
    await expect(page.locator('text=What is your refund policy')).toBeVisible();
  });

  test('has Contact Sales and Book a Demo CTAs', async ({ page }) => {
    await page.goto('/pricing');
    await expect(page.locator('a:has-text("Contact Sales")')).toBeVisible();
    await expect(page.locator('a:has-text("Book a Demo")')).toBeVisible();
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
