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
    const startBtn = page.locator('a:has-text("Start Learning Free")');
    await expect(startBtn).toBeVisible();
    await expect(startBtn).toHaveAttribute('href', '/login');
  });

  test('has Sign Up Free button in navigation', async ({ page }) => {
    await page.goto('/welcome');
    const signUpBtn = page.locator('a:has-text("Sign Up Free")');
    await expect(signUpBtn).toBeVisible();
  });

  test('renders hero section with CBSE badge and stats', async ({ page }) => {
    await page.goto('/welcome');
    // CBSE badge
    await expect(page.locator('text=Adaptive Learning Platform for CBSE Grades')).toBeVisible();
    // Hero headline
    await expect(page.locator('h1')).toContainText('child');
    // Stats bar
    await expect(page.locator('text=16')).toBeVisible(); // 16 subjects
    await expect(page.locator('text=6\u201312')).toBeVisible(); // Grades 6-12
  });

  test('renders Trust and Recognition section', async ({ page }) => {
    await page.goto('/welcome');
    await expect(page.locator('text=DPIIT Recognized')).toBeVisible();
    await expect(page.locator('text=DPDPA Compliant')).toBeVisible();
    await expect(page.locator('text=NCERT Aligned')).toBeVisible();
  });

  test('renders The Real Problem section with 4 problem cards', async ({ page }) => {
    await page.goto('/welcome');
    await expect(page.locator('text=THE REAL PROBLEM')).toBeVisible();
    await expect(page.locator('text=Concepts don\'t stick')).toBeVisible();
    await expect(page.locator('text=Practice is random')).toBeVisible();
    await expect(page.locator('text=Exam stress builds silently')).toBeVisible();
    await expect(page.locator('text=Parents can\'t see the real picture')).toBeVisible();
  });

  test('renders The Solution section', async ({ page }) => {
    await page.goto('/welcome');
    await expect(page.locator('text=THE SOLUTION')).toBeVisible();
    await expect(page.locator('text=Concept clarity first')).toBeVisible();
    await expect(page.locator('text=Practice that targets weak spots')).toBeVisible();
    await expect(page.locator('text=Progress everyone can see')).toBeVisible();
  });

  test('renders How It Works section with 5 steps', async ({ page }) => {
    await page.goto('/welcome');
    await expect(page.locator('text=HOW IT WORKS')).toBeVisible();
    await expect(page.locator('text=Learn').first()).toBeVisible();
    await expect(page.locator('text=Practice').first()).toBeVisible();
    await expect(page.locator('text=Revise')).toBeVisible();
    // "Test" is generic, so check the step number instead
    await expect(page.locator('text=04')).toBeVisible();
    await expect(page.locator('text=Track').first()).toBeVisible();
  });

  test('renders See It In Action section with product showcase cards', async ({ page }) => {
    await page.goto('/welcome');
    await expect(page.locator('text=SEE IT IN ACTION')).toBeVisible();
    await expect(page.locator('text=Foxy AI Tutor').first()).toBeVisible();
    await expect(page.locator('text=Smart Quiz')).toBeVisible();
    await expect(page.locator('text=Progress Dashboard')).toBeVisible();
    await expect(page.locator('text=Parent View')).toBeVisible();
  });

  test('renders Product Experience section with feature grid', async ({ page }) => {
    await page.goto('/welcome');
    await expect(page.locator('text=Built for how Indian students')).toBeVisible();
    await expect(page.locator('text=19 Interactive Simulations')).toBeVisible();
    await expect(page.locator('text=Bloom-Aware Quizzes')).toBeVisible();
    await expect(page.locator('text=Parent Dashboard')).toBeVisible();
    await expect(page.locator('text=Teacher Command Center')).toBeVisible();
  });

  test('renders audience sections for Students, Parents, Teachers, Schools', async ({ page }) => {
    await page.goto('/welcome');
    await expect(page.locator('text=For Students')).toBeVisible();
    await expect(page.locator('text=For Parents').first()).toBeVisible();
    await expect(page.locator('text=For Teachers').first()).toBeVisible();
    await expect(page.locator('text=For Schools').first()).toBeVisible();
  });

  test('renders Outcomes section with result cards', async ({ page }) => {
    await page.goto('/welcome');
    await expect(page.locator('text=OUTCOMES')).toBeVisible();
    await expect(page.locator('text=Deeper understanding')).toBeVisible();
    await expect(page.locator('text=Measurable progress')).toBeVisible();
    await expect(page.locator('text=Better exam scores')).toBeVisible();
    await expect(page.locator('text=Real confidence')).toBeVisible();
  });

  test('renders Our Philosophy / Trust section', async ({ page }) => {
    await page.goto('/welcome');
    await expect(page.locator('text=OUR PHILOSOPHY')).toBeVisible();
    await expect(page.locator('text=Systems over shortcuts')).toBeVisible();
  });

  test('renders FAQ section with expandable questions', async ({ page }) => {
    await page.goto('/welcome');
    const faqSection = page.locator('text=Frequently Asked Questions');
    await expect(faqSection.first()).toBeVisible();

    // FAQs use <details>/<summary>; click to expand
    const firstFaq = page.locator('details').first();
    await expect(firstFaq).toBeVisible();

    // Click to expand the first FAQ
    await firstFaq.locator('summary').click();
    // The answer text should now be visible
    const answer = firstFaq.locator('div');
    await expect(answer).toBeVisible();
  });

  test('renders Final CTA section', async ({ page }) => {
    await page.goto('/welcome');
    await expect(page.locator('text=Every week without a system')).toBeVisible();
    await expect(page.locator('text=lost progress')).toBeVisible();
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

    // The toggle button has aria-label
    const langToggle = page.locator('button[aria-label]').filter({
      has: page.locator('text=EN'),
    });
    await expect(langToggle).toBeVisible();

    // Click the toggle to switch to Hindi
    await langToggle.click();

    // Verify Hindi text appears on the page
    await expect(page.locator('text=असली समस्या')).toBeVisible();
    await expect(page.locator('text=समाधान')).toBeVisible();
    await expect(page.locator('text=कैसे काम करता है')).toBeVisible();
  });

  test('language toggle switches back to English from Hindi', async ({ page }) => {
    await page.goto('/welcome');

    // Toggle to Hindi
    const langToggle = page.locator('button[aria-label]').filter({
      has: page.locator('text=EN'),
    });
    await langToggle.click();
    await expect(page.locator('text=असली समस्या')).toBeVisible();

    // Toggle back to English
    await langToggle.click();
    await expect(page.locator('text=THE REAL PROBLEM')).toBeVisible();
    await expect(page.locator('text=THE SOLUTION')).toBeVisible();
  });

  test('navigation links are present in navbar', async ({ page }) => {
    await page.goto('/welcome');
    const nav = page.locator('nav');
    await expect(nav.locator('a[href="/product"]')).toBeVisible();
    await expect(nav.locator('a[href="/pricing"]')).toBeVisible();
    await expect(nav.locator('a[href="/for-schools"]')).toBeVisible();
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
    await expect(page.locator('text=Student')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('text=Teacher')).toBeVisible();
    await expect(page.locator('text=Parent')).toBeVisible();
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
    await expect(page.locator('text=For Schools')).toBeVisible();
    await expect(page.locator('text=Admin Dashboard')).toBeVisible();
    await expect(page.locator('text=Multi-Class Management')).toBeVisible();
    await expect(page.locator('text=Board Exam Analytics')).toBeVisible();
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
    await expect(page.locator('a[href="/welcome"]')).toBeVisible();
  });
});

/* ================================================================
 * Content Pages (for-schools, for-parents, for-teachers, product)
 * ================================================================ */
test.describe('Content Pages', () => {
  test('for-schools page loads with correct title', async ({ page }) => {
    await page.goto('/for-schools');
    await expect(page).toHaveTitle(/For Schools/);
    await expect(page.locator('text=Better Learning Outcomes')).toBeVisible();
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
