import { test, expect, type Page } from '@playwright/test';

/**
 * D4 — Parent "link a new child" 2FA (link-code + OTP) E2E.
 *
 * Gate-2 D4 (parent portal cleanup) named this flow explicitly in its
 * verification bar ("link/OTP E2E") and it had zero E2E coverage before this
 * file: `apps/host/src/app/api/parent/link-code/request-otp/route.ts` and
 * `.../redeem/route.ts` back the "Link a New Child" form on
 * `/parent/children` (`LinkChildSection` in
 * `apps/host/src/app/parent/children/page.tsx`) — a signed-in guardian adds
 * an ADDITIONAL child by submitting the child's link code, then the 6-digit
 * OTP emailed to the guardian's own address. This is a DIFFERENT flow from
 * the no-account "link-code mode" sign-in embedded in `/parent/page.tsx`
 * (which has no OTP step at all) — do not conflate the two.
 *
 * ── Two tiers of coverage here, matching e2e/auth-onboarding-3role.spec.ts's
 *    "real, not mocked" philosophy ──────────────────────────────────────────
 *
 * 1. AUTH-BOUNDARY tests (below, unconditional): both routes require a
 *    Supabase session before touching the DB. These need no fixtures at all
 *    — they hit the API directly and assert the 401, so they run in every CI
 *    invocation with a real backend configured.
 *
 * 2. VALIDATION tests (gated on TEST_PARENT_EMAIL/PASSWORD — the SAME fixture
 *    AO-2 already requires, no new fixture needed): a real guardian session
 *    hitting malformed input. These never create a real challenge or link
 *    row, so they're safe to run against the shared staging fixture.
 *
 * 3. HAPPY-PATH test (gated on TEST_PARENT_EMAIL/PASSWORD **plus a new**
 *    TEST_LINKABLE_CHILD_CODE): drives the real UI end-to-end — enters the
 *    link code, captures `otp_dev` from the request-otp response (the
 *    documented dev-only escape hatch, active whenever NODE_ENV !==
 *    'production', specifically so e2e doesn't need to scrape email), enters
 *    it, and asserts the success state. This is `test.fixme()`'d until ops
 *    seeds a student whose link code is valid and NOT YET linked to the
 *    TEST_PARENT guardian — redeem creates a real `guardian_student_links`
 *    row and is one-shot per (guardian, student) pair, so the fixture must be
 *    freshly (re-)seeded before each run, the same caution AO-2 gives its own
 *    fresh-student fixture.
 *
 * Run: npx playwright test e2e/parent-link-code-otp.spec.ts
 */

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

async function loginAs(
  page: Page,
  role: 'Student' | 'Teacher' | 'Parent',
  email: string,
  password: string,
): Promise<void> {
  await page.goto('/login');
  await page.getByRole('tab', { name: role }).click();
  await page.getByLabel(/^email/i).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: /^log in$|^sign in$/i }).click();
}

// ─── 1. Auth boundary — no fixtures needed, runs whenever a real backend is configured ───

test('D4 link-code request-otp: unauthenticated request is rejected', async ({ page }) => {
  test.fixme(!realBackend(), 'Needs a staging-backed BASE_URL/NEXT_PUBLIC_SUPABASE_URL to hit a real auth boundary.');

  const res = await page.request.post('/api/parent/link-code/request-otp', {
    data: { link_code: 'ABCD1234' },
  });
  expect(res.status()).toBe(401);
});

test('D4 link-code redeem: unauthenticated request is rejected', async ({ page }) => {
  test.fixme(!realBackend(), 'Needs a staging-backed BASE_URL/NEXT_PUBLIC_SUPABASE_URL to hit a real auth boundary.');

  const res = await page.request.post('/api/parent/link-code/redeem', {
    data: { link_code: 'ABCD1234', otp: '123456' },
  });
  expect(res.status()).toBe(401);
});

// ─── 2. Validation, with a real guardian session — no new fixture, creates no data ───

test('D4 link-code redeem: malformed OTP is rejected before touching the DB', async ({ page }) => {
  test.fixme(
    !ready('TEST_PARENT_EMAIL', 'TEST_PARENT_PASSWORD'),
    'Needs TEST_PARENT_EMAIL/PASSWORD (same fixture as AO-2) + a staging-backed BASE_URL.',
  );
  const { email, password } = creds('TEST_PARENT_EMAIL', 'TEST_PARENT_PASSWORD');
  await loginAs(page, 'Parent', email!, password!);

  // Not 6 digits — route rejects at the zod/shape check, before the RPC.
  const res = await page.request.post('/api/parent/link-code/redeem', {
    data: { link_code: 'ABCD1234', otp: 'abc' },
  });
  expect(res.status()).toBe(400);
});

test('D4 link-code request-otp: an invalid/unknown code still returns the enumeration-safe success shape', async ({ page }) => {
  test.fixme(
    !ready('TEST_PARENT_EMAIL', 'TEST_PARENT_PASSWORD'),
    'Needs TEST_PARENT_EMAIL/PASSWORD (same fixture as AO-2) + a staging-backed BASE_URL.',
  );
  const { email, password } = creds('TEST_PARENT_EMAIL', 'TEST_PARENT_PASSWORD');
  await loginAs(page, 'Parent', email!, password!);

  // A code that cannot match any real student. The route's documented
  // security posture is a CONSTANT response shape regardless of whether the
  // code matched — this pins that contract (no enumeration leak).
  const res = await page.request.post('/api/parent/link-code/request-otp', {
    data: { link_code: 'NOSUCHCODE99' },
  });
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.success).toBe(true);
  expect(body.otp_sent).toBe(true);
});

// ─── 3. Full happy path — real UI, needs a fresh linkable-child fixture ───

test('D4 parent: link a new child end-to-end via the real link-code + OTP form', async ({ page }) => {
  test.fixme(
    !ready('TEST_PARENT_EMAIL', 'TEST_PARENT_PASSWORD') || !process.env.TEST_LINKABLE_CHILD_CODE,
    'Needs TEST_PARENT_EMAIL/PASSWORD (same fixture as AO-2) plus a NEW fixture: ' +
      'TEST_LINKABLE_CHILD_CODE, the link_code of a student who is NOT already linked ' +
      'to the TEST_PARENT guardian. redeem creates a real guardian_student_links row and ' +
      'is one-shot per (guardian, student) pair, so this student must be freshly seeded ' +
      '(or unlinked) before each run — same caution as AO-2\'s fresh-student fixture.',
  );
  const { email, password } = creds('TEST_PARENT_EMAIL', 'TEST_PARENT_PASSWORD');
  const linkCode = process.env.TEST_LINKABLE_CHILD_CODE!;

  await loginAs(page, 'Parent', email!, password!);
  await page.waitForURL(/\/parent/, { timeout: 15_000 });

  await page.goto('/parent/children');
  await page.getByPlaceholder(/child's link code/i).first().fill(linkCode);

  const otpRequest = page.waitForResponse((r) => r.url().includes('/api/parent/link-code/request-otp'));
  await page.getByRole('button', { name: /send code/i }).first().click();
  const otpRes = await otpRequest;
  const otpBody = (await otpRes.json()) as { success?: boolean; otp_dev?: string };
  expect(otpBody.success).toBe(true);
  // otp_dev is the documented dev-only escape hatch (NODE_ENV !== 'production')
  // that lets e2e complete the flow without scraping a real inbox.
  expect(otpBody.otp_dev).toMatch(/^\d{6}$/);

  await page.getByPlaceholder('000000').first().fill(otpBody.otp_dev!);
  await page.getByRole('button', { name: /^verify$/i }).first().click();

  await expect(page.getByText(/linked successfully/i)).toBeVisible({ timeout: 10_000 });
});
