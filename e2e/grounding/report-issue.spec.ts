import { test, expect } from '@playwright/test';
import { loginViaUI } from '../helpers/auth';

/**
 * E2E @grounding: Report-an-issue modal + POST /api/support/ai-issue.
 *
 * Student clicks the "Report an issue" action on a Foxy reply. A modal
 * opens. Student fills in reason + comment and submits. The client POSTs
 * to /api/support/ai-issue. Response drives a success toast.
 *
 * Intercepts:
 *   1. POST /api/foxy — return a grounded answer so the bubble renders.
 *   2. POST /api/support/ai-issue — return { success: true }.
 */

test.describe('Grounding @grounding report-issue', () => {
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

  test('report-issue modal posts to /api/support/ai-issue and shows confirmation', async ({ page }) => {
    await page.route('**/api/foxy', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          response: 'Force equals mass times acceleration.',
          sources: [{ chapter: 'Force', chunk_index: 0, snippet: 'F=ma.' }],
          sessionId: 'session-ri-1',
          quotaRemaining: 10,
          tokensUsed: 120,
          groundingStatus: 'grounded',
          confidence: 0.92,
          traceId: 'trace-ri-1',
        }),
      });
    });

    const issuePosts: unknown[] = [];
    await page.route('**/api/support/ai-issue', async (route) => {
      const payload = route.request().postDataJSON();
      issuePosts.push(payload);
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, id: 'issue-1' }),
      });
    });

    await page.goto('/foxy?subject=science&grade=10');
    const input = page.locator('textarea, input[placeholder*="ask" i]').first();
    await input.fill('What is force?');
    await page.keyboard.press('Enter');

    // Wait for the reply bubble.
    await expect(page.getByText(/Force equals mass times acceleration/i)).toBeVisible();

    // Click "Report an issue" / flag icon on the tutor bubble.
    const reportLink = page.getByRole('button', { name: /report.*issue|flag/i }).first();
    await reportLink.click();

    // Fill the modal form.
    await page.getByLabel(/reason|category/i).first().selectOption({ index: 1 }).catch(async () => {
      // Fallback: if it's a radio group, click the first option
      await page.getByRole('radio').first().click();
    });
    const commentBox = page.locator('textarea').first();
    await commentBox.fill('This answer is incorrect — f=ma is Newton\u2019s 2nd law, not a definition of force.');

    // Submit.
    await page.getByRole('button', { name: /submit|send|report/i }).click();

    // A POST should have fired.
    await expect.poll(() => issuePosts.length).toBeGreaterThan(0);

    // A success toast or confirmation should appear.
    const confirmation = page.getByText(/thanks|submitted|reported|received/i).first();
    await expect(confirmation).toBeVisible();
  });
});
