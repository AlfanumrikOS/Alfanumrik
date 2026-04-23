# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: auth-flow.spec.ts >> Welcome page (unauthenticated) >> renders for unauthenticated users with hero content
- Location: e2e\auth-flow.spec.ts:33:7

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: locator('a:has-text("Start Learning Free")')
Expected: visible
Error: strict mode violation: locator('a:has-text("Start Learning Free")') resolved to 2 elements:
    1) <a href="/login" class="text-base px-8 py-4 rounded-xl font-bold text-white w-full sm:w-auto text-center">Start Learning Free</a> aka locator('#hero-cta').getByRole('link', { name: 'Start Learning Free' })
    2) <a href="/login" class="inline-block text-base px-10 py-4 rounded-2xl font-bold text-white">Start Learning Free</a> aka locator('#final-cta').getByRole('link', { name: 'Start Learning Free' })

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for locator('a:has-text("Start Learning Free")')

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
  - button "Open Next.js Dev Tools" [ref=e444] [cursor=pointer]:
    - img [ref=e445]
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
> 37 |     await expect(page.locator('a:has-text("Start Learning Free")')).toBeVisible();
     |                                                                     ^ Error: expect(locator).toBeVisible() failed
  38 |   });
  39 | });
  40 | 
  41 | test.describe('Protected route redirects', () => {
  42 |   test('/dashboard redirects unauthenticated to /login or /welcome', async ({ page }) => {
  43 |     await page.goto('/dashboard');
  44 |     await page.waitForURL(/\/(welcome|login)/, { timeout: 10_000 });
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