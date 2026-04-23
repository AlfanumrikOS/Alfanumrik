# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: smoke.spec.ts >> Landing Page >> renders footer with legal links and company info
- Location: e2e\smoke.spec.ts:143:7

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: locator('footer').locator('text=Cusiosense Learning India')
Expected: visible
Error: strict mode violation: locator('footer').locator('text=Cusiosense Learning India') resolved to 2 elements:
    1) <p class="text-xs leading-relaxed">…</p> aka getByText('Structured learning for CBSE')
    2) <p class="text-xs">…</p> aka getByText('© 2026 Cusiosense Learning')

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for locator('footer').locator('text=Cusiosense Learning India')

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
  49  |     await expect(page.locator('text=NCERT Aligned')).toBeVisible();
  50  |   });
  51  | 
  52  |   test('renders The Real Problem section with 4 problem cards', async ({ page }) => {
  53  |     await page.goto('/welcome');
  54  |     await expect(page.locator('text=THE REAL PROBLEM')).toBeVisible();
  55  |     await expect(page.locator('text=Concepts don\'t stick')).toBeVisible();
  56  |     await expect(page.locator('text=Practice is random')).toBeVisible();
  57  |     await expect(page.locator('text=Exam stress builds silently')).toBeVisible();
  58  |     await expect(page.locator('text=Parents can\'t see the real picture')).toBeVisible();
  59  |   });
  60  | 
  61  |   test('renders The Solution section', async ({ page }) => {
  62  |     await page.goto('/welcome');
  63  |     await expect(page.locator('text=THE SOLUTION')).toBeVisible();
  64  |     await expect(page.locator('text=Concept clarity first')).toBeVisible();
  65  |     await expect(page.locator('text=Practice that targets weak spots')).toBeVisible();
  66  |     await expect(page.locator('text=Progress everyone can see')).toBeVisible();
  67  |   });
  68  | 
  69  |   test('renders How It Works section with 5 steps', async ({ page }) => {
  70  |     await page.goto('/welcome');
  71  |     await expect(page.locator('text=HOW IT WORKS')).toBeVisible();
  72  |     await expect(page.locator('text=Learn').first()).toBeVisible();
  73  |     await expect(page.locator('text=Practice').first()).toBeVisible();
  74  |     await expect(page.locator('text=Revise')).toBeVisible();
  75  |     // "Test" is generic, so check the step number instead
  76  |     await expect(page.locator('text=04')).toBeVisible();
  77  |     await expect(page.locator('text=Track').first()).toBeVisible();
  78  |   });
  79  | 
  80  |   test('renders See It In Action section with product showcase cards', async ({ page }) => {
  81  |     await page.goto('/welcome');
  82  |     await expect(page.locator('text=SEE IT IN ACTION')).toBeVisible();
  83  |     await expect(page.locator('text=Foxy AI Tutor').first()).toBeVisible();
  84  |     await expect(page.locator('text=Smart Quiz')).toBeVisible();
  85  |     await expect(page.locator('text=Progress Dashboard')).toBeVisible();
  86  |     await expect(page.locator('text=Parent View')).toBeVisible();
  87  |   });
  88  | 
  89  |   test('renders Product Experience section with feature grid', async ({ page }) => {
  90  |     await page.goto('/welcome');
  91  |     await expect(page.locator('text=Built for how Indian students')).toBeVisible();
  92  |     await expect(page.locator('text=19 Interactive Simulations')).toBeVisible();
  93  |     await expect(page.locator('text=Bloom-Aware Quizzes')).toBeVisible();
  94  |     await expect(page.locator('text=Parent Dashboard')).toBeVisible();
  95  |     await expect(page.locator('text=Teacher Command Center')).toBeVisible();
  96  |   });
  97  | 
  98  |   test('renders audience sections for Students, Parents, Teachers, Schools', async ({ page }) => {
  99  |     await page.goto('/welcome');
  100 |     await expect(page.locator('text=For Students')).toBeVisible();
  101 |     await expect(page.locator('text=For Parents').first()).toBeVisible();
  102 |     await expect(page.locator('text=For Teachers').first()).toBeVisible();
  103 |     await expect(page.locator('text=For Schools').first()).toBeVisible();
  104 |   });
  105 | 
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
> 149 |     await expect(footer.locator('text=Cusiosense Learning India')).toBeVisible();
      |                                                                    ^ Error: expect(locator).toBeVisible() failed
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
```