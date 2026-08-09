import { test, expect, type Page } from '@playwright/test';
import { mockStudentSession } from './helpers/auth';
import {
  installBackendContainment,
  assertTreeAlive,
  measureOverflow,
  measureClipping,
  measureTouchTargets,
  shot,
  writeJson,
} from './helpers/ui-audit';
import {
  attachEscapeGuard,
  countLaidOutTiers,
  assertNoExternalTraffic,
  measureMotion,
  measureNavState,
  measureSafeArea,
  setPageZoom,
  setTextZoom,
  EXPECTED_SLOT_ORDER,
  TIER_SELECTOR,
} from './helpers/viewport-audit';

/**
 * ZOOM, REFLOW, REDUCED MOTION, LANDSCAPE AND SAFE-AREA — the WCAG 2.2 AA
 * conditions the existing browser audit does not touch.
 *
 * `e2e/ui-responsive-a11y.spec.ts` sweeps nine viewports at 100% zoom, in
 * portrait, with default motion, on a display with no cutout. Every condition
 * below is one it structurally cannot see:
 *
 *   SC 1.4.4  Resize text (AA)      — text to 200% without loss of content
 *   SC 1.4.10 Reflow (AA)           — 320 CSS px wide, no 2-D scrolling
 *   SC 2.3.3  Animation from
 *             interactions (AAA)    — and the AA-adjacent expectation that
 *                                     prefers-reduced-motion is honoured
 *   SC 1.3.4  Orientation (AA)      — landscape must not be a degraded view
 *   Safe area                       — not a success criterion, but the bottom
 *                                     nav's reachability on notched phones
 *                                     depends entirely on it
 *
 * ── Why zoom is emulated by resizing the viewport ────────────────────────
 * Playwright exposes no zoom API. Page zoom at factor N presents the page
 * with a CSS viewport of (physical / N) — that IS what zoom does to layout,
 * and expressing it as a viewport size is the only formulation that behaves
 * identically in all three engines. The Chromium-only CDP
 * `Emulation.setPageScaleFactor` is pinch-zoom: it scales the rendered output
 * without reflowing, so it would assert nothing about reflow. Text-only zoom
 * (the harsher case for px-sized boxes) is a separate axis and is driven
 * through the root font-size instead.
 *
 * ── Safety ───────────────────────────────────────────────────────────────
 * Full page.route() containment plus `attachEscapeGuard`, which fails the
 * test if any browser request actually reached a remote server.
 *
 * Run: npx playwright test e2e/ui-zoom-motion-safearea.spec.ts --project=chromium
 */

test.beforeEach(async ({}, testInfo) => {
  testInfo.setTimeout(300_000);
});

/* ── Fixtures (same real envelopes as the other browser specs) ─────────── */

const SUBJECTS = [
  { code: 'science', name: 'Science', nameHi: 'विज्ञान', icon: '🔬', color: '#22C55E', subjectKind: 'cbse_core', isCore: true, isLocked: false },
  { code: 'maths', name: 'Mathematics', nameHi: 'गणित', icon: '📐', color: '#3B82F6', subjectKind: 'cbse_core', isCore: true, isLocked: false },
];

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
    {
      type: 'srs_due', rank: 2,
      labelKey: 'today.item.srs_due.label',
      subtitleKey: 'today.item.srs_due.subtitle',
      estMinutes: 5,
      deepLink: { route: '/review' }, iconHint: 'repeat', reason: 'cards_due',
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

const MIN_TOUCH_TARGET_PX = 44;

async function gotoStudent(page: Page, route: string): Promise<void> {
  await installBackendContainment(page, BACKEND);
  await mockStudentSession(page, STUDENT_OPTS);
  await page.goto(route);
  await page.waitForLoadState('domcontentloaded');
  await expect
    .poll(() => page.url(), {
      timeout: 30_000,
      message: `Expected to stay on ${route} with the mocked student session but the page navigated away.`,
    })
    .not.toMatch(/\/(login|welcome|onboarding)(\?|$)/);
  await assertTreeAlive(page, route);
  // Readiness is "exactly one navigation tier is LAID OUT", not "a nav element
  // is attached": attachment happens before the tier-switch media queries
  // apply under `next dev`, and measuring in that window reports an empty
  // tier list as a product failure. The 180s budget absorbs the dev server's
  // client-bundle compile (warming a route over HTTP only warms the SERVER
  // render); the per-test timeout still bounds a genuine hang. Full rationale
  // in e2e/ui-nav-contract.spec.ts.
  await expect
    .poll(() => countLaidOutTiers(page), {
      timeout: 180_000,
      message: `No navigation tier was ever laid out on ${route}.`,
    })
    .toBe(1);
}

/** The reflow assertion, shared by every zoom case. */
async function assertNoHorizontalScroll(page: Page, context: string): Promise<void> {
  const overflow = await measureOverflow(page);
  expect(
    overflow.scrollWidth,
    `${context}: the page requires horizontal scrolling (${overflow.scrollWidth}px of content in a ` +
      `${overflow.innerWidth}px viewport). WCAG 2.2 SC 1.4.10 forbids two-dimensional scrolling for ` +
      'content that does not require it. Boxes crossing the right edge:\n' +
      overflow.offenders
        .map((o) => `  <${o.tag}> right=${o.right} w=${o.width} "${o.text}" .${o.cls}`)
        .join('\n'),
  ).toBeLessThanOrEqual(overflow.innerWidth + 1);
}

/* ═══════════════════════════════════════════════════════════════════════
 * 1. Page zoom — SC 1.4.10 Reflow
 * ═══════════════════════════════════════════════════════════════════════ */

test.describe('page zoom and reflow', () => {
  /**
   * The declared desktop widths at 200%, plus the 400%/320px case the
   * criterion is actually written around. WCAG 1.4.10 states the target as
   * "320 CSS pixels wide", which a 1280px window reaches at 400% zoom.
   */
  const ZOOM_CASES = [
    { physical: { width: 1024, height: 768 }, factor: 2, why: 'SC 1.4.4/1.4.10 at the smallest desktop width' },
    { physical: { width: 1280, height: 800 }, factor: 2, why: '200% on the common laptop width' },
    { physical: { width: 1440, height: 900 }, factor: 2, why: '200% on the declared 1440 breakpoint' },
    { physical: { width: 1280, height: 1024 }, factor: 4, why: 'SC 1.4.10 Reflow: 400% == 320 CSS px' },
  ];

  for (const { physical, factor, why } of ZOOM_CASES) {
    test(`${physical.width}x${physical.height} at ${factor * 100}% zoom reflows without horizontal scrolling (${why})`, async ({
      page,
    }) => {
      const escape = attachEscapeGuard(page);
      const css = await setPageZoom(page, physical, factor);
      await gotoStudent(page, '/dashboard');

      const shotPath = await shot(page, `zoom-${physical.width}-${factor}x`);
      await assertNoHorizontalScroll(
        page,
        `${physical.width}px @${factor * 100}% (= ${css.width}x${css.height} CSS px). Screenshot: ${shotPath}`,
      );
      assertNoExternalTraffic(escape, `/dashboard @${factor * 100}% zoom`);
    });
  }

  test('the navigation survives 200% zoom with all five slots still tappable', async ({ page }) => {
    // Zoom shrinks the CSS viewport, so a 1440px desktop at 200% becomes a
    // 720px viewport — which crosses INTO the tablet-rail band. The nav must
    // switch tier cleanly rather than render a stretched or clipped desktop
    // sidebar.
    await setPageZoom(page, { width: 1440, height: 900 }, 2);
    await gotoStudent(page, '/dashboard');

    const nav = await measureNavState(page);
    writeJson('zoom-nav-1440-2x', nav);
    expect(
      nav.visibleTiers.length,
      `At 720x450 CSS px (1440 @200%) the laid-out tiers are [${nav.visibleTiers.join(', ')}] — ` +
        'exactly one must be displayed at every effective width, zoomed or not.',
    ).toBe(1);
    expect(nav.slotOrder).toEqual([...EXPECTED_SLOT_ORDER]);

    const undersized = nav.slotBoxes.filter(
      (b) => b.width < MIN_TOUCH_TARGET_PX || b.height < MIN_TOUCH_TARGET_PX,
    );
    expect(
      undersized,
      'Zoom must not shrink navigation slots below the 44px tap floor:\n' +
        undersized.map((b) => `  ${b.slot}: ${b.width}x${b.height}`).join('\n'),
    ).toHaveLength(0);
  });

  test('at 320 CSS px the page still exposes its primary navigation', async ({ page }) => {
    // The reflow criterion is not only "no sideways scrollbar" — content and
    // FUNCTIONALITY must survive. A nav that reflows itself off-screen passes
    // an overflow check and fails the criterion.
    await page.setViewportSize({ width: 320, height: 256 });
    await gotoStudent(page, '/dashboard');

    const nav = await measureNavState(page);
    await shot(page, 'reflow-320');
    expect(
      nav.slotOrder,
      'At the WCAG reflow target width the five primary destinations must all still be present.',
    ).toEqual([...EXPECTED_SLOT_ORDER]);
    expect(
      nav.visibleTiers,
      'At 320 CSS px the phone-tier bottom bar is the correct navigation.',
    ).toEqual(['bottom-bar']);
  });
});

/* ═══════════════════════════════════════════════════════════════════════
 * 2. Text-only zoom — SC 1.4.4 Resize text
 * ═══════════════════════════════════════════════════════════════════════ */

test.describe('text resize to 200%', () => {
  /**
   * Harsher than page zoom: the viewport does not shrink, so every box sized
   * in `px` keeps its size while the type inside it doubles. Anything with
   * `overflow: hidden` or `text-overflow: ellipsis` starts eating its own
   * content — and the navigation labels are declared exactly that way
   * (`.bottom-nav-mobile__label { white-space: nowrap; text-overflow: ellipsis }`).
   */
  for (const { width, height } of [
    { width: 360, height: 800 },
    { width: 768, height: 1024 },
    { width: 1440, height: 900 },
  ]) {
    test(`200% text at ${width}px loses no content to clipping or overflow`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await gotoStudent(page, '/dashboard');
      await setTextZoom(page, 200);

      const shotPath = await shot(page, `text-zoom-200-${width}`);
      const clipped = await measureClipping(page);
      writeJson(`text-zoom-200-clipping-${width}`, clipped);

      await assertNoHorizontalScroll(page, `200% text @${width}px. Screenshot: ${shotPath}`);

      expect(
        clipped,
        `SC 1.4.4: at 200% text size, ${clipped.length} text node(s) render truncated at ${width}px — ` +
          'the student is shown less than the string says:\n' +
          clipped
            .map((c) => `  <${c.tag}> "${c.text}" needs ${c.scrollWidth}px, has ${c.clientWidth}px (+${c.overflowPx})`)
            .join('\n') +
          `\nScreenshot: ${shotPath}`,
      ).toHaveLength(0);
    });
  }
});

/* ═══════════════════════════════════════════════════════════════════════
 * 3. prefers-reduced-motion
 * ═══════════════════════════════════════════════════════════════════════ */

test.describe('prefers-reduced-motion: reduce', () => {
  // Playwright 1.62 exposes `reducedMotion` only through `contextOptions`, not
  // as a top-level test option (`test.use({ reducedMotion })` type-errors).
  // Top-level options like `viewport` still take priority over this object, so
  // the project's device profile is unaffected. The `matchesReduce` assertion
  // in each test is the machine check that the preference actually took — a
  // silently-ignored option would fail there rather than pass vacuously.
  test.use({ contextOptions: { reducedMotion: 'reduce' } });

  test('the duration tokens themselves collapse, not just the blanket rule', async ({ page }) => {
    // globals.css deliberately redeclares --duration-* inside the reduce block
    // "so any JS reading getComputedStyle sees the reduced value rather than
    // the animated one". Nothing asserted that until now, and the blanket
    // `transition-duration: 0.01ms !important` rule would mask its absence
    // from every visual check while leaving JS-driven animation at full speed.
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoStudent(page, '/dashboard');

    const motion = await measureMotion(page);
    writeJson('reduced-motion-dashboard', motion);

    expect(
      motion.matchesReduce,
      'The page does not report prefers-reduced-motion: reduce, so everything below would be ' +
        'measuring the DEFAULT motion state and reporting it as reduced.',
    ).toBe(true);

    for (const [token, value] of Object.entries(motion.tokens)) {
      expect(
        value,
        `${token} computes to "${value}" under prefers-reduced-motion: reduce. globals.css ` +
          'redeclares the whole duration scale to 0.01ms inside the reduce block precisely so a ' +
          'component reading the token via getComputedStyle gets the reduced value.',
      ).toBe('0.01ms');
    }
  });

  test('no element keeps a perceptible transition or animation', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoStudent(page, '/dashboard');
    // Let async widgets mount — a component that sets its transition in JS
    // after hydration is exactly what the stylesheet rule cannot reach.
    await page.waitForTimeout(3000);

    const motion = await measureMotion(page);
    expect(motion.matchesReduce, 'reduce must be active for this measurement to mean anything').toBe(true);

    expect(
      motion.animated,
      `${motion.animated.length} element(s) still carry a perceptible transition-duration under ` +
        'prefers-reduced-motion: reduce (vestibular-disorder accessibility):\n' +
        motion.animated.map((a) => `  <${a.tag}> .${a.cls} ${a.prop} = ${a.duration}`).join('\n'),
    ).toHaveLength(0);

    expect(
      motion.running,
      `${motion.running.length} element(s) still run a perceptible CSS animation under ` +
        'prefers-reduced-motion: reduce:\n' +
        motion.running.map((a) => `  <${a.tag}> .${a.cls} ${a.name} = ${a.duration}`).join('\n'),
    ).toHaveLength(0);
  });

  test('the bottom nav does not hide itself on scroll', async ({ page }) => {
    // MobileBottomNav's scroll-hide is JS motion, so no stylesheet rule can
    // suppress it — the component checks the media query itself and returns
    // early. That branch had no test.
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoStudent(page, '/dashboard');

    const scrollable = await page.evaluate(
      () => document.documentElement.scrollHeight - window.innerHeight,
    );
    expect(
      scrollable,
      'The dashboard is not scrollable at 390x844, so a scroll-driven assertion is vacuous.',
    ).toBeGreaterThan(200);

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    // The hide transition is 260ms; wait well past it so a pass is not just
    // an unfinished animation.
    await page.waitForTimeout(1500);

    await expect(
      page.locator(TIER_SELECTOR['bottom-bar']),
      'Under prefers-reduced-motion: reduce the bottom nav must not slide away on scroll — the ' +
        'component is supposed to skip installing its scroll listener entirely.',
    ).toHaveAttribute('data-scroll-hidden', 'false');
  });
});

test.describe('prefers-reduced-motion: no-preference (the control direction)', () => {
  test.use({ contextOptions: { reducedMotion: 'no-preference' } });

  /**
   * Without this, every assertion in the block above would also pass against
   * a page that has NO motion at all — a stylesheet whose --duration tokens
   * were simply deleted. The control proves the reduced state is a real
   * response to the media query rather than the app's only state.
   */
  test('the duration tokens carry their full animated values', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoStudent(page, '/dashboard');

    const motion = await measureMotion(page);
    writeJson('default-motion-dashboard', motion);

    expect(motion.matchesReduce, 'this control must run WITHOUT the reduce preference').toBe(false);
    expect(
      motion.tokens['--duration-base'],
      'With no motion preference the duration scale must carry its designed values — otherwise ' +
        'the reduced-motion tests above are asserting a no-op.',
    ).toBe('200ms');
    expect(motion.tokens['--duration-fast']).toBe('140ms');
    expect(motion.tokens['--duration-slower']).toBe('480ms');
  });
});

/* ═══════════════════════════════════════════════════════════════════════
 * 4. Landscape — SC 1.3.4 Orientation
 * ═══════════════════════════════════════════════════════════════════════ */

test.describe('landscape orientation on phones', () => {
  /**
   * Landscape is where the tier switch does real work: a 844x390 phone on its
   * side is 844 CSS px WIDE, so it lands in the tablet band and gets the
   * vertical rail. That is the case TabletNavRail was written for ("every
   * landscape phone ... fell into the phone tier and got a bottom bar
   * stretched across a 900px viewport") and it had no test.
   */
  const LANDSCAPE = [
    { width: 667, height: 375, name: 'iPhone SE landscape', tier: 'bottom-bar' as const },
    { width: 800, height: 360, name: '360x800 phone landscape', tier: 'tablet-rail' as const },
    { width: 844, height: 390, name: 'iPhone 14 landscape', tier: 'tablet-rail' as const },
    { width: 915, height: 412, name: 'Pixel-class landscape', tier: 'tablet-rail' as const },
  ];

  for (const { width, height, name, tier } of LANDSCAPE) {
    test(`${name} (${width}x${height}) renders the ${tier} and reaches every slot`, async ({ page }) => {
      const escape = attachEscapeGuard(page);
      await page.setViewportSize({ width, height });
      await gotoStudent(page, '/dashboard');

      const nav = await measureNavState(page);
      const shotPath = await shot(page, `landscape-${width}x${height}`);
      writeJson(`landscape-nav-${width}x${height}`, nav);

      expect(
        nav.visibleTiers,
        `${name}: laid-out tiers are [${nav.visibleTiers.join(', ')}]; expected exactly [${tier}]. ` +
          `Screenshot: ${shotPath}`,
      ).toEqual([tier]);
      expect(nav.slotOrder).toEqual([...EXPECTED_SLOT_ORDER]);

      await assertNoHorizontalScroll(page, `${name}. Screenshot: ${shotPath}`);

      // A short viewport is where a full-height rail can push its last slot
      // out of reach. Reachability, not mere presence, is the contract.
      for (const slot of EXPECTED_SLOT_ORDER) {
        // `:visible` — all three tier components stay mounted, so a bare
        // [data-slot] match can resolve to a display:none tier and hang.
        const el = page.locator(`[data-slot="${slot}"]:visible`).first();
        await el.scrollIntoViewIfNeeded();
        const box = await el.boundingBox();
        expect(box, `${name}: the "${slot}" slot has no rendered box`).not.toBeNull();
        expect(
          box!.y + box!.height,
          `${name}: the "${slot}" slot ends at y=${Math.round(box!.y + box!.height)} in a ${height}px-tall ` +
            'viewport even after scrolling it into view — it is unreachable in landscape.',
        ).toBeLessThanOrEqual(height + 1);
        expect(box!.height, `${name}: "${slot}" slot height`).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET_PX);
      }

      assertNoExternalTraffic(escape, `${name}`);
    });
  }

  test('landscape does not shrink any interactive control below the tap floor', async ({ page }) => {
    await page.setViewportSize({ width: 844, height: 390 });
    await gotoStudent(page, '/dashboard');

    const targets = await measureTouchTargets(page);
    writeJson('touch-targets-landscape-844x390', targets);
    const gated = targets.filter((t) => !t.inlineInText);
    const undersized = gated.filter(
      (t) => t.width < MIN_TOUCH_TARGET_PX || t.height < MIN_TOUCH_TARGET_PX,
    );
    expect(
      gated.length,
      'no interactive controls were measured in landscape — this pass would be vacuous',
    ).toBeGreaterThan(0);
    expect(
      undersized,
      `Landscape 844x390: ${undersized.length} of ${gated.length} controls are under ` +
        `${MIN_TOUCH_TARGET_PX}x${MIN_TOUCH_TARGET_PX} as rendered:\n` +
        undersized
          .map((t) => `  ${t.width}x${t.height} <${t.tag}> "${t.name}" .${t.cls}`)
          .join('\n'),
    ).toHaveLength(0);
  });
});

/* ═══════════════════════════════════════════════════════════════════════
 * 5. Safe area — the display cutout
 * ═══════════════════════════════════════════════════════════════════════ */

test.describe('safe-area insets', () => {
  /**
   * ── What can and cannot be verified here ─────────────────────────────
   * A headless desktop browser has no display cutout, so
   * `env(safe-area-inset-bottom)` resolves to 0 and NO test in this
   * environment can observe the padding a notched iPhone would get. Asserting
   * "padding-bottom is 34px" is therefore impossible, and asserting
   * "padding-bottom is 0px" would pass on a build that had deleted the
   * declaration entirely.
   *
   * What IS decidable, and what actually breaks in production, is whether the
   * app has WIRED UP the cutout at all:
   *
   *   - `env(safe-area-inset-*)` resolves to 0 on EVERY browser unless the
   *     page opts in with `viewport-fit=cover` in its viewport meta. Without
   *     that opt-in the padding is in the stylesheet, computes to 0, looks
   *     right in every desktop screenshot, and does nothing on the exact
   *     devices it exists for.
   *   - the declaration must still be present on the nav element.
   *
   * So this suite asserts the two decidable halves and is explicit that the
   * rendered inset on a real notched device remains unverified here.
   */
  test('the page opts into the display cutout with viewport-fit=cover', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoStudent(page, '/dashboard');

    const safe = await measureSafeArea(page, TIER_SELECTOR['bottom-bar']);
    writeJson('safe-area-dashboard-390', safe);

    expect(
      safe.viewportFitCover,
      'The viewport meta is `' + (safe.viewportMeta ?? '(absent)') + '`. Without ' +
        '`viewport-fit=cover` every env(safe-area-inset-*) in this codebase resolves to 0 on ' +
        'iOS Safari, so the bottom nav\'s safe-area padding — and the .pb-nav content clearance, ' +
        'the AlfaBot launcher offset and the Foxy composer inset — are inert on precisely the ' +
        'notched phones they were written for. The nav then sits under the home indicator. ' +
        'This is a product defect, not a test-environment limitation: the meta is emitted by ' +
        'apps/host/src/app/layout.tsx\'s `viewport` export, which sets width/initialScale/' +
        'themeColor and no viewportFit.',
    ).toBe(true);
  });

  test('the bottom nav still declares its safe-area padding', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoStudent(page, '/dashboard');

    const safe = await measureSafeArea(page, TIER_SELECTOR['bottom-bar']);
    expect(
      safe.navDeclaredPaddingBottom ?? '',
      `The bottom nav's inline padding-bottom is "${safe.navDeclaredPaddingBottom}". It must be ` +
        'expressed through env(safe-area-inset-bottom) — a fixed px value would either float the ' +
        'bar above the content on a flat phone or bury it under the home indicator on a notched one.',
    ).toContain('env(safe-area-inset-bottom');
    expect(
      safe.envSupported,
      'This browser did not resolve env(safe-area-inset-bottom, 7px) to its fallback, so the ' +
        'measurement above cannot be trusted.',
    ).toBe(true);
  });

  test('the content-clearance helper reserves the full nav height plus the inset', async ({ page }) => {
    // `.pb-nav` is `calc(4rem + env(safe-area-inset-bottom, 0px))`. On a
    // cutout-free display that is exactly 64px; anything less means content
    // ends underneath the fixed bar.
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoStudent(page, '/dashboard');

    const safe = await measureSafeArea(page, TIER_SELECTOR['bottom-bar']);
    if (safe.pbNavComputed === null) {
      // Not every student surface uses the helper; report rather than assert
      // a value that does not exist on this page.
      test.info().annotations.push({
        type: 'note',
        description: '.pb-nav is not present on /dashboard — clearance is handled by the shell instead.',
      });
      return;
    }
    expect(
      parseFloat(safe.pbNavComputed),
      `.pb-nav reserves ${safe.pbNavComputed}; the fixed bottom bar is 4rem tall, so anything under ` +
        '64px leaves the last content element underneath it.',
    ).toBeGreaterThanOrEqual(64);
  });
});
