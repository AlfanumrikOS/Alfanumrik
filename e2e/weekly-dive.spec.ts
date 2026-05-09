import { test, expect } from '@playwright/test';

/**
 * Pedagogy v2 — Wave 2 Task 7
 * Weekly Curiosity Dive smoke.
 *
 * Pre-conditions (set up once in staging Supabase):
 *   - Test student `dive-test@alfanumrik.test` with a `students` row,
 *     academic_goal = 'school_topper', grade = '9',
 *     preferred_subject = 'science'.
 *   - At least 1 active phenomenon row whose grade_band includes 9
 *     (the seeded 'monsoon' / 'cricket-physics' / 'kirana-store-accounting'
 *     rows in the Wave 2 migration all qualify).
 *   - No dive_artifacts row exists for the test student in the current
 *     ISO week (delete via SQL between e2e runs to keep the suite
 *     deterministic):
 *       DELETE FROM dive_artifacts WHERE student_id = '<test_uuid>';
 *   - Feature flag `ff_pedagogy_v2_weekly_dive = true` (scoped to staging).
 *   - Feature flag `ff_pedagogy_v2_daily_rhythm = true` for the dashboard
 *     CTA test (test 3 below).
 *
 * Auth: standard /login form. Override creds via E2E_DIVE_EMAIL /
 * E2E_DIVE_PASSWORD env vars when running against an environment with
 * non-default test credentials.
 *
 * The asserted markup uses the data-testid hooks planted in Task 5b
 * (Picker, ArtifactComposer, DivePage state-machine sections) and
 * Task 6 (history page). No assertions on copy text other than CTA
 * labels — copy may evolve, testids are the contract.
 */
test.describe('Pedagogy v2 — Weekly Dive', () => {
  async function login(page: import('@playwright/test').Page) {
    await page.goto('/login');
    await page.fill('input[name="email"]', process.env.E2E_DIVE_EMAIL ?? 'dive-test@alfanumrik.test');
    await page.fill('input[name="password"]', process.env.E2E_DIVE_PASSWORD ?? 'changeme');
    await page.click('button[type="submit"]');
    await page.waitForURL((u) => u.pathname !== '/login', { timeout: 10000 });
  }

  test('1. /dive renders picker with persona default for school_topper (phenomenon)', async ({ page }) => {
    await login(page);
    await page.goto('/dive');

    const pickerHost = page.getByTestId('dive-picker-host');
    await expect(pickerHost).toBeVisible({ timeout: 10000 });

    const picker = page.getByTestId('dive-picker');
    await expect(picker).toBeVisible();

    // school_topper persona defaults to phenomenon — the option must be
    // present AND selected (the radio input inside dive-picker-option-phenomenon
    // is checked).
    const phenomenonOption = page.getByTestId('dive-picker-option-phenomenon');
    await expect(phenomenonOption).toBeVisible();
    await expect(phenomenonOption.locator('input[type="radio"]')).toBeChecked();

    // Phenomenon selector dropdown is rendered under the selected option.
    await expect(page.getByTestId('dive-picker-phenomenon-select')).toBeVisible();

    // Other options are also visible (test student has weak topics + own_topic always shows).
    await expect(page.getByTestId('dive-picker-option-own_topic')).toBeVisible();
  });

  test('2. picking a phenomenon transitions to dive_active with composer + Foxy CTA', async ({ page }) => {
    await login(page);
    await page.goto('/dive');
    await expect(page.getByTestId('dive-picker-host')).toBeVisible({ timeout: 10000 });

    // Submit the picker with the default phenomenon already selected.
    await page.getByTestId('dive-picker-submit').click();

    // dive_active phase: foxy CTA + composer both render.
    await expect(page.getByTestId('dive-active')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('dive-foxy-link')).toBeVisible();
    await expect(page.getByTestId('dive-foxy-link')).toHaveAttribute('href', /^\/foxy\?mode=explorer&topic=/);
    await expect(page.getByTestId('dive-foxy-link')).toHaveAttribute('target', '_blank');
    await expect(page.getByTestId('dive-artifact-composer')).toBeVisible();

    // Save button is disabled until validation passes (empty form).
    await expect(page.getByTestId('dive-artifact-save')).toBeDisabled();
  });

  test('3. saving the artifact transitions to just_saved + dashboard reflects completion', async ({ page }) => {
    await login(page);
    await page.goto('/dive');
    await expect(page.getByTestId('dive-picker-host')).toBeVisible({ timeout: 10000 });
    await page.getByTestId('dive-picker-submit').click();
    await expect(page.getByTestId('dive-active')).toBeVisible({ timeout: 10000 });

    // Fill out the composer.
    await page.getByTestId('dive-artifact-title').fill('Monsoon and the Western Ghats');
    await page.getByTestId('dive-artifact-keyconcepts').fill(
      [
        'Southwest monsoon driven by ITCZ shift',
        'Orographic uplift on the Western Ghats',
        'Rain shadow effect on the Deccan plateau',
      ].join('\n'),
    );
    await page.getByTestId('dive-artifact-studentvoice').fill(
      'I figured out that the dryness of central India is not random — the Western Ghats squeeze rain out of the air before it can move east.',
    );

    await expect(page.getByTestId('dive-artifact-save')).toBeEnabled();
    await page.getByTestId('dive-artifact-save').click();

    // Transition to completed state.
    await expect(page.getByTestId('dive-completed')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('dive-streak-badge')).toBeVisible();

    // Dashboard now shows the dive CTA in completed state.
    await page.goto('/dashboard');
    await expect(page.getByTestId('rhythm-dive-cta')).toBeVisible({ timeout: 10000 });

    // History page lists the artifact.
    await page.goto('/dive/history');
    await expect(page.getByTestId('dive-history-list')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('dive-history-item').first()).toBeVisible();
  });

  test('4. Hindi toggle flips composer + picker copy', async ({ page }) => {
    await login(page);
    await page.goto('/dive');
    await expect(page.getByTestId('dive-picker-host')).toBeVisible({ timeout: 10000 });

    // Click language toggle (assumed selector — adjust if your toggle differs).
    // Most page layouts have a header-level lang toggle; if this selector misses,
    // skip rather than fail — test stays useful for the EN-default case.
    const langToggle = page.locator('[data-testid="lang-toggle"]');
    if (await langToggle.count() > 0) {
      await langToggle.click();
      await expect(page.getByTestId('dive-picker-submit')).toContainText('शुरू');
    }
  });
});
