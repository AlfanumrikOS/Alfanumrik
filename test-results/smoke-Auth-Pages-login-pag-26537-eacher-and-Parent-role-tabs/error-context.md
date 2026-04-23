# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: smoke.spec.ts >> Auth Pages >> login page shows Student, Teacher, and Parent role tabs
- Location: e2e\smoke.spec.ts:204:7

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: locator('text=Student')
Expected: visible
Error: strict mode violation: locator('text=Student') resolved to 2 elements:
    1) <p class="text-sm font-medium mt-1">AI Tutor for CBSE Students</p> aka getByText('AI Tutor for CBSE Students')
    2) <button role="tab" aria-selected="true" class="flex-1 py-2.5 rounded-xl text-xs font-bold transition-all">…</button> aka getByRole('tab', { name: 'Student' })

Call log:
  - Expect "toBeVisible" with timeout 10000ms
  - waiting for locator('text=Student')

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
  - button "Open Next.js Dev Tools" [ref=e46] [cursor=pointer]:
    - img [ref=e47]
```

# Test source

```ts
  106 |   test('renders Outcomes section with result cards', async ({ page }) => {
  107 |     await page.goto('/welcome');
  108 |     await expect(page.locator('text=OUTCOMES')).toBeVisible();
  109 |     await expect(page.locator('text=Deeper understanding')).toBeVisible();
  110 |     await expect(page.locator('text=Measurable progress')).toBeVisible();
  111 |     await expect(page.locator('text=Better exam scores')).toBeVisible();
  112 |     await expect(page.locator('text=Real confidence')).toBeVisible();
  113 |   });
  114 | 
  115 |   test('renders Our Philosophy / Trust section', async ({ page }) => {
  116 |     await page.goto('/welcome');
  117 |     await expect(page.locator('text=OUR PHILOSOPHY')).toBeVisible();
  118 |     await expect(page.locator('text=Systems over shortcuts')).toBeVisible();
  119 |   });
  120 | 
  121 |   test('renders FAQ section with expandable questions', async ({ page }) => {
  122 |     await page.goto('/welcome');
  123 |     const faqSection = page.locator('text=Frequently Asked Questions');
  124 |     await expect(faqSection.first()).toBeVisible();
  125 | 
  126 |     // FAQs use <details>/<summary>; click to expand
  127 |     const firstFaq = page.locator('details').first();
  128 |     await expect(firstFaq).toBeVisible();
  129 | 
  130 |     // Click to expand the first FAQ
  131 |     await firstFaq.locator('summary').click();
  132 |     // The answer text should now be visible
  133 |     const answer = firstFaq.locator('div');
  134 |     await expect(answer).toBeVisible();
  135 |   });
  136 | 
  137 |   test('renders Final CTA section', async ({ page }) => {
  138 |     await page.goto('/welcome');
  139 |     await expect(page.locator('text=Every week without a system')).toBeVisible();
  140 |     await expect(page.locator('text=lost progress')).toBeVisible();
  141 |   });
  142 | 
  143 |   test('renders footer with legal links and company info', async ({ page }) => {
  144 |     await page.goto('/welcome');
  145 |     const footer = page.locator('footer');
  146 |     await expect(footer).toBeVisible();
  147 |     await expect(footer.locator('a[href="/privacy"]')).toBeVisible();
  148 |     await expect(footer.locator('a[href="/terms"]')).toBeVisible();
  149 |     await expect(footer.locator('text=Cusiosense Learning India')).toBeVisible();
  150 |   });
  151 | 
  152 |   test('language toggle switches to Hindi', async ({ page }) => {
  153 |     await page.goto('/welcome');
  154 | 
  155 |     // The toggle button has aria-label
  156 |     const langToggle = page.locator('button[aria-label]').filter({
  157 |       has: page.locator('text=EN'),
  158 |     });
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
> 206 |     await expect(page.locator('text=Student')).toBeVisible({ timeout: 10_000 });
      |                                                ^ Error: expect(locator).toBeVisible() failed
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
```