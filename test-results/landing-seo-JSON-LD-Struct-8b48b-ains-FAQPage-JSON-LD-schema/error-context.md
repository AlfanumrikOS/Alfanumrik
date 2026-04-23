# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: landing-seo.spec.ts >> JSON-LD Structured Data >> welcome page contains FAQPage JSON-LD schema
- Location: e2e\landing-seo.spec.ts:11:7

# Error details

```
Error: expect(locator).toBeAttached() failed

Locator: locator('script[type="application/ld+json"]')
Expected: attached
Error: strict mode violation: locator('script[type="application/ld+json"]') resolved to 3 elements:
    1) <script type="application/ld+json">{"@context":"https://schema.org","@type":["Organi…</script> aka locator('script:nth-child(42)')
    2) <script type="application/ld+json">{"@context":"https://schema.org","@type":"WebAppl…</script> aka locator('script:nth-child(43)')
    3) <script type="application/ld+json">{"@context":"https://schema.org","@type":"FAQPage…</script> aka locator('div > script')

Call log:
  - Expect "toBeAttached" with timeout 5000ms
  - waiting for locator('script[type="application/ld+json"]')

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
  1   | import { test, expect } from '@playwright/test';
  2   | 
  3   | /**
  4   |  * E2E SEO Tests -- Verify structured data, meta tags, sitemap, and robots.txt.
  5   |  * These tests ensure search engine crawlability and proper indexing signals.
  6   |  *
  7   |  * Run: npx playwright test e2e/landing-seo.spec.ts
  8   |  */
  9   | 
  10  | test.describe('JSON-LD Structured Data', () => {
  11  |   test('welcome page contains FAQPage JSON-LD schema', async ({ page }) => {
  12  |     await page.goto('/welcome');
  13  |     const jsonLd = page.locator('script[type="application/ld+json"]');
> 14  |     await expect(jsonLd).toBeAttached();
      |                          ^ Error: expect(locator).toBeAttached() failed
  15  | 
  16  |     const content = await jsonLd.textContent();
  17  |     expect(content).toBeTruthy();
  18  | 
  19  |     const schema = JSON.parse(content!);
  20  |     expect(schema['@context']).toBe('https://schema.org');
  21  |     expect(schema['@type']).toBe('FAQPage');
  22  |     expect(schema.mainEntity).toBeInstanceOf(Array);
  23  |     expect(schema.mainEntity.length).toBeGreaterThan(0);
  24  |     // Each FAQ item should have Question type
  25  |     expect(schema.mainEntity[0]['@type']).toBe('Question');
  26  |     expect(schema.mainEntity[0].acceptedAnswer['@type']).toBe('Answer');
  27  |   });
  28  | });
  29  | 
  30  | test.describe('Meta Tags - Welcome Page', () => {
  31  |   test('has og:title meta tag', async ({ page }) => {
  32  |     await page.goto('/welcome');
  33  |     const ogTitle = page.locator('meta[property="og:title"]');
  34  |     await expect(ogTitle).toBeAttached();
  35  |     const content = await ogTitle.getAttribute('content');
  36  |     expect(content).toBeTruthy();
  37  |     expect(content).toContain('Alfanumrik');
  38  |   });
  39  | 
  40  |   test('has og:description meta tag', async ({ page }) => {
  41  |     await page.goto('/welcome');
  42  |     const ogDesc = page.locator('meta[property="og:description"]');
  43  |     await expect(ogDesc).toBeAttached();
  44  |     const content = await ogDesc.getAttribute('content');
  45  |     expect(content).toBeTruthy();
  46  |     expect(content!.length).toBeGreaterThan(20);
  47  |   });
  48  | 
  49  |   test('has canonical URL meta tag', async ({ page }) => {
  50  |     await page.goto('/welcome');
  51  |     const canonical = page.locator('link[rel="canonical"]');
  52  |     await expect(canonical).toBeAttached();
  53  |     const href = await canonical.getAttribute('href');
  54  |     expect(href).toContain('alfanumrik.com/welcome');
  55  |   });
  56  | 
  57  |   test('has description meta tag', async ({ page }) => {
  58  |     await page.goto('/welcome');
  59  |     const desc = page.locator('meta[name="description"]');
  60  |     await expect(desc).toBeAttached();
  61  |     const content = await desc.getAttribute('content');
  62  |     expect(content).toBeTruthy();
  63  |     expect(content!.length).toBeGreaterThan(50);
  64  |   });
  65  | 
  66  |   test('has keywords meta tag', async ({ page }) => {
  67  |     await page.goto('/welcome');
  68  |     const keywords = page.locator('meta[name="keywords"]');
  69  |     await expect(keywords).toBeAttached();
  70  |     const content = await keywords.getAttribute('content');
  71  |     expect(content).toContain('CBSE');
  72  |   });
  73  | 
  74  |   test('has twitter card meta tag', async ({ page }) => {
  75  |     await page.goto('/welcome');
  76  |     const twitterCard = page.locator('meta[name="twitter:card"]');
  77  |     await expect(twitterCard).toBeAttached();
  78  |     const content = await twitterCard.getAttribute('content');
  79  |     expect(content).toBe('summary_large_image');
  80  |   });
  81  | 
  82  |   test('does not block indexing (no noindex)', async ({ page }) => {
  83  |     await page.goto('/welcome');
  84  |     const robots = page.locator('meta[name="robots"]');
  85  |     // Either robots meta is absent (allowing indexing by default)
  86  |     // or if present, it should not contain "noindex"
  87  |     const count = await robots.count();
  88  |     if (count > 0) {
  89  |       const content = await robots.getAttribute('content');
  90  |       expect(content).not.toContain('noindex');
  91  |     }
  92  |     // If no robots meta, indexing is allowed by default -- test passes
  93  |   });
  94  | });
  95  | 
  96  | test.describe('Meta Tags - Pricing Page', () => {
  97  |   test('has og:title and og:description', async ({ page }) => {
  98  |     await page.goto('/pricing');
  99  |     const ogTitle = page.locator('meta[property="og:title"]');
  100 |     await expect(ogTitle).toBeAttached();
  101 |     const titleContent = await ogTitle.getAttribute('content');
  102 |     expect(titleContent).toContain('Pricing');
  103 | 
  104 |     const ogDesc = page.locator('meta[property="og:description"]');
  105 |     await expect(ogDesc).toBeAttached();
  106 |   });
  107 | 
  108 |   test('has canonical URL for pricing', async ({ page }) => {
  109 |     await page.goto('/pricing');
  110 |     const canonical = page.locator('link[rel="canonical"]');
  111 |     await expect(canonical).toBeAttached();
  112 |     const href = await canonical.getAttribute('href');
  113 |     expect(href).toContain('alfanumrik.com/pricing');
  114 |   });
```