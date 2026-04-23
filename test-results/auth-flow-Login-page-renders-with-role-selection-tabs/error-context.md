# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: auth-flow.spec.ts >> Login page >> renders with role selection tabs
- Location: e2e\auth-flow.spec.ts:12:7

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: locator('button:has-text("Parent")')
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for locator('button:has-text("Parent")')
    - waiting for" http://localhost:3000/login" navigation to finish...
    - navigated to "http://localhost:3000/login"

```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - link "Skip to content" [ref=e2] [cursor=pointer]:
    - /url: "#main-content"
  - generic [ref=e6]:
    - generic [ref=e7]:
      - generic [ref=e8]: 🦊
      - heading "Alfanumrik" [level=1] [ref=e9]
      - paragraph [ref=e10]: AI Tutor for CBSE Students
      - generic [ref=e11]:
        - generic [ref=e12]: CBSE Grades 6-12
        - generic [ref=e13]: Hindi & English
        - generic [ref=e14]: AI-Powered Adaptive
    - tablist "Account type" [ref=e15]:
      - tab "Student" [selected] [ref=e16] [cursor=pointer]: 🎓Student
      - tab "Teacher" [ref=e17] [cursor=pointer]: 👩‍🏫Teacher
      - tab "Parent" [ref=e18] [cursor=pointer]: 👨‍👩‍👧Parent
      - tab "School" [ref=e19] [cursor=pointer]: 🏫School
    - generic [ref=e20]:
      - heading "Welcome Back!" [level=2] [ref=e21]
      - generic [ref=e22]:
        - textbox "Email address" [ref=e23]
        - generic [ref=e24]:
          - textbox "Password" [ref=e25]:
            - /placeholder: Password (min 8 chars, A-z, 0-9)
          - button "Show password" [ref=e26] [cursor=pointer]: 👁️
        - button "Log In" [ref=e27] [cursor=pointer]
      - button "Forgot password?" [ref=e28] [cursor=pointer]
      - generic [ref=e30]:
        - text: New here?
        - button "Create Account" [ref=e31] [cursor=pointer]
    - generic [ref=e32]:
      - generic [ref=e33]:
        - generic [ref=e34]: 🛡️ Safe & Secure
        - generic [ref=e35]: 🇮🇳 Made in India
        - generic [ref=e36]: 🔒 No Ads
      - paragraph [ref=e37]:
        - text: By signing up, you agree to our
        - link "Terms" [ref=e38] [cursor=pointer]:
          - /url: /terms
        - text: "&"
        - link "Privacy Policy" [ref=e39] [cursor=pointer]:
          - /url: /privacy
      - paragraph [ref=e40]: © 2026 Cusiosense Learning India Pvt. Ltd.
```

# Test source

```ts
  1  | import { test, expect } from '@playwright/test';
  2  | 
  3  | /**
  4  |  * E2E Auth Flow Tests -- Verify authentication-related page behavior
  5  |  * for unauthenticated users: login rendering, role selection, redirect
  6  |  * guards on protected routes, and public page accessibility.
  7  |  *
  8  |  * Run: npx playwright test e2e/auth-flow.spec.ts
  9  |  */
  10 | 
  11 | test.describe('Login page', () => {
  12 |   test('renders with role selection tabs', async ({ page }) => {
  13 |     await page.goto('/login');
  14 |     await expect(page.locator('text=Welcome Back')).toBeVisible({ timeout: 10_000 });
  15 |     await expect(page.locator('button:has-text("Student")')).toBeVisible();
  16 |     await expect(page.locator('button:has-text("Teacher")')).toBeVisible();
> 17 |     await expect(page.locator('button:has-text("Parent")')).toBeVisible();
     |                                                             ^ Error: expect(locator).toBeVisible() failed
  18 |   });
  19 | 
  20 |   test('defaults to Student role tab', async ({ page }) => {
  21 |     await page.goto('/login');
  22 |     const studentTab = page.locator('button:has-text("Student")');
  23 |     await expect(studentTab).toBeVisible({ timeout: 10_000 });
  24 |   });
  25 | 
  26 |   test('has email input field', async ({ page }) => {
  27 |     await page.goto('/login');
  28 |     await expect(page.locator('input[type="email"]')).toBeVisible({ timeout: 10_000 });
  29 |   });
  30 | });
  31 | 
  32 | test.describe('Welcome page (unauthenticated)', () => {
  33 |   test('renders for unauthenticated users with hero content', async ({ page }) => {
  34 |     const response = await page.goto('/welcome');
  35 |     expect(response?.status()).toBe(200);
  36 |     await expect(page.locator('h1')).toBeVisible();
  37 |     await expect(page.locator('a:has-text("Start Learning Free")')).toBeVisible();
  38 |   });
  39 | });
  40 | 
  41 | test.describe('Protected route redirects', () => {
  42 |   test('/dashboard redirects unauthenticated to /login or /welcome', async ({ page }) => {
  43 |     await page.goto('/dashboard');
  44 |     await page.waitForURL(/\/(welcome|login)/, { timeout: 10_000 });
  45 |     const url = page.url();
  46 |     expect(url.includes('/welcome') || url.includes('/login')).toBe(true);
  47 |   });
  48 | 
  49 |   test('/super-admin shows login page for unauthenticated users', async ({ page }) => {
  50 |     await page.goto('/super-admin');
  51 |     await page.waitForLoadState('networkidle');
  52 |     // Super admin should either redirect to login or show its own auth gate
  53 |     const body = await page.locator('body').textContent();
  54 |     expect(body).toBeTruthy();
  55 |     // Page should not show admin content without auth
  56 |     const url = page.url();
  57 |     const hasAuthGate = url.includes('/login') ||
  58 |       url.includes('/welcome') ||
  59 |       url.includes('/super-admin');
  60 |     expect(hasAuthGate).toBe(true);
  61 |   });
  62 | });
  63 | 
  64 | test.describe('Public pages accessible without auth', () => {
  65 |   test('/pricing renders pricing cards without auth', async ({ page }) => {
  66 |     const response = await page.goto('/pricing');
  67 |     expect(response?.status()).toBe(200);
  68 |     await expect(page.locator('h1')).toBeVisible();
  69 |     await expect(page.locator('text=Simple, Transparent Pricing')).toBeVisible();
  70 |   });
  71 | 
  72 |   test('/help renders help content without auth', async ({ page }) => {
  73 |     const response = await page.goto('/help');
  74 |     expect(response?.status()).toBe(200);
  75 |     // Help page should have meaningful content
  76 |     const body = await page.locator('body').textContent();
  77 |     expect(body!.length).toBeGreaterThan(100);
  78 |   });
  79 | });
  80 | 
```