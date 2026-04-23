# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: smoke.spec.ts >> Landing Page >> language toggle switches to Hindi
- Location: e2e\smoke.spec.ts:152:7

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: locator.click: Test timeout of 30000ms exceeded.
Call log:
  - waiting for locator('button[aria-label]').filter({ has: locator('text=EN') })
    - locator resolved to <button aria-label="हिन्दी में बदलें" class="flex items-center rounded-full text-[11px] font-bold overflow-hidden">…</button>
  - attempting click action
    - waiting for element to be visible, enabled and stable
  - element was detached from the DOM, retrying

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
> 162 |     await langToggle.click();
      |                      ^ Error: locator.click: Test timeout of 30000ms exceeded.
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
  259 |     await expect(page.locator('text=For Schools')).toBeVisible();
  260 |     await expect(page.locator('text=Admin Dashboard')).toBeVisible();
  261 |     await expect(page.locator('text=Multi-Class Management')).toBeVisible();
  262 |     await expect(page.locator('text=Board Exam Analytics')).toBeVisible();
```