# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: smoke.spec.ts >> Pricing Page >> has For Schools section with B2B features
- Location: e2e\smoke.spec.ts:257:7

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: locator('text=For Schools')
Expected: visible
Error: strict mode violation: locator('text=For Schools') resolved to 2 elements:
    1) <span>FOR SCHOOLS</span> aka getByText('FOR SCHOOLS', { exact: true })
    2) <h2>For Schools & Institutions</h2> aka getByRole('heading', { name: 'For Schools & Institutions' })

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for locator('text=For Schools')

```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - link "Skip to content" [ref=e2] [cursor=pointer]:
    - /url: "#main-content"
  - generic [ref=e4]:
    - navigation [ref=e5]:
      - generic [ref=e6]:
        - link "🦊 Alfanumrik" [ref=e7] [cursor=pointer]:
          - /url: /welcome
          - generic [ref=e8]: 🦊
          - generic [ref=e9]: Alfanumrik
        - generic [ref=e10]:
          - button "हिन्दी में बदलें" [ref=e11] [cursor=pointer]:
            - generic [ref=e12]: EN
            - generic [ref=e13]: हिन्दी
          - link "Home" [ref=e14] [cursor=pointer]:
            - /url: /welcome
    - generic [ref=e15]:
      - generic [ref=e16]: PRICING
      - heading "Simple, Transparent Pricing" [level=1] [ref=e17]
      - paragraph [ref=e18]: Start free, upgrade when you're ready. Every plan includes Foxy, your personal AI tutor.
    - generic [ref=e19]:
      - generic [ref=e20]:
        - generic [ref=e21]: Monthly
        - button "Switch to annual billing" [ref=e22] [cursor=pointer]
        - generic [ref=e24]: Annual
      - generic [ref=e25]:
        - generic [ref=e26]:
          - heading "Explorer" [level=3] [ref=e27]
          - paragraph [ref=e28]: Get started with Foxy for free
          - generic [ref=e29]: Free
          - link "Start Free" [ref=e30] [cursor=pointer]:
            - /url: /login
          - list [ref=e31]:
            - listitem [ref=e32]:
              - generic [ref=e33]: ✓
              - generic [ref=e34]: 5 Foxy chats / day
            - listitem [ref=e35]:
              - generic [ref=e36]: ✓
              - generic [ref=e37]: 5 quizzes / day
            - listitem [ref=e38]:
              - generic [ref=e39]: ✓
              - generic [ref=e40]: 2 subjects
            - listitem [ref=e41]:
              - generic [ref=e42]: ✓
              - generic [ref=e43]: Progress reports
            - listitem [ref=e44]:
              - generic [ref=e45]: ✓
              - generic [ref=e46]: Spaced repetition
            - listitem [ref=e47]:
              - generic [ref=e48]: ✕
              - generic [ref=e49]: STEM Lab
        - generic [ref=e50]:
          - heading "Starter" [level=3] [ref=e51]
          - paragraph [ref=e52]: More chats, more subjects
          - generic [ref=e53]:
            - text: ₹299
            - generic [ref=e54]: /mo
          - link "Get Started" [ref=e55] [cursor=pointer]:
            - /url: /login
          - list [ref=e56]:
            - listitem [ref=e57]:
              - generic [ref=e58]: ✓
              - generic [ref=e59]: 30 Foxy chats / day
            - listitem [ref=e60]:
              - generic [ref=e61]: ✓
              - generic [ref=e62]: 20 quizzes / day
            - listitem [ref=e63]:
              - generic [ref=e64]: ✓
              - generic [ref=e65]: 4 subjects
            - listitem [ref=e66]:
              - generic [ref=e67]: ✓
              - generic [ref=e68]: Progress reports
            - listitem [ref=e69]:
              - generic [ref=e70]: ✓
              - generic [ref=e71]: Spaced repetition
            - listitem [ref=e72]:
              - generic [ref=e73]: ✓
              - generic [ref=e74]: STEM Lab
        - generic [ref=e75]:
          - generic [ref=e76]: Most Popular
          - heading "Pro" [level=3] [ref=e77]
          - paragraph [ref=e78]: The complete learning experience
          - generic [ref=e79]:
            - text: ₹699
            - generic [ref=e80]: /mo
          - link "Get Started" [ref=e81] [cursor=pointer]:
            - /url: /login
          - list [ref=e82]:
            - listitem [ref=e83]:
              - generic [ref=e84]: ✓
              - generic [ref=e85]: 100 Foxy chats / day
            - listitem [ref=e86]:
              - generic [ref=e87]: ✓
              - generic [ref=e88]: Unlimited quizzes
            - listitem [ref=e89]:
              - generic [ref=e90]: ✓
              - generic [ref=e91]: All subjects
            - listitem [ref=e92]:
              - generic [ref=e93]: ✓
              - generic [ref=e94]: Progress reports
            - listitem [ref=e95]:
              - generic [ref=e96]: ✓
              - generic [ref=e97]: Spaced repetition
            - listitem [ref=e98]:
              - generic [ref=e99]: ✓
              - generic [ref=e100]: STEM Lab
        - generic [ref=e101]:
          - heading "Unlimited" [level=3] [ref=e102]
          - paragraph [ref=e103]: No limits, maximum results
          - generic [ref=e104]:
            - text: ₹1,499
            - generic [ref=e105]: /mo
          - link "Get Started" [ref=e106] [cursor=pointer]:
            - /url: /login
          - list [ref=e107]:
            - listitem [ref=e108]:
              - generic [ref=e109]: ✓
              - generic [ref=e110]: Unlimited Foxy chats
            - listitem [ref=e111]:
              - generic [ref=e112]: ✓
              - generic [ref=e113]: Unlimited quizzes
            - listitem [ref=e114]:
              - generic [ref=e115]: ✓
              - generic [ref=e116]: All subjects
            - listitem [ref=e117]:
              - generic [ref=e118]: ✓
              - generic [ref=e119]: Progress reports
            - listitem [ref=e120]:
              - generic [ref=e121]: ✓
              - generic [ref=e122]: Spaced repetition
            - listitem [ref=e123]:
              - generic [ref=e124]: ✓
              - generic [ref=e125]: STEM Lab
    - generic [ref=e127]:
      - generic [ref=e128]:
        - generic [ref=e129]: FOR SCHOOLS
        - heading "For Schools & Institutions" [level=2] [ref=e130]
        - paragraph [ref=e131]: Custom pricing based on student count. Deploy Alfanumrik across your entire school with dedicated support, training, and integration assistance.
      - generic [ref=e132]:
        - generic [ref=e133]:
          - generic [ref=e134]: 🏢
          - heading "Admin Dashboard" [level=3] [ref=e135]
          - paragraph [ref=e136]: School-wide analytics covering all classes, teachers, and students in one unified view.
        - generic [ref=e137]:
          - generic [ref=e138]: 📚
          - heading "Multi-Class Management" [level=3] [ref=e139]
          - paragraph [ref=e140]: Manage multiple sections, grades, and subjects across your entire school from a single admin panel.
        - generic [ref=e141]:
          - generic [ref=e142]: 🎯
          - heading "Board Exam Analytics" [level=3] [ref=e143]
          - paragraph [ref=e144]: Track student preparedness for CBSE board examinations with subject-wise mastery data.
        - generic [ref=e145]:
          - generic [ref=e146]: 🛠️
          - heading "Teacher Tools" [level=3] [ref=e147]
          - paragraph [ref=e148]: Worksheet generators, assignment management, and class-wide mastery tracking for every teacher.
        - generic [ref=e149]:
          - generic [ref=e150]: 👨‍👩‍👧
          - heading "Parent Portal" [level=3] [ref=e151]
          - paragraph [ref=e152]: Give parents real-time visibility into their child's progress, streaks, and exam readiness.
        - generic [ref=e153]:
          - generic [ref=e154]: 🔗
          - heading "Custom Integration" [level=3] [ref=e155]
          - paragraph [ref=e156]: Work with our team to connect Alfanumrik with your existing school ERP, LMS, or student information systems. Available on request.
      - generic [ref=e157]:
        - link "Contact Sales" [ref=e158] [cursor=pointer]:
          - /url: /contact
        - link "Book a Demo" [ref=e159] [cursor=pointer]:
          - /url: /demo
    - generic [ref=e161]:
      - generic [ref=e162]:
        - generic [ref=e163]: FAQ
        - heading "Frequently Asked Questions" [level=2] [ref=e164]
      - generic [ref=e165]:
        - generic [ref=e166]:
          - heading "Can I try Alfanumrik for free before upgrading?" [level=3] [ref=e167]
          - paragraph [ref=e168]: Yes! The Explorer plan is completely free with 5 Foxy chats and 5 quizzes per day across 2 subjects. No credit card required. Upgrade anytime when you need more.
        - generic [ref=e169]:
          - heading "How does the annual billing work?" [level=3] [ref=e170]
          - paragraph [ref=e171]: When you choose annual billing, you pay for the full year upfront and save 33% compared to monthly billing. For example, the Pro plan is ₹699/month or ₹5,599/year (equivalent to ₹467/month).
        - generic [ref=e172]:
          - heading "What is your refund policy?" [level=3] [ref=e173]
          - paragraph [ref=e174]: We offer a 7-day money-back guarantee on all paid plans. If you're not satisfied within the first 7 days of your subscription, contact us for a full refund. No questions asked.
        - generic [ref=e175]:
          - heading "Can I switch plans at any time?" [level=3] [ref=e176]
          - paragraph [ref=e177]: Absolutely. You can upgrade or downgrade your plan at any time. When upgrading, you'll be charged the prorated difference. When downgrading, the remaining credit will be applied to your next billing cycle.
    - contentinfo [ref=e178]:
      - generic [ref=e179]:
        - generic [ref=e180]:
          - link "Privacy Policy" [ref=e181] [cursor=pointer]:
            - /url: /privacy
          - link "Terms of Service" [ref=e182] [cursor=pointer]:
            - /url: /terms
          - link "Contact" [ref=e183] [cursor=pointer]:
            - /url: /contact
        - paragraph [ref=e184]: © 2026 Cusiosense Learning India Pvt. Ltd. All rights reserved.
  - button "Open Next.js Dev Tools" [ref=e190] [cursor=pointer]:
    - img [ref=e191]
```

# Test source

```ts
  159 |     await expect(langToggle).toBeVisible();
  160 | 
  161 |     // Click the toggle to switch to Hindi
  162 |     await langToggle.click();
  163 | 
  164 |     // Verify Hindi text appears on the page
  165 |     await expect(page.locator('text=असली समस्या')).toBeVisible();
  166 |     await expect(page.locator('text=समाधान')).toBeVisible();
  167 |     await expect(page.locator('text=कैसे काम करता है')).toBeVisible();
  168 |   });
  169 | 
  170 |   test('language toggle switches back to English from Hindi', async ({ page }) => {
  171 |     await page.goto('/welcome');
  172 | 
  173 |     // Toggle to Hindi
  174 |     const langToggle = page.locator('button[aria-label]').filter({
  175 |       has: page.locator('text=EN'),
  176 |     });
  177 |     await langToggle.click();
  178 |     await expect(page.locator('text=असली समस्या')).toBeVisible();
  179 | 
  180 |     // Toggle back to English
  181 |     await langToggle.click();
  182 |     await expect(page.locator('text=THE REAL PROBLEM')).toBeVisible();
  183 |     await expect(page.locator('text=THE SOLUTION')).toBeVisible();
  184 |   });
  185 | 
  186 |   test('navigation links are present in navbar', async ({ page }) => {
  187 |     await page.goto('/welcome');
  188 |     const nav = page.locator('nav');
  189 |     await expect(nav.locator('a[href="/product"]')).toBeVisible();
  190 |     await expect(nav.locator('a[href="/pricing"]')).toBeVisible();
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
> 259 |     await expect(page.locator('text=For Schools')).toBeVisible();
      |                                                    ^ Error: expect(locator).toBeVisible() failed
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
  291 |     await expect(page.locator('text=Better Learning Outcomes')).toBeVisible();
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
```