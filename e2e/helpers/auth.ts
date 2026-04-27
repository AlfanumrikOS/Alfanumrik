import type { Page } from '@playwright/test';

/**
 * Shared E2E auth helpers.
 *
 * Strategy: in CI we have no real Supabase test user seeded, so we mock the
 * Supabase token endpoint and `students` REST endpoint such that AuthContext
 * resolves a valid student session without contacting a live backend.
 *
 * Tests that need a *real* logged-in session (e.g. for backend-side P3
 * anti-cheat enforcement) should `test.fixme(true, '<reason>')` until a
 * dedicated test-user fixture is wired in CI. The mocked path here is only
 * useful for asserting client-side flows.
 *
 * If `TEST_STUDENT_EMAIL` + `TEST_STUDENT_PASSWORD` are present, callers can
 * choose to take the real-login path via `loginViaUI()` instead.
 */

const MOCK_USER_ID = 'mock-user-uuid-0000-0000-0000-000000000001';
const MOCK_STUDENT_ID = 'mock-student-id-0000-0000-0000-000000000001';

export function buildSupabaseSession(role: 'student' | 'teacher' | 'guardian' = 'student') {
  return {
    access_token: 'mock-access-token',
    refresh_token: 'mock-refresh-token',
    token_type: 'bearer',
    expires_in: 3600,
    user: {
      id: MOCK_USER_ID,
      email: `${role}@test.alfanumrik.com`,
      app_metadata: { provider: 'email' },
      user_metadata: { role, name: `Test ${role}`, grade: '9', board: 'CBSE' },
      aud: 'authenticated',
      created_at: new Date().toISOString(),
    },
  };
}

/**
 * Install network mocks that make AuthContext think it has an authenticated
 * student session. Call before `page.goto(...)`.
 */
export async function mockStudentSession(page: Page, opts?: {
  xpTotal?: number;
  streakDays?: number;
  onboardingCompleted?: boolean;
}): Promise<void> {
  const session = buildSupabaseSession('student');
  await page.route('**/auth/v1/token**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(session),
    });
  });
  await page.route('**/auth/v1/user**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(session.user),
    });
  });
  await page.route('**/rest/v1/students**', async (route) => {
    const method = route.request().method();
    if (method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([{
          id: MOCK_STUDENT_ID,
          auth_user_id: MOCK_USER_ID,
          name: 'Test student',
          grade: '9',
          board: 'CBSE',
          onboarding_completed: opts?.onboardingCompleted ?? true,
          xp_total: opts?.xpTotal ?? 0,
          streak_days: opts?.streakDays ?? 0,
        }]),
      });
    } else {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([{ id: MOCK_STUDENT_ID }]),
      });
    }
  });
}

export const TEST_IDS = {
  MOCK_USER_ID,
  MOCK_STUDENT_ID,
};

/**
 * Real-login path. Returns true on success, false if env vars are missing
 * (caller should test.skip() in that case).
 */
export async function loginViaUI(page: Page): Promise<boolean> {
  const email = process.env.TEST_STUDENT_EMAIL;
  const password = process.env.TEST_STUDENT_PASSWORD;
  if (!email || !password) return false;

  await page.goto('/login');
  // The login form has 3 elements matching /password/i (the input itself
  // plus "Show password" toggle + "Forgot password?" link). Use exact label
  // match to disambiguate to the actual input. AuthScreen.tsx:387 sets
  // aria-label="Password" on the input.
  await page.getByLabel(/^email/i).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: /^log in$|^sign in$/i }).click();
  await page.waitForURL(/dashboard|foxy|learn|quiz|onboarding/, { timeout: 15_000 });
  return true;
}

export function hasRealStudentCreds(): boolean {
  return Boolean(process.env.TEST_STUDENT_EMAIL && process.env.TEST_STUDENT_PASSWORD);
}
