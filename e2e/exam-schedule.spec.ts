import { test, expect, type Page } from '@playwright/test';
import { mockStudentSession, hasRealStudentCreds, loginViaUI } from './helpers/auth';

/**
 * Wave B — the exam-schedule surface: `/tests` (full list, ff_exam_schedule_v1)
 * and the exam-schedule card embedded in `/today` v2 (covered separately in
 * today-home.spec.ts and accessibility.spec.ts).
 *
 * Determinism strategy mirrors today-home.spec.ts:
 *   - Auth: mockStudentSession + the SAME test.fixme(!hasRealStudentCreds())
 *     gating for anything that needs a rendered authenticated page (the
 *     mocked session only resolves a real isLoggedIn gate against a real
 *     Supabase URL — see helpers/auth.ts).
 *   - Flag: intercept the feature_flags REST read.
 *   - BFF: intercept GET /api/v2/exam-schedule (Playwright route interception).
 *
 * Run: npx playwright test e2e/exam-schedule.spec.ts
 */

function featureFlagsPayload(examScheduleOn: boolean) {
  return [
    {
      flag_name: 'ff_exam_schedule_v1',
      is_enabled: examScheduleOn,
      target_roles: null,
      target_environments: null,
      target_institutions: null,
    },
  ];
}

async function installTestsPageMocks(
  page: Page,
  opts: { examScheduleOn: boolean; entries?: unknown[] },
): Promise<void> {
  await page.route('**/rest/v1/feature_flags**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(featureFlagsPayload(opts.examScheduleOn)),
    });
  });

  await page.route('**/api/v2/exam-schedule**', async (route) => {
    if (!opts.examScheduleOn) {
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, error: 'Not found', code: 'NOT_FOUND' }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { schemaVersion: 1, entries: opts.entries ?? [] } }),
    });
  });
}

// ── 1. Flag OFF / logged out — /tests gates the same way /today does ───────

test.describe('/tests — gating (parity with /today\'s own gate)', () => {
  // Runs UNCONDITIONALLY: an unauthenticated visit to /tests must leave
  // /tests regardless of the flag (auth is checked first in the page's gate).
  test('unauthenticated visit redirects to /login', async ({ page }) => {
    await installTestsPageMocks(page, { examScheduleOn: true });
    await page.goto('/tests');
    await page.waitForURL(/\/login/, { timeout: 15_000 });
    expect(page.url()).toContain('/login');
  });

  // Runs UNCONDITIONALLY regardless of real creds: with the flag OFF,
  // /tests must never stay on /tests. Authenticated → /today; unauthenticated
  // → /login (the auth gate fires first either way, same as /today's own).
  test('flag OFF redirects away from /tests (never stays on /tests)', async ({ page }) => {
    await mockStudentSession(page, { xpTotal: 100, streakDays: 2 });
    await installTestsPageMocks(page, { examScheduleOn: false });

    if (hasRealStudentCreds()) {
      await loginViaUI(page);
      await page.goto('/tests');
      await page.waitForURL(/\/today/, { timeout: 15_000 });
      expect(page.url()).toContain('/today');
      expect(page.url()).not.toContain('/tests');
      return;
    }

    await page.goto('/tests');
    await page.waitForURL(/\/(login|today|dashboard|welcome)/, { timeout: 15_000 });
    expect(page.url()).not.toMatch(/\/tests(\?|$)/);
  });
});

// ── 2. Flag ON — the full list renders ──────────────────────────────────────

test.describe('/tests — flag ON', () => {
  test('renders the exam-schedule-list with an empty state when there are no entries', async ({ page }) => {
    test.fixme(
      !hasRealStudentCreds(),
      'Rendering /tests past the auth+flag gate needs an authenticated session — same ' +
      'fixture dependency as today-home.spec.ts\'s "flag ON" tests. Mocks installed; ' +
      'promote with the test-student fixture. The list/card render contract is unit-' +
      'covered in src/__tests__/components/exams/ExamSchedule.test.tsx.',
    );

    await mockStudentSession(page, { xpTotal: 100, streakDays: 2 });
    await installTestsPageMocks(page, { examScheduleOn: true, entries: [] });

    if (hasRealStudentCreds()) {
      await loginViaUI(page);
    }

    await page.goto('/tests');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.getByTestId('exam-schedule-list')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('exam-schedule-empty')).toBeVisible();
  });

  test('renders a student-added entry and the "coming soon" banner on Add', async ({ page }) => {
    test.fixme(
      !hasRealStudentCreds(),
      'Same auth-gate dependency as the empty-state test above.',
    );

    await mockStudentSession(page, { xpTotal: 100, streakDays: 2 });
    await installTestsPageMocks(page, {
      examScheduleOn: true,
      entries: [
        {
          id: 'entry-1',
          source: 'student',
          title: 'Coaching test',
          startsOn: new Date().toISOString().slice(0, 10),
          endsOn: new Date().toISOString().slice(0, 10),
          editable: true,
        },
      ],
    });

    if (hasRealStudentCreds()) {
      await loginViaUI(page);
    }

    await page.goto('/tests');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.getByTestId('exam-entry-student')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Coaching test')).toBeVisible();

    // No write route exists yet for student_exam_entries — Add/Edit surface a
    // dismissible "coming soon" message instead of a real form.
    await page.getByTestId('exam-schedule-add').click();
    await expect(page.getByTestId('tests-coming-soon')).toBeVisible();
  });
});
