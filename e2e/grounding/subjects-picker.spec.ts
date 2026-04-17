import { test, expect } from '@playwright/test';

/**
 * E2E @grounding: /learn subject picker shows only ready chapters.
 *
 * The chapters API (src/app/api/student/chapters/route.ts) returns only
 * chapters where rag_status = 'ready'. This E2E intercepts that response
 * with a fixed set of ready + not_ready chapters and asserts the UI hides
 * the not-ready ones.
 */

test.describe('Grounding @grounding subjects-picker', () => {
  test.beforeEach(async ({ page }) => {
    const email = process.env.TEST_STUDENT_EMAIL;
    const password = process.env.TEST_STUDENT_PASSWORD;
    if (!email || !password) test.skip();

    await page.goto('/login');
    await page.getByLabel(/email/i).fill(email!);
    await page.getByLabel(/password/i).fill(password!);
    await page.getByRole('button', { name: /log in|sign in/i }).click();
    await expect(page).toHaveURL(/dashboard|foxy|learn/);
  });

  test('only ready chapters render in the picker', async ({ page }) => {
    await page.route('**/api/student/chapters**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            chapters: [
              { chapter_number: 1, chapter_title: 'Chemical Reactions', rag_status: 'ready', chunk_count: 42 },
              { chapter_number: 2, chapter_title: 'Acids Bases Salts', rag_status: 'ready', chunk_count: 38 },
              // This one is NOT ready — API should filter it out. Included
              // here as a negative-control: if the API forwards it, the UI
              // would show it and this test would fail.
              { chapter_number: 3, chapter_title: 'Metals and Non-metals', rag_status: 'ingesting', chunk_count: 0 },
            ],
          },
        }),
      });
    });

    await page.goto('/learn/science');

    // Assert: ready chapters are visible.
    await expect(page.getByText(/Chemical Reactions/i)).toBeVisible();
    await expect(page.getByText(/Acids Bases Salts/i)).toBeVisible();

    // The "ingesting" chapter should not appear in the picker — this is a
    // negative assertion; the API should never have returned it, but we
    // check the UI too in case of future regressions.
    await expect(page.getByText(/Metals and Non-metals/i)).toHaveCount(0);
  });
});
