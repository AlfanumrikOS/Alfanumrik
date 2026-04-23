# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: smoke.spec.ts >> Landing Page >> renders hero section with CBSE badge and stats
- Location: e2e\smoke.spec.ts:34:7

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: locator('text=Adaptive Learning Platform for CBSE Grades')
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for locator('text=Adaptive Learning Platform for CBSE Grades')
    - waiting for" http://localhost:3000/welcome" navigation to finish...
    - navigated to "http://localhost:3000/welcome"

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
        - generic [ref=e49]: "1"
        - generic [ref=e50]: "2"
    - generic [ref=e55] [cursor=pointer]:
      - button "Open Next.js Dev Tools" [ref=e56]:
        - img [ref=e57]
      - generic [ref=e60]:
        - button "Open issues overlay" [ref=e61]:
          - generic [ref=e62]:
            - generic [ref=e63]: "1"
            - generic [ref=e64]: "2"
          - generic [ref=e65]:
            - text: Issue
            - generic [ref=e66]: s
        - button "Collapse issues badge" [ref=e67]:
          - img [ref=e68]
  - generic [ref=e70]:
    - img "Fox face" [ref=e71]: 🦊
    - heading "Something went wrong" [level=1] [ref=e72]
    - paragraph [ref=e73]: Foxy ran into a problem loading this page. Please try again.
    - generic [ref=e74]:
      - button "Try Again" [ref=e75] [cursor=pointer]
      - button "Go Home" [ref=e76] [cursor=pointer]
    - generic [ref=e77]: Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY
```

# Test source

```ts
  1   | import { test, expect } from '@playwright/test';
  2   | 
  3   | /**
  4   |  * E2E Smoke Tests -- Verify critical pages load without crashing.
  5   |  * Covers: landing page sections, language toggle, pricing, static pages,
  6   |  * auth pages, 404, and protected route redirects.
  7   |  *
  8   |  * Run: npx playwright test e2e/smoke.spec.ts
  9   |  */
  10  | 
  11  | /* ================================================================
  12  |  * Landing Page (/welcome)
  13  |  * ================================================================ */
  14  | test.describe('Landing Page', () => {
  15  |   test('loads welcome page with correct title', async ({ page }) => {
  16  |     await page.goto('/welcome');
  17  |     await expect(page).toHaveTitle(/Alfanumrik/);
  18  |     await expect(page.locator('h1')).toBeVisible();
  19  |   });
  20  | 
  21  |   test('has working CTA buttons linking to login', async ({ page }) => {
  22  |     await page.goto('/welcome');
  23  |     const startBtn = page.locator('a:has-text("Start Learning Free")');
  24  |     await expect(startBtn).toBeVisible();
  25  |     await expect(startBtn).toHaveAttribute('href', '/login');
  26  |   });
  27  | 
  28  |   test('has Sign Up Free button in navigation', async ({ page }) => {
  29  |     await page.goto('/welcome');
  30  |     const signUpBtn = page.locator('a:has-text("Sign Up Free")');
  31  |     await expect(signUpBtn).toBeVisible();
  32  |   });
  33  | 
  34  |   test('renders hero section with CBSE badge and stats', async ({ page }) => {
  35  |     await page.goto('/welcome');
  36  |     // CBSE badge
> 37  |     await expect(page.locator('text=Adaptive Learning Platform for CBSE Grades')).toBeVisible();
      |                                                                                   ^ Error: expect(locator).toBeVisible() failed
  38  |     // Hero headline
  39  |     await expect(page.locator('h1')).toContainText('child');
  40  |     // Stats bar
  41  |     await expect(page.locator('text=16')).toBeVisible(); // 16 subjects
  42  |     await expect(page.locator('text=6\u201312')).toBeVisible(); // Grades 6-12
  43  |   });
  44  | 
  45  |   test('renders Trust and Recognition section', async ({ page }) => {
  46  |     await page.goto('/welcome');
  47  |     await expect(page.locator('text=DPIIT Recognized')).toBeVisible();
  48  |     await expect(page.locator('text=DPDPA Compliant')).toBeVisible();
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
```