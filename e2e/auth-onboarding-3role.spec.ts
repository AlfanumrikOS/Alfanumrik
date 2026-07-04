import { test, expect, type Page } from '@playwright/test';

/**
 * AO-2 — Real 3-role signup→profile→dashboard E2E (student / teacher / parent).
 *
 * This is the POSITIVE end-to-end funnel verification that the audit
 * (engineering-audit/workflows/auth-onboarding/02-gap-analysis.md, gap AO-2)
 * identified as missing. The sibling spec `e2e/auth-onboarding-p15.spec.ts`
 * only proves NEGATIVE guards ("a teacher session never lands on /parent") via
 * `page.route` Supabase mocks — it never drives a real account from auth through
 * profile creation to the role dashboard, so bootstrap-layer regressions (RPC
 * arg drift, role-redirect drift, onboarding_state transitions) can pass CI.
 *
 * ── Why these are `test.fixme()` and NOT mocked ─────────────────────────────
 * A truthful positive funnel test needs a REAL authenticated session against a
 * real Supabase project so the actual `bootstrap_user_profile` RPC, RLS,
 * triggers, and `onboarding_state` transitions execute. CI currently seeds only
 * ONE account — a student with `onboarding_completed=true`
 * (.github/workflows/seed-staging-test-student.yml) — which cannot exercise the
 * first-time signup→profile funnel and has no teacher/parent equivalent.
 *
 * Rather than `page.route`-mock the funnel (which makes the positive path never
 * actually execute while the suite reports green — the exact anti-pattern AO-2
 * calls out), each test is registered with `test.fixme(<creds-absent>, …)`. The
 * assertions below are REAL and UNCONDITIONAL: the moment the per-role fixtures
 * exist, the tests drive the live funnel and assert against it. Until then they
 * are visibly PENDING (not passing), so the catalog cannot over-report coverage.
 *
 * ── Fixture seeding required to un-gate (owner: testing + ops) ──────────────
 * Provision these in the STAGING Supabase project + GitHub repo secrets, mirror
 * the idempotent seed in `.github/workflows/seed-staging-test-student.yml`:
 *
 *   STUDENT (fresh, must re-create each run so the funnel is real):
 *     - TEST_STUDENT_ONBOARDING_EMAIL / TEST_STUDENT_ONBOARDING_PASSWORD
 *     - auth user with user_metadata.role='student', email_confirm=true
 *     - students row with onboarding_completed=FALSE (or no profile yet, so the
 *       in-app bootstrap creates it) so /onboarding renders the grade/board step
 *
 *   TEACHER:
 *     - TEST_TEACHER_EMAIL / TEST_TEACHER_PASSWORD
 *     - auth user role='teacher'; bootstrap_user_profile(p_role='teacher', …)
 *       seeded so a teachers row exists → login lands on /teacher
 *
 *   PARENT:
 *     - TEST_PARENT_EMAIL / TEST_PARENT_PASSWORD
 *     - auth user role='parent'; bootstrap_user_profile(p_role='parent', …)
 *       seeded → login lands on /parent
 *
 * Also required: BASE_URL pointed at a deploy backed by the SAME staging
 * Supabase project (NEXT_PUBLIC_SUPABASE_URL must NOT be the placeholder), so
 * real auth resolves instead of hanging.
 *
 * Run: npx playwright test e2e/auth-onboarding-3role.spec.ts
 */

// ─── Per-role credential helpers ────────────────────────────────────────────

function creds(emailKey: string, passwordKey: string): { email?: string; password?: string } {
  return { email: process.env[emailKey], password: process.env[passwordKey] };
}

function realBackend(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  return url !== '' && !url.includes('placeholder.supabase.co');
}

function ready(emailKey: string, passwordKey: string): boolean {
  const { email, password } = creds(emailKey, passwordKey);
  return Boolean(email && password) && realBackend();
}

/**
 * Drive the real login form (AuthScreen) for any role. The role tab must be
 * selected before submitting so AuthContext resolves the correct portal.
 */
async function loginAs(
  page: Page,
  role: 'Student' | 'Teacher' | 'Parent',
  email: string,
  password: string,
): Promise<void> {
  await page.goto('/login');
  // Role selector migrated to the canonical Tabs primitive: each role control
  // now renders role="tab" (was a hand-rolled role="button"). Select by the same
  // accessible name — non-weakening, just the corrected ARIA role.
  await page.getByRole('tab', { name: role }).click();
  await page.getByLabel(/^email/i).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: /^log in$|^sign in$/i }).click();
}

// ─── A. Student: signup → /onboarding profile step → /dashboard ─────────────

test('AO-2 student: login → onboarding profile creation → /dashboard', async ({ page }) => {
  test.fixme(
    !ready('TEST_STUDENT_ONBOARDING_EMAIL', 'TEST_STUDENT_ONBOARDING_PASSWORD'),
    'Needs a FRESH student fixture (onboarding_completed=FALSE) + a staging-backed BASE_URL. ' +
      'Seed TEST_STUDENT_ONBOARDING_EMAIL/PASSWORD per the header block. The existing ' +
      'seed-staging-test-student.yml account has onboarding_completed=true and cannot test ' +
      'the first-time profile-creation funnel.',
  );
  const { email, password } = creds('TEST_STUDENT_ONBOARDING_EMAIL', 'TEST_STUDENT_ONBOARDING_PASSWORD');

  await loginAs(page, 'Student', email!, password!);

  // A fresh student lands on the onboarding profile step (grade + board).
  await page.waitForURL(/\/onboarding/, { timeout: 15_000 });
  await expect(page.getByText('Your Grade')).toBeVisible();
  await expect(page.getByText('Your Board')).toBeVisible();

  // Complete the profile: pick grade 9, keep board CBSE, submit.
  await page.locator('select').first().selectOption('9');
  await page.getByRole('button', { name: /start learning|continue|finish/i }).click();

  // Profile creation (bootstrap RPC) must land the student on the dashboard.
  await page.waitForURL(/\/dashboard/, { timeout: 15_000 });
  expect(page.url()).toContain('/dashboard');
  // The dashboard must render real content, not an error/empty shell.
  const body = (await page.locator('body').textContent()) ?? '';
  expect(body.trim().length).toBeGreaterThan(0);
  await expect(page.getByText(/application error/i)).toHaveCount(0);
});

// ─── B. Teacher: login → profile present → /teacher ─────────────────────────

test('AO-2 teacher: login → profile resolves → /teacher dashboard', async ({ page }) => {
  test.fixme(
    !ready('TEST_TEACHER_EMAIL', 'TEST_TEACHER_PASSWORD'),
    'Needs a seeded teacher fixture + staging-backed BASE_URL. Seed TEST_TEACHER_EMAIL/PASSWORD ' +
      'with bootstrap_user_profile(p_role=\'teacher\') per the header block.',
  );
  const { email, password } = creds('TEST_TEACHER_EMAIL', 'TEST_TEACHER_PASSWORD');

  await loginAs(page, 'Teacher', email!, password!);

  // A provisioned teacher lands on the teacher portal — never the student
  // onboarding form or the parent portal.
  await page.waitForURL(/\/teacher/, { timeout: 15_000 });
  expect(page.url()).toContain('/teacher');
  expect(page.url()).not.toContain('/parent');
  await expect(page.getByText('Your Grade')).toHaveCount(0);
  const body = (await page.locator('body').textContent()) ?? '';
  expect(body.trim().length).toBeGreaterThan(0);
  await expect(page.getByText(/application error/i)).toHaveCount(0);
});

// ─── C. Parent: login → profile present → /parent ───────────────────────────

test('AO-2 parent: login → profile resolves → /parent dashboard', async ({ page }) => {
  test.fixme(
    !ready('TEST_PARENT_EMAIL', 'TEST_PARENT_PASSWORD'),
    'Needs a seeded parent fixture + staging-backed BASE_URL. Seed TEST_PARENT_EMAIL/PASSWORD ' +
      'with bootstrap_user_profile(p_role=\'parent\') per the header block.',
  );
  const { email, password } = creds('TEST_PARENT_EMAIL', 'TEST_PARENT_PASSWORD');

  await loginAs(page, 'Parent', email!, password!);

  // A provisioned parent lands on the parent portal — never the student
  // onboarding form or the teacher portal.
  await page.waitForURL(/\/parent/, { timeout: 15_000 });
  expect(page.url()).toContain('/parent');
  expect(page.url()).not.toContain('/teacher');
  await expect(page.getByText('Your Grade')).toHaveCount(0);
  const body = (await page.locator('body').textContent()) ?? '';
  expect(body.trim().length).toBeGreaterThan(0);
  await expect(page.getByText(/application error/i)).toHaveCount(0);
});
