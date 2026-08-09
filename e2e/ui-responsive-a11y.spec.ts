import { test, expect, type Page } from '@playwright/test';
import { mockStudentSession } from './helpers/auth';
import {
  installBackendContainment,
  mockTeacherSession,
  measureOverflow,
  measureClipping,
  measureTouchTargets,
  overrideStudentRow,
  overlapArea,
  resolveAxeBundle,
  runAxe,
  summariseAxe,
  armWebVitals,
  collectWebVitals,
  attachDiagnostics,
  assertTreeAlive,
  shot,
  writeJson,
  type TouchTarget,
} from './helpers/ui-audit';

/**
 * BROWSER-OBSERVED UI AUDIT — responsive layout, touch targets, bilingual
 * rendering, accessibility and layout stability, measured in a real engine.
 *
 * ── Why this file exists ─────────────────────────────────────────────────
 * The frontend UI/UX program's responsive / a11y / performance requirements
 * had, up to 2026-08-09, NEVER been observed in a browser. Every claim was
 * either source-reasoned or asserted in JSDOM, and JSDOM loads no stylesheet:
 * it can prove that a `min-h-tap-min` class string is in the markup, and it
 * can prove nothing at all about the pixels. That distinction is not
 * academic — an earlier pass found a /progress retry control that computed to
 * 42 px with entirely correct-looking source.
 *
 * Two fixes in particular were made blind and are pinned here for the first
 * time (see the "student dashboard header" describe):
 *   (a) the dashboard header was regrouped into two rows so the Hindi
 *       greeting stops truncating;
 *   (b) the one-handed-mode toggle was supposed to stop landing on top of the
 *       language toggle at 360 px.
 * Both are asserted as GEOMETRY (is the greeting's scrollWidth inside its
 * clientWidth? is the intersection area of the two controls zero?), not as
 * class strings, because a class string is what was already believed.
 *
 * ── What is measured ─────────────────────────────────────────────────────
 *   1. Horizontal overflow at the nine declared viewports.
 *   2. Touch targets: boundingBox() >= 44x44 on interactive controls.
 *   3. Hindi at 360 px: no overflow, no clipped strings, no collisions.
 *   4. axe-core (WCAG 2.0/2.1 A + AA) + keyboard focus order and visibility.
 *   5. LCP / CLS / long-task TBT.
 *   6. console.error / pageerror / failed requests.
 *
 * ── Performance numbers are DEV-BUILD numbers ────────────────────────────
 * This spec runs against `next dev`, which serves unminified, unsplit,
 * source-mapped bundles and compiles routes on demand. LCP and TBT here are
 * inflated by an unknown factor and are RECORDED, NOT GATED — quoting them as
 * evidence that the production targets (LCP <= 2.5s, INP <= 200ms) are met
 * would be false. CLS is different: layout stability is a function of
 * reserved space, not bundle size, so a large CLS in dev is a real defect and
 * IS gated. A small CLS in dev remains only weak evidence for production.
 *
 * ── Safety ───────────────────────────────────────────────────────────────
 * No live backend. `installBackendContainment()` answers every
 * browser-originated PostgREST / Edge Function / Next.js API call locally,
 * and the session mocks intercept Supabase auth. Boot the dev server with
 * neutralised credentials (the env block in .github/workflows/ci.yml) — this
 * file cannot see requests the Next.js server makes with its own ambient env.
 *
 * ORDERING: `installBackendContainment()` must be called BEFORE the session
 * mock. Playwright resolves route handlers in REVERSE registration order, so
 * the broad `** /rest/v1/**` handler would otherwise shadow the `students` /
 * `get_user_role` mocks and AuthContext would never resolve.
 *
 * Run: npx playwright test e2e/ui-responsive-a11y.spec.ts --project=chromium
 */

/**
 * Local runs hit `next dev`, which compiles each route on first request. The
 * first navigation to /dashboard in a cold worker measured ~84s end-to-end,
 * which blows the config's 90s default before a single assertion runs — the
 * failure then reads as "locator not found", which is the wrong diagnosis.
 * Raise the per-test budget so a genuine assertion failure is never masked by
 * a compile. Against a built server every one of these finishes in seconds.
 */
test.beforeEach(async ({}, testInfo) => {
  testInfo.setTimeout(240_000);
});

/** The nine viewports the skill declares. */
const VIEWPORTS = [
  { name: '320x568', width: 320, height: 568, band: 'mobile' },
  { name: '360x800', width: 360, height: 800, band: 'mobile' },
  { name: '390x844', width: 390, height: 844, band: 'mobile' },
  { name: '412x915', width: 412, height: 915, band: 'mobile' },
  { name: '768x1024', width: 768, height: 1024, band: 'tablet' },
  { name: '1024x768', width: 1024, height: 768, band: 'tablet' },
  { name: '1280x800', width: 1280, height: 800, band: 'desktop' },
  { name: '1440x900', width: 1440, height: 900, band: 'desktop' },
  { name: '1920x1080', width: 1920, height: 1080, band: 'desktop' },
] as const;

/** Apple HIG minimum, and the repo's `--tap-min` token. */
const MIN_TOUCH_TARGET_PX = 44;

/** Google's "good" CLS threshold. The one CWV a dev build can speak to. */
const MAX_CLS = 0.1;

const AXE_BUNDLE = resolveAxeBundle();

/* ── Fixtures ─────────────────────────────────────────────────────────── */

const SUBJECTS = [
  { code: 'science', name: 'Science', nameHi: 'विज्ञान', icon: '🔬', color: '#22C55E', subjectKind: 'cbse_core', isCore: true, isLocked: false },
  { code: 'maths', name: 'Mathematics', nameHi: 'गणित', icon: '📐', color: '#3B82F6', subjectKind: 'cbse_core', isCore: true, isLocked: false },
];

/**
 * A returning student with real history. The name comes from
 * `helpers/auth.ts` ("Test student", so the greeting reads "Hi, Test") — a
 * deliberately SHORT first name. That matters for how the header findings
 * should be read: the greeting is measured clipped at 320 px and 360 px even
 * with a 4-character name, so a real Indian first name can only be worse.
 */
const STUDENT_OPTS = { xpTotal: 12450, streakDays: 7, anyProjectRef: true as const };

/**
 * A REAL `/api/v2/today` envelope (apps/host/src/app/api/v2/today/route.ts,
 * `TodayResponse`), not a convenient stub.
 *
 * ── Why this fixture is written out in full (2026-08-09) ─────────────────
 * The first run of this file answered `/api/v2/today` with the catch-all
 * `{}`. `{}` is truthy, so `TodaysMission`'s
 * `!!queueData && queueData.queue.length > 0` threw
 * `TypeError: Cannot read properties of undefined (reading 'length')`, the
 * dashboard's route-level error boundary replaced the ENTIRE page with
 * "Dashboard couldn't load", and four viewport tests failed with
 * "`.dashboard-header-row` not found" — a diagnosis that pointed at the
 * header work rather than at the fixture. Same failure class as the
 * TenantConfigProvider incident recorded in e2e/ui-error-states.spec.ts:
 * answering a real endpoint with a shape it cannot emit tests nothing.
 */
const TODAY_RESPONSE = {
  schemaVersion: 1,
  resolvedAt: new Date().toISOString(),
  primary: {
    type: 'weak_topic_zpd',
    rank: 1,
    labelKey: 'today.item.weak_topic_zpd.label',
    subtitleKey: 'today.item.weak_topic_zpd.subtitle',
    estMinutes: 10,
    deepLink: { route: '/quiz', params: { subject: 'science', chapter: 3 } },
    iconHint: 'target',
    reason: 'todays_zpd',
    chapterTitle: 'Force and Laws of Motion',
    chapterTitleHi: 'बल तथा गति के नियम',
  },
  queue: [
    {
      type: 'weak_topic_zpd',
      rank: 1,
      labelKey: 'today.item.weak_topic_zpd.label',
      subtitleKey: 'today.item.weak_topic_zpd.subtitle',
      estMinutes: 10,
      deepLink: { route: '/quiz', params: { subject: 'science', chapter: 3 } },
      iconHint: 'target',
      reason: 'todays_zpd',
      chapterTitle: 'Force and Laws of Motion',
      chapterTitleHi: 'बल तथा गति के नियम',
    },
    {
      type: 'srs_due',
      rank: 2,
      labelKey: 'today.item.srs_due.label',
      subtitleKey: 'today.item.srs_due.subtitle',
      estMinutes: 5,
      deepLink: { route: '/review' },
      iconHint: 'repeat',
      reason: 'cards_due',
    },
  ],
  meta: {
    branch: 'zpd',
    masterySubjectCount: 2,
    dueReviewCount: 5,
    practicedToday: false,
  },
};

/** Answers the dashboard's own reads so the surface renders populated. */
const DASHBOARD_BACKEND = {
  apis: {
    '/api/v2/today': { kind: 'ok' as const, body: TODAY_RESPONSE },
    '/api/student/subjects': { kind: 'ok' as const, body: { subjects: SUBJECTS } },
    '/api/student/chapters': { kind: 'ok' as const, body: { chapters: [] } },
  },
  rpcs: {
    get_mastery_overview: { kind: 'ok' as const, body: [] },
  },
};

/* ── Navigation ───────────────────────────────────────────────────────── */

async function gotoStudent(
  page: Page,
  route: string,
  opts?: { preferredLanguage?: 'en' | 'hi' },
): Promise<void> {
  await installBackendContainment(page, DASHBOARD_BACKEND);
  await mockStudentSession(page, STUDENT_OPTS);
  if (opts?.preferredLanguage) {
    // Registered LAST so it wins over mockStudentSession's `students` handler.
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
  // The ROUTE-level boundary (app/(student)/dashboard/error.tsx). It swallows
  // the whole page — header included — so checking it first turns "locator not
  // found" into a message that names the actual cause. This is exactly how the
  // `/api/v2/today` fixture bug presented on the first run of this file.
  await expect(
    page.getByText("Dashboard couldn't load"),
    `The dashboard's route error boundary rendered on ${route}: a child component threw, so the ` +
      'whole page (including the header under test) was replaced. Check the browser console for ' +
      'the underlying exception — this is not a layout problem.',
  ).toHaveCount(0);
  // The header rail only exists once AuthContext has resolved a student.
  await expect(page.locator('.dashboard-header-row')).toBeVisible({ timeout: 30_000 });
}

async function gotoTeacher(page: Page, route: string): Promise<void> {
  await installBackendContainment(page);
  await mockTeacherSession(page);
  await page.goto(route);
  await page.waitForLoadState('domcontentloaded');
  await expect
    .poll(() => page.url(), {
      timeout: 30_000,
      message: `Expected to stay on ${route} with the mocked teacher session but the page navigated away.`,
    })
    .not.toMatch(/\/(login|welcome|onboarding)(\?|$)/);
  await assertTreeAlive(page, route);
  await expect(page.locator('main, [role="main"]').first()).toBeVisible({ timeout: 30_000 });
}

/**
 * /parent is the parent portal's own entry surface. Unauthenticated it
 * renders the link-code / guardian login screen — that IS the surface a
 * parent meets first, and it is the one parent surface reachable without a
 * live `parent-portal` Edge Function, so it is what this audit can honestly
 * cover. Deeper parent pages (/parent/reports, /parent/billing) sit behind a
 * guardian-mode session plus a DPDP consent gate and are NOT covered here.
 */
async function gotoParent(page: Page, route: string): Promise<void> {
  await installBackendContainment(page);
  await page.goto(route);
  await page.waitForLoadState('domcontentloaded');
  await assertTreeAlive(page, route);
  // ParentShell renders `<div aria-busy="true">` (an empty box, no controls)
  // until it resolves the parent's mode. `body` becoming visible is therefore
  // NOT a readiness signal — the first run of this file measured /parent at
  // 360px in exactly that state and reported "0 undersized of 0", a green
  // result from an empty page. Wait for the login screen's own heading.
  await expect(
    page.getByRole('heading', { name: /Parent Dashboard|अभिभावक डैशबोर्ड|Create a parent account|अभिभावक अकाउंट बनाएँ/ }),
    `/parent never rendered its heading — the portal shell is still resolving, or the surface ` +
      'changed. Measuring now would measure an empty page.',
  ).toBeVisible({ timeout: 30_000 });
}

/* ── Shared assertions ────────────────────────────────────────────────── */

function formatTargets(targets: TouchTarget[]): string {
  return targets
    .map((t) => `  ${t.width}x${t.height} <${t.tag}${t.role ? ` role=${t.role}` : ''}> "${t.name}" @(${t.x},${t.y}) .${t.cls}`)
    .join('\n');
}

/**
 * The 44 px assertion, applied to every control that is not inline inside a
 * sentence (WCAG 2.5.8's documented exception, recorded per-control by
 * `measureTouchTargets` rather than silently dropped).
 */
function assertTouchTargets(targets: TouchTarget[], context: string): TouchTarget[] {
  const gated = targets.filter((t) => !t.inlineInText);
  const undersized = gated.filter(
    (t) => t.width < MIN_TOUCH_TARGET_PX || t.height < MIN_TOUCH_TARGET_PX,
  );
  expect(
    undersized,
    `${context}: ${undersized.length} of ${gated.length} interactive controls are smaller than ` +
      `${MIN_TOUCH_TARGET_PX}x${MIN_TOUCH_TARGET_PX} CSS px as RENDERED:\n${formatTargets(undersized)}`,
  ).toHaveLength(0);
  return gated;
}

/* ═══════════════════════════════════════════════════════════════════════
 * 1. Student dashboard — responsive sweep across all nine viewports
 * ═══════════════════════════════════════════════════════════════════════ */

test.describe('/dashboard — responsive sweep', () => {
  for (const vp of VIEWPORTS) {
    test(`no horizontal overflow and no clipped header text at ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await gotoStudent(page, '/dashboard');

      const overflow = await measureOverflow(page);
      const shotPath = await shot(page, `dashboard-en-${vp.name}`);
      writeJson(`dashboard-overflow-en-${vp.name}`, overflow);

      expect(
        overflow.scrollWidth,
        `${vp.name}: the document is horizontally scrollable (${overflow.scrollWidth}px content in a ` +
          `${overflow.innerWidth}px viewport). Boxes crossing the right edge:\n` +
          overflow.offenders.map((o) => `  <${o.tag}> right=${o.right} w=${o.width} "${o.text}" .${o.cls}`).join('\n') +
          `\nScreenshot: ${shotPath}`,
      ).toBeLessThanOrEqual(overflow.innerWidth + 1);

      // Header text that is cut off is meaning the student never receives.
      const clipped = await measureClipping(page, '.dashboard-header-row');
      expect(
        clipped,
        `${vp.name}: header text is visually clipped:\n` +
          clipped.map((c) => `  <${c.tag}> "${c.text}" ${c.scrollWidth}px into ${c.clientWidth}px (+${c.overflowPx})`).join('\n') +
          `\nScreenshot: ${shotPath}`,
      ).toHaveLength(0);
    });
  }
});

/* ═══════════════════════════════════════════════════════════════════════
 * 2. Student dashboard header — the two fixes made blind
 * ═══════════════════════════════════════════════════════════════════════ */

test.describe('/dashboard header — regrouping and control collision', () => {
  /**
   * Fix (a). The greeting and the stats cluster were regrouped so identity
   * owns one row and the glanceable stats own another; the whole point was
   * that neither has to shrink. "Two rows" is a GEOMETRIC claim: the stats
   * block's top edge must sit at or below the greeting block's bottom edge.
   * Asserting the class names would re-assert the belief that was already
   * held when the bug shipped.
   */
  test('the greeting and the stats cluster occupy two separate rows at 360px', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await gotoStudent(page, '/dashboard');

    const rows = await page.evaluate(() => {
      const row = document.querySelector('.dashboard-header-row');
      if (!row) return null;
      const greeting = row.querySelector('.dashboard-header-greeting');
      const stats = greeting?.nextElementSibling;
      if (!greeting || !stats) return null;
      const g = greeting.getBoundingClientRect();
      const s = stats.getBoundingClientRect();
      return {
        flexDirection: window.getComputedStyle(row).flexDirection,
        greeting: { top: Math.round(g.top), bottom: Math.round(g.bottom), left: Math.round(g.left), right: Math.round(g.right), width: Math.round(g.width) },
        stats: { top: Math.round(s.top), bottom: Math.round(s.bottom), left: Math.round(s.left), right: Math.round(s.right), width: Math.round(s.width) },
      };
    });

    expect(rows, 'header row + greeting + stats must all be present').not.toBeNull();
    await shot(page, 'dashboard-header-360-en');
    expect(
      rows!.stats.top,
      'The stats cluster must start at or below the bottom of the greeting block — otherwise the ' +
        'header is still ONE row and the greeting is still being squeezed. Measured: ' +
        `greeting=${JSON.stringify(rows!.greeting)} stats=${JSON.stringify(rows!.stats)} ` +
        `flex-direction=${rows!.flexDirection}`,
    ).toBeGreaterThanOrEqual(rows!.greeting.bottom);
  });

  /**
   * Side effect of the same regrouping, found only by looking at the rendered
   * page: the greeting was moved into `.dashboard-header-greeting`, a class
   * globals.css defines as a 12px UPPERCASE letter-spaced kicker
   * (`text-transform: uppercase; letter-spacing: .08em; font-size:
   * var(--text-2xs)`). `text-transform` inherits, and the `<p>` inside
   * overrides only `font-size` — so the student's own name is rendered
   * "HI, ABHINAV" at 20px bold. Nothing in the markup says uppercase, which is
   * why source review could not see it.
   *
   * Asserting the computed value is unusual for this suite and deliberate:
   * `textContent` is unaffected by `text-transform`, so the DOM cannot tell
   * you what the student actually reads.
   */
  test('the greeting renders in the case the component wrote, not uppercased by its container', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await gotoStudent(page, '/dashboard');

    const transform = await page.evaluate(() => {
      const p = document.querySelector('.dashboard-header-greeting p');
      if (!p) return null;
      const s = window.getComputedStyle(p);
      return { textTransform: s.textTransform, letterSpacing: s.letterSpacing, text: p.textContent };
    });
    expect(transform, 'the greeting paragraph must exist').not.toBeNull();
    expect(
      transform!.textTransform,
      `The greeting "${transform!.text}" is rendered with text-transform: ${transform!.textTransform} ` +
        `and letter-spacing: ${transform!.letterSpacing}, inherited from .dashboard-header-greeting ` +
        '(a 12px uppercase kicker style). A personal greeting must keep the name\'s own casing.',
    ).toBe('none');
  });

  /**
   * Fix (b). `.app-shell-onehand-toggle` is `position: absolute; top: 8px;
   * right: ~16px; 36x36` and is `display: none` from 768px up, so on a phone
   * it was landing directly on top of the language toggle — two live controls
   * in the same pixels, where whichever wins the z-order silently eats the
   * other's taps. The fix reserves the slot with `pe-14`. The only honest
   * assertion is that the intersection area is zero.
   */
  for (const width of [320, 360, 390, 412]) {
    test(`the one-handed toggle does not overlap the language toggle at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await gotoStudent(page, '/dashboard');

      const oneHand = page.locator('.app-shell-onehand-toggle');
      await expect(
        oneHand,
        `The one-handed toggle must be present below 768px (it is display:none above). ` +
          'If this fails the collision test below is vacuous.',
      ).toBeVisible();

      const lang = page.getByRole('button', { name: /Switch to English|हिन्दी में बदलें/ });
      await expect(lang).toBeVisible();

      const a = await oneHand.boundingBox();
      const b = await lang.boundingBox();
      expect(a, 'one-hand toggle bounding box').not.toBeNull();
      expect(b, 'language toggle bounding box').not.toBeNull();

      const area = overlapArea(a!, b!);
      await shot(page, `dashboard-header-collision-${width}`);
      expect(
        area,
        `At ${width}px the one-handed toggle and the language toggle overlap by ${Math.round(area)}px². ` +
          `one-hand=${JSON.stringify(a)} language=${JSON.stringify(b)}. Two live controls sharing ` +
          'pixels means one of them is unreachable by touch.',
      ).toBe(0);
    });
  }
});

/* ═══════════════════════════════════════════════════════════════════════
 * 2b. Bottom nav vs. content — the last thing on the page must be reachable
 * ═══════════════════════════════════════════════════════════════════════ */

test.describe('bottom navigation', () => {
  /**
   * The student bottom nav is `position: fixed`, so it is OUTSIDE normal flow
   * and does not push content up. If the scroll container does not reserve
   * its height, the final element of every page sits permanently underneath
   * it: visible in a screenshot, untappable and half-unreadable in the hand.
   *
   * Scrolling to the very bottom first is load-bearing — mid-page the nav
   * always overlaps something, and that is fine because the user can scroll
   * past it. The defect only exists if there is nothing left to scroll.
   */
  for (const width of [360, 412]) {
    test(`content is not trapped under the fixed bottom nav at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await gotoStudent(page, '/dashboard');

      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      // The nav hides itself on scroll-down and returns on settle; give the
      // transform transition (220ms) room before measuring.
      await page.waitForTimeout(1200);

      const result = await page.evaluate(() => {
        const navButton = Array.from(document.querySelectorAll('button')).find((b) =>
          /^(Today|आज)$/.test((b.getAttribute('aria-label') ?? '').trim()),
        );
        if (!navButton) return null;
        let nav: HTMLElement | null = navButton;
        while (nav && window.getComputedStyle(nav).position !== 'fixed') nav = nav.parentElement;
        if (!nav) return null;
        const navRect = nav.getBoundingClientRect();
        const content = document.querySelector('.app-shell-content');
        if (!content) return null;
        const last = content.lastElementChild?.lastElementChild ?? content.lastElementChild;
        if (!last) return null;
        const lastRect = last.getBoundingClientRect();
        return {
          navTop: Math.round(navRect.top),
          navBottom: Math.round(navRect.bottom),
          lastBottom: Math.round(lastRect.bottom),
          lastText: (last.textContent ?? '').trim().slice(0, 60),
        };
      });

      expect(
        result,
        'Could not locate both the fixed bottom nav and the last content element — the nav markup ' +
          'or the shell structure changed, so this test is no longer measuring what it claims.',
      ).not.toBeNull();

      await shot(page, `dashboard-bottom-nav-${width}`);
      expect(
        result!.lastBottom,
        `At ${width}px the last content element ("${result!.lastText}") ends at y=${result!.lastBottom} ` +
          `while the fixed bottom nav starts at y=${result!.navTop}, with the page already scrolled to ` +
          'the end. The final content is permanently underneath the nav.',
      ).toBeLessThanOrEqual(result!.navTop);
    });
  }
});

/* ═══════════════════════════════════════════════════════════════════════
 * 3. Touch targets — measured, not read off the class list
 * ═══════════════════════════════════════════════════════════════════════ */

test.describe('touch targets', () => {
  test('every interactive control on /dashboard is at least 44x44 as rendered (360px)', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await gotoStudent(page, '/dashboard');

    const targets = await measureTouchTargets(page);
    writeJson('touch-targets-dashboard-360', targets);
    const gated = assertTouchTargets(targets, '/dashboard @360x800');
    expect(gated.length, 'the dashboard must expose interactive controls to measure').toBeGreaterThan(0);
  });

  test('every interactive control on /dashboard is at least 44x44 as rendered (1280px)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await gotoStudent(page, '/dashboard');

    const targets = await measureTouchTargets(page);
    writeJson('touch-targets-dashboard-1280', targets);
    assertTouchTargets(targets, '/dashboard @1280x800');
  });

  /**
   * SCOPE LIMIT — read the screenshot before quoting this as "/teacher is
   * verified". Under this file's containment the TeacherShell (sidebar,
   * brand, nav, Profile/Logout) renders for real, but CommandCenter — the
   * whole content column — stays on `TeacherDashboardSkeleton`, because its
   * roster/assignment reads are answered with empty arrays and it never
   * leaves its loading state. So what is measured here is the teacher SHELL,
   * not the teacher dashboard. Extending this to the populated Command
   * Center needs real `teacher-dashboard` fixtures and is NOT done.
   */
  test('every interactive control on /teacher is at least 44x44 as rendered (360px)', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await gotoTeacher(page, '/teacher');

    const targets = await measureTouchTargets(page);
    writeJson('touch-targets-teacher-360', targets);
    await shot(page, 'teacher-en-360x800');
    const gated = assertTouchTargets(targets, '/teacher @360x800');
    // Non-vacuity guard. The first run of this file reported /parent as
    // "0 undersized of 0" — a green result produced by measuring a surface
    // that had rendered no controls at all. A size assertion over an empty
    // set proves nothing, so the set must be non-empty for the pass to mean
    // anything.
    expect(
      gated.length,
      '/teacher exposed NO interactive controls to measure — this pass would be vacuous. Either ' +
        'the page is still on its skeleton or the teacher session did not resolve.',
    ).toBeGreaterThan(0);
  });

  test('every interactive control on /parent is at least 44x44 as rendered (360px)', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await gotoParent(page, '/parent');

    const targets = await measureTouchTargets(page);
    writeJson('touch-targets-parent-360', targets);
    await shot(page, 'parent-en-360x800');
    const gated = assertTouchTargets(targets, '/parent @360x800');
    expect(
      gated.length,
      '/parent exposed NO interactive controls to measure — this pass would be vacuous (see the ' +
        'teacher case above for why this guard exists).',
    ).toBeGreaterThan(0);
  });
});

/* ═══════════════════════════════════════════════════════════════════════
 * 4. Hindi rendering — the single largest unverified claim in the program
 * ═══════════════════════════════════════════════════════════════════════ */

test.describe('Hindi rendering at 360px', () => {
  /**
   * Hindi strings run 20-30% longer than their English counterparts, so every
   * fixed-width control, every `truncate`, and every flex row that just
   * barely fitted in English is a candidate failure. Nothing in this program
   * had ever rendered them.
   *
   * ── Why these tests do NOT tap the language toggle ───────────────────────
   * They did, originally. They could not: the one-handed-mode toggle is
   * painted over the language toggle on phones and intercepts its pointer
   * events, so `click()` burned the entire 240s budget on
   * "…app-shell-onehand-toggle intercepts pointer events" and every Hindi
   * assertion died before measuring a single pixel. That collision is
   * asserted head-on in its own tests above and below; here we enter Hindi
   * through the OTHER production path — `students.preferred_language = 'hi'`,
   * which AuthContext reads on load — so the Hindi LAYOUT can be measured
   * while the toggle remains broken. This is a different entry point, not a
   * relaxed assertion.
   *
   * P7 note: numerals must stay Arabic (12,450), which is what
   * `toLocaleString('en-IN')` produces; asserted separately below.
   */
  async function assertHindiActive(page: Page): Promise<void> {
    await expect(
      page.getByText(/नमस्ते/),
      'The Hindi greeting never rendered, so the measurements below would be measuring the ENGLISH ' +
        'dashboard and reporting it as Hindi. AuthContext seeds `language` from ' +
        '`students.preferred_language` — check that fixture.',
    ).toBeVisible({ timeout: 30_000 });
  }

  /**
   * The consequence of the header collision, stated as the user-facing fact:
   * a student on a phone cannot switch language, because the control that
   * would do it is underneath another control. Kept short (10s) — this is a
   * hit-test, not a load wait, and letting it retry for minutes only hides
   * what happened.
   */
  test('the language toggle can actually be tapped at 360px', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await gotoStudent(page, '/dashboard');

    const toggle = page.getByRole('button', { name: /हिन्दी में बदलें|Switch to English/ });
    await expect(toggle).toBeVisible();
    await toggle.click({ timeout: 10_000 });
    await assertHindiActive(page);
  });

  test('the Hindi dashboard does not overflow horizontally at 360px', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await gotoStudent(page, '/dashboard', { preferredLanguage: 'hi' });
    await assertHindiActive(page);

    const overflow = await measureOverflow(page);
    const shotPath = await shot(page, 'dashboard-hi-360');
    writeJson('dashboard-overflow-hi-360', overflow);

    expect(
      overflow.scrollWidth,
      `Hindi @360px: document is ${overflow.scrollWidth}px wide in a ${overflow.innerWidth}px viewport. ` +
        'Boxes crossing the right edge:\n' +
        overflow.offenders.map((o) => `  <${o.tag}> right=${o.right} w=${o.width} "${o.text}" .${o.cls}`).join('\n') +
        `\nScreenshot: ${shotPath}`,
    ).toBeLessThanOrEqual(overflow.innerWidth + 1);
  });

  test('no Hindi string is clipped mid-word anywhere on the dashboard at 360px', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await gotoStudent(page, '/dashboard', { preferredLanguage: 'hi' });
    await assertHindiActive(page);

    const clipped = await measureClipping(page);
    const shotPath = await shot(page, 'dashboard-hi-360-clipping');
    writeJson('dashboard-clipping-hi-360', clipped);

    expect(
      clipped,
      `Hindi @360px: ${clipped.length} text node(s) render clipped/ellipsised, i.e. the student is ` +
        'shown less than the string says:\n' +
        clipped.map((c) => `  <${c.tag}> "${c.text}" needs ${c.scrollWidth}px, has ${c.clientWidth}px (+${c.overflowPx})`).join('\n') +
        `\nScreenshot: ${shotPath}`,
    ).toHaveLength(0);
  });

  test('Hindi touch targets stay at least 44x44 at 360px', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await gotoStudent(page, '/dashboard', { preferredLanguage: 'hi' });
    await assertHindiActive(page);

    const targets = await measureTouchTargets(page);
    writeJson('touch-targets-dashboard-hi-360', targets);
    assertTouchTargets(targets, '/dashboard Hindi @360x800');
  });

  test('XP numerals stay Arabic in Hindi mode (P7: technical values are not transliterated)', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await gotoStudent(page, '/dashboard', { preferredLanguage: 'hi' });
    await assertHindiActive(page);

    const chip = page.locator('.dashboard-header-row [aria-label*="XP"]').first();
    await expect(chip).toBeVisible();
    const text = ((await chip.textContent()) ?? '').trim();
    // Devanagari digits are U+0966..U+096F. Their presence would mean the
    // number was localised, which P7 forbids for technical values.
    expect(text, `XP chip rendered "${text}" — it must use Arabic numerals`).toMatch(/[0-9]/);
    expect(text, `XP chip rendered "${text}" — Devanagari digits are not allowed`).not.toMatch(/[०-९]/);
  });
});

/* ═══════════════════════════════════════════════════════════════════════
 * 5. Accessibility — axe-core plus real keyboard traversal
 * ═══════════════════════════════════════════════════════════════════════ */

test.describe('accessibility — axe-core (WCAG 2.0/2.1 A + AA)', () => {
  // Machine-checkable, self-enabling: the moment axe-core resolves, these
  // run. A literal-boolean skip is banned in this directory (helpers/auth.ts).
  test.skip(
    AXE_BUNDLE === null,
    'axe-core/axe.min.js not resolvable from node_modules — install axe-core to enable the automated a11y scan.',
  );

  test('/dashboard has no critical or serious axe violations (360px)', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await gotoStudent(page, '/dashboard');

    const violations = await runAxe(page, AXE_BUNDLE!);
    writeJson('axe-dashboard-360', violations);
    const blocking = violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
    expect(
      blocking,
      `/dashboard @360px axe violations (all severities: ${summariseAxe(violations)})`,
    ).toHaveLength(0);
  });

  test('/dashboard has no critical or serious axe violations (1280px)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await gotoStudent(page, '/dashboard');

    const violations = await runAxe(page, AXE_BUNDLE!);
    writeJson('axe-dashboard-1280', violations);
    const blocking = violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
    expect(
      blocking,
      `/dashboard @1280px axe violations (all severities: ${summariseAxe(violations)})`,
    ).toHaveLength(0);
  });

  test('/dashboard in Hindi has no critical or serious axe violations (360px)', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    // Hindi via `preferred_language` (see the Hindi describe for why the
    // toggle cannot be tapped on a phone).
    await gotoStudent(page, '/dashboard', { preferredLanguage: 'hi' });
    await expect(page.getByText(/नमस्ते/)).toBeVisible({ timeout: 30_000 });

    const violations = await runAxe(page, AXE_BUNDLE!);
    writeJson('axe-dashboard-hi-360', violations);
    const blocking = violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
    expect(
      blocking,
      `/dashboard Hindi @360px axe violations (all severities: ${summariseAxe(violations)})`,
    ).toHaveLength(0);
  });

  // SCOPE LIMIT: same as the /teacher touch-target test — this scans the
  // teacher SHELL with CommandCenter still on its skeleton. A clean result
  // here says nothing about the populated Command Center.
  test('/teacher has no critical or serious axe violations (1280px)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await gotoTeacher(page, '/teacher');

    await shot(page, 'teacher-en-1280x800');
    const violations = await runAxe(page, AXE_BUNDLE!);
    writeJson('axe-teacher-1280', violations);
    const blocking = violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
    expect(
      blocking,
      `/teacher @1280px axe violations (all severities: ${summariseAxe(violations)})`,
    ).toHaveLength(0);
  });

  test('/parent has no critical or serious axe violations (1280px)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await gotoParent(page, '/parent');

    await shot(page, 'parent-en-1280x800');
    const violations = await runAxe(page, AXE_BUNDLE!);
    writeJson('axe-parent-1280', violations);
    const blocking = violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
    expect(
      blocking,
      `/parent @1280px axe violations (all severities: ${summariseAxe(violations)})`,
    ).toHaveLength(0);
  });
});

test.describe('accessibility — keyboard', () => {
  /**
   * Three separate contracts, all invisible to JSDOM:
   *   - every keyboard-focused control shows a VISIBLE indicator (WCAG 2.4.7),
   *     which here means a non-zero outline or a box-shadow ring;
   *   - focus ORDER follows the visual order (no jump backwards up the page);
   *   - no keyboard TRAP: 40 Tab presses must not get stuck on one element.
   */
  test('/dashboard is keyboard traversable with a visible focus indicator', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await gotoStudent(page, '/dashboard');

    await page.locator('body').click({ position: { x: 2, y: 2 } });
    const trail: Array<{ tag: string; name: string; y: number; x: number; indicator: string }> = [];

    for (let i = 0; i < 40; i += 1) {
      await page.keyboard.press('Tab');
      const info = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return null;
        const s = window.getComputedStyle(el);
        const r = el.getBoundingClientRect();
        const outline =
          s.outlineStyle !== 'none' && parseFloat(s.outlineWidth || '0') > 0
            ? `outline ${s.outlineWidth} ${s.outlineColor}`
            : '';
        const ring = s.boxShadow && s.boxShadow !== 'none' ? `box-shadow ${s.boxShadow.slice(0, 60)}` : '';
        return {
          tag: el.tagName.toLowerCase(),
          name: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 40),
          x: Math.round(r.x),
          y: Math.round(r.y),
          indicator: [outline, ring].filter(Boolean).join(' + '),
        };
      });
      if (!info) break;
      // `<nextjs-portal>` is the Next.js DEV OVERLAY custom element, injected
      // by `next dev` and absent from every production build. It is not
      // product markup and cannot be styled by this codebase, so holding it to
      // the app's focus-indicator contract would report a dev-server artifact
      // as an accessibility defect. Excluded by tag name only — nothing the
      // app renders is excluded.
      if (info.tag === 'nextjs-portal') continue;
      trail.push(info);
    }

    writeJson('keyboard-trail-dashboard-1280', trail);
    expect(trail.length, 'Tab must move focus through the dashboard').toBeGreaterThan(3);

    // Keyboard trap: the same control focused on many consecutive presses.
    let repeats = 1;
    let worstRepeat = 1;
    for (let i = 1; i < trail.length; i += 1) {
      const same = trail[i].tag === trail[i - 1].tag && trail[i].name === trail[i - 1].name && trail[i].x === trail[i - 1].x && trail[i].y === trail[i - 1].y;
      repeats = same ? repeats + 1 : 1;
      worstRepeat = Math.max(worstRepeat, repeats);
    }
    expect(
      worstRepeat,
      `Focus stayed on the same control for ${worstRepeat} consecutive Tab presses — that is a ` +
        `keyboard trap. Trail:\n${trail.map((t) => `  <${t.tag}> "${t.name}" @(${t.x},${t.y})`).join('\n')}`,
    ).toBeLessThan(3);

    const invisible = trail.filter((t) => t.indicator === '');
    expect(
      invisible,
      `WCAG 2.4.7: ${invisible.length} of ${trail.length} keyboard-focused controls render NO focus ` +
        'indicator (no outline, no box-shadow ring):\n' +
        invisible.map((t) => `  <${t.tag}> "${t.name}" @(${t.x},${t.y})`).join('\n'),
    ).toHaveLength(0);
  });
});

/* ═══════════════════════════════════════════════════════════════════════
 * 6. Layout stability + recorded (NOT gated) load timings
 * ═══════════════════════════════════════════════════════════════════════ */

test.describe('core web vitals', () => {
  test('/dashboard layout is stable (CLS) and load timings are recorded', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await armWebVitals(page);
    await gotoStudent(page, '/dashboard');

    // Let async widgets (mastery, board score, revision rail) settle — their
    // arrival is exactly when unreserved space produces a shift.
    await page.waitForTimeout(4000);
    const vitals = await collectWebVitals(page);
    writeJson('web-vitals-dashboard-390', vitals);
    await testInfo.attach('web-vitals-dashboard-390', {
      body: JSON.stringify(vitals, null, 2),
      contentType: 'application/json',
    });

    // ── LCP / TBT: RECORDED, NOT GATED ──────────────────────────────────
    // `next dev` serves unminified, unsplit, on-demand-compiled bundles.
    // These numbers cannot be compared to the production targets (LCP <=
    // 2.5s, INP <= 200ms) and are attached as artifacts for regression
    // spotting only. Gating on them here would either be trivially green or
    // permanently red, and either way would be dishonest.
    // eslint-disable-next-line no-console
    console.warn(
      `[dev-build, NOT a production measurement] LCP=${vitals.lcp?.toFixed(0) ?? 'n/a'}ms ` +
        `CLS=${vitals.cls.toFixed(4)} TBT=${vitals.tbt.toFixed(0)}ms ` +
        `longTasks=${vitals.longTasks} longest=${vitals.longestTask.toFixed(0)}ms`,
    );

    // ── CLS IS gated ────────────────────────────────────────────────────
    // Layout stability is a function of reserved space, not bundle size, so
    // a dev-build CLS above the "good" threshold is a real defect (an async
    // widget landing into unreserved space).
    expect(
      vitals.cls,
      `Cumulative Layout Shift ${vitals.cls.toFixed(4)} exceeds ${MAX_CLS}. Something lands into ` +
        'unreserved space after first paint — check that every async dashboard widget renders a ' +
        'same-height skeleton. (LCP/TBT in this run are dev-build numbers and are not gated.)',
    ).toBeLessThanOrEqual(MAX_CLS);
  });
});

/* ═══════════════════════════════════════════════════════════════════════
 * 7. Console + network hygiene
 * ═══════════════════════════════════════════════════════════════════════ */

test.describe('console and network hygiene', () => {
  /**
   * Under full containment every browser-originated backend call is answered
   * 200 locally, so an uncaught exception or a failed request here is the
   * app's own defect, not neutralised-credential noise. That makes
   * `pageErrors` safely gateable. HTTP >= 400 and console errors are
   * recorded and reported: the dev server itself emits some (Next.js dev
   * overlay, source-map fetches) that are not product defects.
   */
  for (const route of ['/dashboard'] as const) {
    test(`${route} raises no uncaught exception and no failed request`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 390, height: 844 });
      const diag = attachDiagnostics(page);
      await gotoStudent(page, route);
      await page.waitForTimeout(3000);

      writeJson(`diagnostics${route.replace(/\//g, '-')}`, diag);
      await testInfo.attach(`diagnostics${route.replace(/\//g, '-')}`, {
        body: JSON.stringify(diag, null, 2),
        contentType: 'application/json',
      });

      expect(
        diag.pageErrors,
        `${route} raised uncaught exception(s):\n${diag.pageErrors.join('\n---\n')}`,
      ).toHaveLength(0);

      // Requests that never completed at the transport layer. With every
      // backend call mocked, these can only be the app's own.
      expect(
        diag.failedRequests,
        `${route} had failed network request(s):\n${diag.failedRequests.join('\n')}`,
      ).toHaveLength(0);
    });
  }
});
