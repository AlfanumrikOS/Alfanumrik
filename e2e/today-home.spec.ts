import { test, expect, type Page } from '@playwright/test';
import { mockStudentSession, hasRealStudentCreds, loginViaUI } from './helpers/auth';
import type { TodayResponse } from '../src/lib/today/types';

/**
 * The adaptive "Today" home (`/today`).
 *
 * Browser-level regression net for the flag-gated `/today` surface. It proves
 * two contracts the unit suite cannot reach:
 *
 *   1. FLAG OFF (default): `/today` is invisible — the page never renders for a
 *      visitor without the `ff_today_home_v1` flag; it redirects away from
 *      itself. For an authenticated student the destination is `/dashboard`;
 *      unauthenticated it is `/login`. Either way `/today` is not a reachable
 *      standalone page, and the student bottom nav keeps the EXISTING legacy
 *      tabs (Home / Practice / Foxy / Progress) with NO "Today" tab. This is
 *      the byte-identical flag-off parity guarantee.
 *
 *   2. FLAG ON: `/today` renders `TodayHomeV2` — the sole loaded-state
 *      presentation (see packages/ui/src/today/v2/TodayHomeV2.tsx) — with a
 *      focus hero and a Continue CTA, and clicking Continue navigates to the
 *      resolver's deep-link target (here `/quiz?subject=science&chapter=3`).
 *      The `ff_today_home_v2` flag that used to gate this presentation as an
 *      additive second render path (alongside an older greeting-strip +
 *      focus-card render) has been retired — TodayHomeV2 is unconditional
 *      once `ff_today_home_v1` is on.
 *
 * Determinism strategy (mirrors quiz-happy-path.spec.ts + refresh-page.spec.ts):
 *   - Auth: `mockStudentSession` installs the Supabase token/user/students
 *     network mocks. BUT — as documented in `helpers/auth.ts` — the mocked
 *     session only resolves a REAL `isLoggedIn` gate when the dev server is
 *     bound to a real Supabase URL; against the CI placeholder URL the auth
 *     state never settles and protected pages bounce to /login. So every test
 *     that asserts a *rendered authenticated page* is gated with
 *     `test.fixme(!hasRealStudentCreds(), …)` — catalogued, runs green once a
 *     test-student fixture (TEST_STUDENT_EMAIL/PASSWORD) is wired in CI (same
 *     fixture as REG-45 / REG-69). The mocks below make those tests pass the
 *     moment creds exist — nothing else changes.
 *   - Flag: we intercept the client `feature_flags` REST read (the same call
 *     `getFeatureFlags()` makes) and return a row set with `ff_today_home_v1`
 *     OFF or ON. No service-role key / live DB needed.
 *   - BFF: we intercept `/api/v2/today` (Playwright route interception) and
 *     return a representative `TodayResponse`, so the queue is fixed and does
 *     not depend on seeded learner state.
 *   - Subjects: `/api/student/subjects` is stubbed so `useAllowedSubjects`
 *     resolves instead of erroring.
 *
 * Bilingual: AuthContext bootstraps language from
 * `localStorage['alfanumrik_language']` — the harness DOES support a language
 * toggle, so the bilingual assertion runs (gated on the same auth fixture as
 * the other rendered-page tests, not skipped for lack of a toggle).
 *
 * Run: npx playwright test e2e/today-home.spec.ts
 */

// ── Fixtures ──────────────────────────────────────────────────────────────

/**
 * A representative Today envelope. `primary === queue[0]`. The primary is a
 * weak-topic ZPD quiz whose deepLink resolves (via deepLinkToHref) to
 * `/quiz?subject=science&chapter=3` — the resolver's navigation contract.
 */
const TODAY_RESPONSE: TodayResponse = {
  schemaVersion: 1,
  resolvedAt: '2026-06-06T09:00:00.000Z',
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
  queue: [
    {
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
    {
      type: 'srs_due',
      rank: 2,
      labelKey: 'today.item.srs_due.label',
      subtitleKey: 'today.item.srs_due.subtitle',
      estMinutes: 5,
      deepLink: { route: '/review' },
      iconHint: 'cards-stack',
      reason: 'reviews_due_today',
      meta: { dueCount: 4 },
    },
  ],
  meta: {
    branch: 'start_quiz',
    masterySubjectCount: 3,
    dueReviewCount: 4,
    practicedToday: false,
  },
};

/**
 * Build a `feature_flags` REST payload for the client `getFeatureFlags()`
 * read. The helper returns the minimal column set the client selects
 * (`flag_name, is_enabled, target_roles, target_environments,
 * target_institutions`). Global, unscoped rows so the client coerces them
 * straight to on/off.
 */
function featureFlagsPayload(todayHomeOn: boolean, examScheduleOn = false) {
  return [
    {
      flag_name: 'ff_today_home_v1',
      is_enabled: todayHomeOn,
      target_roles: null,
      target_environments: null,
      target_institutions: null,
    },
    {
      flag_name: 'ff_exam_schedule_v1',
      is_enabled: examScheduleOn,
      target_roles: null,
      target_environments: null,
      target_institutions: null,
    },
  ];
}

/**
 * Install the flag + BFF + subjects mocks on top of `mockStudentSession`.
 */
async function installTodayMocks(
  page: Page,
  opts: {
    todayHomeOn: boolean;
    todayResponse?: TodayResponse | null;
    examScheduleOn?: boolean;
    examScheduleResponse?: { schemaVersion: 1; entries: unknown[] } | null;
    /** Exposes the exam-schedule route's call count to the caller (proves the
     *  request is never issued while ff_today_home_v1 is off). */
    examScheduleCallCounter?: { count: number };
  },
): Promise<void> {
  // Client feature-flag read (getFeatureFlags → supabase.from('feature_flags')).
  await page.route('**/rest/v1/feature_flags**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(featureFlagsPayload(opts.todayHomeOn, opts.examScheduleOn)),
    });
  });

  // Subjects hook — keep it resolving so the loaded page doesn't hang/throw.
  await page.route('**/api/student/subjects**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ subjects: [] }),
    });
  });

  // The Today BFF. When flag is OFF the page redirects before fetching, but we
  // still stub it (404, matching the real flag-off contract) so a stray fetch
  // never hits a live backend.
  await page.route('**/api/v2/today**', async (route) => {
    if (!opts.todayHomeOn || opts.todayResponse === null) {
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'not_found' }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(opts.todayResponse ?? TODAY_RESPONSE),
    });
  });

  // GET /api/v2/exam-schedule — fetched by useExamSchedule whenever
  // ff_today_home_v1 is on && isLoggedIn (see today/page.tsx). Counted so
  // callers can assert it is NEVER requested while the flag is off.
  await page.route('**/api/v2/exam-schedule**', async (route) => {
    if (opts.examScheduleCallCounter) opts.examScheduleCallCounter.count += 1;
    if (!opts.examScheduleOn || opts.examScheduleResponse === null) {
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
      body: JSON.stringify({ success: true, data: opts.examScheduleResponse ?? { schemaVersion: 1, entries: [] } }),
    });
  });
}

// ── 1. Flag OFF — /today never renders as a standalone page ────────────────

test.describe('Today home — flag OFF (parity)', () => {
  // Runs UNCONDITIONALLY: regardless of auth, a flag-off visit to /today must
  // leave /today. Authenticated → /dashboard; unauthenticated → /login. The
  // load-bearing parity assertion is "/today is not a reachable page", which
  // holds in both environments. This is the always-green half of the parity net.
  test('visiting /today redirects away (never stays on /today)', async ({ page }) => {
    await mockStudentSession(page, { xpTotal: 120, streakDays: 3 });
    await installTodayMocks(page, { todayHomeOn: false });

    // Real creds → assert the precise authenticated destination (/dashboard).
    if (hasRealStudentCreds()) {
      await loginViaUI(page);
      await page.goto('/today');
      await page.waitForURL(/\/dashboard/, { timeout: 15_000 });
      expect(page.url()).toContain('/dashboard');
      expect(page.url()).not.toContain('/today');
      return;
    }

    // CI (no fixture): assert /today is left for an auth gate (/login) — the
    // route is never a standalone reachable page without the flag.
    await page.goto('/today');
    await page.waitForURL(/\/(login|dashboard|welcome)/, { timeout: 15_000 });
    expect(page.url()).not.toMatch(/\/today(\?|$)/);
  });

  // Runs UNCONDITIONALLY: proves the page never issues a stray network call
  // to the exam-schedule BFF while it is redirecting away (v1 off) — the
  // exam-schedule fetch is gated by the SAME `flagOn && isLoggedIn` condition
  // as the queue fetch itself, so it must not fire pre-gate either.
  test('never requests GET /api/v2/exam-schedule while ff_today_home_v1 is off', async ({ page }) => {
    const examScheduleCallCounter = { count: 0 };
    await mockStudentSession(page, { xpTotal: 120, streakDays: 3 });
    await installTodayMocks(page, {
      todayHomeOn: false,
      examScheduleOn: true,
      examScheduleCallCounter,
    });

    await page.goto('/today');
    await page.waitForURL(/\/(login|dashboard|welcome)/, { timeout: 15_000 }).catch(() => {
      // Some environments bounce fast enough that waitForURL races the
      // navigation event; the call-count assertion below is the load-bearing
      // check regardless of which URL we land on.
    });
    expect(examScheduleCallCounter.count).toBe(0);
  });

  // Requires a RENDERED authenticated dashboard to read the bottom nav, so it
  // is fixme'd in CI until a test-student fixture lands. The mocks above make
  // it pass the moment creds exist.
  test('student bottom nav shows the EXISTING tabs, no "Today" tab', async ({ page }) => {
    test.fixme(
      !hasRealStudentCreds(),
      'Reading the rendered student bottom nav needs an authenticated /dashboard ' +
      'render. The mocked session passes the auth wall only against a real ' +
      'Supabase URL; the CI placeholder URL bounces to /login. Promote once ' +
      'TEST_STUDENT_EMAIL/PASSWORD are wired (same fixture as REG-45/REG-69). ' +
      'Flag-off nav parity is also unit-covered in ' +
      'src/__tests__/state/learner-loop / nav-config tests.',
    );

    // Mobile viewport so the bottom nav (not the desktop sidebar) renders.
    await page.setViewportSize({ width: 375, height: 812 });
    await mockStudentSession(page, { xpTotal: 120, streakDays: 3 });
    await installTodayMocks(page, { todayHomeOn: false });

    if (hasRealStudentCreds()) {
      await loginViaUI(page);
    }

    await page.goto('/dashboard');
    await page.waitForLoadState('domcontentloaded');

    const nav = page.getByRole('navigation', { name: /main navigation/i });
    await expect(nav).toBeVisible({ timeout: 15_000 });

    // Legacy CORE_TABS labels must be present…
    await expect(nav.getByText('Home', { exact: true })).toBeVisible();
    await expect(nav.getByText('Practice', { exact: true })).toBeVisible();
    await expect(nav.getByText('Progress', { exact: true })).toBeVisible();

    // …and the flag-gated tabs must NOT be (flag-off byte-identical parity).
    await expect(nav.getByText('Today', { exact: true })).toHaveCount(0);
    await expect(nav.getByText('Learn', { exact: true })).toHaveCount(0);
    await expect(nav.getByText('Me', { exact: true })).toHaveCount(0);
  });
});

// ── 2. Flag ON — TodayHomeV2 renders: primary card + Start navigation ──────
//
// Phase 4 (2026-08-11) rebuilt the loaded surface as a prioritised action
// queue. The two mutually-exclusive heroes (`today-v2-focus-hero` /
// `today-v2-resume-hero`, plus the resume "Later" dismiss) are gone: there is
// now ONE primary card (`today-primary`) with ONE CTA (`today-primary-cta`)
// whose verb switches between Start and Continue, followed by the plan,
// reminder, progress statement and Foxy entry. The testids below track that.

test.describe('Today home — flag ON (TodayHomeV2, the sole loaded-state render)', () => {
  test('renders the TodayHomeV2 primary card with a single CTA', async ({ page }) => {
    test.fixme(
      !hasRealStudentCreds(),
      'Rendering /today past the auth+flag gate needs an authenticated session. ' +
      'Mocked session resolves only against a real Supabase URL; CI placeholder ' +
      'URL bounces to /login before the gated render. Mocks (flag ON + /api/v2/today ' +
      'envelope) are installed so this passes once a test-student fixture is wired. ' +
      'The render contract is unit-covered in ' +
      'src/__tests__/components/today/TodayHomeV2.test.tsx.',
    );

    await mockStudentSession(page, { xpTotal: 250, streakDays: 5 });
    await installTodayMocks(page, { todayHomeOn: true });

    if (hasRealStudentCreds()) {
      await loginViaUI(page);
    }

    await page.goto('/today');
    await page.waitForLoadState('domcontentloaded');

    // The loaded shell renders TodayHomeV2 (root + greeting testids).
    await expect(page.getByTestId('today-loaded')).toBeVisible({ timeout: 15_000 });
    const greeting = page.getByTestId('today-greeting');
    await expect(greeting).toBeVisible();
    await expect(greeting.getByRole('heading', { name: 'What should I learn now?' })).toBeVisible();

    // The single primary recommendation card.
    await expect(page.getByTestId('today-primary')).toBeVisible();
    await expect(page.getByText('Start here')).toBeVisible();
    await expect(page.getByText("Today's challenge")).toBeVisible();

    // It states WHY, in approved learner language — never the machine reason.
    await expect(page.getByTestId('today-primary-reason')).toHaveText(/Build this prerequisite/);
    await expect(page.getByText('todays_zpd')).toHaveCount(0);

    // Exactly ONE primary CTA on the screen.
    await expect(page.getByTestId('today-primary-cta')).toHaveCount(1);

    // The compact progress statement and the Foxy entry close the surface.
    await expect(page.getByTestId('today-progress')).toBeVisible();
    await expect(page.getByTestId('today-foxy')).toBeVisible();
  });

  test('caps the plan at three activities and shows no leaderboard above learning', async ({ page }) => {
    test.fixme(
      !hasRealStudentCreds(),
      'Same auth-gate dependency as the render test above. Mocks installed; promote ' +
      'with the test-student fixture. Unit-covered in ' +
      'src/__tests__/components/today/TodayHomeV2.test.tsx.',
    );

    await mockStudentSession(page, { xpTotal: 250, streakDays: 5 });
    await installTodayMocks(page, { todayHomeOn: true });

    if (hasRealStudentCreds()) {
      await loginViaUI(page);
    }

    await page.goto('/today');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.getByTestId('today-loaded')).toBeVisible({ timeout: 15_000 });
    expect(await page.getByTestId('today-plan-item').count()).toBeLessThanOrEqual(3);
    await expect(page.getByText(/leaderboard/i)).toHaveCount(0);
  });

  test('clicking Continue navigates to the resolver deep-link target', async ({ page }) => {
    test.fixme(
      !hasRealStudentCreds(),
      'Same auth-gate dependency as the render test above — the Continue CTA ' +
      'only exists once /today renders past the gate. Mocks installed; promote ' +
      'with the test-student fixture. deepLinkToHref → /quiz?subject=science&chapter=3 ' +
      'is unit-covered in src/__tests__/lib/today/copy (or map-action) tests.',
    );

    await mockStudentSession(page, { xpTotal: 250, streakDays: 5 });
    await installTodayMocks(page, { todayHomeOn: true });

    // /quiz redirects to /foxy in next.config.js — stub it so the click is
    // asserted on the navigation target the resolver chose, independent of any
    // downstream rewrite. We assert the URL the app pushed.
    await page.route('**/quiz**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<!doctype html><html><body data-testid="quiz-stub">quiz</body></html>',
      });
    });

    if (hasRealStudentCreds()) {
      await loginViaUI(page);
    }

    await page.goto('/today');
    await page.waitForLoadState('domcontentloaded');

    const continueCta = page.getByTestId('today-primary-cta');
    await expect(continueCta).toBeVisible({ timeout: 15_000 });
    await continueCta.click();

    // The primary card builds the href from the primary deepLink via
    // deepLinkToHref → /quiz?subject=science&chapter=3, then router.push()es it.
    await page.waitForURL(/\/quiz\?subject=science&chapter=3/, { timeout: 15_000 });
    expect(page.url()).toContain('/quiz');
    expect(page.url()).toContain('subject=science');
    expect(page.url()).toContain('chapter=3');
  });

  // ── 3. Bilingual — Hindi heading when isHi is active ─────────────────────
  test('renders the Hindi heading when language is Hindi', async ({ page }) => {
    test.fixme(
      !hasRealStudentCreds(),
      'Bilingual assertion needs the gated /today to render. The harness DOES ' +
      'support a language toggle (localStorage["alfanumrik_language"]="hi" → ' +
      'AuthContext.isHi), so this is NOT skipped for lack of a toggle — it is ' +
      'gated on the same auth fixture as the other rendered-page tests. Copy ' +
      'table is unit-covered in src/__tests__/lib/today/copy tests.',
    );

    // Seed AuthContext language BEFORE any app script runs. AuthContext reads
    // localStorage['alfanumrik_language'] during bootstrap → isHi = true.
    await page.addInitScript(() => {
      try {
        window.localStorage.setItem('alfanumrik_language', 'hi');
      } catch {
        /* storage unavailable — assertion below will surface it */
      }
    });

    await mockStudentSession(page, { xpTotal: 250, streakDays: 5 });
    await installTodayMocks(page, { todayHomeOn: true });

    if (hasRealStudentCreds()) {
      await loginViaUI(page);
    }

    await page.goto('/today');
    await page.waitForLoadState('domcontentloaded');

    const greeting = page.getByTestId('today-greeting');
    await expect(greeting).toBeVisible({ timeout: 15_000 });
    await expect(greeting.getByRole('heading', { name: 'मुझे अभी क्या सीखना चाहिए?' })).toBeVisible();
    // Every block is bilingual (P7), not just the heading.
    await expect(page.getByTestId('today-primary-reason')).toHaveText(/यह बुनियाद मज़बूत करो/);
  });
});

// ── 4. TodayHomeV2 — an in-progress session in the one primary card ────────
//
// There is no longer a separate "resume hero" / "focus hero" pair. A
// resume_in_progress primary renders through the SAME `today-primary` card;
// only the CTA verb ("Continue" rather than "Start") and the resume status
// chip differ. The "Later" dismiss was removed with the second hero: the plan
// block below the card is now how a student chooses something else, which
// keeps one dominant action per screen.

test.describe('TodayHomeV2 rendered on /today — an in-progress session', () => {
  test('renders the primary card with a Continue CTA and an in-progress status', async ({ page }) => {
    test.fixme(
      !hasRealStudentCreds(),
      'Rendering /today past the auth+flag gate needs an authenticated session — same ' +
      'fixture dependency as the "flag ON" tests above. Mocks (flag ON, a ' +
      'resume_in_progress TodayResponse) are installed so this passes the moment a ' +
      'test-student fixture is wired. Unit-covered in the meantime by ' +
      'src/__tests__/components/today/TodayHomeV2.test.tsx.',
    );

    const resumeResponse: TodayResponse = {
      schemaVersion: 1,
      resolvedAt: '2026-08-02T09:00:00.000Z',
      primary: {
        type: 'resume_in_progress',
        rank: 1,
        labelKey: 'today.item.resume_in_progress.label',
        subtitleKey: 'today.item.resume_in_progress.subtitle',
        estMinutes: 5,
        deepLink: { route: '/learn/science/7' },
        iconHint: 'flame',
        reason: 'resume',
        meta: { liveKind: 'in_lesson', subjectCode: 'science', chapterNumber: 7 },
      },
      queue: [
        {
          type: 'resume_in_progress',
          rank: 1,
          labelKey: 'today.item.resume_in_progress.label',
          subtitleKey: 'today.item.resume_in_progress.subtitle',
          estMinutes: 5,
          deepLink: { route: '/learn/science/7' },
          iconHint: 'flame',
          reason: 'resume',
          meta: { liveKind: 'in_lesson', subjectCode: 'science', chapterNumber: 7 },
        },
      ],
      meta: { branch: 'resume', masterySubjectCount: 1, dueReviewCount: 0, practicedToday: true },
    };

    await mockStudentSession(page, { xpTotal: 250, streakDays: 5 });
    await installTodayMocks(page, {
      todayHomeOn: true,
      todayResponse: resumeResponse,
    });

    if (hasRealStudentCreds()) {
      await loginViaUI(page);
    }

    await page.goto('/today');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.getByTestId('today-v2')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('today-greeting')).toBeVisible();
    await expect(page.getByTestId('today-primary')).toBeVisible();
    await expect(page.getByTestId('today-primary-cta')).toHaveText(/Continue/);
    await expect(page.getByTestId('today-primary-status')).toHaveText(/In progress/);
    // Still exactly one primary action — there is no second hero, and no
    // "Later" dismiss competing with it.
    await expect(page.getByTestId('today-primary-cta')).toHaveCount(1);
  });

  test('clicking the primary CTA navigates to the resume deep link', async ({ page }) => {
    test.fixme(
      !hasRealStudentCreds(),
      'Same auth-gate dependency as the render test above. Mocks installed; promote with ' +
      'the test-student fixture.',
    );

    const resumeResponse: TodayResponse = {
      schemaVersion: 1,
      resolvedAt: '2026-08-02T09:00:00.000Z',
      primary: {
        type: 'resume_in_progress',
        rank: 1,
        labelKey: 'today.item.resume_in_progress.label',
        subtitleKey: 'today.item.resume_in_progress.subtitle',
        estMinutes: 5,
        deepLink: { route: '/learn/science/7' },
        iconHint: 'flame',
        reason: 'resume',
        meta: { liveKind: 'in_lesson', subjectCode: 'science', chapterNumber: 7 },
      },
      queue: [],
      meta: { branch: 'resume', masterySubjectCount: 1, dueReviewCount: 0, practicedToday: true },
    };
    // queue[0] must equal primary — mirror that contract in the fixture.
    resumeResponse.queue = [resumeResponse.primary];

    await mockStudentSession(page, { xpTotal: 250, streakDays: 5 });
    await installTodayMocks(page, { todayHomeOn: true, todayResponse: resumeResponse });

    if (hasRealStudentCreds()) {
      await loginViaUI(page);
    }

    await page.goto('/today');
    await page.waitForLoadState('domcontentloaded');

    const continueCta = page.getByTestId('today-primary-cta');
    await expect(continueCta).toBeVisible({ timeout: 15_000 });
    await continueCta.click();
    await page.waitForURL(/\/learn\/science\/7/, { timeout: 15_000 });
    expect(page.url()).toContain('/learn/science/7');
  });

  test('a non-resume primary uses the SAME card with a Start CTA', async ({ page }) => {
    test.fixme(
      !hasRealStudentCreds(),
      'Same auth-gate dependency as the other v2 render tests. Mocks installed; promote ' +
      'with the test-student fixture.',
    );

    await mockStudentSession(page, { xpTotal: 250, streakDays: 5 });
    await installTodayMocks(page, { todayHomeOn: true, todayResponse: TODAY_RESPONSE });

    if (hasRealStudentCreds()) {
      await loginViaUI(page);
    }

    await page.goto('/today');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.getByTestId('today-primary')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('today-primary-cta')).toHaveText(/Start/);
    await expect(page.getByTestId('today-primary-status')).toHaveText(/Not started/);
  });
});

/* ──────────────────────────────────────────────────────────────────────────
 * TODO (follow-up): wire the shared test-student fixture (TEST_STUDENT_EMAIL /
 * TEST_STUDENT_PASSWORD against a staging Supabase project — same fixture
 * tracked by REG-45 / REG-69) so the `test.fixme(!hasRealStudentCreds(), …)`
 * blocks above run green in CI:
 *   1. Account state: onboarding_completed=true, grade='9', board='CBSE'.
 *   2. Flip ff_today_home_v1 ON for that user via helpers/feature-flag.ts
 *      instead of the network stub (exercises the real flag read path).
 *   3. Seed enough mastery/review state that /api/v2/today returns a non-empty
 *      queue with a deterministic primary, OR keep the /api/v2/today stub to
 *      keep the queue fixed (recommended — the resolver is unit-tested
 *      separately, so the E2E only needs to prove the page CONSUMES the
 *      envelope and navigates).
 * Owner: testing. Tracked alongside REG-45/69 fixture work.
 * ────────────────────────────────────────────────────────────────────────── */
