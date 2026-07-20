import { test, type Page } from '@playwright/test';

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

/**
 * The DPDP cookie-consent banner (packages/ui/src/CookieConsent.tsx) renders a
 * fixed full-width bottom bar (z-index 9999) until a consent level is stored
 * under `alfanumrik_cookie_consent`. In headless runs it overlays every
 * bottom-anchored control (AlfaBot launcher, modal submit buttons, footer
 * accordions) and its "Accept All" button intercepts their pointer events —
 * observed as 90s click timeouts in CI run 29716158705 and reproduced locally
 * (alfabot + account-deletion specs). Seed 'essential' BEFORE any page script
 * runs so the banner never mounts. 'essential' (not 'all') also keeps Vercel
 * Analytics/SpeedInsights out of test traffic.
 */
export async function seedCookieConsent(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.setItem('alfanumrik_cookie_consent', 'essential');
  });
}

function supabaseStorageKey(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
  try {
    const host = new URL(url).hostname;
    const projectRef = host.split('.')[0] || 'placeholder';
    return `sb-${projectRef}-auth-token`;
  } catch {
    return 'sb-placeholder-auth-token';
  }
}

export function buildSupabaseSession(role: 'student' | 'teacher' | 'guardian' = 'student') {
  const expiresIn = 3600;
  return {
    access_token: 'mock-access-token',
    refresh_token: 'mock-refresh-token',
    token_type: 'bearer',
    expires_in: expiresIn,
    expires_at: Math.floor(Date.now() / 1000) + expiresIn,
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
  const student = {
    id: MOCK_STUDENT_ID,
    auth_user_id: MOCK_USER_ID,
    name: 'Test student',
    grade: '9',
    board: 'CBSE',
    onboarding_completed: opts?.onboardingCompleted ?? true,
    xp_total: opts?.xpTotal ?? 0,
    streak_days: opts?.streakDays ?? 0,
  };
  const storageKeys = Array.from(new Set([supabaseStorageKey(), 'sb-placeholder-auth-token']));
  await seedCookieConsent(page);
  await page.addInitScript(
    ({ keys, value }) => {
      for (const key of keys) {
        window.localStorage.setItem(key, JSON.stringify(value));
      }
      window.localStorage.setItem('alfanumrik_active_role', 'student');
    },
    { keys: storageKeys, value: session },
  );
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
  await page.route('**/rest/v1/rpc/get_user_role**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        roles: ['student'],
        primary_role: 'student',
        student: {
          id: MOCK_STUDENT_ID,
          name: student.name,
          grade: student.grade,
          board: student.board,
          onboarding_completed: student.onboarding_completed,
        },
      }),
    });
  });
  await page.route('**/rest/v1/students**', async (route) => {
    const method = route.request().method();
    if (method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([student]),
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
 *
 * Missing-fixture detection (CI run 29716158705 triage): a job may supply
 * TEST_STUDENT_* against a Supabase project where the test student is not
 * provisioned. When the target Supabase AFFIRMATIVELY rejects the credentials
 * (AuthScreen's #auth-error alert shows the Supabase message), we skip with
 * the named missing precondition instead of burning the 15s navigation wait
 * twice per test — but ONLY when the job opts in by setting
 * `E2E_SKIP_ON_UNPROVISIONED_STUDENT=1` (set exclusively by the reusable
 * .github/workflows/e2e-suite.yml in ADVISORY mode — the label-gated PR
 * caller in ci.yml; the NIGHTLY caller runs advisory=false, which leaves
 * the flag unset so a missing fixture reddens the nightly). Without that
 * opt-in, every
 * auth-error alert THROWS: the BLOCKING e2e-critical-paths job also flows
 * through this helper (quiz-happy-path.spec.ts, payment-checkout.spec.ts
 * against production), and a rotated/deleted prod student or a client
 * regression that mangles credentials must turn that gate red, never
 * green-with-skip. Any OTHER login failure (broken form, no error surfaced,
 * timeout) always fails loudly — this is precondition detection, not
 * failure suppression.
 */
export async function loginViaUI(page: Page): Promise<boolean> {
  const email = process.env.TEST_STUDENT_EMAIL;
  const password = process.env.TEST_STUDENT_PASSWORD;
  if (!email || !password) return false;

  await seedCookieConsent(page);
  await page.goto('/login');
  // The login form has 3 elements matching /password/i (the input itself
  // plus "Show password" toggle + "Forgot password?" link). Use exact label
  // match to disambiguate to the actual input. AuthScreen.tsx:387 sets
  // aria-label="Password" on the input.
  await page.getByLabel(/^email/i).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: /^log in$|^sign in$/i }).click();

  // AuthScreen renders sign-in errors in <div id="auth-error" role="alert">.
  const authError = page.locator('#auth-error');
  const outcome = await Promise.race([
    page
      .waitForURL(/dashboard|foxy|learn|quiz|onboarding/, { timeout: 15_000 })
      .then(() => 'navigated' as const, () => 'nav-timeout' as const),
    // The alert waiter can only win this race by becoming VISIBLE: its 20s
    // timeout fires after the 15s nav-timeout above has already settled the
    // race, so its rejection is unreachable as a race outcome — fold it into
    // 'nav-timeout' instead of inventing a dead branch.
    authError
      .waitFor({ state: 'visible', timeout: 20_000 })
      .then(() => 'auth-error' as const, () => 'nav-timeout' as const),
  ]);

  if (outcome === 'navigated') return true;

  const errorVisible =
    outcome === 'auth-error' || (await authError.isVisible().catch(() => false));
  if (errorVisible) {
    const message = ((await authError.textContent()) ?? '').trim();
    if (
      process.env.E2E_SKIP_ON_UNPROVISIONED_STUDENT === '1' &&
      /invalid login credentials|invalid email|email not confirmed|user not found/i.test(message)
    ) {
      test.skip(
        true,
        `Missing fixture: the TEST_STUDENT_EMAIL/TEST_STUDENT_PASSWORD student is not ` +
          `provisioned in the Supabase project this run authenticates against ` +
          `(sign-in rejected with "${message}"). Skipped because ` +
          'E2E_SKIP_ON_UNPROVISIONED_STUDENT=1 opted this job into skip-on-unprovisioned. ' +
          'Provision the fixture with the idempotent ' +
          '.github/workflows/seed-staging-test-student.yml dispatch workflow.',
      );
    }
    throw new Error(`loginViaUI: sign-in surfaced an auth error: "${message}"`);
  }
  throw new Error(
    'loginViaUI: no post-auth navigation within 15s and no #auth-error alert shown — ' +
      'login flow itself may be broken (this is NOT the missing-staging-student case).',
  );
}

/**
 * True when both test-student creds AND a non-placeholder Supabase URL are
 * configured. The CI env block defaults NEXT_PUBLIC_SUPABASE_URL to
 * https://placeholder.supabase.co — real auth against that URL hangs and
 * times out after 30s. Tests guarded by this check skip cleanly when the
 * dev server is bound to placeholder Supabase, regardless of whether the
 * test-student secrets exist.
 */
export function hasRealStudentCreds(): boolean {
  const hasCreds = Boolean(process.env.TEST_STUDENT_EMAIL && process.env.TEST_STUDENT_PASSWORD);
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const isPlaceholder = supabaseUrl.includes("placeholder.supabase.co") || supabaseUrl === "";
  return hasCreds && !isPlaceholder;
}
