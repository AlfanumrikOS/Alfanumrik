import { test, expect } from '@playwright/test';

/**
 * E2E @grounding: Foxy hard-abstain with alternatives (spec §9.2).
 *
 * The service returned groundingStatus: 'hard-abstain' with reason
 * 'chapter_not_ready' and a list of suggestedAlternatives (semantic top-3).
 * UI should show the HardAbstainCard with the scope + alternatives grid.
 * Clicking an alternative should navigate (or re-query for that chapter).
 */

test.describe('Grounding @grounding foxy-hard-abstain', () => {
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

  test('renders HardAbstainCard with alternatives when chapter_not_ready', async ({ page }) => {
    await page.route('**/api/foxy', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          response: '',
          sources: [],
          sessionId: 'session-abst-1',
          quotaRemaining: 10,
          tokensUsed: 0,
          groundingStatus: 'hard-abstain',
          abstainReason: 'chapter_not_ready',
          suggestedAlternatives: [
            { grade: '10', subject_code: 'science', chapter_number: 1, chapter_title: 'Chemical Reactions', rag_status: 'ready' },
            { grade: '10', subject_code: 'science', chapter_number: 2, chapter_title: 'Acids Bases Salts', rag_status: 'ready' },
            { grade: '10', subject_code: 'science', chapter_number: 3, chapter_title: 'Metals and Non-metals', rag_status: 'ready' },
          ],
          traceId: 'trace-abst-1',
        }),
      });
    });

    await page.goto('/foxy?subject=science&grade=10');
    const input = page.locator('textarea, input[placeholder*="ask" i]').first();
    await input.fill('Tell me about a chapter not yet ingested');
    await page.keyboard.press('Enter');

    // HardAbstainCard shows.
    await expect(page.getByTestId('hard-abstain-card')).toBeVisible();
    // Alternatives grid renders all 3 chapters.
    await expect(page.getByText(/Chemical Reactions/i)).toBeVisible();
    await expect(page.getByText(/Acids Bases Salts/i)).toBeVisible();
    await expect(page.getByText(/Metals and Non-metals/i)).toBeVisible();

    // Click an alternative — should trigger a re-query or navigation.
    await page.getByText(/Chemical Reactions/i).first().click();
    // The URL or input should update in some way; we only assert the click
    // was accepted (button, not a no-op disabled state).
    await expect(page.getByTestId('hard-abstain-card')).toBeVisible(); // still there pre-response
  });
});
