# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: accessibility.spec.ts >> Landing Page Accessibility >> language toggle aria-label updates after switching to Hindi
- Location: e2e\accessibility.spec.ts:95:7

# Error details

```
Error: expect(received).toContain(expected) // indexOf

Expected substring: "English"
Received string:    "हिन्दी में बदलें"
```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - link "Skip to content" [ref=e2] [cursor=pointer]:
    - /url: "#main-content"
  - generic [ref=e4]:
    - navigation [ref=e5]:
      - generic [ref=e6]:
        - link "Alfanumrik™" [ref=e7] [cursor=pointer]:
          - /url: /welcome
          - generic [ref=e15]: Alfanumrik™
        - generic [ref=e16]:
          - button "हिन्दी में बदलें" [ref=e17] [cursor=pointer]:
            - generic [ref=e18]: EN
            - generic [ref=e19]: हिन्दी
          - link "Log In" [ref=e20] [cursor=pointer]:
            - /url: /login
          - link "Sign Up Free" [ref=e21] [cursor=pointer]:
            - /url: /login
    - generic [ref=e24]:
      - generic [ref=e25]:
        - generic [ref=e26]:
          - generic [ref=e27]:
            - generic [ref=e28]: 🇮🇳
            - text: CBSE Grades 6–12 · Hindi & English
          - heading "What if your child walked into every exam knowing they're prepared?" [level=1] [ref=e29]
          - paragraph [ref=e30]: Alfanumrik is a structured learning system that replaces guesswork with real concept clarity — so you stop worrying and start seeing progress.
          - link "Start Learning Free" [ref=e32] [cursor=pointer]:
            - /url: /login
          - paragraph [ref=e33]: No credit card · 5 free sessions daily · Cancel anytime
          - paragraph [ref=e34]:
            - link "Are you a teacher?" [ref=e35] [cursor=pointer]:
              - /url: /login?role=teacher
        - generic [ref=e38]:
          - generic [ref=e41]:
            - generic [ref=e49]: Foxy AI Tutor
            - generic [ref=e50]:
              - generic [ref=e51]: Learn
              - generic [ref=e52]: Practice
              - generic [ref=e53]: Quiz
          - generic [ref=e54]:
            - generic [ref=e56]: Photosynthesis samjhao step by step
            - generic [ref=e65]:
              - paragraph [ref=e66]: "Photosynthesis mein plants sunlight se food banate hain:"
              - paragraph [ref=e67]: "Step 1: Chlorophyll absorbs light"
              - paragraph [ref=e68]: "Step 2: Water splits (photolysis)"
              - paragraph [ref=e69]: "Step 3: CO₂ → glucose"
              - generic [ref=e70]: 6CO₂ + 6H₂O → C₆H₁₂O₆ + 6O₂
              - paragraph [ref=e71]: Bata sakte ho chlorophyll kahan hota hai?
            - generic [ref=e77]: Type your answer...
      - generic [ref=e86]:
        - generic [ref=e88]:
          - generic [ref=e89]: "16"
          - generic [ref=e90]: Subjects
        - generic [ref=e92]:
          - generic [ref=e93]: 6–12
          - generic [ref=e94]: Grades
        - generic [ref=e96]:
          - generic [ref=e97]: हिन्दी+En
          - generic [ref=e98]: Bilingual
        - generic [ref=e100]:
          - generic [ref=e101]: DPIIT
          - generic [ref=e102]: Recognized
    - generic [ref=e104]:
      - generic [ref=e105]:
        - generic [ref=e106]: THE REAL PROBLEM
        - heading "Most students study hard. The system they follow doesn't work." [level=2] [ref=e107]
      - generic [ref=e108]:
        - generic [ref=e119]:
          - heading "Concepts don't stick" [level=3] [ref=e120]
          - paragraph [ref=e121]: They read the chapter, attend the class — and still can't answer the exam question.
        - generic [ref=e133]:
          - heading "Practice is random" [level=3] [ref=e134]
          - paragraph [ref=e135]: 50 easy questions don't fix the 5 hard ones they keep getting wrong.
        - generic [ref=e142]:
          - heading "You can't see the real picture" [level=3] [ref=e143]
          - paragraph [ref=e144]: By the time the report card arrives, months of gaps have already piled up.
      - generic [ref=e145]:
        - generic [ref=e148]: ↓
        - generic [ref=e149]: Here's what changes
      - generic [ref=e150]:
        - generic [ref=e153]:
          - img [ref=e161]
          - generic [ref=e166]:
            - heading "Concepts explained until they click" [level=3] [ref=e167]
            - paragraph [ref=e168]: Foxy AI tutor breaks every topic step-by-step. In Hindi or English. Adapts to what your child already knows.
        - generic [ref=e178]:
          - heading "Practice targets weak spots only" [level=3] [ref=e179]
          - paragraph [ref=e180]: Smart quizzes adapt to your child's level. Board-exam patterns. Bloom's taxonomy built in. No wasted repetition.
        - generic [ref=e190]:
          - heading "You see progress every day" [level=3] [ref=e191]
          - paragraph [ref=e192]: Your parent dashboard shows what they studied, what's strong, what needs work — updated after every session.
    - generic [ref=e194]:
      - generic [ref=e195]:
        - generic [ref=e196]: SEE IT IN ACTION
        - heading "Real product. Real interface. Not stock photos." [level=2] [ref=e197]
      - generic [ref=e198]:
        - generic [ref=e199]:
          - generic [ref=e201]:
            - generic [ref=e202]:
              - generic [ref=e210]: Foxy AI Tutor
              - generic [ref=e211]:
                - generic [ref=e212]: Learn
                - generic [ref=e213]: Practice
                - generic [ref=e214]: Quiz
            - generic [ref=e215]:
              - generic [ref=e217]: Photosynthesis samjhao step by step
              - generic [ref=e226]:
                - paragraph [ref=e227]: "Photosynthesis mein plants sunlight se food banate hain:"
                - paragraph [ref=e228]: "Step 1: Chlorophyll absorbs light"
                - paragraph [ref=e229]: "Step 2: Water splits (photolysis)"
                - paragraph [ref=e230]: "Step 3: CO₂ → glucose"
                - generic [ref=e231]: 6CO₂ + 6H₂O → C₆H₁₂O₆ + 6O₂
                - paragraph [ref=e232]: Bata sakte ho chlorophyll kahan hota hai?
          - paragraph [ref=e233]: Your child asks. Foxy explains. In Hindi, English, or both.
        - generic [ref=e234]:
          - generic [ref=e236]:
            - generic [ref=e237]: For You
            - generic [ref=e238]:
              - generic [ref=e239]: 👨‍👩‍👧
              - generic [ref=e240]: Parent Dashboard
            - generic [ref=e241]:
              - generic [ref=e242]:
                - generic [ref=e243]: A
                - generic [ref=e244]:
                  - generic [ref=e245]: Aarav Sharma
                  - generic [ref=e246]: Class 8 · CBSE
                - generic [ref=e249]: Active today
              - generic [ref=e250]:
                - generic [ref=e251]: This Week
                - generic [ref=e252]:
                  - generic [ref=e253]:
                    - generic [ref=e254]: "5"
                    - generic [ref=e255]: Quizzes
                  - generic [ref=e256]:
                    - generic [ref=e257]: 82%
                    - generic [ref=e258]: Avg Score
                  - generic [ref=e259]:
                    - generic [ref=e260]: 45m
                    - generic [ref=e261]: Study Time
              - generic [ref=e262]:
                - generic [ref=e263]:
                  - generic [ref=e264]: Strong
                  - generic [ref=e268]: Algebra
                  - generic [ref=e272]: Photosynthesis
                  - generic [ref=e276]: Grammar
                - generic [ref=e277]:
                  - generic [ref=e278]: Needs Work
                  - generic [ref=e282]: Geometry
                  - generic [ref=e286]: Chemical Rxns
          - paragraph [ref=e287]: See what they studied. Know what's weak. No surprises.
        - generic [ref=e288]:
          - generic [ref=e290]:
            - generic [ref=e291]:
              - generic [ref=e292]:
                - generic [ref=e293]: ⚡
                - generic [ref=e294]: Smart Quiz
              - generic [ref=e295]:
                - generic [ref=e296]: Apply
                - generic [ref=e301]: Medium
            - generic [ref=e302]:
              - generic [ref=e303]:
                - generic [ref=e304]: Question 7 of 10
                - generic [ref=e305]: 7/10
              - paragraph [ref=e317]: Which of the following is the correct product of photosynthesis?
              - generic [ref=e318]:
                - generic [ref=e319]:
                  - generic [ref=e320]: A
                  - text: Carbon dioxide and water
                - generic [ref=e321]:
                  - generic [ref=e322]: ✓
                  - text: Glucose and oxygen
                - generic [ref=e323]:
                  - generic [ref=e324]: C
                  - text: Starch and nitrogen
                - generic [ref=e325]:
                  - generic [ref=e326]: D
                  - text: Protein and hydrogen
              - generic [ref=e327]:
                - generic [ref=e328]: ✅
                - text: Correct!
                - generic [ref=e329]:
                  - text: "+10"
                  - text: XP
          - paragraph [ref=e331]: Board-pattern questions. Instant feedback. Real improvement.
    - generic [ref=e333]:
      - generic [ref=e334]:
        - generic [ref=e336]: DPIIT Recognized Startup
        - generic [ref=e341]: DPDPA Compliant
        - generic [ref=e346]: Data Encrypted
        - generic [ref=e352]: NCERT Aligned
        - generic [ref=e358]: No Ads. Ever.
      - paragraph [ref=e363]:
        - generic [ref=e364]:
          - generic [ref=e365]: "16"
          - text: subjects ·
        - generic [ref=e366]:
          - generic [ref=e367]: "7"
          - text: grades ·
        - generic [ref=e368]:
          - generic [ref=e369]: "115"
          - text: STEM experiments ·
        - generic [ref=e370]:
          - generic [ref=e371]: "6"
          - text: Bloom's levels in every quiz ·
        - generic [ref=e372]: Hindi & English ·
        - text: Built in India
      - generic [ref=e374]:
        - paragraph [ref=e375]: Trusted by parents who want more than tuition classes.
        - paragraph [ref=e376]: "Cusiosense Learning India Pvt. Ltd. · CIN: U58200UP2025PTC238093"
    - generic [ref=e379]:
      - heading "Every week without a system is a week of guesswork." [level=2] [ref=e389]
      - paragraph [ref=e390]: Start free. See the difference in how your child studies within the first week.
      - link "Start Learning Free" [ref=e391] [cursor=pointer]:
        - /url: /login
      - paragraph [ref=e392]: No credit card · 5 free sessions daily · Works on any phone
      - paragraph [ref=e393]:
        - text: I'm a
        - link "teacher" [ref=e394] [cursor=pointer]:
          - /url: /login?role=teacher
        - text: · I'm a
        - link "student" [ref=e395] [cursor=pointer]:
          - /url: /login
      - generic [ref=e396]:
        - heading "Quick answers" [level=3] [ref=e397]
        - generic [ref=e398]:
          - group [ref=e399]:
            - generic "Is it really free? +" [ref=e400] [cursor=pointer]:
              - text: Is it really free?
              - generic [ref=e401]: +
          - group [ref=e402]:
            - generic "Is it safe for my child? +" [ref=e403] [cursor=pointer]:
              - text: Is it safe for my child?
              - generic [ref=e404]: +
          - group [ref=e405]:
            - generic "Which grades and subjects? +" [ref=e406] [cursor=pointer]:
              - text: Which grades and subjects?
              - generic [ref=e407]: +
    - contentinfo [ref=e408]:
      - generic [ref=e409]:
        - generic [ref=e410]:
          - generic [ref=e411]:
            - generic [ref=e420]: Alfanumrik
            - paragraph [ref=e421]:
              - text: Structured learning for CBSE students
              - text: Cusiosense Learning India Pvt. Ltd.
          - generic [ref=e422]:
            - heading "Product" [level=4] [ref=e423]
            - generic [ref=e424]:
              - link "Pricing" [ref=e425] [cursor=pointer]:
                - /url: /pricing
              - link "For Schools" [ref=e426] [cursor=pointer]:
                - /url: /for-schools
              - link "Student Login" [ref=e427] [cursor=pointer]:
                - /url: /login
              - link "Parent Login" [ref=e428] [cursor=pointer]:
                - /url: /login?role=parent
              - link "Teacher Login" [ref=e429] [cursor=pointer]:
                - /url: /login?role=teacher
          - generic [ref=e430]:
            - heading "Contact & Legal" [level=4] [ref=e431]
            - generic [ref=e432]:
              - paragraph [ref=e433]: support@alfanumrik.com
              - link "Privacy Policy" [ref=e434] [cursor=pointer]:
                - /url: /privacy
              - link "Terms" [ref=e435] [cursor=pointer]:
                - /url: /terms
        - generic [ref=e436]:
          - paragraph [ref=e437]: © 2026 Cusiosense Learning India Pvt. Ltd. All rights reserved.
          - paragraph [ref=e438]: DPIIT Recognized · DPDPA Compliant · Data Encrypted · No Ads
```

# Test source

```ts
  11  |   test('all buttons have accessible names', async ({ page }) => {
  12  |     await page.goto('/welcome');
  13  |     await page.waitForLoadState('networkidle');
  14  | 
  15  |     const buttons = page.locator('button');
  16  |     const count = await buttons.count();
  17  |     expect(count).toBeGreaterThan(0);
  18  | 
  19  |     for (let i = 0; i < count; i++) {
  20  |       const button = buttons.nth(i);
  21  |       const visible = await button.isVisible();
  22  |       if (!visible) continue;
  23  | 
  24  |       // Each button should have either text content, aria-label, or aria-labelledby
  25  |       const text = (await button.textContent())?.trim();
  26  |       const ariaLabel = await button.getAttribute('aria-label');
  27  |       const ariaLabelledBy = await button.getAttribute('aria-labelledby');
  28  |       const title = await button.getAttribute('title');
  29  | 
  30  |       const hasAccessibleName = (text && text.length > 0) || ariaLabel || ariaLabelledBy || title;
  31  |       expect(
  32  |         hasAccessibleName,
  33  |         `Button at index ${i} has no accessible name. Text: "${text}", aria-label: "${ariaLabel}"`
  34  |       ).toBeTruthy();
  35  |     }
  36  |   });
  37  | 
  38  |   test('heading hierarchy has no skips (h1 before h2, h2 before h3)', async ({ page }) => {
  39  |     await page.goto('/welcome');
  40  |     await page.waitForLoadState('networkidle');
  41  | 
  42  |     // Get all headings in document order
  43  |     const headings = await page.evaluate(() => {
  44  |       const elements = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
  45  |       return Array.from(elements).map(el => ({
  46  |         tag: el.tagName.toLowerCase(),
  47  |         level: parseInt(el.tagName[1]),
  48  |         text: el.textContent?.trim().substring(0, 50) || '',
  49  |       }));
  50  |     });
  51  | 
  52  |     expect(headings.length).toBeGreaterThan(0);
  53  | 
  54  |     // First heading should be h1
  55  |     expect(headings[0].level).toBe(1);
  56  | 
  57  |     // Check no heading level is skipped (e.g., h1 then h3 without h2)
  58  |     let maxLevelSeen = 0;
  59  |     for (const heading of headings) {
  60  |       // Allow going back up (e.g., h3 then h2), but going down should not skip
  61  |       if (heading.level > maxLevelSeen + 1 && heading.level > maxLevelSeen) {
  62  |         // Only fail if we jump more than one level deeper
  63  |         expect(
  64  |           heading.level,
  65  |           `Heading "${heading.text}" (${heading.tag}) skips a level after max level ${maxLevelSeen}`
  66  |         ).toBeLessThanOrEqual(maxLevelSeen + 1);
  67  |       }
  68  |       maxLevelSeen = Math.max(maxLevelSeen, heading.level);
  69  |     }
  70  |   });
  71  | 
  72  |   test('page has exactly one h1', async ({ page }) => {
  73  |     await page.goto('/welcome');
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
> 111 |     expect(hindiLabel).toContain('English');
      |                        ^ Error: expect(received).toContain(expected) // indexOf
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
  174 |     await expect(page.locator('text=Student')).toBeVisible({ timeout: 10_000 });
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
```