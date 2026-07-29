import { test, type Page } from '@playwright/test';

/**
 * Shared E2E auth helpers.
 *
 * Strategy: in CI we have no real Supabase test user seeded, so we mock the
 * Supabase token endpoint and `students` REST endpoint such that AuthContext
 * resolves a valid student session without contacting a live backend.
 *
 * Tests that need a *real* logged-in session (e.g. to exercise the SERVER
 * side of P3 anti-cheat against a live Supabase) must gate on a MACHINE-
 * CHECKABLE condition — `test.skip(!hasRealStudentCreds(), '<reason>')` — so
 * they self-enable the moment the prerequisite exists.
 *
 * Passing a LITERAL boolean to `test.fixme` / `test.skip` is BANNED in this
 * directory: it makes the skip unconditional and permanent, which is how the
 * blocking critical-path gate ended up green while asserting nothing. The ban
 * is enforced by `apps/host/src/__tests__/e2e/critical-path-gate.test.ts`.
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

/**
 * ── Root cause of the 2026-07 "10 fixme'd critical-path tests" incident ──
 *
 * `supabaseStorageKey()` above derives the localStorage key from the
 * NEXT_PUBLIC_SUPABASE_URL of the PLAYWRIGHT PROCESS. In the blocking
 * `e2e-critical-paths` CI job that env var is the workflow-level placeholder
 * (`https://placeholder.supabase.co`) while BASE_URL points at a DEPLOYED
 * app whose bundle was built against the real project ref. The seeded key
 * (`sb-placeholder-auth-token`) therefore never matched the key the browser
 * SDK reads (`sb-<real-ref>-auth-token`), so the mocked session was silently
 * invisible, every mocked-session flow bounced to /login, and ten assertions
 * were written off as "needs a real fixture".
 *
 * Fix: instead of guessing the project ref, intercept the READ. Any
 * `sb-<anything>-auth-token` lookup that would otherwise miss resolves to the
 * mock session. This is target-agnostic (localhost dev, CI-local server, or a
 * deployed domain) and needs no secret, no seeded DB row, and no env var.
 */
async function installSessionForAnyProjectRef(page: Page, session: unknown): Promise<void> {
  await page.addInitScript((raw: string) => {
    const AUTH_TOKEN_KEY = /^sb-[^-]+.*-auth-token$/;
    const origGet = Storage.prototype.getItem;
    Storage.prototype.getItem = function patchedGetItem(key: string) {
      const value = origGet.call(this, key);
      if (value === null && AUTH_TOKEN_KEY.test(key)) return raw;
      return value;
    };
  }, JSON.stringify(session));
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
  /**
   * Opt in to the project-ref-agnostic session read shim (see
   * `installSessionForAnyProjectRef`). Required whenever the app under test
   * was built against a DIFFERENT Supabase project than the one this process's
   * NEXT_PUBLIC_SUPABASE_URL names — which is always true for the blocking
   * `e2e-critical-paths` job (placeholder env, deployed target).
   *
   * Default OFF deliberately: turning it on flips several existing specs from
   * "mocked session silently did not resolve" to "student is authenticated",
   * and at least `today-home.spec.ts:175` encodes the old behaviour in its
   * expectations. Enabling it globally is a separate, reviewed change.
   * TODO(testing): audit the 11 other mockStudentSession callers, then make
   * this the default and delete the flag.
   */
  anyProjectRef?: boolean;
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
  if (opts?.anyProjectRef) await installSessionForAnyProjectRef(page, session);
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

  // ── 2026-07-29 nightly hang triage (run 30405020023, 23/23 auth-dependent
  // failures) ────────────────────────────────────────────────────────────
  // Every failure burned the FULL 60s CI test-timeout inside this function
  // with no thrown error and no #auth-error alert ever appearing — i.e. a
  // silent hang, not a rejection. Investigation ruled out a stale selector:
  // `apps/host/src/app/login/page.tsx` deliberately never gates rendering on
  // auth-loading state ("Always show the login form — never block on
  // loading state... prevents the infinite spinner when session is
  // stale/expired"), and AuthScreen's email/password `aria-label`s still
  // match `/^email/i` / exact 'Password'. A bare `.fill()` timeout is
  // ambiguous about WHERE the hang is — page never rendering the form vs. a
  // network call that never resolves — so split the wait into an explicit,
  // shorter, named step. This changes nothing about what is asserted, only
  // how fast and clearly a hang is diagnosed next time.
  const emailInput = page.getByLabel(/^email/i);
  try {
    await emailInput.waitFor({ state: 'visible', timeout: 15_000 });
  } catch {
    throw new Error(
      'loginViaUI: the email input never appeared on /login within 15s. ' +
        'The login form renders unconditionally (independent of auth state — ' +
        'see apps/host/src/app/login/page.tsx), so this means the TARGET ' +
        'SERVER itself did not serve a working /login in time, not a Supabase ' +
        'auth problem. Check BASE_URL / the in-job production server boot log.',
    );
  }
  // The login form has 3 elements matching /password/i (the input itself
  // plus "Show password" toggle + "Forgot password?" link). Use exact label
  // match to disambiguate to the actual input. AuthScreen.tsx sets
  // aria-label="Password" on the input.
  await emailInput.fill(email);
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
