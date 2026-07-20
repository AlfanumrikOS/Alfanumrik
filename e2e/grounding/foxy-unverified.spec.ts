import { test, expect } from '@playwright/test';
import { loginViaUI } from '../helpers/auth';

/**
 * E2E @grounding: Foxy unverified (low-confidence) answer (spec §9.1).
 *
 * The service returned grounded:true but confidence < SOFT_CONFIDENCE_BANNER_THRESHOLD.
 * UI should render the answer + amber UnverifiedBanner advising the student
 * to double-check with their NCERT book.
 *
 * Intercepts /api/foxy.
 */

test.describe('Grounding @grounding foxy-unverified', () => {
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

  test('renders unverified banner when confidence is low', async ({ page }) => {
    await page.route('**/api/foxy', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          response: 'This is a best-guess explanation.',
          sources: [],
          sessionId: 'session-unv-1',
          quotaRemaining: 10,
          tokensUsed: 80,
          groundingStatus: 'unverified',
          // Below SOFT_CONFIDENCE_BANNER_THRESHOLD — triggers banner
          confidence: 0.4,
          traceId: 'trace-unv-1',
        }),
      });
    });

    await page.goto('/foxy?subject=science&grade=10');
    const input = page.locator('textarea, input[placeholder*="ask" i]').first();
    await input.fill('A tricky question outside of NCERT');
    await page.keyboard.press('Enter');

    // Banner appears, message body also renders.
    await expect(page.getByTestId('unverified-banner')).toBeVisible();
    await expect(page.getByText(/This is a best-guess explanation/i)).toBeVisible();

    // No hard-abstain card.
    await expect(page.getByTestId('hard-abstain-card')).toHaveCount(0);
  });
});
