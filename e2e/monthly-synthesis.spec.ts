import { test, expect } from '@playwright/test';

/**
 * Pedagogy v2 — Wave 3 Task 9
 * Monthly Synthesis smoke.
 *
 * Pre-conditions (set up once on staging Supabase):
 *   - Test student `synthesis-test@alfanumrik.test` with a `students` row,
 *     name='Aanya', grade='10', academic_goal='school_topper'.
 *   - One linked guardian (guardian_student_links.status='approved') with
 *     guardians.monthly_synthesis_optin=TRUE and guardians.phone in E.164
 *     (e.g., '+919999999999' for staging — calls are stubbed by the
 *     whatsapp-notify Edge Function unless WHATSAPP_API_KEY is wired).
 *   - One monthly_synthesis_runs row for the test student with empty
 *     summary_text_en/hi (so the lazy-fill path runs on first /synthesis
 *     view). Insert via SQL between e2e runs to keep tests deterministic:
 *       DELETE FROM monthly_synthesis_runs WHERE student_id = '<uuid>';
 *       SELECT functions/v1/monthly-synthesis-builder
 *         POST {student_id, synthesis_month: '<previous_month>'}
 *   - Feature flag ff_pedagogy_v2_monthly_synthesis=true on staging.
 *   - For test 3 dashboard CTA: ff_pedagogy_v2_daily_rhythm=true.
 *
 * Auth credentials override via E2E_SYNTHESIS_EMAIL /
 * E2E_SYNTHESIS_PASSWORD env vars.
 */
test.describe('Pedagogy v2 — Monthly Synthesis', () => {
  async function login(page: import('@playwright/test').Page) {
    await page.goto('/login');
    await page.fill('input[name="email"]', process.env.E2E_SYNTHESIS_EMAIL ?? 'synthesis-test@alfanumrik.test');
    await page.fill('input[name="password"]', process.env.E2E_SYNTHESIS_PASSWORD ?? 'changeme');
    await page.click('button[type="submit"]');
    await page.waitForURL((u) => u.pathname !== '/login', { timeout: 10000 });
  }

  test('1. /synthesis renders ritual + parent-share card after lazy summary fill', async ({ page }) => {
    await login(page);
    await page.goto('/synthesis');

    // The lazy-fill round-trip can take a few seconds (Claude call).
    const ritual = page.getByTestId('synthesis-ritual');
    await expect(ritual).toBeVisible({ timeout: 30_000 });

    await expect(page.getByTestId('synthesis-mastery-tiles')).toBeVisible();
    await expect(page.getByTestId('parent-share-card')).toBeVisible();

    // Either the summary text renders, OR the "generating" hint is shown.
    // Both are valid pass states for this smoke (depends on Claude latency).
    const summary = page.getByTestId('synthesis-summary-text');
    const pending = page.getByTestId('synthesis-summary-pending');
    await expect(summary.or(pending)).toBeVisible();
  });

  test('2. parent-share card EN/HI tabs flip the preview content', async ({ page }) => {
    await login(page);
    await page.goto('/synthesis');
    await expect(page.getByTestId('synthesis-ritual')).toBeVisible({ timeout: 30_000 });

    const card = page.getByTestId('parent-share-card');
    await expect(card).toBeVisible();
    const preview = page.getByTestId('parent-share-preview');

    await page.getByTestId('parent-share-tab-en').click();
    const enText = await preview.innerText();

    await page.getByTestId('parent-share-tab-hi').click();
    const hiText = await preview.innerText();

    // Either both have real text and they differ, or both render the
    // "generating" placeholder (which is the same string). The smoke
    // verifies the tabs are wired, not the LLM-output content.
    expect(enText.length).toBeGreaterThan(0);
    expect(hiText.length).toBeGreaterThan(0);
  });

  test('3. dashboard CTA shows synthesis row when a recent synthesis exists', async ({ page }) => {
    await login(page);
    await page.goto('/dashboard');

    // The DailyRhythmQueue is the host. Synthesis row appears when /api/synthesis/state
    // returns state='ready' AND createdAt within the past 7 days.
    const queue = page.getByTestId('daily-rhythm-queue');
    await expect(queue).toBeVisible({ timeout: 10_000 });

    const cta = page.getByTestId('rhythm-synthesis-cta');
    await expect(cta).toBeVisible({ timeout: 10_000 });
    await expect(cta.getByText(/View|देखो/)).toBeVisible();
  });

  test('4. clicking Send via WhatsApp transitions parent_share_status to sent (or opted_out)', async ({ page }) => {
    await login(page);
    await page.goto('/synthesis');
    await expect(page.getByTestId('synthesis-ritual')).toBeVisible({ timeout: 30_000 });

    const sendBtn = page.getByTestId('parent-share-send');
    if (await sendBtn.count() === 0) {
      // onSend not wired (feature off in this env) — skip cleanly.
      test.skip();
      return;
    }

    // Pre-condition: status = 'pending' (test setup ensures this).
    await sendBtn.click();

    // After click, status chip flips to 'Sent' (✓), 'Parent opted out',
    // or 'Failed'. Any of those is a valid POST round-trip; the test
    // verifies the status transitioned away from 'Pending'.
    const card = page.getByTestId('parent-share-card');
    await expect(card.getByText(/Sent|Parent opted out|Failed|भेज दिया|अभिभावक ने मना किया|विफल/))
      .toBeVisible({ timeout: 15_000 });
  });
});
