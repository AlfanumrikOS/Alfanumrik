# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: public-pages.spec.ts >> Protected routes redirect unauthenticated users to login >> /profile redirects to login or welcome
- Location: e2e\public-pages.spec.ts:130:9

# Error details

```
TimeoutError: page.waitForURL: Timeout 10000ms exceeded.
=========================== logs ===========================
waiting for navigation until "load"
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
  33  |   for (const { path, label } of PUBLIC_PAGES) {
  34  |     test(`${label} (${path}) returns 200 and has content`, async ({ page }) => {
  35  |       const response = await page.goto(path);
  36  |       expect(response?.status()).toBe(200);
  37  | 
  38  |       // Page should not be empty -- must have meaningful body text
  39  |       const body = await page.locator('body').textContent();
  40  |       expect(body!.trim().length).toBeGreaterThan(50);
  41  | 
  42  |       // Page should have at least one heading or main content area
  43  |       const hasHeading = await page.locator('h1, h2, main').first().isVisible().catch(() => false);
  44  |       expect(hasHeading).toBe(true);
  45  |     });
  46  |   }
  47  | });
  48  | 
  49  | test.describe('Public pages render meaningful content (not just Loading...)', () => {
  50  |   for (const { path, label, mustContain } of PUBLIC_PAGES) {
  51  |     test(`${label} (${path}) is not stuck on loading state`, async ({ page }) => {
  52  |       await page.goto(path);
  53  | 
  54  |       // Wait for content to load (not just the initial shell)
  55  |       await page.waitForLoadState('domcontentloaded');
  56  | 
  57  |       const bodyText = await page.locator('body').textContent();
  58  |       expect(bodyText).toBeTruthy();
  59  |       expect(bodyText!.length).toBeGreaterThan(50);
  60  | 
  61  |       // Should not be stuck on loading
  62  |       const trimmed = bodyText!.trim();
  63  |       expect(trimmed).not.toBe('Loading...');
  64  |       expect(trimmed).not.toBe('Loading');
  65  | 
  66  |       // Should contain at least one expected content keyword
  67  |       const hasExpected = mustContain.some(text =>
  68  |         bodyText!.toLowerCase().includes(text.toLowerCase())
  69  |       );
  70  |       expect(hasExpected).toBe(true);
  71  |     });
  72  |   }
  73  | });
  74  | 
  75  | test.describe('Public pages have proper metadata', () => {
  76  |   test('/welcome has Alfanumrik in title', async ({ page }) => {
  77  |     await page.goto('/welcome');
  78  |     await expect(page).toHaveTitle(/Alfanumrik/);
  79  |   });
  80  | 
  81  |   test('/pricing has Pricing in title', async ({ page }) => {
  82  |     await page.goto('/pricing');
  83  |     await expect(page).toHaveTitle(/Pricing/);
  84  |   });
  85  | 
  86  |   test('/for-schools has For Schools in title', async ({ page }) => {
  87  |     await page.goto('/for-schools');
  88  |     await expect(page).toHaveTitle(/For Schools/);
  89  |   });
  90  | 
  91  |   test('/for-parents has For Parents in title', async ({ page }) => {
  92  |     await page.goto('/for-parents');
  93  |     await expect(page).toHaveTitle(/For Parents/);
  94  |   });
  95  | 
  96  |   test('/for-teachers has For Teachers in title', async ({ page }) => {
  97  |     await page.goto('/for-teachers');
  98  |     await expect(page).toHaveTitle(/For Teachers/);
  99  |   });
  100 | });
  101 | 
  102 | test.describe('Public pages have navigation', () => {
  103 |   test('public pages include footer with legal links', async ({ page }) => {
  104 |     await page.goto('/welcome');
  105 |     const footer = page.locator('footer');
  106 |     await expect(footer).toBeVisible();
  107 |     await expect(footer.locator('a[href="/privacy"]')).toBeVisible();
  108 |     await expect(footer.locator('a[href="/terms"]')).toBeVisible();
  109 |   });
  110 | });
  111 | 
  112 | /* ================================================================
  113 |  * Protected Routes Redirect (unauthenticated users)
  114 |  * Regression: redirect_unauthenticated -- all protected pages redirect to /login
  115 |  * ================================================================ */
  116 | test.describe('Protected routes redirect unauthenticated users to login', () => {
  117 |   const PROTECTED_ROUTES = [
  118 |     '/dashboard',
  119 |     '/quiz',
  120 |     '/profile',
  121 |     '/progress',
  122 |     '/foxy',
  123 |     '/billing',
  124 |     '/notifications',
  125 |     '/leaderboard',
  126 |     '/reports',
  127 |   ];
  128 | 
  129 |   for (const route of PROTECTED_ROUTES) {
  130 |     test(`${route} redirects to login or welcome`, async ({ page }) => {
  131 |       await page.goto(route);
  132 |       // Middleware redirects unauthenticated users to /welcome or /login
> 133 |       await page.waitForURL(/\/(welcome|login)/, { timeout: 10_000 });
      |                  ^ TimeoutError: page.waitForURL: Timeout 10000ms exceeded.
  134 |     });
  135 |   }
  136 | });
  137 | 
  138 | /* ================================================================
  139 |  * Admin Routes Protected
  140 |  * Regression: admin_secret_required
  141 |  * ================================================================ */
  142 | test.describe('Admin routes are protected', () => {
  143 |   test('/super-admin redirects to super-admin login', async ({ page }) => {
  144 |     await page.goto('/super-admin');
  145 |     // Should redirect to the super-admin login page, not the main app login
  146 |     await page.waitForURL(/\/super-admin\/login/, { timeout: 10_000 });
  147 |   });
  148 | });
  149 | 
```