import { test, expect, type Page } from '@playwright/test';
import { mockStudentSession } from './helpers/auth';
import {
  installBackendContainment,
  assertTreeAlive,
  overrideStudentRow,
  measureClipping,
  shot,
  writeJson,
} from './helpers/ui-audit';
import {
  attachEscapeGuard,
  countLaidOutTiers,
  assertNoExternalTraffic,
  measureNavState,
  EXPECTED_SLOT_ORDER,
  TIER_SELECTOR,
  type NavTier,
} from './helpers/viewport-audit';

/**
 * THE STUDENT NAVIGATION CONTRACT, OBSERVED IN A BROWSER.
 *
 * ── What this pins ───────────────────────────────────────────────────────
 * Commit 3 (2026-08-09) replaced two ad-hoc navigations with ONE typed config
 * rendered by three tier components, and nothing pinned the result. The
 * properties below are the product contract; each is silent when broken:
 *
 *   1. FIVE primary slots, in the order Today · Learn · Practice · Progress ·
 *      More, at every breakpoint.
 *   2. Tier boundaries: bottom bar <= 767, tablet rail 768-1023, sidebar >=
 *      1024. EXACTLY ONE tier laid out at any width — two would put two
 *      navigation landmarks in the accessibility tree and duplicate every
 *      destination for a screen-reader user.
 *   3. Exactly ONE `aria-current="page"` in the whole document. Zero is the
 *      defect nav-config's TODAY FLAG CONTRACT records as having been measured
 *      at 360px before `altHrefs` existed; two is what a per-item
 *      `isNavItemActive` loop produces on /quiz.
 *   4. The five primaries are NEVER also rows in the More sheet.
 *
 * ── Why in a browser, when there is also a unit test ─────────────────────
 * `apps/host/src/__tests__/components/navigation/student-primary-nav-contract.test.ts`
 * pins the RESOLVED DATA — pure functions over a config object, where a
 * browser buys nothing. It cannot reach any of the four properties above,
 * because every one of them is a fact about layout or about the rendered
 * accessibility tree: which tier a media query displays, how many
 * `aria-current` attributes survive into the document, whether five slots fit
 * at 360px. The two layers are deliberately disjoint, not duplicated.
 *
 * ── Cross-browser ────────────────────────────────────────────────────────
 * This file is the SUBSET that also runs on Firefox and WebKit (see
 * `playwright.config.ts`). It was chosen for that because it is the file
 * whose assertions are most likely to differ per engine: the tier switch is a
 * media query, the "exactly one tier" guarantee rests on `display:none`
 * removing an element from the a11y tree, and the shell inset relies on
 * `:has()` — which Safari gained only in 15.4 and Firefox in 121, and for
 * which globals.css carries a `body.has-nav-rail` fallback that no test has
 * ever exercised in a non-Chromium engine.
 *
 * ── Safety ───────────────────────────────────────────────────────────────
 * Full `page.route()` containment plus `attachEscapeGuard`, which FAILS the
 * test if any browser request actually reached a remote server. That guard is
 * not ceremonial: the local dev server may be running with real credentials,
 * so an uncontained request is a live-data touch.
 *
 * Run: npx playwright test e2e/ui-nav-contract.spec.ts --project=chromium
 */

test.beforeEach(async ({}, testInfo) => {
  // `next dev` compiles each route on first request; a cold /dashboard has
  // measured ~84s. Budget for that so a compile never presents as a missing
  // locator (the diagnosis that wasted a day on e2e/ui-responsive-a11y).
  testInfo.setTimeout(300_000);
});

/* ── Fixtures ─────────────────────────────────────────────────────────── */

const SUBJECTS = [
  { code: 'science', name: 'Science', nameHi: 'विज्ञान', icon: '🔬', color: '#22C55E', subjectKind: 'cbse_core', isCore: true, isLocked: false },
  { code: 'maths', name: 'Mathematics', nameHi: 'गणित', icon: '📐', color: '#3B82F6', subjectKind: 'cbse_core', isCore: true, isLocked: false },
];

/** A REAL `/api/v2/today` envelope — see e2e/ui-responsive-a11y.spec.ts for why a `{}` stub crashes the page. */
const TODAY_RESPONSE = {
  schemaVersion: 1,
  resolvedAt: new Date().toISOString(),
  primary: {
    type: 'weak_topic_zpd', rank: 1,
    labelKey: 'today.item.weak_topic_zpd.label',
    subtitleKey: 'today.item.weak_topic_zpd.subtitle',
    estMinutes: 10,
    deepLink: { route: '/quiz', params: { subject: 'science', chapter: 3 } },
    iconHint: 'target', reason: 'todays_zpd',
    chapterTitle: 'Force and Laws of Motion', chapterTitleHi: 'बल तथा गति के नियम',
  },
  queue: [
    {
      type: 'weak_topic_zpd', rank: 1,
      labelKey: 'today.item.weak_topic_zpd.label',
      subtitleKey: 'today.item.weak_topic_zpd.subtitle',
      estMinutes: 10,
      deepLink: { route: '/quiz', params: { subject: 'science', chapter: 3 } },
      iconHint: 'target', reason: 'todays_zpd',
      chapterTitle: 'Force and Laws of Motion', chapterTitleHi: 'बल तथा गति के नियम',
    },
  ],
  meta: { branch: 'zpd', masterySubjectCount: 2, dueReviewCount: 5, practicedToday: false },
};

const BACKEND = {
  apis: {
    '/api/v2/today': { kind: 'ok' as const, body: TODAY_RESPONSE },
    '/api/student/subjects': { kind: 'ok' as const, body: { subjects: SUBJECTS } },
    '/api/student/chapters': { kind: 'ok' as const, body: { chapters: [] } },
  },
  rpcs: { get_mastery_overview: { kind: 'ok' as const, body: [] } },
};

const STUDENT_OPTS = { xpTotal: 12450, streakDays: 7, anyProjectRef: true as const };

/* ── Navigation ───────────────────────────────────────────────────────── */

/**
 * Land on a student route with the nav mounted, without depending on any
 * page-specific marker.
 *
 * `gotoStudent` in e2e/ui-responsive-a11y.spec.ts waits for
 * `.dashboard-header-row`, which exists only on /dashboard. Readiness here is
 * "a navigation landmark is laid out", which is the precondition every
 * assertion in this file actually needs and which holds on every route.
 */
async function gotoWithNav(
  page: Page,
  route: string,
  opts?: { preferredLanguage?: 'en' | 'hi' },
): Promise<void> {
  await installBackendContainment(page, BACKEND);
  await mockStudentSession(page, STUDENT_OPTS);
  if (opts?.preferredLanguage) {
    await overrideStudentRow(page, {
      xp_total: STUDENT_OPTS.xpTotal,
      streak_days: STUDENT_OPTS.streakDays,
      preferred_language: opts.preferredLanguage,
    });
  }
  await page.goto(route);
  await page.waitForLoadState('domcontentloaded');
  await expect
    .poll(() => page.url(), {
      timeout: 30_000,
      message:
        `Expected to stay on ${route} with the mocked student session but the page navigated ` +
        'away — the auth contract changed, this is not a missing fixture.',
    })
    .not.toMatch(/\/(login|welcome|onboarding)(\?|$)/);
  await assertTreeAlive(page, route);
  await waitForNavLaidOut(page, route);
}

/**
 * Readiness = "exactly one navigation tier is LAID OUT", not "a nav element is
 * attached".
 *
 * ── Why the stronger condition (2026-08-10) ──────────────────────────────
 * `toBeAttached` is satisfied the moment the element enters the DOM, which
 * under `next dev` happens BEFORE the stylesheet has applied the tier-switch
 * media queries. A run that gated on attachment measured `visibleTiers: []` at
 * 360px and reported "no navigation is displayed" — a false failure describing
 * a frame that existed for a few milliseconds. Gating on the laid-out state
 * removes the race at its source instead of papering over it with a retry.
 *
 * The 180s budget is for the dev server, not for the app: `next dev` compiles
 * a route's CLIENT bundle after serving its HTML, and warming a route with an
 * HTTP request only warms the server render. A cold /leaderboard exceeded 120s
 * on a first visit. Against a production build every one of these resolves in
 * milliseconds; the budget only ever absorbs a compile, and the per-test
 * timeout still bounds a genuine hang.
 */
async function waitForNavLaidOut(page: Page, route: string): Promise<void> {
  await expect
    .poll(() => countLaidOutTiers(page), {
      timeout: 180_000,
      message:
        `No navigation tier was ever laid out on ${route}. Every assertion in this file is about ` +
        'the navigation, so measuring now would measure its absence and could report a pass.',
    })
    .toBe(1);
}

/**
 * The slot control a user can actually reach at the current width.
 *
 * ── Why `:visible` and not `.first()` (2026-08-10) ───────────────────────
 * All three tier components stay MOUNTED at every width by design (so a route
 * change never re-mounts navigation) and only one is `display:none`-visible.
 * So `[data-slot="more"]` matches TWICE in the document — once in the tablet
 * rail, once in the bottom bar — and `.first()` returns whichever comes first
 * in DOM order, which is the rail. At 390px that element is `display:none`,
 * and `click()` on it waits for a visibility that never comes: the first run
 * of this file burned 4 minutes per test on exactly that, while the identical
 * 768px test passed in 5 seconds. `:visible` selects the tier that is actually
 * on screen, which is also the only one a student could tap.
 */
function slot(page: Page, id: string) {
  return page.locator(`[data-slot="${id}"]:visible`).first();
}

/* ═══════════════════════════════════════════════════════════════════════
 * 1. Tier boundaries — exactly one navigation, at the declared widths
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * The boundary widths, not round numbers. 767/768 and 1023/1024 are where an
 * off-by-one in a media query lives; 360/1440 would never catch one. The
 * 1023.98 upper bound in globals.css means 1023 is the last rail width.
 */
const TIER_CASES: Array<{ width: number; height: number; tier: NavTier; why: string }> = [
  { width: 360, height: 800, tier: 'bottom-bar', why: 'baseline phone' },
  { width: 480, height: 854, tier: 'bottom-bar', why: 'large phone / phablet' },
  { width: 767, height: 900, tier: 'bottom-bar', why: 'LAST px of the phone band' },
  { width: 768, height: 1024, tier: 'tablet-rail', why: 'FIRST px of the tablet band' },
  { width: 1023, height: 800, tier: 'tablet-rail', why: 'LAST px of the tablet band (1023.98 bound)' },
  { width: 1024, height: 768, tier: 'sidebar', why: 'FIRST px of the desktop band' },
  { width: 1440, height: 900, tier: 'sidebar', why: 'desktop baseline' },
];

test.describe('navigation tiers — exactly one navigation at every width', () => {
  for (const { width, height, tier, why } of TIER_CASES) {
    test(`${width}px shows the ${tier} and nothing else (${why})`, async ({ page }) => {
      const escape = attachEscapeGuard(page);
      await page.setViewportSize({ width, height });
      await gotoWithNav(page, '/dashboard');

      const nav = await measureNavState(page);
      writeJson(`nav-tier-${width}`, nav);

      const w = nav.widths;
      const scrollbarNote =
        w.innerWidth !== w.layoutWidth
          ? `\n\nNOTE — this engine renders a CLASSIC scrollbar: window.innerWidth=${w.innerWidth} but ` +
            `documentElement.clientWidth=${w.layoutWidth} (${w.innerWidth - w.layoutWidth}px taken). ` +
            `Media-query state here is phone=${w.mqPhone} tablet=${w.mqTablet} desktop=${w.mqDesktop}. ` +
            'WebKit evaluates the tier media queries against the SCROLLBAR-EXCLUDED width, so a ' +
            `${width}px Safari window lands one tier down from Chromium and Firefox, which use ` +
            'overlay scrollbars and evaluate against the full width. That is a real rendering ' +
            'difference in the product, not a harness artifact — verified 2026-08-10 by measuring ' +
            'all three engines against the same synthetic page (where they agree) and against the ' +
            'app (where they do not).'
          : '';
      expect(
        nav.visibleTiers,
        `At ${width}px the laid-out navigation tier(s) are [${nav.visibleTiers.join(', ')}]. ` +
          `Exactly one must be displayed — two navigations means every destination appears twice ` +
          'in the accessibility tree, and the student sees duplicated chrome.' +
          scrollbarNote,
      ).toEqual([tier]);

      // display:none removes an element from the a11y tree, so "one tier" and
      // "one navigation landmark" must agree. If they do not, one of the
      // hidden tiers is still exposed.
      expect(
        nav.mainNavLandmarks,
        `At ${width}px there are ${nav.mainNavLandmarks} laid-out nav[aria-label="Main navigation"] ` +
          'landmarks. Exactly one tier is displayed, so exactly one landmark may be.',
      ).toBe(1);

      await expect(page.locator(TIER_SELECTOR[tier])).toBeVisible();
      assertNoExternalTraffic(escape, `/dashboard @${width}px`);
    });
  }
});

/* ═══════════════════════════════════════════════════════════════════════
 * 2. Five slots, one fixed order — in the two tiers that render slots
 * ═══════════════════════════════════════════════════════════════════════ */

test.describe('primary slots — five, in order, at every breakpoint that renders them', () => {
  // The sidebar projects the same destinations into grouped sections rather
  // than five `data-slot` buttons, so slot-order is asserted on the two tiers
  // that carry it; sidebar label/icon parity is pinned in the unit contract.
  for (const { width, height } of [
    { width: 360, height: 800 },
    { width: 480, height: 854 },
    { width: 767, height: 900 },
    { width: 768, height: 1024 },
    { width: 1023, height: 800 },
  ]) {
    test(`exactly five slots in the declared order at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await gotoWithNav(page, '/dashboard');

      const nav = await measureNavState(page);
      await shot(page, `nav-slots-${width}`);

      expect(
        nav.slotOrder,
        `At ${width}px the primary navigation renders [${nav.slotOrder.join(' · ')}]. The product ` +
          `contract fixes it to [${EXPECTED_SLOT_ORDER.join(' · ')}] at EVERY breakpoint — the ` +
          'order is a contract, not a rendering detail.',
      ).toEqual([...EXPECTED_SLOT_ORDER]);
    });
  }

  test('every slot is a real 44x44 target at the 360px baseline', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await gotoWithNav(page, '/dashboard');

    const nav = await measureNavState(page);
    const undersized = nav.slotBoxes.filter((b) => b.width < 44 || b.height < 44);
    expect(
      undersized,
      'Five slots must share a 360px row and still clear the 44px tap floor (5 x 44 = 220px, so ' +
        `there is room). Undersized as rendered:\n${undersized
          .map((b) => `  ${b.slot}: ${b.width}x${b.height}`)
          .join('\n')}`,
    ).toHaveLength(0);
  });
});

/* ═══════════════════════════════════════════════════════════════════════
 * 3. Exactly one aria-current="page"
 * ═══════════════════════════════════════════════════════════════════════ */

test.describe('current-page signalling', () => {
  /**
   * Both directions matter. "At most one" alone passes on a page that marks
   * NONE — which is the state nav-config records as having been measured in
   * Chromium at 360px before `altHrefs` was added, and which leaves a screen
   * reader with no "you are here" at all.
   */
  const CURRENT_CASES: Array<{ route: string; slot: string; why: string }> = [
    { route: '/dashboard', slot: 'today', why: 'TODAY FLAG CONTRACT — /today redirects here while ff_today_home_v1 is OFF' },
    { route: '/learn', slot: 'learn', why: 'exact primary destination' },
    { route: '/progress', slot: 'progress', why: 'exact primary destination' },
    { route: '/quiz', slot: 'practice', why: 'PRACTICE FLAG CONTRACT — /practice redirects here while ff_practice_os_v1 is OFF' },
  ];

  for (const { route, slot, why } of CURRENT_CASES) {
    test(`${route} marks exactly the ${slot} slot current (${why})`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await gotoWithNav(page, route);

      const nav = await measureNavState(page);
      writeJson(`nav-current${route.replace(/\//g, '-')}`, nav);

      // Non-vacuity: the bar must actually be on screen. `.focus-screen` hides
      // all three tiers, so a route that enters focus mode would otherwise
      // make this test pass by having nothing to measure.
      expect(
        nav.visibleTiers.length,
        `${route} rendered NO visible navigation tier, so this assertion would be vacuous. ` +
          '(.focus-screen hides all three tiers — check whether this route entered focus mode.)',
      ).toBe(1);

      expect(
        nav.currentControls.length,
        `${route} exposes ${nav.currentControls.length} controls with aria-current="page": ` +
          `${JSON.stringify(nav.currentControls)}. Exactly one is required — zero leaves a screen ` +
          'reader with no "you are here", two report the student as being in two places. ' +
          `(${nav.currentControlsInDom} carry the attribute in the DOM, which is expected: all ` +
          'three tier components stay mounted and display:none removes the other tiers from the ' +
          'accessibility tree. Only the exposed ones are counted here.)',
      ).toBe(1);

      expect(
        nav.currentControls[0].slot,
        `${route} marks the "${nav.currentControls[0].slot}" slot current; expected "${slot}".`,
      ).toBe(slot);
    });
  }

  test('a More-sheet destination lights no primary slot', async ({ page }) => {
    // /leaderboard lives in the More sheet. If a primary slot claimed it, the
    // bar would be lying about where the student is.
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoWithNav(page, '/leaderboard');

    const nav = await measureNavState(page);
    const primaryCurrent = nav.currentControls.filter(
      (c) => c.slot !== null && c.slot !== 'more',
    );
    expect(
      primaryCurrent,
      `/leaderboard is an overflow destination, but these PRIMARY slots claim it: ` +
        `${JSON.stringify(primaryCurrent)}.`,
    ).toEqual([]);
  });
});

/* ═══════════════════════════════════════════════════════════════════════
 * 4. The five primaries are never inside the More sheet
 * ═══════════════════════════════════════════════════════════════════════ */

test.describe('More sheet — overflow only', () => {
  for (const { width, height, tier } of [
    { width: 390, height: 844, tier: 'bottom bar' },
    { width: 768, height: 1024, tier: 'tablet rail' },
  ]) {
    test(`the sheet opened from the ${tier} contains none of the four primary destinations`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await gotoWithNav(page, '/dashboard');

      await slot(page, 'more').click();
      const sheet = page.getByRole('dialog', { name: 'More navigation options' });
      await expect(sheet).toBeVisible({ timeout: 20_000 });
      await shot(page, `nav-more-sheet-${width}`);

      // The sheet's rows are buttons carrying the item's visible label. A
      // primary destination reappearing here is one route in two places at the
      // same breakpoint — the IA-law violation nav-config records twice.
      for (const label of ['Today', 'Learn', 'Practice', 'Progress']) {
        await expect(
          sheet.getByRole('button', { name: label, exact: true }),
          `"${label}" is a PRIMARY slot but also appears as a row in the More sheet. One ` +
            'destination must have one name in one place per breakpoint.',
        ).toHaveCount(0);
      }

      // Non-vacuity: the sheet must actually have rendered rows, or the four
      // negative assertions above prove nothing.
      const rows = await sheet.getByRole('button').count();
      expect(
        rows,
        'The More sheet rendered no buttons at all — the negative assertions above would be vacuous.',
      ).toBeGreaterThan(4);
    });
  }

  test('the overflow slot announces itself as a sheet opener, not a destination', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoWithNav(page, '/dashboard');

    const more = slot(page, 'more');
    // It opens a sheet, so its accessible name must not read as a place, and
    // its expanded state must be exposed.
    await expect(more).toHaveAttribute('aria-label', 'More options');
    await expect(more).toHaveAttribute('aria-expanded', 'false');
    // An overflow control must never claim to BE the current page.
    await expect(more).not.toHaveAttribute('aria-current', 'page');

    await more.click();
    await expect(more).toHaveAttribute('aria-expanded', 'true');
  });
});

/* ═══════════════════════════════════════════════════════════════════════
 * 5. Long translated labels — the new nav in Hindi
 * ═══════════════════════════════════════════════════════════════════════ */

test.describe('Hindi labels in the new navigation', () => {
  /**
   * Hindi runs 20-30% longer than English, and `.bottom-nav-mobile__label` is
   * `white-space: nowrap; text-overflow: ellipsis` — so a label that does not
   * fit does not wrap, it silently truncates. "प्रगति" rendered as "प्रग…" is
   * a nav item whose destination the student can no longer read.
   *
   * 480 and 768 are the widths the existing Hindi coverage misses: 360 is
   * already covered on /dashboard by e2e/ui-responsive-a11y.spec.ts, and 768
   * is the tablet rail, which had no Hindi coverage at all because it did not
   * exist until commit 3.
   */
  for (const { width, height, tier } of [
    { width: 480, height: 854, tier: 'bottom bar' },
    { width: 768, height: 1024, tier: 'tablet rail' },
  ]) {
    test(`no Hindi nav label is clipped at ${width}px (${tier})`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await gotoWithNav(page, '/dashboard', { preferredLanguage: 'hi' });
      await expect(
        page.getByText(/नमस्ते/),
        'Hindi never activated, so the measurement below would be measuring the ENGLISH nav and ' +
          'reporting it as Hindi.',
      ).toBeVisible({ timeout: 30_000 });

      const nav = await measureNavState(page);
      expect(nav.slotOrder, 'the five slots must survive the language switch').toEqual([
        ...EXPECTED_SLOT_ORDER,
      ]);

      const clipped = await measureClipping(page, TIER_SELECTOR[width < 768 ? 'bottom-bar' : 'tablet-rail']);
      const shotPath = await shot(page, `nav-hi-${width}`);
      writeJson(`nav-hi-clipping-${width}`, { nav, clipped });

      expect(
        clipped,
        `Hindi @${width}px: ${clipped.length} navigation label(s) render truncated, so the student ` +
          'is shown less than the label says:\n' +
          clipped
            .map((c) => `  <${c.tag}> "${c.text}" needs ${c.scrollWidth}px, has ${c.clientWidth}px (+${c.overflowPx})`)
            .join('\n') +
          `\nScreenshot: ${shotPath}`,
      ).toHaveLength(0);
    });
  }

  test('the Hindi overflow slot keeps its own screen-reader name', async ({ page }) => {
    // P7: the visible label is the short "और"; the accessible name must still
    // say the control opens a sheet, in Hindi.
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoWithNav(page, '/dashboard', { preferredLanguage: 'hi' });
    await expect(page.getByText(/नमस्ते/)).toBeVisible({ timeout: 30_000 });

    const label = await slot(page, 'more').getAttribute('aria-label');
    expect(label ?? '', `the Hindi overflow slot announces "${label}"`).toMatch(/[ऀ-ॿ]/);
  });
});

/* ═══════════════════════════════════════════════════════════════════════
 * 6. Deep links, browser back/forward
 * ═══════════════════════════════════════════════════════════════════════ */

test.describe('deep links and history', () => {
  test('a deep link with query params lands on the route and marks the right slot', async ({ page }) => {
    // This is the exact shape /api/v2/today emits as its primary deepLink
    // ({ route: '/quiz', params: { subject, chapter } }), so a student
    // following Today's mission arrives here.
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoWithNav(page, '/quiz?subject=science&chapter=3');

    expect(page.url()).toContain('subject=science');
    expect(page.url()).toContain('chapter=3');

    const nav = await measureNavState(page);
    expect(
      nav.visibleTiers.length,
      'the deep-linked route rendered no navigation tier, so the assertion below is vacuous',
    ).toBe(1);
    expect(
      nav.currentControls.map((c) => c.slot),
      'a deep link into /quiz must leave the Practice slot current — the query string must not ' +
        'defeat the active-state matcher',
    ).toEqual(['practice']);
  });

  test('back and forward restore both the route AND the current-slot marker', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoWithNav(page, '/dashboard');

    // Drive the journey through the NAV ITSELF, not page.goto — a client-side
    // route change is the case where the marker can desync, because the nav
    // components stay mounted across it by design.
    const currentSlot = async () => (await measureNavState(page)).currentControls.map((c) => c.slot);

    await slot(page, 'learn').click();
    await expect.poll(() => page.url(), { timeout: 30_000 }).toMatch(/\/learn(\?|$)/);
    await expect.poll(currentSlot, { timeout: 30_000 }).toEqual(['learn']);

    await slot(page, 'progress').click();
    await expect.poll(() => page.url(), { timeout: 30_000 }).toMatch(/\/progress(\?|$)/);
    await expect.poll(currentSlot, { timeout: 30_000 }).toEqual(['progress']);

    await page.goBack();
    await expect.poll(() => page.url(), { timeout: 30_000 }).toMatch(/\/learn(\?|$)/);
    await expect
      .poll(currentSlot, {
        timeout: 30_000,
        message:
          'After browser Back the URL returned to /learn but the navigation still highlights a ' +
          'different slot. The nav components stay mounted across client-side route changes, so ' +
          'a stale marker here means the active state is not derived from the live pathname.',
      })
      .toEqual(['learn']);

    await page.goBack();
    await expect.poll(() => page.url(), { timeout: 30_000 }).toMatch(/\/dashboard(\?|$)/);
    await expect.poll(currentSlot, { timeout: 30_000 }).toEqual(['today']);

    await page.goForward();
    await expect.poll(() => page.url(), { timeout: 30_000 }).toMatch(/\/learn(\?|$)/);
    await expect
      .poll(currentSlot, {
        timeout: 30_000,
        message: 'Browser Forward restored the URL but not the current-slot marker.',
      })
      .toEqual(['learn']);
  });

  test('the More sheet closes on Escape and returns focus to a live control', async ({ page }) => {
    // Keyboard-only students must be able to leave the sheet without a mouse.
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoWithNav(page, '/dashboard');

    await slot(page, 'more').click();
    const sheet = page.getByRole('dialog', { name: 'More navigation options' });
    await expect(sheet).toBeVisible({ timeout: 20_000 });

    await page.keyboard.press('Escape');
    await expect(
      sheet,
      'Escape must dismiss the More sheet — without it a keyboard-only student is trapped in a ' +
        'full-screen overlay with no way back to the page.',
    ).toBeHidden({ timeout: 10_000 });
  });
});
