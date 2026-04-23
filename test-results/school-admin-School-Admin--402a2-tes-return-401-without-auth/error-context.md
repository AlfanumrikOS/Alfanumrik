# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: school-admin.spec.ts >> School Admin API — Health >> school admin API routes return 401 without auth
- Location: e2e\school-admin.spec.ts:88:7

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: false
Received: undefined
```

# Test source

```ts
  1   | import { test, expect } from '@playwright/test';
  2   | 
  3   | /**
  4   |  * E2E Tests — School Admin Portal
  5   |  *
  6   |  * Verifies:
  7   |  *   - Unauthenticated access to /school-admin redirects to /login
  8   |  *   - /schools landing page loads with pricing
  9   |  *   - Trial signup form validates required fields
  10  |  *   - Unknown B2B subdomain shows appropriate error
  11  |  *
  12  |  * Run: npx playwright test e2e/school-admin.spec.ts
  13  |  */
  14  | 
  15  | test.describe('School Admin Portal — Auth Guards', () => {
  16  |   test('redirects unauthenticated users from /school-admin to login', async ({ page }) => {
  17  |     await page.goto('/school-admin');
  18  |     // Should redirect to /login (middleware intercepts unauthenticated access)
  19  |     await expect(page).toHaveURL(/\/login/);
  20  |   });
  21  | 
  22  |   test('redirects unauthenticated users from /school-admin/teachers to login', async ({ page }) => {
  23  |     await page.goto('/school-admin/teachers');
  24  |     await expect(page).toHaveURL(/\/login/);
  25  |   });
  26  | 
  27  |   test('redirects unauthenticated users from /school-admin/students to login', async ({ page }) => {
  28  |     await page.goto('/school-admin/students');
  29  |     await expect(page).toHaveURL(/\/login/);
  30  |   });
  31  | 
  32  |   test('redirects unauthenticated users from /school-admin/classes to login', async ({ page }) => {
  33  |     await page.goto('/school-admin/classes');
  34  |     await expect(page).toHaveURL(/\/login/);
  35  |   });
  36  | 
  37  |   test('redirects unauthenticated users from /school-admin/billing to login', async ({ page }) => {
  38  |     await page.goto('/school-admin/billing');
  39  |     await expect(page).toHaveURL(/\/login/);
  40  |   });
  41  | });
  42  | 
  43  | test.describe('Schools Landing Page', () => {
  44  |   test('loads /schools page with visible heading', async ({ page }) => {
  45  |     await page.goto('/schools');
  46  |     await expect(page.locator('h1')).toBeVisible();
  47  |   });
  48  | 
  49  |   test('shows pricing section with INR amount', async ({ page }) => {
  50  |     await page.goto('/schools');
  51  |     // Pricing should mention per-student amount (75 INR from B2B pricing)
  52  |     await expect(page.getByText('75')).toBeVisible();
  53  |   });
  54  | 
  55  |   test('has a trial signup or contact form', async ({ page }) => {
  56  |     await page.goto('/schools');
  57  |     // Should have either a "Start Free Trial" button or a contact form
  58  |     const trialButton = page.getByRole('button', { name: /Start Free Trial|Free Trial|Trial|Contact|शुरू करें/i });
  59  |     const contactForm = page.locator('form');
  60  |     // At least one should be visible
  61  |     const hasTrialButton = await trialButton.isVisible().catch(() => false);
  62  |     const hasContactForm = await contactForm.isVisible().catch(() => false);
  63  |     expect(hasTrialButton || hasContactForm).toBe(true);
  64  |   });
  65  | 
  66  |   test('trial signup form validates required fields when submitted empty', async ({ page }) => {
  67  |     await page.goto('/schools');
  68  | 
  69  |     // Look for a submit button related to trial/contact
  70  |     const submitButton = page.getByRole('button', { name: /Start Free Trial|Submit|शुरू करें|संपर्क/i });
  71  |     const isVisible = await submitButton.isVisible().catch(() => false);
  72  | 
  73  |     if (isVisible) {
  74  |       await submitButton.click();
  75  |       // Should show a validation error for required fields
  76  |       // This could be HTML5 validation or custom error messages
  77  |       const errorVisible = await page.getByText(/required|आवश्यक|please|कृपया/i).isVisible().catch(() => false);
  78  |       const invalidInput = await page.locator('input:invalid').count().catch(() => 0);
  79  |       expect(errorVisible || invalidInput > 0).toBe(true);
  80  |     } else {
  81  |       // If no submit button, the page structure may differ — skip gracefully
  82  |       test.skip(true, 'No trial signup form found on /schools');
  83  |     }
  84  |   });
  85  | });
  86  | 
  87  | test.describe('School Admin API — Health', () => {
  88  |   test('school admin API routes return 401 without auth', async ({ request }) => {
  89  |     // Test that the school admin API routes reject unauthenticated requests
  90  |     const routes = [
  91  |       '/api/school-admin/classes',
  92  |       '/api/school-admin/reports?type=school_overview',
  93  |       '/api/school-admin/content',
  94  |     ];
  95  | 
  96  |     for (const route of routes) {
  97  |       const response = await request.get(route);
  98  |       // Should be 401 (unauthorized) not 500 (server error)
  99  |       expect(response.status()).toBe(401);
  100 |       const body = await response.json();
> 101 |       expect(body.success).toBe(false);
      |                            ^ Error: expect(received).toBe(expected) // Object.is equality
  102 |     }
  103 |   });
  104 | });
  105 | 
  106 | test.describe('Unknown Subdomain', () => {
  107 |   test('unknown B2B subdomain shows error or redirects', async ({ page }) => {
  108 |     // This test requires wildcard DNS — skip in environments without it
  109 |     test.skip(
  110 |       !process.env.TEST_WILDCARD_DNS,
  111 |       'Wildcard DNS not configured — skipping subdomain test'
  112 |     );
  113 | 
  114 |     await page.goto('https://nonexistent-school-xyz.alfanumrik.com');
  115 |     // Should show a "School Not Found" message or redirect to main site
  116 |     const notFoundVisible = await page.getByText(/School Not Found|not found/i).isVisible().catch(() => false);
  117 |     const redirectedToMain = page.url().includes('alfanumrik.com') && !page.url().includes('nonexistent');
  118 |     expect(notFoundVisible || redirectedToMain).toBe(true);
  119 |   });
  120 | });
  121 | 
```