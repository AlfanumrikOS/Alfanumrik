import { test, expect, type Page } from '@playwright/test';
import { mockStudentSession } from './helpers/auth';

/**
 * Account-deletion (DPDP §17) UI flow.
 *
 * What this covers (frontend D7.2):
 *   1. Authenticated-only access — anonymous loads bounce to /login.
 *   2. Happy path — open page → fill reason + email → confirm modal →
 *      type DELETE → submit → see cooling-off State B.
 *   3. Cancel happy path — State B → cancel button → confirm → see
 *      green "Deletion cancelled" State C.
 *   4. Wrong email rejection — type a non-matching email → server
 *      returns 400 CONFIRM_EMAIL_MISMATCH → user-facing inline error.
 *
 * What this does NOT cover (out of scope, owned by backend tests):
 *   - 8-year payment-record retention assertions (DB-level)
 *   - Razorpay subscription cancellation atomicity (server integration)
 *   - 30-day purge cron behaviour (cron tests)
 *
 * Strategy:
 *   We mock both Supabase auth (via existing mockStudentSession helper) AND
 *   the /api/v1/account/delete endpoint with `page.route()`. This lets each
 *   test set its own GET/POST/DELETE response without touching a live DB.
 *
 * Run: npx playwright test e2e/account-deletion-flow.spec.ts
 */

const ACCOUNT_EMAIL = 'student@test.alfanumrik.com';

interface RouteState {
  // What GET /api/v1/account/delete returns next
  status:
    | 'none' // → 404
    | 'requested'
    | 'cancelled_by_user';
  // What POST returns
  postStatus: 201 | 400 | 503;
  postBodyOverride?: Record<string, unknown>;
  // What DELETE returns
  deleteStatus: 200 | 410 | 503;
}

async function installDeletionApiMocks(page: Page, state: RouteState): Promise<void> {
  await page.route('**/api/v1/account/delete', async (route) => {
    const method = route.request().method();
    const now = new Date();
    const purgeDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    if (method === 'GET') {
      if (state.status === 'none') {
        await route.fulfill({
          status: 404,
          contentType: 'application/json',
          body: JSON.stringify({ success: false, error: 'No deletion request found', code: 'NO_REQUEST' }),
        });
        return;
      }
      const status = state.status;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            deletion_id: 'mock-deletion-id-1',
            status,
            requested_at: now.toISOString(),
            cooling_off_ends_at: purgeDate.toISOString(),
            completed_at: null,
            purged_categories: {},
            can_cancel: status === 'requested',
          },
        }),
      });
      return;
    }

    if (method === 'POST') {
      if (state.postStatus === 201) {
        // Flip the next GET to 'requested' so the SWR refresh shows State B.
        state.status = 'requested';
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: {
              deletion_id: 'mock-deletion-id-1',
              cooling_off_ends_at: purgeDate.toISOString(),
              can_cancel: true,
              idempotent_replay: false,
              subscription_outcome: 'no_active_subscription',
            },
          }),
        });
        return;
      }
      if (state.postStatus === 400) {
        await route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify(
            state.postBodyOverride ?? {
              success: false,
              error: 'confirmEmail does not match account email',
              code: 'CONFIRM_EMAIL_MISMATCH',
            },
          ),
        });
        return;
      }
      // 503
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, error: 'RPC failed', code: 'RPC_FAILED' }),
      });
      return;
    }

    if (method === 'DELETE') {
      if (state.deleteStatus === 200) {
        state.status = 'cancelled_by_user';
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, data: { cancelled: true } }),
        });
        return;
      }
      if (state.deleteStatus === 410) {
        await route.fulfill({
          status: 410,
          contentType: 'application/json',
          body: JSON.stringify({
            success: false,
            error: 'Cooling-off window has ended',
            code: 'COOLING_OFF_ENDED',
          }),
        });
        return;
      }
      // 503
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, error: 'RPC failed', code: 'RPC_FAILED' }),
      });
      return;
    }

    await route.continue();
  });
}

/**
 * The page reads accountEmail from useAuth().student.email. mockStudentSession
 * does not set an email by default — patch the students REST mock to inject
 * one.
 */
async function patchStudentEmail(page: Page, email: string): Promise<void> {
  await page.route('**/rest/v1/students**', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: 'mock-student-id-0000-0000-0000-000000000001',
            auth_user_id: 'mock-user-uuid-0000-0000-0000-000000000001',
            name: 'Test student',
            email,
            grade: '9',
            board: 'CBSE',
            onboarding_completed: true,
            xp_total: 0,
            streak_days: 0,
          },
        ]),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([{ id: 'mock-student-id-0000-0000-0000-000000000001' }]),
    });
  });
}

test.describe('Account deletion (DPDP §17) — frontend flow', () => {
  test('redirects unauthenticated visitors to /login', async ({ page }) => {
    await page.goto('/settings/account/delete');
    // Either /login or /welcome (middleware may bounce to either).
    await page.waitForURL(/\/(login|welcome)/, { timeout: 10_000 });
  });

  test('happy path: submit deletion → see cooling-off state', async ({ page }) => {
    const state: RouteState = {
      status: 'none',
      postStatus: 201,
      deleteStatus: 200,
    };
    await mockStudentSession(page, { onboardingCompleted: true });
    await patchStudentEmail(page, ACCOUNT_EMAIL);
    await installDeletionApiMocks(page, state);

    await page.goto('/settings/account/delete');

    // State A renders the heading.
    await expect(page.locator('h2:has-text("Delete your account")')).toBeVisible({
      timeout: 10_000,
    });

    // Fill the form with a valid reason and matching email.
    await page
      .getByTestId('deletion-reason-input')
      .fill('I no longer use the platform — switching to a different tutor.');
    await page.getByTestId('deletion-confirm-email-input').fill(ACCOUNT_EMAIL);

    // Open the confirm modal.
    await page.getByTestId('deletion-open-confirm-button').click();

    // Modal asks the user to type DELETE.
    await expect(page.locator('text=Are you absolutely sure?')).toBeVisible();
    await page.getByTestId('deletion-confirm-text-input').fill('DELETE');

    // Submit.
    await page.getByTestId('deletion-final-submit-button').click();

    // After SWR revalidates, State B renders.
    await expect(
      page.locator('h2:has-text("Account deletion in progress")'),
    ).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('text=days remaining')).toBeVisible();
  });

  test('cancel happy path: cooling-off → cancel → see cancelled state', async ({ page }) => {
    const state: RouteState = {
      status: 'requested',
      postStatus: 201,
      deleteStatus: 200,
    };
    await mockStudentSession(page, { onboardingCompleted: true });
    await patchStudentEmail(page, ACCOUNT_EMAIL);
    await installDeletionApiMocks(page, state);

    await page.goto('/settings/account/delete');

    // State B is the entry point.
    await expect(
      page.locator('h2:has-text("Account deletion in progress")'),
    ).toBeVisible({ timeout: 10_000 });

    // Open cancel modal.
    await page.getByTestId('deletion-cancel-open-button').click();
    await expect(page.locator('text=Cancel deletion?')).toBeVisible();

    // Confirm.
    await page.getByTestId('deletion-cancel-confirm-button').click();

    // State C renders the success notice.
    await expect(page.getByTestId('deletion-cancelled-success')).toBeVisible({
      timeout: 10_000,
    });
    await expect(
      page.locator('text=Deletion cancelled successfully'),
    ).toBeVisible();
  });

  test('wrong email is rejected with a bilingual inline error', async ({ page }) => {
    const state: RouteState = {
      status: 'none',
      postStatus: 400,
      deleteStatus: 200,
    };
    await mockStudentSession(page, { onboardingCompleted: true });
    await patchStudentEmail(page, ACCOUNT_EMAIL);
    await installDeletionApiMocks(page, state);

    await page.goto('/settings/account/delete');
    await expect(page.locator('h2:has-text("Delete your account")')).toBeVisible({
      timeout: 10_000,
    });

    await page
      .getByTestId('deletion-reason-input')
      .fill('Trying with the wrong email to verify the guard works.');
    // Different email than the account → client-side error fires first.
    await page
      .getByTestId('deletion-confirm-email-input')
      .fill('attacker@example.com');

    // Client-side validation fires immediately and the button stays disabled,
    // proving the email guard before any network call.
    await expect(page.getByTestId('deletion-open-confirm-button')).toBeDisabled();

    // Now correct the email so the button enables, then we still verify the
    // server-side guard by patching the post mock to return mismatch.
    await page
      .getByTestId('deletion-confirm-email-input')
      .fill(ACCOUNT_EMAIL);
    await expect(page.getByTestId('deletion-open-confirm-button')).toBeEnabled();
    await page.getByTestId('deletion-open-confirm-button').click();
    await page.getByTestId('deletion-confirm-text-input').fill('DELETE');
    await page.getByTestId('deletion-final-submit-button').click();

    // Server returned 400 CONFIRM_EMAIL_MISMATCH → bilingual error surfaced.
    await expect(page.getByTestId('deletion-server-error')).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByTestId('deletion-server-error')).toContainText(
      /does not match|मेल नहीं खाता/,
    );
  });
});
