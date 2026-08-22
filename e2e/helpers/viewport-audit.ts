import { expect, type Page } from '@playwright/test';

/**
 * Measurement primitives for the conditions `e2e/ui-responsive-a11y.spec.ts`
 * does NOT cover: browser zoom, WCAG reflow, prefers-reduced-motion,
 * safe-area insets, and the three-tier navigation contract.
 *
 * Kept in its own module (rather than growing `helpers/ui-audit.ts`) because
 * these are a different KIND of probe: ui-audit measures a page as laid out at
 * a viewport, whereas everything here changes an environmental condition
 * (zoom factor, motion preference, orientation) and then asks what the page
 * did about it. The two files share no state and can be read independently.
 *
 * ── Safety ───────────────────────────────────────────────────────────────
 * `assertNoExternalTraffic()` is the load-bearing one. Every spec in this
 * directory CLAIMS that `page.route()` containment keeps a run off any real
 * backend; none of them has ever MEASURED it. That claim is not free here:
 * the local dev server this suite runs against may have been booted with
 * whatever credentials were in the operator's shell, and a single
 * uncontained request would reach a real Supabase project with them. The
 * guard turns the claim into an assertion by recording every request the
 * browser makes and failing if any of them left localhost.
 */

/* ═══════════════════════════════════════════════════════════════════════
 * Containment verification
 * ═══════════════════════════════════════════════════════════════════════ */

export interface TrafficLog {
  /** Absolute URLs the browser requested that were NOT served from localhost. */
  external: string[];
}

const LOCAL_HOST = /^(127\.0\.0\.1|localhost|\[::1\])$/;

/**
 * Record every browser-originated request whose host is not the local server.
 *
 * Attach BEFORE `page.goto`. `page.route()` handlers still see (and fulfil)
 * these requests, so a fulfilled-locally request to a supabase.co URL WILL be
 * listed — that is deliberate: the point is to prove which origins the app
 * tried to reach, and to fail loudly if a NEW code path starts talking to one
 * the containment net does not cover.
 *
 * `data:`, `blob:` and `about:` URLs are ignored (no network involved).
 */
export function attachTrafficGuard(page: Page): TrafficLog {
  const log: TrafficLog = { external: [] };
  page.on('request', (req) => {
    const url = req.url();
    if (/^(data|blob|about|chrome-extension):/.test(url)) return;
    let host: string;
    try {
      host = new URL(url).hostname;
    } catch {
      return;
    }
    if (LOCAL_HOST.test(host)) return;
    log.external.push(`${req.method()} ${url.slice(0, 200)}`);
  });
  return log;
}

/**
 * Fail if any request actually REACHED a non-local server.
 *
 * Distinguished from `attachTrafficGuard`'s raw log by consulting the
 * response: a request that `page.route()` fulfilled locally never touched the
 * network, so it is contained even though its URL names a remote host. Only a
 * request that produced a real response from a remote server counts.
 */
export function attachEscapeGuard(page: Page): { escaped: string[] } {
  const escaped: string[] = [];
  page.on('response', async (res) => {
    const url = res.url();
    let host: string;
    try {
      host = new URL(url).hostname;
    } catch {
      return;
    }
    if (LOCAL_HOST.test(host)) return;
    // `fromServiceWorker` and route-fulfilled responses report no server
    // address; a genuine network hit does.
    const addr = await res.serverAddr().catch(() => null);
    if (addr && !LOCAL_HOST.test(addr.ipAddress)) {
      escaped.push(`${res.status()} ${res.request().method()} ${url.slice(0, 200)} → ${addr.ipAddress}`);
    }
  });
  return { escaped };
}

export function assertNoExternalTraffic(guard: { escaped: string[] }, context: string): void {
  expect(
    guard.escaped,
    `${context}: ${guard.escaped.length} browser request(s) REACHED a remote server despite ` +
      'page.route() containment. Under a dev server booted with real credentials this is a ' +
      'live-data touch, not a test-hygiene nit:\n' + guard.escaped.join('\n'),
  ).toHaveLength(0);
}

/* ═══════════════════════════════════════════════════════════════════════
 * Zoom / reflow
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * Emulate browser page zoom by shrinking the CSS viewport.
 *
 * Page zoom at factor N on a physical window of W device px presents the page
 * with a CSS viewport of W/N — that IS what zoom does to layout, and it is the
 * only way to express it that works identically in Chromium, Firefox and
 * WebKit (Playwright exposes no zoom API, and the Chromium-only CDP
 * `Emulation.setPageScaleFactor` is a pinch-zoom overlay that does not reflow
 * at all, so it would test nothing).
 *
 * The one thing this does NOT reproduce is zoom's effect on physical text
 * size; `setTextZoom()` below covers that axis separately.
 */
export async function setPageZoom(
  page: Page,
  physical: { width: number; height: number },
  factor: number,
): Promise<{ width: number; height: number }> {
  const width = Math.round(physical.width / factor);
  const height = Math.round(physical.height / factor);
  await page.setViewportSize({ width, height });
  return { width, height };
}

/**
 * WCAG 2.2 SC 1.4.4 "Resize text": text scaled to 200% must not lose content
 * or function. Distinct from page zoom (SC 1.4.10 Reflow) — here the viewport
 * stays put and only the type grows, which is the harsher case for any box
 * sized in px.
 *
 * Applied to the root font-size, so every `rem`-based size follows. Elements
 * hardcoded in `px` deliberately do NOT scale — that is the defect this
 * exposes, not a limitation of the technique.
 */
export async function setTextZoom(page: Page, percent: number): Promise<void> {
  await page.evaluate((pct) => {
    const base = 16;
    document.documentElement.style.setProperty('font-size', `${(base * pct) / 100}px`, 'important');
  }, percent);
  // One frame for layout to settle before anything is measured.
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))));
}

/* ═══════════════════════════════════════════════════════════════════════
 * Motion
 * ═══════════════════════════════════════════════════════════════════════ */

export interface MotionReport {
  /** `--duration-*` tokens as the page computes them on :root. */
  tokens: Record<string, string>;
  /** Elements whose computed transition-duration exceeds the reduced budget. */
  animated: Array<{ tag: string; cls: string; prop: string; duration: string }>;
  /** Elements running a non-`none` CSS animation. */
  running: Array<{ tag: string; cls: string; name: string; duration: string }>;
  matchesReduce: boolean;
}

/** Anything at or below this is "effectively instant" (the tokens collapse to 0.01ms). */
const REDUCED_MOTION_BUDGET_MS = 1;

function parseCssTimeList(value: string): number[] {
  return value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)
    .map((v) => (v.endsWith('ms') ? parseFloat(v) : parseFloat(v) * 1000))
    .filter((n) => Number.isFinite(n));
}

/**
 * What the page actually does about `prefers-reduced-motion`.
 *
 * Reads three independent signals rather than one, because each can pass while
 * the others fail:
 *   1. the `--duration-*` TOKENS on :root (globals.css redeclares them to
 *      0.01ms inside the reduce block — a component reading them via
 *      getComputedStyle must see the reduced value);
 *   2. every element's computed `transition-duration` (the blanket
 *      `*, *::before, *::after { transition-duration: 0.01ms !important }`);
 *   3. running CSS animations (`animation-name !== none`), which the token
 *      collapse does not touch — those need the explicit `animation: none`
 *      rules.
 */
export async function measureMotion(page: Page): Promise<MotionReport> {
  return page.evaluate((budgetMs) => {
    const root = getComputedStyle(document.documentElement);
    const tokenNames = [
      '--duration-instant',
      '--duration-fast',
      '--duration-base',
      '--duration-slow',
      '--duration-slower',
    ];
    const tokens: Record<string, string> = {};
    for (const name of tokenNames) tokens[name] = root.getPropertyValue(name).trim();

    const toMs = (value: string): number[] =>
      value
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean)
        .map((v) => (v.endsWith('ms') ? parseFloat(v) : parseFloat(v) * 1000))
        .filter((n) => Number.isFinite(n));

    const animated: MotionReport['animated'] = [];
    const running: MotionReport['running'] = [];
    const all = Array.from(document.querySelectorAll<HTMLElement>('body *')).slice(0, 4000);
    for (const el of all) {
      // The Next.js dev overlay is not product markup and cannot be styled by
      // this codebase — holding it to the app's motion contract would report a
      // dev-server artifact as a defect.
      if (el.tagName.toLowerCase() === 'nextjs-portal') continue;
      const s = getComputedStyle(el);
      const durations = toMs(s.transitionDuration);
      const worst = durations.length ? Math.max(...durations) : 0;
      if (worst > budgetMs) {
        animated.push({
          tag: el.tagName.toLowerCase(),
          cls: String(el.className ?? '').slice(0, 90),
          prop: s.transitionProperty.slice(0, 60),
          duration: s.transitionDuration,
        });
      }
      if (s.animationName && s.animationName !== 'none') {
        const animDurations = toMs(s.animationDuration);
        const worstAnim = animDurations.length ? Math.max(...animDurations) : 0;
        if (worstAnim > budgetMs) {
          running.push({
            tag: el.tagName.toLowerCase(),
            cls: String(el.className ?? '').slice(0, 90),
            name: s.animationName.slice(0, 60),
            duration: s.animationDuration,
          });
        }
      }
    }
    return {
      tokens,
      animated: animated.slice(0, 25),
      running: running.slice(0, 25),
      matchesReduce: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    };
  }, REDUCED_MOTION_BUDGET_MS) as Promise<MotionReport>;
}

export { REDUCED_MOTION_BUDGET_MS, parseCssTimeList };

/* ═══════════════════════════════════════════════════════════════════════
 * Safe area
 * ═══════════════════════════════════════════════════════════════════════ */

export interface SafeAreaReport {
  /** The literal `content` of <meta name="viewport">. */
  viewportMeta: string | null;
  /** True when that meta opts into the display cutout via viewport-fit=cover. */
  viewportFitCover: boolean;
  /** The bottom nav's DECLARED padding-bottom (style attribute, pre-resolution). */
  navDeclaredPaddingBottom: string | null;
  /** ...and the resolved value in this browser (0px where there is no inset). */
  navComputedPaddingBottom: string | null;
  /** `.pb-nav`'s computed padding-bottom, the content clearance helper. */
  pbNavComputed: string | null;
  /** Whether `env(safe-area-inset-bottom)` is honoured at all here. */
  envSupported: boolean;
}

/**
 * Whether the app has actually WIRED UP the display cutout, as opposed to
 * merely writing `env(safe-area-inset-bottom)` somewhere.
 *
 * The distinction is the whole point. `env(safe-area-inset-*)` resolves to 0
 * on every browser unless the page opts in with `viewport-fit=cover` in its
 * viewport meta. Without that opt-in the padding is present in the stylesheet,
 * computes to 0, looks correct in every desktop screenshot, and does nothing
 * on the notched phones it exists for. A test that only asserted "the CSS
 * mentions env()" would be green in exactly that broken state.
 */
export async function measureSafeArea(page: Page, navSelector: string): Promise<SafeAreaReport> {
  return page.evaluate((sel) => {
    const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
    const content = meta?.getAttribute('content') ?? null;
    const nav = document.querySelector<HTMLElement>(sel);
    const probe = document.createElement('div');
    probe.style.setProperty('padding-bottom', 'env(safe-area-inset-bottom, 7px)');
    document.body.appendChild(probe);
    const probed = getComputedStyle(probe).paddingBottom;
    probe.remove();
    const pbNav = document.querySelector<HTMLElement>('.pb-nav');
    return {
      viewportMeta: content,
      viewportFitCover: /viewport-fit\s*=\s*cover/.test(content ?? ''),
      navDeclaredPaddingBottom: nav?.style.paddingBottom ?? null,
      navComputedPaddingBottom: nav ? getComputedStyle(nav).paddingBottom : null,
      pbNavComputed: pbNav ? getComputedStyle(pbNav).paddingBottom : null,
      // If the fallback survived, env() itself parsed — the browser understands
      // the function even though the inset is 0 on a non-notched display.
      envSupported: probed === '7px' || /^\d/.test(probed),
    };
  }, navSelector) as Promise<SafeAreaReport>;
}

/* ═══════════════════════════════════════════════════════════════════════
 * Navigation tiers
 * ═══════════════════════════════════════════════════════════════════════ */

export type NavTier = 'bottom-bar' | 'tablet-rail' | 'sidebar';

export const TIER_SELECTOR: Record<NavTier, string> = {
  'bottom-bar': '.bottom-nav-mobile',
  'tablet-rail': '.nav-rail-tablet',
  sidebar: '.sidebar-nav',
};

export interface NavStateReport {
  /** Which of the three tier containers are laid out (not display:none). */
  visibleTiers: NavTier[];
  /** `data-slot` values in DOM order, from whichever tier is visible. */
  slotOrder: string[];
  /** Accessible names of those slots, in the same order. */
  slotNames: string[];
  /** Rendered size of each slot. */
  slotBoxes: Array<{ slot: string; width: number; height: number; x: number; y: number }>;
  /**
   * `aria-current="page"` on controls that are actually EXPOSED — i.e. laid
   * out, and therefore in the accessibility tree.
   *
   * All three tier components stay mounted at every width by design (so a
   * route change never re-mounts navigation), and each marks its own slot. The
   * document therefore carries up to three `aria-current="page"` attributes at
   * once, of which `display:none` removes two from the accessibility tree. A
   * bare `querySelectorAll('[aria-current="page"]').length` would report 3 and
   * call the correct product broken; what a user — including a screen-reader
   * user — can actually perceive is the exposed set, which is what this is.
   */
  currentControls: Array<{ name: string; slot: string | null; tier: string | null }>;
  /** Diagnostic only: the raw DOM count, including the hidden tiers' markers. */
  currentControlsInDom: number;
  /** How many elements expose role=navigation with the main nav's name. */
  mainNavLandmarks: number;
  /**
   * The width the tier media queries are actually evaluated against, and the
   * requested viewport width, so a boundary failure names its own cause.
   *
   * These differ when the engine renders a CLASSIC (space-consuming) scrollbar:
   * `window.innerWidth` reports the requested viewport while
   * `documentElement.clientWidth` — and, in WebKit, the media query — see the
   * viewport MINUS the scrollbar. Measured 2026-08-10: at a 1024px viewport
   * WebKit reports innerWidth 1024 / clientWidth 1019 and `(min-width: 1024px)`
   * does NOT match, while Chromium and Firefox (overlay scrollbars) report
   * 1024/1024 and it does.
   */
  widths: {
    innerWidth: number;
    layoutWidth: number;
    mqPhone: boolean;
    mqTablet: boolean;
    mqDesktop: boolean;
  };
}

/**
 * One snapshot of the navigation as the accessibility tree and the layout
 * engine actually see it.
 *
 * Collected in a single `page.evaluate` so every number describes the same
 * frame — separate round-trips could straddle a re-render and produce a
 * report that never existed.
 */
export async function measureNavState(page: Page): Promise<NavStateReport> {
  return page.evaluate(() => {
    const TIERS: Array<[string, string]> = [
      ['bottom-bar', '.bottom-nav-mobile'],
      ['tablet-rail', '.nav-rail-tablet'],
      ['sidebar', '.sidebar-nav'],
    ];
    const isLaidOut = (el: Element | null): boolean => {
      if (!el) return false;
      const s = getComputedStyle(el as HTMLElement);
      if (s.display === 'none' || s.visibility === 'hidden') return false;
      const r = (el as HTMLElement).getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };

    const visibleTiers: string[] = [];
    let activeTierEl: HTMLElement | null = null;
    for (const [name, sel] of TIERS) {
      const el = document.querySelector<HTMLElement>(sel);
      if (isLaidOut(el)) {
        visibleTiers.push(name);
        activeTierEl ??= el;
      }
    }

    const slotEls = activeTierEl
      ? Array.from(activeTierEl.querySelectorAll<HTMLElement>('[data-slot]'))
      : [];
    const slotOrder = slotEls.map((el) => el.getAttribute('data-slot') ?? '');
    const slotNames = slotEls.map((el) =>
      (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 40),
    );
    const slotBoxes = slotEls.map((el) => {
      const r = el.getBoundingClientRect();
      return {
        slot: el.getAttribute('data-slot') ?? '',
        width: Math.round(r.width * 10) / 10,
        height: Math.round(r.height * 10) / 10,
        x: Math.round(r.x),
        y: Math.round(r.y),
      };
    });

    const allCurrent = Array.from(
      document.querySelectorAll<HTMLElement>('[aria-current="page"]'),
    );
    // Exposure test: an element inside a display:none tier has no client
    // rects, so it is in the DOM but in no accessibility tree.
    const currentControls = allCurrent
      .filter((el) => el.getClientRects().length > 0)
      .map((el) => {
        let tier: string | null = null;
        for (const [name, sel] of TIERS) {
          if (el.closest(sel)) {
            tier = name;
            break;
          }
        }
        return {
          name: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 40),
          slot: el.getAttribute('data-slot'),
          tier,
        };
      });

    const mainNavLandmarks = Array.from(
      document.querySelectorAll<HTMLElement>('nav[aria-label="Main navigation"]'),
    ).filter((el) => isLaidOut(el)).length;

    return {
      visibleTiers,
      slotOrder,
      slotNames,
      slotBoxes,
      currentControls,
      currentControlsInDom: allCurrent.length,
      mainNavLandmarks,
      widths: {
        innerWidth: window.innerWidth,
        layoutWidth: document.documentElement.clientWidth,
        mqPhone: window.matchMedia('(max-width: 767.98px)').matches,
        mqTablet: window.matchMedia('(min-width: 768px) and (max-width: 1023.98px)').matches,
        mqDesktop: window.matchMedia('(min-width: 1024px)').matches,
      },
    };
  }) as Promise<NavStateReport>;
}

/**
 * How many tier containers are laid out — a CHEAP readiness probe.
 *
 * `measureNavState` walks every interactive descendant and reads computed
 * styles, which on a chart-heavy route costs enough that polling it in a tight
 * loop competes with the page's own hydration: two readiness polls that used it
 * exceeded 180s and then passed in 26s on retry. This looks at exactly three
 * elements, so it can be polled without perturbing what it measures.
 */
export async function countLaidOutTiers(page: Page): Promise<number> {
  return page.evaluate(() => {
    const SELECTORS = ['.bottom-nav-mobile', '.nav-rail-tablet', '.sidebar-nav'];
    let n = 0;
    for (const sel of SELECTORS) {
      const el = document.querySelector<HTMLElement>(sel);
      if (!el) continue;
      const s = getComputedStyle(el);
      if (s.display === 'none' || s.visibility === 'hidden') continue;
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) n += 1;
    }
    return n;
  });
}

/** The five primary slots, in the order the product contract fixes. */
export const EXPECTED_SLOT_ORDER = ['today', 'learn', 'practice', 'progress', 'more'] as const;
