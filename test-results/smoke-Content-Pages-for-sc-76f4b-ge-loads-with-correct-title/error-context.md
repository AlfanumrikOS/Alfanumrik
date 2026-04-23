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
Error: strict mode violation: locator('text=Better Learning Outcomes') resolved to 2 elements:
    1) <h3 class="text-base font-bold mb-2">Better Learning Outcomes</h3> aka getByRole('heading', { name: 'Better Learning Outcomes' })
    2) <p class="text-sm sm:text-base max-w-lg mx-auto mb-8">Join forward-thinking schools using AI to deliver…</p> aka getByText('Join forward-thinking schools')

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for locator('text=Better Learning Outcomes')

```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - generic [ref=e6] [cursor=pointer]:
    - button "Open Next.js Dev Tools" [ref=e7]:
      - img [ref=e8]
    - generic [ref=e11]:
      - button "Open issues overlay" [ref=e12]:
        - generic [ref=e13]:
          - generic [ref=e14]: "1"
          - generic [ref=e15]: "2"
        - generic [ref=e16]:
          - text: Issue
          - generic [ref=e17]: s
      - button "Collapse issues badge" [ref=e18]:
        - img [ref=e19]
  - generic [ref=e21]:
    - img "Fox face" [ref=e22]: 🦊
    - heading "Something went wrong" [level=1] [ref=e23]
    - paragraph [ref=e24]: Foxy ran into a problem loading this page. Please try again.
    - generic [ref=e25]:
      - button "Try Again" [ref=e26] [cursor=pointer]
      - button "Go Home" [ref=e27] [cursor=pointer]
    - generic [ref=e28]: Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY
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