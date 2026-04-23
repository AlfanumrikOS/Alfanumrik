# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: accessibility.spec.ts >> Login Page Accessibility >> role tab buttons have accessible text
- Location: e2e\accessibility.spec.ts:172:7

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
  74  |     await page.waitForLoadState('networkidle');
  75  | 
  76  |     const h1Count = await page.locator('h1').count();
  77  |     expect(h1Count).toBe(1);
  78  |   });
  79  | 
  80  |   test('language toggle has aria-label', async ({ page }) => {
  81  |     await page.goto('/welcome');
  82  | 
  83  |     // The LangToggle button has aria-label
  84  |     const langToggle = page.locator('button[aria-label]').filter({
  85  |       has: page.locator('text=EN'),
  86  |     });
  87  |     await expect(langToggle).toBeVisible();
  88  | 
  89  |     const ariaLabel = await langToggle.getAttribute('aria-label');
  90  |     expect(ariaLabel).toBeTruthy();
  91  |     // Should describe the toggle action
  92  |     expect(ariaLabel!.length).toBeGreaterThan(5);
  93  |   });
  94  | 
  95  |   test('language toggle aria-label updates after switching to Hindi', async ({ page }) => {
  96  |     await page.goto('/welcome');
  97  | 
  98  |     const langToggle = page.locator('button[aria-label]').filter({
  99  |       has: page.locator('text=EN'),
  100 |     });
  101 | 
  102 |     // In English mode, aria-label should be in Hindi (telling Hindi speakers to switch)
  103 |     const englishLabel = await langToggle.getAttribute('aria-label');
  104 |     expect(englishLabel).toContain('हिन्दी');
  105 | 
  106 |     // Switch to Hindi
  107 |     await langToggle.click();
  108 | 
  109 |     // In Hindi mode, aria-label should be in English (telling English speakers to switch)
  110 |     const hindiLabel = await langToggle.getAttribute('aria-label');
  111 |     expect(hindiLabel).toContain('English');
  112 |   });
  113 | 
  114 |   test('links to login pages have descriptive text', async ({ page }) => {
  115 |     await page.goto('/welcome');
  116 | 
  117 |     // CTA links should have meaningful text, not just "click here"
  118 |     const ctaLinks = page.locator('a[href="/login"]');
  119 |     const count = await ctaLinks.count();
  120 |     expect(count).toBeGreaterThan(0);
  121 | 
  122 |     for (let i = 0; i < count; i++) {
  123 |       const link = ctaLinks.nth(i);
  124 |       const visible = await link.isVisible();
  125 |       if (!visible) continue;
  126 | 
  127 |       const text = (await link.textContent())?.trim();
  128 |       const ariaLabel = await link.getAttribute('aria-label');
  129 |       const hasLabel = (text && text.length > 2) || ariaLabel;
  130 |       expect(
  131 |         hasLabel,
  132 |         `Login link at index ${i} has no descriptive text`
  133 |       ).toBeTruthy();
  134 |     }
  135 |   });
  136 | });
  137 | 
  138 | test.describe('Login Page Accessibility', () => {
  139 |   test('login form inputs have associated labels or aria-label', async ({ page }) => {
  140 |     await page.goto('/login');
  141 |     await page.waitForLoadState('networkidle');
  142 | 
  143 |     const inputs = page.locator('input:visible');
  144 |     const count = await inputs.count();
  145 | 
  146 |     for (let i = 0; i < count; i++) {
  147 |       const input = inputs.nth(i);
  148 |       const type = await input.getAttribute('type');
  149 |       // Skip hidden inputs and submit buttons
  150 |       if (type === 'hidden' || type === 'submit') continue;
  151 | 
  152 |       const id = await input.getAttribute('id');
  153 |       const ariaLabel = await input.getAttribute('aria-label');
  154 |       const ariaLabelledBy = await input.getAttribute('aria-labelledby');
  155 |       const placeholder = await input.getAttribute('placeholder');
  156 | 
  157 |       // Check if there's a label element associated via "for" attribute
  158 |       let hasLabel = false;
  159 |       if (id) {
  160 |         const label = page.locator(`label[for="${id}"]`);
  161 |         hasLabel = (await label.count()) > 0;
  162 |       }
  163 | 
  164 |       const hasAccessibleLabel = hasLabel || ariaLabel || ariaLabelledBy || placeholder;
  165 |       expect(
  166 |         hasAccessibleLabel,
  167 |         `Input at index ${i} (type="${type}") has no accessible label`
  168 |       ).toBeTruthy();
  169 |     }
  170 |   });
  171 | 
  172 |   test('role tab buttons have accessible text', async ({ page }) => {
  173 |     await page.goto('/login');
> 174 |     await expect(page.locator('text=Student')).toBeVisible({ timeout: 10_000 });
      |                                                ^ Error: expect(locator).toBeVisible() failed
  175 | 
  176 |     const roleTabs = page.locator('button').filter({
  177 |       hasText: /Student|Teacher|Parent/,
  178 |     });
  179 |     const count = await roleTabs.count();
  180 |     expect(count).toBe(3);
  181 | 
  182 |     for (let i = 0; i < count; i++) {
  183 |       const tab = roleTabs.nth(i);
  184 |       const text = await tab.textContent();
  185 |       expect(text?.trim().length).toBeGreaterThan(0);
  186 |     }
  187 |   });
  188 | });
  189 | 
  190 | test.describe('Not Found Page Accessibility', () => {
  191 |   test('404 page has proper heading structure', async ({ page }) => {
  192 |     await page.goto('/this-route-does-not-exist');
  193 |     await page.waitForLoadState('networkidle');
  194 | 
  195 |     const h1 = page.locator('h1');
  196 |     await expect(h1).toBeVisible({ timeout: 10_000 });
  197 |     await expect(h1).toContainText('Page Not Found');
  198 |   });
  199 | 
  200 |   test('404 page Back to Dashboard link has aria-label', async ({ page }) => {
  201 |     await page.goto('/this-route-does-not-exist');
  202 |     const backLink = page.locator('a[aria-label="Go back to dashboard"]');
  203 |     await expect(backLink).toBeVisible({ timeout: 10_000 });
  204 |   });
  205 | 
  206 |   test('404 page alternative nav has aria-label', async ({ page }) => {
  207 |     await page.goto('/this-route-does-not-exist');
  208 |     const altNav = page.locator('nav[aria-label="Additional navigation"]');
  209 |     await expect(altNav).toBeVisible({ timeout: 10_000 });
  210 |   });
  211 | });
  212 | 
  213 | test.describe('Pricing Page Accessibility', () => {
  214 |   test('pricing page has proper heading hierarchy', async ({ page }) => {
  215 |     await page.goto('/pricing');
  216 |     await page.waitForLoadState('networkidle');
  217 | 
  218 |     const h1 = page.locator('h1');
  219 |     await expect(h1).toBeVisible();
  220 |     await expect(h1).toContainText('Pricing');
  221 | 
  222 |     // h2 elements should exist for subsections
  223 |     const h2Count = await page.locator('h2').count();
  224 |     expect(h2Count).toBeGreaterThan(0);
  225 |   });
  226 | });
  227 | 
```