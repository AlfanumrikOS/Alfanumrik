# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: smoke.spec.ts >> Content Pages >> for-schools page loads with correct title
- Location: e2e\smoke.spec.ts:288:7

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: locator('text=Better Learning Outcomes')
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for locator('text=Better Learning Outcomes')

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
  191 |     await expect(nav.locator('a[href="/for-schools"]')).toBeVisible();
  192 |   });
  193 | });
  194 | 
  195 | /* ================================================================
  196 |  * Auth Pages
  197 |  * ================================================================ */
  198 | test.describe('Auth Pages', () => {
  199 |   test('login page loads with Welcome Back heading', async ({ page }) => {
  200 |     await page.goto('/login');
  201 |     await expect(page.locator('text=Welcome Back')).toBeVisible({ timeout: 10_000 });
  202 |   });
  203 | 
  204 |   test('login page shows Student, Teacher, and Parent role tabs', async ({ page }) => {
  205 |     await page.goto('/login');
  206 |     await expect(page.locator('text=Student')).toBeVisible({ timeout: 10_000 });
  207 |     await expect(page.locator('text=Teacher')).toBeVisible();
  208 |     await expect(page.locator('text=Parent')).toBeVisible();
  209 |   });
  210 | 
  211 |   test('clicking Teacher tab switches the active role', async ({ page }) => {
  212 |     await page.goto('/login');
  213 |     const teacherTab = page.locator('button:has-text("Teacher")');
  214 |     await expect(teacherTab).toBeVisible({ timeout: 10_000 });
  215 |     await teacherTab.click();
  216 |     // Teacher tab should be visually active (the button was clicked)
  217 |     // Verify the form is still visible after switching
  218 |     await expect(page.locator('text=Welcome Back')).toBeVisible();
  219 |   });
  220 | 
  221 |   test('clicking Parent tab switches the active role', async ({ page }) => {
  222 |     await page.goto('/login');
  223 |     const parentTab = page.locator('button:has-text("Parent")');
  224 |     await expect(parentTab).toBeVisible({ timeout: 10_000 });
  225 |     await parentTab.click();
  226 |     await expect(page.locator('text=Welcome Back')).toBeVisible();
  227 |   });
  228 | 
  229 |   test('teacher role pre-selected via query param', async ({ page }) => {
  230 |     await page.goto('/login?role=teacher');
  231 |     await expect(page.locator('button:has-text("Teacher")')).toBeVisible({ timeout: 10_000 });
  232 |   });
  233 | 
  234 |   test('parent role pre-selected via query param', async ({ page }) => {
  235 |     await page.goto('/login?role=parent');
  236 |     await expect(page.locator('button:has-text("Parent")')).toBeVisible({ timeout: 10_000 });
  237 |   });
  238 | });
  239 | 
  240 | /* ================================================================
  241 |  * Pricing Page
  242 |  * ================================================================ */
  243 | test.describe('Pricing Page', () => {
  244 |   test('pricing page loads with correct title', async ({ page }) => {
  245 |     await page.goto('/pricing');
  246 |     await expect(page).toHaveTitle(/Pricing/);
  247 |     await expect(page.locator('h1')).toContainText('Pricing');
  248 |   });
  249 | 
  250 |   test('displays plan cards', async ({ page }) => {
  251 |     await page.goto('/pricing');
  252 |     // The PricingCards component renders plans
  253 |     // Check that pricing amounts are visible (INR symbol)
  254 |     await expect(page.locator('text=Simple, Transparent Pricing')).toBeVisible();
  255 |   });
  256 | 
  257 |   test('has For Schools section with B2B features', async ({ page }) => {
  258 |     await page.goto('/pricing');
  259 |     await expect(page.locator('text=For Schools')).toBeVisible();
  260 |     await expect(page.locator('text=Admin Dashboard')).toBeVisible();
  261 |     await expect(page.locator('text=Multi-Class Management')).toBeVisible();
  262 |     await expect(page.locator('text=Board Exam Analytics')).toBeVisible();
  263 |   });
  264 | 
  265 |   test('has FAQ section with questions', async ({ page }) => {
  266 |     await page.goto('/pricing');
  267 |     await expect(page.locator('text=Frequently Asked Questions')).toBeVisible();
  268 |     await expect(page.locator('text=Can I try Alfanumrik for free')).toBeVisible();
  269 |     await expect(page.locator('text=What is your refund policy')).toBeVisible();
  270 |   });
  271 | 
  272 |   test('has Contact Sales and Book a Demo CTAs', async ({ page }) => {
  273 |     await page.goto('/pricing');
  274 |     await expect(page.locator('a:has-text("Contact Sales")')).toBeVisible();
  275 |     await expect(page.locator('a:has-text("Book a Demo")')).toBeVisible();
  276 |   });
  277 | 
  278 |   test('has navigation back to home', async ({ page }) => {
  279 |     await page.goto('/pricing');
  280 |     await expect(page.locator('a[href="/welcome"]')).toBeVisible();
  281 |   });
  282 | });
  283 | 
  284 | /* ================================================================
  285 |  * Content Pages (for-schools, for-parents, for-teachers, product)
  286 |  * ================================================================ */
  287 | test.describe('Content Pages', () => {
  288 |   test('for-schools page loads with correct title', async ({ page }) => {
  289 |     await page.goto('/for-schools');
  290 |     await expect(page).toHaveTitle(/For Schools/);
> 291 |     await expect(page.locator('text=Better Learning Outcomes')).toBeVisible();
      |                                                                 ^ Error: expect(locator).toBeVisible() failed
  292 |   });
  293 | 
  294 |   test('for-parents page loads with correct title', async ({ page }) => {
  295 |     await page.goto('/for-parents');
  296 |     await expect(page).toHaveTitle(/For Parents/);
  297 |     await expect(page.locator('text=Weekly Progress Reports')).toBeVisible();
  298 |   });
  299 | 
  300 |   test('for-teachers page loads with correct title', async ({ page }) => {
  301 |     await page.goto('/for-teachers');
  302 |     await expect(page).toHaveTitle(/For Teachers/);
  303 |     await expect(page.locator('text=Automated assessment')).toBeVisible();
  304 |   });
  305 | 
  306 |   test('product page loads with correct title', async ({ page }) => {
  307 |     await page.goto('/product');
  308 |     await expect(page).toHaveTitle(/Product/);
  309 |   });
  310 | });
  311 | 
  312 | /* ================================================================
  313 |  * Static Pages
  314 |  * ================================================================ */
  315 | test.describe('Static Pages', () => {
  316 |   test('privacy page loads', async ({ page }) => {
  317 |     await page.goto('/privacy');
  318 |     await expect(page).toHaveTitle(/Privacy|Alfanumrik/);
  319 |   });
  320 | 
  321 |   test('terms page loads', async ({ page }) => {
  322 |     await page.goto('/terms');
  323 |     await expect(page).toHaveTitle(/Terms|Alfanumrik/);
  324 |   });
  325 | });
  326 | 
  327 | /* ================================================================
  328 |  * 404 Page
  329 |  * ================================================================ */
  330 | test.describe('Not Found Page', () => {
  331 |   test('shows 404 page for nonexistent route', async ({ page }) => {
  332 |     await page.goto('/this-page-does-not-exist-at-all');
  333 |     await expect(page.locator('text=Page Not Found')).toBeVisible({ timeout: 10_000 });
  334 |     await expect(page.locator('text=404')).toBeVisible();
  335 |   });
  336 | 
  337 |   test('404 page has Back to Dashboard link', async ({ page }) => {
  338 |     await page.goto('/this-page-does-not-exist-at-all');
  339 |     await expect(page.locator('text=Back to Dashboard')).toBeVisible({ timeout: 10_000 });
  340 |   });
  341 | 
  342 |   test('404 page has alternative navigation links', async ({ page }) => {
  343 |     await page.goto('/this-page-does-not-exist-at-all');
  344 |     await expect(page.locator('a:has-text("Home")')).toBeVisible({ timeout: 10_000 });
  345 |     await expect(page.locator('a:has-text("Support")')).toBeVisible();
  346 |   });
  347 | });
  348 | 
  349 | /* ================================================================
  350 |  * API Health
  351 |  * ================================================================ */
  352 | test.describe('API Health', () => {
  353 |   test('health endpoint returns 200', async ({ request }) => {
  354 |     const res = await request.get('/api/v1/health');
  355 |     expect(res.status()).toBe(200);
  356 |   });
  357 | });
  358 | 
  359 | /* ================================================================
  360 |  * Protected Routes (unauthenticated)
  361 |  * ================================================================ */
  362 | test.describe('Protected Routes (unauthenticated)', () => {
  363 |   test('dashboard redirects to welcome or login', async ({ page }) => {
  364 |     await page.goto('/dashboard');
  365 |     await page.waitForURL(/\/(welcome|login)/, { timeout: 10_000 });
  366 |   });
  367 | });
  368 | 
```