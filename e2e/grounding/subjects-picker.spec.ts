import { test, expect } from '@playwright/test';
import { loginViaUI } from '../helpers/auth';

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
    // Shared login helper (2026-07-20, CI run 29716158705 triage):
    //  - skips with a named precondition when TEST_STUDENT_* are absent, OR
    //    when the target Supabase affirmatively rejects them (staging test
    //    student not seeded -- run .github/workflows/seed-staging-test-student.yml);
    //  - replaces the previous inline login, whose getByLabel(/password/i)
    //    strict-mode-throws against the live login form (3 elements match:
    //    input + "Show password" toggle + "Forgot password?" link).
    const ok = await loginViaUI(page);
    test.skip(!ok, 'requires TEST_STUDENT_EMAIL + TEST_STUDENT_PASSWORD secrets');
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
