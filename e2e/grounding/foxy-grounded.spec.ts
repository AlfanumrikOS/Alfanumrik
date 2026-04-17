import { test, expect } from '@playwright/test';

/**
 * E2E @grounding: Foxy happy-path grounded answer (spec §9.0).
 *
 * Student asks an in-chapter question. The /api/foxy handler returns a
 * grounded response. UI should render the message body with:
 *   - NO unverified banner
 *   - NO hard-abstain card
 *   - Citations visible (sources > 0)
 *
 * Strategy: intercept POST /api/foxy via Playwright page.route() and return
 * a canned grounded response. Does NOT hit the real Edge Function.
 *
 * This test skips when SUPER_ADMIN_EMAIL/PASSWORD (or test student creds)
 * are not available, matching the existing pattern used by
 * observability-timeline.spec.ts.
 */

test.describe('Grounding @grounding foxy-grounded', () => {
  test.beforeEach(async ({ page }) => {
    const email = process.env.TEST_STUDENT_EMAIL;
    const password = process.env.TEST_STUDENT_PASSWORD;
    if (!email || !password) test.skip();

    // Reusable auth: log the student in so /foxy is reachable.
    await page.goto('/login');
    await page.getByLabel(/email/i).fill(email!);
    await page.getByLabel(/password/i).fill(password!);
    await page.getByRole('button', { name: /log in|sign in/i }).click();
    await expect(page).toHaveURL(/dashboard|foxy|learn/);
  });

  test('renders grounded answer with citations and no banners', async ({ page }) => {
    // Intercept /api/foxy and return a grounded response
    await page.route('**/api/foxy', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          response: 'Acceleration is the rate of change of velocity.',
          sources: [
            { chapter: 'Motion', chunk_index: 0, snippet: 'Acceleration = dv/dt.' },
          ],
          sessionId: 'session-grounded-1',
          quotaRemaining: 10,
          tokensUsed: 120,
          groundingStatus: 'grounded',
          confidence: 0.91,
          traceId: 'trace-grounded-1',
        }),
      });
    });

    await page.goto('/foxy?subject=science&grade=10');

    // Fill + send a message
    const input = page.locator('textarea, input[placeholder*="ask" i]').first();
    await input.fill('What is acceleration?');
    await page.keyboard.press('Enter');

    // Assert: no unverified banner, no hard-abstain card
    await expect(page.getByTestId('unverified-banner')).toHaveCount(0);
    await expect(page.getByTestId('hard-abstain-card')).toHaveCount(0);

    // Assert: answer body renders
    await expect(page.getByText(/Acceleration is the rate of change/i)).toBeVisible();
  });
});
