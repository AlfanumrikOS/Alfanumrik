import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { mockStudentSession } from '../helpers/auth';

/**
 * DD-01 — Design-system visual-regression harness (Phase 1 token layer).
 *
 * Guards the design-system token contract added in commit e8b3c032 against
 * silent CSS regressions. Phase 1 introduced --radius-sm..2xl (flipping
 * ~1,916 rounded-* elements from square→rounded), darkened --text-3 to
 * #6B6053 for AA, added an AA-safe CTA gradient (--btn-primary-from/to), a
 * 12px arbitrary-type floor, and repointed brand.orange → var(--orange).
 *
 * Enforcing test for REG-237.
 *
 * DESIGN NOTE — determinism over pixels:
 *   Full-page pixel screenshots are inherently device/OS/font-render
 *   dependent (sub-pixel AA, emoji, fonts differ across CI runners), so they
 *   are captured as ARTIFACTS only (see CAPTURE below) and are NEVER the
 *   CI-gating assertion. The gate is computed-style probing of the token
 *   contract, which is device-independent: a `var(--x)` either resolves to a
 *   real value or falls back to the undefined-token fallback (transparent /
 *   0px / none). That distinction is what silently broke ~1,916 corners
 *   before Phase 1, and it is exactly what this harness pins.
 *
 * Run (public surfaces, no secrets):
 *   npm run test:e2e:visual
 * Run everything (attempts authed surfaces via mocked session):
 *   npx playwright test e2e/visual-regression
 */

/* ── Surfaces ─────────────────────────────────────────────────────────────
 * PUBLIC (no auth). `/` role-redirects unauthenticated users to /welcome via
 * src/app/page.tsx + middleware, so it lands on the real landing surface. */
const PUBLIC_SURFACES = [
  { path: '/', label: 'root (→ welcome)' },
  { path: '/pricing', label: 'pricing' },
  { path: '/login', label: 'login' },
];

/* AUTHED (best-effort via mocked Supabase session — see helpers/auth.ts).
 * The radius flip's highest blast radius is here (cards, quiz, foxy). */
const AUTHED_SURFACES = [
  { path: '/dashboard', label: 'dashboard' },
  { path: '/quiz', label: 'quiz' },
  { path: '/foxy', label: 'foxy' },
];

const VIEWPORTS = [
  { name: 'mobile', width: 375, height: 812 },
  { name: 'desktop', width: 1280, height: 800 },
];

/* ── Token contract (tailwind.config.js → CSS custom properties) ───────────
 * Every var here MUST be defined on the default (non-cosmic) :root, else the
 * mapped utility (bg-secondary / text-xp / rounded-xl / shadow-md / p-sp-4 …)
 * computes to the undefined-token fallback and is a silent no-op. */
const COLOR_TOKENS = [
  '--orange', '--purple',
  '--primary', '--primary-light', '--primary-hover',
  '--secondary', '--success', '--warning', '--info',
  '--danger', '--danger-light',
  '--surface-1', '--surface-2', '--surface-3',
  '--text-1', '--text-2', '--text-3',
  '--xp-color', '--streak-color',
  '--mastery-low', '--mastery-mid', '--mastery-high', '--level-up',
];
const RADIUS_TOKENS = ['--radius-sm', '--radius-md', '--radius-lg', '--radius-xl', '--radius-2xl'];
const SHADOW_TOKENS = ['--shadow-sm', '--shadow-md', '--shadow-lg', '--shadow-glow'];
const SPACE_TOKENS = ['--space-1', '--space-2', '--space-3', '--space-4', '--space-5', '--space-6', '--space-8', '--space-12', '--space-16'];

const ARTIFACT_DIR = path.join('test-results', 'visual');

type ProbeReport = {
  colors: Record<string, string>;   // token → resolved rgb(a) string
  radii: Record<string, string>;    // token → resolved border-radius (px)
  shadows: Record<string, string>;  // token → resolved box-shadow
  spaces: Record<string, string>;   // token → resolved padding (px)
  roundedXlClass: string;           // computed border-radius of a real `.rounded-xl` element
  brandOrange: string;              // resolved var(--orange)
  typeFloor9px: string;             // computed font-size of a `.text-[9px]` element
  contrast: {
    text3OnSurface3: number;
    btnFromOnWhite: number;
    btnToOnWhite: number;
  };
  overflow: { scrollWidth: number; clientWidth: number };
};

/**
 * Runs the entire token-contract probe inside the page. Resolves every token
 * through a REAL element property (so var() chains like --secondary→--purple
 * resolve fully), computes WCAG contrast for the AA-critical pairs, and reads
 * horizontal-overflow geometry. Pure read — mutates nothing durable.
 */
async function probeTokens(page: Page, tokens: {
  colors: string[]; radii: string[]; shadows: string[]; spaces: string[];
}): Promise<ProbeReport> {
  return page.evaluate((t) => {
    const host = document.createElement('div');
    host.style.position = 'absolute';
    host.style.left = '-9999px';
    host.style.top = '0';
    host.style.visibility = 'hidden';
    document.body.appendChild(host);

    const resolveProp = (cssProp: string, value: string): string => {
      const el = document.createElement('div');
      // camelCase CSS property (e.g. 'backgroundColor'); set then read the
      // fully-resolved computed value by camelCase index (getPropertyValue
      // would need the kebab name — indexing the CSSStyleDeclaration works
      // with the camelCase key and resolves var() chains).
      // @ts-expect-error index signature for arbitrary CSS prop
      el.style[cssProp] = value;
      host.appendChild(el);
      const cs = getComputedStyle(el);
      // @ts-expect-error index signature for arbitrary CSS prop
      const out = String(cs[cssProp] ?? '').trim();
      host.removeChild(el);
      return out;
    };

    const colors: Record<string, string> = {};
    for (const tk of t.colors) colors[tk] = resolveProp('backgroundColor', `var(${tk})`);
    const radii: Record<string, string> = {};
    for (const tk of t.radii) radii[tk] = resolveProp('borderRadius', `var(${tk})`);
    const shadows: Record<string, string> = {};
    for (const tk of t.shadows) shadows[tk] = resolveProp('boxShadow', `var(${tk})`);
    const spaces: Record<string, string> = {};
    for (const tk of t.spaces) spaces[tk] = resolveProp('paddingTop', `var(${tk})`);

    // End-to-end tailwind wiring anchor: a REAL element with the emitted
    // `.rounded-xl` utility (used ~670× so JIT always emits it).
    const rx = document.createElement('div');
    rx.className = 'rounded-xl';
    host.appendChild(rx);
    const roundedXlClass = getComputedStyle(rx).borderRadius.trim();

    // Arbitrary sub-12px type floor: `.text-[9px]` must compute to 12px.
    const tf = document.createElement('div');
    tf.className = 'text-[9px]';
    tf.textContent = 'x';
    host.appendChild(tf);
    const typeFloor9px = getComputedStyle(tf).fontSize.trim();

    const brandOrange = resolveProp('backgroundColor', 'var(--orange)');

    // WCAG contrast helpers (sRGB relative luminance).
    const parse = (c: string): [number, number, number] => {
      const m = c.match(/rgba?\(([^)]+)\)/);
      if (!m) return [0, 0, 0];
      const [r, g, b] = m[1].split(',').map((s) => parseFloat(s.trim()));
      return [r, g, b];
    };
    const lin = (v: number) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };
    const lum = (c: string) => {
      const [r, g, b] = parse(c);
      return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    };
    const ratio = (fg: string, bg: string) => {
      const a = lum(fg), b = lum(bg);
      const hi = Math.max(a, b), lo = Math.min(a, b);
      return (hi + 0.05) / (lo + 0.05);
    };

    const text3 = resolveProp('color', 'var(--text-3)');
    const surface3 = resolveProp('backgroundColor', 'var(--surface-3)');
    const btnFrom = resolveProp('backgroundColor', 'var(--btn-primary-from)');
    const btnTo = resolveProp('backgroundColor', 'var(--btn-primary-to)');
    const white = 'rgb(255, 255, 255)';

    const contrast = {
      text3OnSurface3: ratio(text3, surface3),
      btnFromOnWhite: ratio(btnFrom, white),
      btnToOnWhite: ratio(btnTo, white),
    };

    const overflow = {
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    };

    document.body.removeChild(host);
    return { colors, radii, shadows, spaces, roundedXlClass, brandOrange, typeFloor9px, contrast, overflow };
  }, tokens);
}

/** An unresolved color token computes to transparent (rgba(0,0,0,0)). */
function isTransparent(rgb: string): boolean {
  return rgb === 'rgba(0, 0, 0, 0)' || rgb === 'transparent' || rgb === '';
}

function captureScreenshot(page: Page, name: string): Promise<Buffer> {
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  return page.screenshot({ path: path.join(ARTIFACT_DIR, `${name}.png`), fullPage: true });
}

/* ════════════════════════════════════════════════════════════════════════
 * PUBLIC SURFACES — no secrets required. This is the CI gate.
 * ════════════════════════════════════════════════════════════════════════ */
test.describe('DD-01 design-system token contract — public surfaces', () => {
  for (const surface of PUBLIC_SURFACES) {
    for (const vp of VIEWPORTS) {
      test(`${surface.label} @ ${vp.name} (${vp.width}px) — tokens resolve, AA holds, no overflow`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await page.goto(surface.path, { waitUntil: 'networkidle' }).catch(() => page.goto(surface.path));
        await page.waitForLoadState('domcontentloaded');

        const report = await probeTokens(page, {
          colors: COLOR_TOKENS, radii: RADIUS_TOKENS, shadows: SHADOW_TOKENS, spaces: SPACE_TOKENS,
        });

        // Artifact only — NOT a gating assertion.
        await captureScreenshot(page, `${surface.label}-${vp.name}`);

        // (a) No color token is a silent no-op (undefined → transparent).
        for (const tk of COLOR_TOKENS) {
          expect(isTransparent(report.colors[tk]), `${tk} must resolve to a real color, got "${report.colors[tk]}"`).toBe(false);
        }
        // (b) Radius tokens resolve to a non-zero radius (the ~1,916-corner flip).
        for (const tk of RADIUS_TOKENS) {
          const px = parseFloat(report.radii[tk]);
          expect(px, `${tk} must be a non-zero radius, got "${report.radii[tk]}"`).toBeGreaterThan(0);
        }
        // (c) Shadow tokens resolve (undefined → 'none').
        for (const tk of SHADOW_TOKENS) {
          expect(report.shadows[tk], `${tk} must resolve to a real shadow`).not.toBe('none');
          expect(report.shadows[tk]).not.toBe('');
        }
        // (d) Spacing tokens resolve to non-zero padding.
        for (const tk of SPACE_TOKENS) {
          const px = parseFloat(report.spaces[tk]);
          expect(px, `${tk} must be non-zero spacing, got "${report.spaces[tk]}"`).toBeGreaterThan(0);
        }

        // (e) End-to-end: a real `.rounded-xl` element is rounded (12px), not square.
        expect(parseFloat(report.roundedXlClass), `.rounded-xl computed "${report.roundedXlClass}" — square-corner regression`).toBeCloseTo(12, 0);

        // (f) brand.orange → var(--orange) resolves to burnt-orange #E8581C.
        expect(report.brandOrange).toBe('rgb(232, 88, 28)');

        // (g) Sub-12px arbitrary type floors to 12px.
        expect(report.typeFloor9px).toBe('12px');

        // (h) WCAG AA (≥4.5:1) on the Phase-1 fixed pairs.
        expect(report.contrast.text3OnSurface3, '--text-3 on --surface-3 must clear AA 4.5:1').toBeGreaterThanOrEqual(4.5);
        expect(report.contrast.btnFromOnWhite, '--btn-primary-from on white must clear AA 4.5:1').toBeGreaterThanOrEqual(4.5);
        expect(report.contrast.btnToOnWhite, '--btn-primary-to on white must clear AA 4.5:1').toBeGreaterThanOrEqual(4.5);

        // (i) No horizontal overflow (1px sub-pixel tolerance).
        expect(report.overflow.scrollWidth, `horizontal overflow on ${surface.label} @ ${vp.name}`).toBeLessThanOrEqual(report.overflow.clientWidth + 1);
      });
    }
  }
});

/* ════════════════════════════════════════════════════════════════════════
 * AUTHED SURFACES — best-effort via mocked Supabase session.
 *
 * The radius flip's highest blast radius is on authed student surfaces. We
 * attempt a mocked-session render and, when the surface actually mounts
 * (does not bounce to /welcome|/login), run the SAME device-independent token
 * probe and capture a screenshot artifact. When the mock cannot hold the
 * route (env without a real backend often falls through to a redirect or an
 * indefinite skeleton), we SKIP with a clear message rather than fake
 * coverage — see the manual-QA steps documented in the task report.
 *
 * OPT-IN + NON-GATING: the mocked session only mounts the client SHELL (data
 * endpoints beyond `students` are unmocked, so these surfaces render as
 * skeleton/loading), and whether it beats the redirect is timing-dependent.
 * So this block is deterministically skipped unless VISUAL_AUTHED=1 and is
 * NEVER part of the `test:e2e:visual` CI gate. Real authed content QA (images
 * inside now-rounded cards, populated quiz cards) needs a seeded student
 * session — run manually (see report) or set TEST_STUDENT_EMAIL/PASSWORD.
 * ════════════════════════════════════════════════════════════════════════ */
const RUN_AUTHED = process.env.VISUAL_AUTHED === '1';
test.describe('DD-01 design-system token contract — authed surfaces (best-effort, mocked session)', () => {
  for (const surface of AUTHED_SURFACES) {
    for (const vp of VIEWPORTS) {
      test(`${surface.label} @ ${vp.name} (${vp.width}px) — radius/overflow QA`, async ({ page }) => {
        test.skip(!RUN_AUTHED, 'authed visual QA is opt-in (set VISUAL_AUTHED=1); mocked session renders skeleton only — see report for manual steps');
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await mockStudentSession(page, { onboardingCompleted: true });
        await page.goto(surface.path).catch(() => {});
        await page.waitForLoadState('domcontentloaded');
        // Give the client router a beat to either mount or bounce.
        await page.waitForTimeout(1500);

        const url = page.url();
        test.skip(/\/(welcome|login)(\?|$|\/)/.test(url),
          `mocked session did not hold ${surface.path} (landed on ${url}); authed radius QA must be done manually — see report`);

        const report = await probeTokens(page, {
          colors: COLOR_TOKENS, radii: RADIUS_TOKENS, shadows: SHADOW_TOKENS, spaces: SPACE_TOKENS,
        });
        await captureScreenshot(page, `authed-${surface.label}-${vp.name}`);

        // Token contract holds identically on authed surfaces.
        for (const tk of RADIUS_TOKENS) {
          expect(parseFloat(report.radii[tk]), `${tk} on ${surface.label}`).toBeGreaterThan(0);
        }
        expect(parseFloat(report.roundedXlClass)).toBeCloseTo(12, 0);
        // No horizontal overflow on the authed surface (broken-card canary).
        expect(report.overflow.scrollWidth, `horizontal overflow on authed ${surface.label} @ ${vp.name}`).toBeLessThanOrEqual(report.overflow.clientWidth + 1);
      });
    }
  }
});
