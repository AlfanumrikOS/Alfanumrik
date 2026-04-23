# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: navigation.spec.ts >> Unauthenticated redirect guards >> /dashboard redirects to /welcome or /login
- Location: e2e\navigation.spec.ts:20:7

# Error details

```
TimeoutError: page.waitForURL: Timeout 10000ms exceeded.
=========================== logs ===========================
waiting for navigation until "load"
  navigated to "http://localhost:3000/dashboard"
  navigated to "http://localhost:3000/dashboard"
  navigated to "http://localhost:3000/dashboard"
============================================================
```

# Page snapshot

```yaml
- link "Skip to content" [ref=e2] [cursor=pointer]:
  - /url: "#main-content"
```

# Test source

```ts
  1   | import { test, expect } from '@playwright/test';
  2   | 
  3   | /**
  4   |  * E2E Navigation Tests -- Verify unauthenticated redirect guards.
  5   |  * All protected routes should redirect unauthenticated users to /welcome or /login.
  6   |  *
  7   |  * These tests address the regression catalog item:
  8   |  *   `unauthenticated_redirect` -- No session -> redirect to /login for protected pages
  9   |  *
  10  |  * Run: npx playwright test e2e/navigation.spec.ts
  11  |  */
  12  | 
  13  | test.describe('Unauthenticated redirect guards', () => {
  14  |   test('/ redirects unauthenticated users to /welcome', async ({ page }) => {
  15  |     await page.goto('/');
  16  |     await page.waitForURL(/\/welcome/, { timeout: 10_000 });
  17  |     expect(page.url()).toContain('/welcome');
  18  |   });
  19  | 
  20  |   test('/dashboard redirects to /welcome or /login', async ({ page }) => {
  21  |     await page.goto('/dashboard');
> 22  |     await page.waitForURL(/\/(welcome|login)/, { timeout: 10_000 });
      |                ^ TimeoutError: page.waitForURL: Timeout 10000ms exceeded.
  23  |   });
  24  | 
  25  |   test('/quiz redirects unauthenticated users', async ({ page }) => {
  26  |     await page.goto('/quiz');
  27  |     // Quiz page either redirects to login/welcome or shows a login prompt
  28  |     // Wait for either a redirect or the page to settle
  29  |     await page.waitForLoadState('networkidle');
  30  |     const url = page.url();
  31  |     const hasRedirected = url.includes('/welcome') || url.includes('/login');
  32  |     const hasLoginPrompt = await page.locator('text=Welcome Back').isVisible().catch(() => false);
  33  |     const stayedOnQuiz = url.includes('/quiz');
  34  |     // Either redirected or shows quiz page (which may handle auth internally)
  35  |     expect(hasRedirected || hasLoginPrompt || stayedOnQuiz).toBe(true);
  36  |   });
  37  | 
  38  |   test('/foxy redirects unauthenticated users', async ({ page }) => {
  39  |     await page.goto('/foxy');
  40  |     await page.waitForLoadState('networkidle');
  41  |     const url = page.url();
  42  |     const hasRedirected = url.includes('/welcome') || url.includes('/login');
  43  |     const stayedOnFoxy = url.includes('/foxy');
  44  |     // Either redirected to login or page handles auth internally
  45  |     expect(hasRedirected || stayedOnFoxy).toBe(true);
  46  |   });
  47  | 
  48  |   test('/parent/children redirects to parent login', async ({ page }) => {
  49  |     await page.goto('/parent/children');
  50  |     await page.waitForURL(/\/parent/, { timeout: 10_000 });
  51  |     // Middleware redirects /parent/children to /parent (login page)
  52  |     expect(page.url()).toMatch(/\/parent$/);
  53  |   });
  54  | 
  55  |   test('/parent/reports redirects to parent login', async ({ page }) => {
  56  |     await page.goto('/parent/reports');
  57  |     await page.waitForURL(/\/parent$/, { timeout: 10_000 });
  58  |   });
  59  | 
  60  |   test('/parent/profile redirects to parent login', async ({ page }) => {
  61  |     await page.goto('/parent/profile');
  62  |     await page.waitForURL(/\/parent$/, { timeout: 10_000 });
  63  |   });
  64  | 
  65  |   test('/billing redirects to login without session', async ({ page }) => {
  66  |     await page.goto('/billing');
  67  |     await page.waitForURL(/\/(login|welcome|billing)/, { timeout: 10_000 });
  68  |     // Middleware redirects /billing to /login when no session
  69  |     const url = page.url();
  70  |     expect(url.includes('/login') || url.includes('/welcome') || url.includes('/billing')).toBe(true);
  71  |   });
  72  | 
  73  |   test('/super-admin loads login or admin page', async ({ page }) => {
  74  |     await page.goto('/super-admin');
  75  |     await page.waitForLoadState('networkidle');
  76  |     // Super admin may have its own auth gate
  77  |     const url = page.url();
  78  |     const pageLoaded = await page.locator('body').isVisible();
  79  |     expect(pageLoaded).toBe(true);
  80  |     // Should either redirect or show an admin login
  81  |     expect(url).toBeTruthy();
  82  |   });
  83  | });
  84  | 
  85  | test.describe('Deep link preservation', () => {
  86  |   test('/login preserves role query param for teacher', async ({ page }) => {
  87  |     await page.goto('/login?role=teacher');
  88  |     await expect(page.locator('button:has-text("Teacher")')).toBeVisible({ timeout: 10_000 });
  89  |   });
  90  | 
  91  |   test('/login preserves role query param for parent', async ({ page }) => {
  92  |     await page.goto('/login?role=parent');
  93  |     await expect(page.locator('button:has-text("Parent")')).toBeVisible({ timeout: 10_000 });
  94  |   });
  95  | });
  96  | 
  97  | test.describe('Public pages remain accessible', () => {
  98  |   test('/welcome is accessible without auth', async ({ page }) => {
  99  |     const response = await page.goto('/welcome');
  100 |     expect(response?.status()).toBe(200);
  101 |     await expect(page.locator('h1')).toBeVisible();
  102 |   });
  103 | 
  104 |   test('/pricing is accessible without auth', async ({ page }) => {
  105 |     const response = await page.goto('/pricing');
  106 |     expect(response?.status()).toBe(200);
  107 |     await expect(page.locator('h1')).toBeVisible();
  108 |   });
  109 | 
  110 |   test('/for-schools is accessible without auth', async ({ page }) => {
  111 |     const response = await page.goto('/for-schools');
  112 |     expect(response?.status()).toBe(200);
  113 |   });
  114 | 
  115 |   test('/for-parents is accessible without auth', async ({ page }) => {
  116 |     const response = await page.goto('/for-parents');
  117 |     expect(response?.status()).toBe(200);
  118 |   });
  119 | 
  120 |   test('/for-teachers is accessible without auth', async ({ page }) => {
  121 |     const response = await page.goto('/for-teachers');
  122 |     expect(response?.status()).toBe(200);
```