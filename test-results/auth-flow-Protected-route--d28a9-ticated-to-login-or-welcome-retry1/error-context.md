# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: auth-flow.spec.ts >> Protected route redirects >> /dashboard redirects unauthenticated to /login or /welcome
- Location: e2e\auth-flow.spec.ts:42:7

# Error details

```
TimeoutError: page.waitForURL: Timeout 10000ms exceeded.
=========================== logs ===========================
waiting for navigation until "load"
  navigated to "http://localhost:3000/dashboard"
  navigated to "http://localhost:3000/dashboard"
============================================================
```

# Page snapshot

```yaml
- generic [ref=e1]:
  - generic [active]:
    - generic [ref=e4]:
      - generic [ref=e5]:
        - generic [ref=e6]:
          - navigation [ref=e7]:
            - button "previous" [disabled] [ref=e8]:
              - img "previous" [ref=e9]
            - generic [ref=e11]:
              - generic [ref=e12]: 1/
              - text: "2"
            - button "next" [ref=e13] [cursor=pointer]:
              - img "next" [ref=e14]
          - img
        - generic [ref=e16]:
          - link "Next.js 16.2.3 (stale) Webpack" [ref=e17] [cursor=pointer]:
            - /url: https://nextjs.org/docs/messages/version-staleness
            - img [ref=e18]
            - generic "There is a newer version (16.2.4) available, upgrade recommended!" [ref=e20]: Next.js 16.2.3 (stale)
            - generic [ref=e21]: Webpack
          - img
      - dialog "Console Error" [ref=e23]:
        - generic [ref=e26]:
          - generic [ref=e27]:
            - generic [ref=e28]:
              - generic [ref=e30]: Console Error
              - generic [ref=e31]:
                - button "Copy Error Info" [ref=e32] [cursor=pointer]:
                  - img [ref=e33]
                - button "No related documentation found" [disabled] [ref=e35]:
                  - img [ref=e36]
                - button "Attach Node.js inspector" [ref=e38] [cursor=pointer]:
                  - img [ref=e39]
            - generic [ref=e48]: Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY
          - generic [ref=e49]:
            - generic [ref=e50]:
              - paragraph [ref=e52]:
                - img [ref=e54]
                - generic [ref=e58]: src\lib\supabase-client.ts (30:11) @ getSupabaseClient
                - button "Open in editor" [ref=e59] [cursor=pointer]:
                  - img [ref=e61]
              - generic [ref=e64]:
                - generic [ref=e65]: 28 | if (_supabase) return _supabase;
                - generic [ref=e66]: "29 | if (!supabaseUrl || !supabaseAnonKey) {"
                - generic [ref=e67]: "> 30 | throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY');"
                - generic [ref=e68]: "| ^"
                - generic [ref=e69]: "31 | }"
                - generic [ref=e70]: "32 | _supabase = createClient(supabaseUrl, supabaseAnonKey, {"
                - generic [ref=e71]: "33 | auth: {"
            - generic [ref=e72]:
              - generic [ref=e73]:
                - paragraph [ref=e74]:
                  - text: Call Stack
                  - generic [ref=e75]: "51"
                - button "Show 45 ignore-listed frame(s)" [ref=e76] [cursor=pointer]:
                  - text: Show 45 ignore-listed frame(s)
                  - img [ref=e77]
              - generic [ref=e79]:
                - generic [ref=e80]:
                  - text: getSupabaseClient
                  - button "Open getSupabaseClient in editor" [ref=e81] [cursor=pointer]:
                    - img [ref=e82]
                - text: src\lib\supabase-client.ts (30:11)
              - generic [ref=e84]:
                - generic [ref=e85]:
                  - text: Object.get
                  - button "Open Object.get in editor" [ref=e86] [cursor=pointer]:
                    - img [ref=e87]
                - text: src\lib\supabase-client.ts (48:20)
              - generic [ref=e89]:
                - generic [ref=e90]:
                  - text: AuthProvider.useCallback[fetchUser]
                  - button "Open AuthProvider.useCallback[fetchUser] in editor" [ref=e91] [cursor=pointer]:
                    - img [ref=e92]
                - text: src\lib\AuthContext.tsx (176:49)
              - generic [ref=e94]:
                - generic [ref=e95]:
                  - text: AuthProvider.useEffect.init
                  - button "Open AuthProvider.useEffect.init in editor" [ref=e96] [cursor=pointer]:
                    - img [ref=e97]
                - text: src\lib\AuthContext.tsx (433:13)
              - generic [ref=e99]:
                - generic [ref=e100]:
                  - text: AuthProvider.useEffect
                  - button "Open AuthProvider.useEffect in editor" [ref=e101] [cursor=pointer]:
                    - img [ref=e102]
                - text: src\lib\AuthContext.tsx (447:5)
              - generic [ref=e104]:
                - generic [ref=e105]:
                  - text: RootLayout
                  - button "Open RootLayout in editor" [ref=e106] [cursor=pointer]:
                    - img [ref=e107]
                - text: src\app\layout.tsx (86:11)
        - generic [ref=e109]: "1"
        - generic [ref=e110]: "2"
    - generic [ref=e115] [cursor=pointer]:
      - button "Open Next.js Dev Tools" [ref=e116]:
        - img [ref=e117]
      - generic [ref=e120]:
        - button "Open issues overlay" [ref=e121]:
          - generic [ref=e122]:
            - generic [ref=e123]: "1"
            - generic [ref=e124]: "2"
          - generic [ref=e125]:
            - text: Issue
            - generic [ref=e126]: s
        - button "Collapse issues badge" [ref=e127]:
          - img [ref=e128]
  - generic [ref=e130]:
    - img "Fox face" [ref=e131]: 🦊
    - heading "Something went wrong" [level=1] [ref=e132]
    - paragraph [ref=e133]: Foxy ran into a problem loading this page. Please try again.
    - generic [ref=e134]:
      - button "Try Again" [ref=e135] [cursor=pointer]
      - button "Go Home" [ref=e136] [cursor=pointer]
    - generic [ref=e137]: Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY
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
  17 |     await expect(page.locator('button:has-text("Parent")')).toBeVisible();
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
> 44 |     await page.waitForURL(/\/(welcome|login)/, { timeout: 10_000 });
     |                ^ TimeoutError: page.waitForURL: Timeout 10000ms exceeded.
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