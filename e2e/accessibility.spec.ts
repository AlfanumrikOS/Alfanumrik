import { test, expect, type Page } from '@playwright/test';
import { mockStudentSession, hasRealStudentCreds, loginViaUI } from './helpers/auth';

/**
 * E2E Accessibility Tests -- Verify basic accessibility requirements.
 * Checks: button labels, heading hierarchy, alt text, form labels, aria attributes.
 *
 * Run: npx playwright test e2e/accessibility.spec.ts
 */

test.describe('Landing Page Accessibility', () => {
  test('all buttons have accessible names', async ({ page }) => {
    await page.goto('/welcome');
    await page.waitForLoadState('networkidle');

    const buttons = page.locator('button');
    const count = await buttons.count();
    expect(count).toBeGreaterThan(0);

    for (let i = 0; i < count; i++) {
      const button = buttons.nth(i);
      const visible = await button.isVisible();
      if (!visible) continue;

      // Each button should have either text content, aria-label, or aria-labelledby
      const text = (await button.textContent())?.trim();
      const ariaLabel = await button.getAttribute('aria-label');
      const ariaLabelledBy = await button.getAttribute('aria-labelledby');
      const title = await button.getAttribute('title');

      const hasAccessibleName = (text && text.length > 0) || ariaLabel || ariaLabelledBy || title;
      expect(
        hasAccessibleName,
        `Button at index ${i} has no accessible name. Text: "${text}", aria-label: "${ariaLabel}"`
      ).toBeTruthy();
    }
  });

  test('heading hierarchy has no skips (h1 before h2, h2 before h3)', async ({ page }) => {
    await page.goto('/welcome');
    await page.waitForLoadState('networkidle');

    // Get all headings in document order
    const headings = await page.evaluate(() => {
      const elements = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
      return Array.from(elements).map(el => ({
        tag: el.tagName.toLowerCase(),
        level: parseInt(el.tagName[1]),
        text: el.textContent?.trim().substring(0, 50) || '',
      }));
    });

    expect(headings.length).toBeGreaterThan(0);

    // First heading should be h1
    expect(headings[0].level).toBe(1);

    // Check no heading level is skipped (e.g., h1 then h3 without h2)
    let maxLevelSeen = 0;
    for (const heading of headings) {
      // Allow going back up (e.g., h3 then h2), but going down should not skip
      if (heading.level > maxLevelSeen + 1 && heading.level > maxLevelSeen) {
        // Only fail if we jump more than one level deeper
        expect(
          heading.level,
          `Heading "${heading.text}" (${heading.tag}) skips a level after max level ${maxLevelSeen}`
        ).toBeLessThanOrEqual(maxLevelSeen + 1);
      }
      maxLevelSeen = Math.max(maxLevelSeen, heading.level);
    }
  });

  test('page has exactly one h1', async ({ page }) => {
    await page.goto('/welcome');
    await page.waitForLoadState('networkidle');

    const h1Count = await page.locator('h1').count();
    expect(h1Count).toBe(1);
  });

  test('language toggle has aria-label', async ({ page }) => {
    await page.goto('/welcome');

    // The v2 page can render a secondary mobile/menu language control; assert
    // against the primary accessible toggle by role/name.
    const langToggle = page.getByRole('button', { name: /हिन्दी|Toggle language/i }).first();
    await expect(langToggle).toBeVisible();

    const ariaLabel = await langToggle.getAttribute('aria-label');
    expect(ariaLabel).toBeTruthy();
    // Should describe the toggle action
    expect(ariaLabel!.length).toBeGreaterThan(5);
  });

  test('language toggle aria-label updates after switching to Hindi', async ({ page }) => {
    await page.goto('/welcome');

    const langToggle = page.getByRole('button', { name: /हिन्दी|Toggle language/i }).first();

    // In English mode, aria-label should be in Hindi (telling Hindi speakers to switch)
    const englishLabel = await langToggle.getAttribute('aria-label');
    expect(englishLabel).toContain('हिन्दी');

    // Switch to Hindi
    await langToggle.click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'hi', { timeout: 20_000 });

    // In Hindi mode, aria-label should be in English (telling English speakers to switch)
    const hindiLabel = await page.getByRole('button', { name: /English|Toggle language/i }).first().getAttribute('aria-label');
    expect(hindiLabel).toMatch(/English|Toggle language/i);
  });

  test('links to login pages have descriptive text', async ({ page }) => {
    await page.goto('/welcome');

    // CTA links should have meaningful text, not just "click here"
    const ctaLinks = page.locator('a[href="/login"]');
    const count = await ctaLinks.count();
    expect(count).toBeGreaterThan(0);

    for (let i = 0; i < count; i++) {
      const link = ctaLinks.nth(i);
      const visible = await link.isVisible();
      if (!visible) continue;

      const text = (await link.textContent())?.trim();
      const ariaLabel = await link.getAttribute('aria-label');
      const hasLabel = (text && text.length > 2) || ariaLabel;
      expect(
        hasLabel,
        `Login link at index ${i} has no descriptive text`
      ).toBeTruthy();
    }
  });
});

test.describe('Login Page Accessibility', () => {
  test('login form inputs have associated labels or aria-label', async ({ page }) => {
    await page.goto('/login');
    await page.waitForLoadState('networkidle');

    const inputs = page.locator('input:visible');
    const count = await inputs.count();

    for (let i = 0; i < count; i++) {
      const input = inputs.nth(i);
      const type = await input.getAttribute('type');
      // Skip hidden inputs and submit buttons
      if (type === 'hidden' || type === 'submit') continue;

      const id = await input.getAttribute('id');
      const ariaLabel = await input.getAttribute('aria-label');
      const ariaLabelledBy = await input.getAttribute('aria-labelledby');
      const placeholder = await input.getAttribute('placeholder');

      // Check if there's a label element associated via "for" attribute
      let hasLabel = false;
      if (id) {
        const label = page.locator(`label[for="${id}"]`);
        hasLabel = (await label.count()) > 0;
      }

      const hasAccessibleLabel = hasLabel || ariaLabel || ariaLabelledBy || placeholder;
      expect(
        hasAccessibleLabel,
        `Input at index ${i} (type="${type}") has no accessible label`
      ).toBeTruthy();
    }
  });

  test('role tab buttons have accessible text', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('tab', { name: 'Student' })).toBeVisible({ timeout: 10_000 });

    const roleTabs = page.getByRole('tab').filter({
      hasText: /Student|Teacher|Parent|School/,
    });
    const count = await roleTabs.count();
    expect(count).toBe(4);

    for (let i = 0; i < count; i++) {
      const tab = roleTabs.nth(i);
      const text = await tab.textContent();
      expect(text?.trim().length).toBeGreaterThan(0);
    }
  });
});

test.describe('Not Found Page Accessibility', () => {
  test('404 page has proper heading structure', async ({ page }) => {
    await page.goto('/this-route-does-not-exist');
    await page.waitForLoadState('networkidle');

    const h1 = page.locator('h1');
    await expect(h1).toBeVisible({ timeout: 10_000 });
    await expect(h1).toContainText('Page Not Found');
  });

  test('404 page Back to Dashboard link has aria-label', async ({ page }) => {
    await page.goto('/this-route-does-not-exist');
    const backLink = page.locator('a[aria-label="Go back to dashboard"]');
    await expect(backLink).toBeVisible({ timeout: 10_000 });
  });

  test('404 page alternative nav has aria-label', async ({ page }) => {
    await page.goto('/this-route-does-not-exist');
    const altNav = page.locator('nav[aria-label="Additional navigation"]');
    await expect(altNav).toBeVisible({ timeout: 10_000 });
  });
});

test.describe('Pricing Page Accessibility', () => {
  test('pricing page has proper heading hierarchy', async ({ page }) => {
    await page.goto('/pricing');
    await page.waitForLoadState('networkidle');

    const h1 = page.locator('h1');
    await expect(h1).toBeVisible();
    // Landing-v3 makeover (2026-07-16): the pricing hero H1 is the
    // tuition-class line; "Pricing" moved to the eyebrow. Same pin as
    // e2e/smoke.spec.ts "pricing page loads with correct title" — this file
    // was missed in the V3 pin sweep (caught by CI run 29716158705 triage).
    await expect(h1).toContainText('Less than a single tuition class');

    // h2 elements should exist for subsections
    const h2Count = await page.locator('h2').count();
    expect(h2Count).toBeGreaterThan(0);
  });
});

/**
 * Wave B accessibility additions (task item 9): today-v2, exam-schedule-card,
 * exam-schedule-list — the 3 new surfaces that are actually REACHABLE via a
 * live route (`/today` with ff_today_home_v1 on — TodayHomeV2 is the sole
 * /today loaded-state presentation, no separate v2 flag anymore; `/tests`
 * with ff_exam_schedule_v1 on). `offline-state` and `placement-check` have NO
 * wiring page yet in this pass (usePlacement/PlacementCheck are not mounted
 * anywhere; OfflineState only mounts once OfflineBoundary detects a genuine
 * `offline` browser event, which Playwright's route-mocking does not
 * simulate) — their 44px tap-target contract is covered at the component
 * level instead, in src/__tests__/components/offline/OfflineState.test.tsx
 * and src/__tests__/components/onboarding/PlacementCheck.test.tsx.
 *
 * Real rendered dimensions (boundingBox(), not the inline minHeight style
 * string) are asserted here — the gold-standard check, since actual layout
 * can only be >= the declared minHeight, never less.
 */
async function installWaveBFlagMocks(
  page: Page,
  flags: { todayHomeV1?: boolean; examScheduleV1?: boolean },
): Promise<void> {
  await page.route('**/rest/v1/feature_flags**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(
        [
          { flag_name: 'ff_today_home_v1', is_enabled: flags.todayHomeV1 ?? false },
          { flag_name: 'ff_exam_schedule_v1', is_enabled: flags.examScheduleV1 ?? false },
        ].map((f) => ({ ...f, target_roles: null, target_environments: null, target_institutions: null })),
      ),
    });
  });
  await page.route('**/api/student/subjects**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ subjects: [] }) });
  });
}

async function minHeightPx(page: Page, testId: string): Promise<number> {
  const box = await page.getByTestId(testId).boundingBox();
  return box?.height ?? 0;
}

test.describe('Today v2 + exam-schedule-card accessibility', () => {
  test('today-v2 interactive controls meet the 44px minimum tap target', async ({ page }) => {
    test.fixme(
      !hasRealStudentCreds(),
      'Rendering /today past the auth+flag gate needs an authenticated session ' +
      '(same fixture dependency as today-home.spec.ts). Mocks installed; promote with ' +
      'the test-student fixture.',
    );

    const todayResponse = {
      schemaVersion: 1,
      resolvedAt: '2026-08-02T09:00:00.000Z',
      primary: {
        type: 'weak_topic_zpd',
        rank: 1,
        labelKey: 'today.item.weak_topic_zpd.label',
        subtitleKey: 'today.item.weak_topic_zpd.subtitle',
        estMinutes: 7,
        deepLink: { route: '/quiz', params: { subject: 'science', chapter: 3 } },
        iconHint: 'target',
        reason: 'todays_zpd',
        meta: { subjectCode: 'science', chapterNumber: 3, zpdBin: 'medium' },
      },
      queue: [],
      meta: { branch: 'start_quiz', masterySubjectCount: 1, dueReviewCount: 0, practicedToday: true },
    };
    todayResponse.queue = [todayResponse.primary];

    await mockStudentSession(page, { xpTotal: 250, streakDays: 5 });
    await installWaveBFlagMocks(page, { todayHomeV1: true, examScheduleV1: true });
    await page.route('**/api/v2/today**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(todayResponse) });
    });
    await page.route('**/api/v2/exam-schedule**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            schemaVersion: 1,
            entries: [
              {
                id: 'exam-1',
                source: 'student',
                title: 'Coaching test',
                startsOn: new Date().toISOString().slice(0, 10),
                endsOn: new Date().toISOString().slice(0, 10),
                editable: true,
              },
            ],
          },
        }),
      });
    });

    if (hasRealStudentCreds()) {
      await loginViaUI(page);
    }

    await page.goto('/today');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.getByTestId('today-v2')).toBeVisible({ timeout: 15_000 });

    // exam-schedule-card
    await expect(page.getByTestId('exam-schedule-card')).toBeVisible();
    expect(await minHeightPx(page, 'exam-schedule-revise')).toBeGreaterThanOrEqual(44);

    // today-v2 focus hero CTA (non-resume primary in this fixture)
    expect(await minHeightPx(page, 'today-v2-focus-continue')).toBeGreaterThanOrEqual(44);

    // Every visible button on the page has an accessible name (generic sweep,
    // matching the Landing Page Accessibility convention above).
    const buttons = page.locator('button');
    const count = await buttons.count();
    for (let i = 0; i < count; i++) {
      const button = buttons.nth(i);
      if (!(await button.isVisible())) continue;
      const text = (await button.textContent())?.trim();
      const ariaLabel = await button.getAttribute('aria-label');
      expect(Boolean(text) || Boolean(ariaLabel), `button ${i} has no accessible name`).toBeTruthy();
    }
  });
});

test.describe('/tests (exam-schedule-list) accessibility (ff_exam_schedule_v1)', () => {
  test('exam-schedule-list interactive controls meet the 44px minimum tap target', async ({ page }) => {
    test.fixme(
      !hasRealStudentCreds(),
      'Rendering /tests past the auth+flag gate needs an authenticated session — same ' +
      'fixture dependency as exam-schedule.spec.ts. Mocks installed; promote with the ' +
      'test-student fixture.',
    );

    await mockStudentSession(page, { xpTotal: 100, streakDays: 2 });
    await installWaveBFlagMocks(page, { examScheduleV1: true });
    await page.route('**/api/v2/exam-schedule**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            schemaVersion: 1,
            entries: [
              {
                id: 'exam-1',
                source: 'student',
                title: 'Coaching test',
                startsOn: new Date().toISOString().slice(0, 10),
                endsOn: new Date().toISOString().slice(0, 10),
                editable: true,
              },
            ],
          },
        }),
      });
    });

    if (hasRealStudentCreds()) {
      await loginViaUI(page);
    }

    await page.goto('/tests');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.getByTestId('exam-schedule-list')).toBeVisible({ timeout: 15_000 });
    expect(await minHeightPx(page, 'exam-schedule-add')).toBeGreaterThanOrEqual(44);

    const editButtons = page.getByText('Edit', { exact: true });
    if (await editButtons.count() > 0) {
      const box = await editButtons.first().boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
  });
});
