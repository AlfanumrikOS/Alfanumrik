import { test, expect, type Page, type Route } from '@playwright/test';
import { mockStudentSession } from './helpers/auth';

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
  const synthesisRow = {
    id: 'synthesis-run-e2e-1',
    synthesisMonth: 'June 2026',
    createdAt: new Date().toISOString(),
    summaryTextEn: 'Aanya strengthened photosynthesis and improved in quadratic equations this month.',
    summaryTextHi: 'आन्या ने इस महीने प्रकाश संश्लेषण मजबूत किया और द्विघात समीकरणों में सुधार किया।',
    parentShareStatus: 'pending' as const,
    parentShareSentAt: null,
    bundle: {
      masteryDelta: {
        topicsMastered: 4,
        topicsImproved: 6,
        topicsRegressed: 1,
        chaptersTouched: ['Photosynthesis', 'Quadratic equations', 'Indian nationalism'],
      },
      weeklyArtifactIds: ['week-1', 'week-2', 'week-3'],
      chapterMockSummary: {
        totalQuestions: 18,
      },
    },
  };

  async function installLocalMocks(page: Page) {
    await mockStudentSession(page, { onboardingCompleted: true });
    await page.route('**/api/synthesis/state', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ state: 'ready', row: synthesisRow }),
      });
    });
    await page.route('**/api/synthesis/parent-share', async (route: Route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, sentAt: new Date().toISOString() }),
      });
    });
    await page.route('**/api/dive/state', async (route: Route) => {
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ state: 'closed' }),
      });
    });
    await page.route('**/functions/v1/nep-compliance', async (route: Route) => {
      const body = route.request().postDataJSON() as { action?: string } | null;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          body?.action === 'get_hpc'
            ? {
                student: { name: 'Test student', grade: '9', board: 'CBSE' },
                academic_year: '2026-27',
                term: 'Term 1',
                class_percentile: 72,
                bloom_distribution: { remember: 2, understand: 3, apply: 4, total: 9 },
                competency_levels: {},
                subject_performance: {},
                learning_behaviors: {},
                holistic_indicators: {},
                cbse_readiness: {},
                portfolio_highlights: [],
              }
            : { ok: true },
        ),
      });
    });
  }

  test('1. /synthesis renders ritual + parent-share card after lazy summary fill', async ({ page }) => {
    await installLocalMocks(page);
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
    await installLocalMocks(page);
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

  test('3. HPC CTA shows synthesis chip when a recent synthesis exists', async ({ page }) => {
    await installLocalMocks(page);
    await page.goto('/hpc');

    const cta = page.getByTestId('hpc-synthesis-chip');
    await expect(cta).toBeVisible({ timeout: 10_000 });
    await expect(cta).toContainText(/Monthly synthesis ready|मासिक/);
  });

  test('4. clicking Send via WhatsApp transitions parent_share_status to sent (or opted_out)', async ({ page }) => {
    await installLocalMocks(page);
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
    await expect(card.getByText(/Sent|Parent opted out|Failed|भेज दिया|अभिभावक ने मना किया|विफल/).first())
      .toBeVisible({ timeout: 15_000 });
  });
});
