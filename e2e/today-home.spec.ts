import { test, expect, type Page } from '@playwright/test';
import { mockStudentSession, hasRealStudentCreds, loginViaUI } from './helpers/auth';
import type { TodayResponse } from '../src/lib/today/types';

/**
 * Consumer Minimalism Wave A — the adaptive "Today" home (`/today`).
 *
 * Browser-level regression net for the flag-gated Wave A surface. It proves two
 * contracts the unit suite cannot reach:
 *
 *   1. FLAG OFF (default): `/today` is invisible — the page never renders for a
 *      visitor without the flag; it redirects away from itself. For an
 *      authenticated student the destination is `/dashboard`; unauthenticated it
 *      is `/login`. Either way `/today` is not a reachable standalone page, and
 *      the student bottom nav keeps the EXISTING legacy tabs (Home / Practice /
 *      Foxy / Progress) with NO "Today" tab. This is the byte-identical
 *      flag-off parity guarantee.
 *
 *   2. FLAG ON: `/today` renders the greeting strip + the primary "Today's
 *      focus" card with a Continue CTA, and clicking Continue navigates to the
 *      resolver's deep-link target (here `/quiz?subject=science&chapter=3`).
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
 * toggle, so the bilingual assertion ("आज") runs (gated on the same auth
 * fixture as the other rendered-page tests, not skipped for lack of a toggle).
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
function featureFlagsPayload(todayHomeOn: boolean) {
  return [
    {
      flag_name: 'ff_today_home_v1',
      is_enabled: todayHomeOn,
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
  opts: { todayHomeOn: boolean; todayResponse?: TodayResponse | null },
): Promise<void> {
  // Client feature-flag read (getFeatureFlags → supabase.from('feature_flags')).
  await page.route('**/rest/v1/feature_flags**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(featureFlagsPayload(opts.todayHomeOn)),
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

    // …and the Wave-A-only tabs must NOT be (flag-off byte-identical parity).
    await expect(nav.getByText('Today', { exact: true })).toHaveCount(0);
    await expect(nav.getByText('Learn', { exact: true })).toHaveCount(0);
    await expect(nav.getByText('Me', { exact: true })).toHaveCount(0);
  });
});

// ── 2. Flag ON — greeting + focus card + Continue navigation ───────────────

test.describe('Today home — flag ON', () => {
  test('renders greeting strip + Today\'s Focus card with a Continue CTA', async ({ page }) => {
    test.fixme(
      !hasRealStudentCreds(),
      'Rendering /today past the auth+flag gate needs an authenticated session. ' +
      'Mocked session resolves only against a real Supabase URL; CI placeholder ' +
      'URL bounces to /login before the gated render. Mocks (flag ON + /api/v2/today ' +
      'envelope) are installed so this passes once a test-student fixture is wired. ' +
      'The render contract is unit-covered in src/__tests__/lib/today/*.',
    );

    await mockStudentSession(page, { xpTotal: 250, streakDays: 5 });
    await installTodayMocks(page, { todayHomeOn: true });

    if (hasRealStudentCreds()) {
      await loginViaUI(page);
    }

    await page.goto('/today');
    await page.waitForLoadState('domcontentloaded');

    // Greeting strip — English heading (default language).
    const greeting = page.getByTestId('today-greeting');
    await expect(greeting).toBeVisible({ timeout: 15_000 });
    await expect(greeting.getByRole('heading', { name: /^Today$/ })).toBeVisible();

    // The loaded shell + primary focus card render.
    await expect(page.getByTestId('today-loaded')).toBeVisible();
    await expect(page.getByText("Today's focus")).toBeVisible();
    // Primary item label (weak_topic_zpd → "Today's challenge").
    await expect(page.getByText("Today's challenge")).toBeVisible();

    // The Continue CTA exists and is clickable.
    await expect(page.getByTestId('today-focus-continue')).toBeVisible();
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

    const continueCta = page.getByTestId('today-focus-continue');
    await expect(continueCta).toBeVisible({ timeout: 15_000 });
    await continueCta.click();

    // The focus card builds the href from the primary deepLink via
    // deepLinkToHref → /quiz?subject=science&chapter=3, then router.push()es it.
    await page.waitForURL(/\/quiz\?subject=science&chapter=3/, { timeout: 15_000 });
    expect(page.url()).toContain('/quiz');
    expect(page.url()).toContain('subject=science');
    expect(page.url()).toContain('chapter=3');
  });

  // ── 3. Bilingual — Hindi heading "आज" when isHi is active ────────────────
  test('renders the Hindi heading "आज" when language is Hindi', async ({ page }) => {
    test.fixme(
      !hasRealStudentCreds(),
      'Bilingual assertion needs the gated /today to render. The harness DOES ' +
      'support a language toggle (localStorage["alfanumrik_language"]="hi" → ' +
      'AuthContext.isHi), so this is NOT skipped for lack of a toggle — it is ' +
      'gated on the same auth fixture as the other rendered-page tests. Copy ' +
      'table ("आज") is unit-covered in src/__tests__/lib/today/copy tests.',
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
    // "आज" is the Hindi copy for `today.heading`.
    await expect(greeting.getByRole('heading', { name: 'आज' })).toBeVisible();
  });
});

/* ──────────────────────────────────────────────────────────────────────────
 * TODO (Consumer Minimalism Wave A follow-up): wire the shared test-student
 * fixture (TEST_STUDENT_EMAIL / TEST_STUDENT_PASSWORD against a staging
 * Supabase project — same fixture tracked by REG-45 / REG-69) so the four
 * `test.fixme(!hasRealStudentCreds(), …)` blocks above run green in CI:
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
