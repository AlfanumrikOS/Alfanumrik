import { test, expect } from '@playwright/test';

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
    const email = process.env.TEST_STUDENT_EMAIL;
    const password = process.env.TEST_STUDENT_PASSWORD;
    if (!email || !password) test.skip();

    await page.goto('/login');
    await page.getByLabel(/email/i).fill(email!);
    await page.getByLabel(/password/i).fill(password!);
    await page.getByRole('button', { name: /log in|sign in/i }).click();
    await expect(page).toHaveURL(/dashboard|foxy|learn/);
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
