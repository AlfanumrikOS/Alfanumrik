import { expect, type Page, type Route } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { seedCookieConsent, buildSupabaseSession } from './auth';

/**
 * Shared instrumentation for the browser-observed UI audit
 * (`e2e/ui-responsive-a11y.spec.ts`).
 *
 * ── Why this file exists ─────────────────────────────────────────────────
 * Every responsive / touch-target / bilingual / a11y / performance claim in
 * the frontend program up to 2026-08-09 was made from SOURCE INSPECTION or
 * from JSDOM unit tests. Neither can see layout: JSDOM loads no stylesheet,
 * so it can assert that a `min-h-tap-min` class string is present but never
 * that the control is 44 px tall as laid out. That gap is not theoretical —
 * a prior pass found a /progress retry button that computed to 42 px with
 * entirely correct-looking source.
 *
 * Everything here therefore measures the RENDERED result:
 *   - `measureOverflow`   → document scrollWidth vs. viewport, plus the
 *                           specific elements crossing the right edge
 *   - `measureClipping`   → elements whose text is ellipsised/clipped
 *                           (scrollWidth > clientWidth), which is how a
 *                           longer Hindi string silently loses meaning
 *   - `measureTouchTargets` → boundingBox() of every interactive control
 *   - `runAxe`            → axe-core executed in the page under test
 *   - `collectWebVitals`  → LCP / CLS / long-task TBT from real
 *                           PerformanceObserver entries
 *   - `attachDiagnostics` → console.error / pageerror / failed requests
 *
 * ── Safety ───────────────────────────────────────────────────────────────
 * `installBackendContainment()` answers every browser-originated backend
 * call (PostgREST, Edge Functions, Next.js API routes) locally. It follows
 * the containment contract established by `e2e/ui-error-states.spec.ts`:
 * layout-level endpoints get their REAL no-op body, because feeding
 * `TenantConfigProvider` a fabricated `{}` crashed the root layout and made
 * 26/26 tests fail for a reason unrelated to their assertions.
 *
 * It does NOT make a run safe on its own — `page.route()` only sees requests
 * the BROWSER makes. The dev server must be booted with neutralised
 * credentials (the CI env block in `.github/workflows/ci.yml`).
 */

/* ═══════════════════════════════════════════════════════════════════════
 * Backend containment
 * ═══════════════════════════════════════════════════════════════════════ */

export type Behaviour =
  | { kind: 'ok'; body: unknown }
  | { kind: 'fail'; status?: number };

export interface ContainmentConfig {
  /** PostgREST table reads keyed by table name. */
  tables?: Record<string, Behaviour>;
  /** PostgREST RPC calls keyed by function name. */
  rpcs?: Record<string, Behaviour>;
  /** Next.js API routes keyed by exact pathname (e.g. `/api/v2/today`). */
  apis?: Record<string, Behaviour>;
}

/**
 * Real no-op bodies for endpoints the ROOT LAYOUT fetches. See the file
 * header — a fabricated shape here takes the whole React tree down.
 */
const LAYOUT_ENDPOINTS: Record<string, unknown> = {
  // apps/host/src/app/api/tenant/config/route.ts → NO_TENANT_BODY
  '/api/tenant/config': { isTenantContext: false },
  // SchoolContext's positive `data.isSchoolContext` guard.
  '/api/school-config': { isSchoolContext: false },
};

async function serve(route: Route, behaviour: Behaviour): Promise<void> {
  if (behaviour.kind === 'fail') {
    await route.fulfill({
      status: behaviour.status ?? 500,
      contentType: 'application/json',
      body: JSON.stringify({
        code: 'E2E500',
        message: 'e2e: forced data-source failure',
        details: 'Injected by e2e/helpers/ui-audit.ts — no live backend involved.',
        hint: null,
      }),
    });
    return;
  }
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(behaviour.body),
  });
}

/**
 * Intercept every backend call the audited surfaces make.
 *
 * MUST be called BEFORE the role-session mock: Playwright resolves route
 * handlers in REVERSE registration order, so the broad `**\/rest/v1/**`
 * handler here would otherwise shadow the `students` / `get_user_role`
 * mocks and AuthContext would never resolve.
 */
export async function installBackendContainment(
  page: Page,
  cfg: ContainmentConfig = {},
): Promise<void> {
  await page.route('**/api/**', async (route) => {
    const { pathname } = new URL(route.request().url());
    const configured = cfg.apis?.[pathname];
    if (configured) {
      await serve(route, configured);
      return;
    }
    const body = Object.prototype.hasOwnProperty.call(LAYOUT_ENDPOINTS, pathname)
      ? LAYOUT_ENDPOINTS[pathname]
      : {};
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });

  await page.route('**/rest/v1/**', async (route) => {
    const { pathname } = new URL(route.request().url());
    const rpcMarker = '/rest/v1/rpc/';
    if (pathname.includes(rpcMarker)) {
      const name = pathname.slice(pathname.indexOf(rpcMarker) + rpcMarker.length);
      await serve(route, cfg.rpcs?.[name] ?? { kind: 'ok', body: [] });
      return;
    }
    const table = pathname.split('/rest/v1/')[1] ?? '';
    await serve(route, cfg.tables?.[table] ?? { kind: 'ok', body: [] });
  });

  await page.route('**/functions/v1/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
  );
}

/* ═══════════════════════════════════════════════════════════════════════
 * Teacher session (the student equivalent lives in helpers/auth.ts)
 * ═══════════════════════════════════════════════════════════════════════ */

const MOCK_TEACHER_USER_ID = 'mock-teacher-uuid-0000-0000-0000-000000000002';
const MOCK_TEACHER_ID = 'mock-teacher-id-0000-0000-0000-000000000002';

/**
 * TeacherShell and CommandCenter both gate on `activeRole === 'teacher'`
 * AND (CommandCenter) on a resolved `teacher` profile, which AuthContext
 * builds from `get_user_role().teacher` followed by a `teachers` table read.
 * Both are mocked here so no live backend is required.
 */
export async function mockTeacherSession(page: Page): Promise<void> {
  const session = buildSupabaseSession('teacher');
  session.user.id = MOCK_TEACHER_USER_ID;
  const teacher = {
    id: MOCK_TEACHER_ID,
    auth_user_id: MOCK_TEACHER_USER_ID,
    name: 'Test teacher',
    email: 'teacher@test.alfanumrik.com',
    school_name: 'E2E Public School',
    subjects: ['science'],
    grades: ['9'],
    onboarding_completed: true,
  };

  await seedCookieConsent(page);
  await page.addInitScript(
    ({ value }) => {
      const raw = JSON.stringify(value);
      window.localStorage.setItem('sb-placeholder-auth-token', raw);
      window.localStorage.setItem('alfanumrik_active_role', 'teacher');
      const AUTH_TOKEN_KEY = /^sb-[^-]+.*-auth-token$/;
      const origGet = Storage.prototype.getItem;
      Storage.prototype.getItem = function patchedGetItem(key: string) {
        const existing = origGet.call(this, key);
        if (existing === null && AUTH_TOKEN_KEY.test(key)) return raw;
        return existing;
      };
    },
    { value: session },
  );

  await page.route('**/auth/v1/token**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(session) }),
  );
  await page.route('**/auth/v1/user**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(session.user),
    }),
  );
  await page.route('**/rest/v1/rpc/get_user_role**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        roles: ['teacher'],
        primary_role: 'teacher',
        teacher: { id: MOCK_TEACHER_ID, name: teacher.name },
      }),
    }),
  );
  await page.route('**/rest/v1/teachers**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([teacher]),
    }),
  );
}

export const AUDIT_IDS = { MOCK_TEACHER_ID, MOCK_TEACHER_USER_ID };

/**
 * Re-answer the `students` read with a patched row, AFTER `mockStudentSession`
 * has installed its own handler (Playwright resolves handlers in reverse
 * registration order, so the last registration wins).
 *
 * ── Why this exists (2026-08-09) ─────────────────────────────────────────
 * The Hindi tests originally flipped the language by TAPPING the header
 * toggle, the way a student does. That turned out to be impossible: the
 * one-handed-mode toggle is painted over the language toggle on phones and
 * intercepts its pointer events, so `click()` retried for the whole 240s test
 * budget and every Hindi assertion died before measuring anything.
 *
 * Driving `preferred_language: 'hi'` instead is not a workaround around a
 * failing assertion — the collision is asserted directly and separately, and
 * this is the OTHER production path into Hindi (AuthContext seeds `language`
 * from `students.preferred_language`), i.e. the state of a student who
 * already prefers Hindi. It is the only way to measure Hindi LAYOUT while the
 * toggle is unreachable.
 */
export async function overrideStudentRow(
  page: Page,
  patch: Record<string, unknown>,
): Promise<void> {
  const base = {
    id: 'mock-student-id-0000-0000-0000-000000000001',
    auth_user_id: 'mock-user-uuid-0000-0000-0000-000000000001',
    name: 'Test student',
    grade: '9',
    board: 'CBSE',
    onboarding_completed: true,
    xp_total: 0,
    streak_days: 0,
  };
  const row = { ...base, ...patch };
  await page.route('**/rest/v1/students**', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([row]),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([{ id: row.id }]),
    });
  });
}

/* ═══════════════════════════════════════════════════════════════════════
 * Layout measurements
 * ═══════════════════════════════════════════════════════════════════════ */

export interface OverflowReport {
  scrollWidth: number;
  innerWidth: number;
  /** Elements whose right edge crosses the viewport, deepest-first. */
  offenders: Array<{ tag: string; cls: string; text: string; right: number; width: number }>;
}

/**
 * Horizontal-overflow measurement.
 *
 * `document.documentElement.scrollWidth > window.innerWidth` is the
 * device-independent symptom (the page can be panned sideways). The offender
 * list is diagnostic only — it names the specific boxes crossing the edge so
 * a failure is actionable instead of a bare number, and it filters to LEAF
 * offenders so a single overflowing chip doesn't report its twelve ancestors.
 */
export async function measureOverflow(page: Page): Promise<OverflowReport> {
  return page.evaluate(() => {
    const innerWidth = window.innerWidth;
    const all = Array.from(document.querySelectorAll<HTMLElement>('body *'));
    const crossing = all.filter((el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return false;
      const style = window.getComputedStyle(el);
      if (style.visibility === 'hidden' || style.display === 'none') return false;
      // Fixed/sticky overlays intentionally span the viewport; only count a
      // box that extends BEYOND it.
      return r.right > innerWidth + 1;
    });
    const leaves = crossing.filter((el) => !crossing.some((other) => other !== el && el.contains(other)));
    return {
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth,
      offenders: leaves.slice(0, 12).map((el) => {
        const r = el.getBoundingClientRect();
        return {
          tag: el.tagName.toLowerCase(),
          cls: String(el.className ?? '').slice(0, 120),
          text: (el.textContent ?? '').trim().slice(0, 60),
          right: Math.round(r.right),
          width: Math.round(r.width),
        };
      }),
    };
  });
}

export interface ClipReport {
  tag: string;
  cls: string;
  text: string;
  scrollWidth: number;
  clientWidth: number;
  overflowPx: number;
}

/**
 * Text that is visually cut off.
 *
 * A node whose `scrollWidth` exceeds its `clientWidth` while `overflow` is
 * hidden/clip is rendering less text than it contains — with
 * `text-overflow: ellipsis` the user sees "नमस्ते, अभि…" and the meaning is
 * gone. This is the failure mode a 20-30% longer Hindi string produces, and
 * it is invisible to any test that does not lay the page out.
 *
 * Scoped by `selector` so a caller can pin a specific region (the header)
 * rather than the whole document.
 */
export async function measureClipping(page: Page, selector = 'body'): Promise<ClipReport[]> {
  return page.evaluate((sel) => {
    const root = document.querySelector(sel);
    if (!root) return [];
    const candidates = Array.from(root.querySelectorAll<HTMLElement>('*'));
    const out: ClipReport[] = [];
    for (const el of candidates) {
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      const clips =
        style.overflowX === 'hidden' ||
        style.overflowX === 'clip' ||
        style.textOverflow === 'ellipsis';
      if (!clips) continue;
      const overflowPx = el.scrollWidth - el.clientWidth;
      if (overflowPx <= 1) continue;
      // Only report nodes that actually carry text — a clipped wrapper with
      // no own text is a layout detail, not lost meaning.
      const ownText = Array.from(el.childNodes)
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => (n.textContent ?? '').trim())
        .join(' ')
        .trim();
      if (!ownText) continue;
      out.push({
        tag: el.tagName.toLowerCase(),
        cls: String(el.className ?? '').slice(0, 120),
        text: ownText.slice(0, 80),
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
        overflowPx,
      });
    }
    return out;
  }, selector) as Promise<ClipReport[]>;
}

export interface TouchTarget {
  tag: string;
  role: string | null;
  name: string;
  cls: string;
  width: number;
  height: number;
  x: number;
  y: number;
  /** True when WCAG 2.5.8's "inline in a sentence" exception applies. */
  inlineInText: boolean;
}

/**
 * Rendered size of every interactive control, as laid out.
 *
 * The WCAG 2.5.8 (AA, 24px) / Apple HIG + repo convention (44px) target
 * applies to controls that are not inline within a block of text. The
 * `inlineInText` flag records that exception per control rather than
 * silently dropping the element, so a caller can assert on the real set and
 * still show the excluded ones in a failure message.
 */
export async function measureTouchTargets(page: Page, selector = 'body'): Promise<TouchTarget[]> {
  return page.evaluate((sel) => {
    const root = document.querySelector(sel);
    if (!root) return [];
    const INTERACTIVE =
      'button, a[href], input:not([type="hidden"]), select, textarea, summary, [role="button"], [role="link"], [role="tab"], [role="switch"], [role="checkbox"], [tabindex]:not([tabindex="-1"])';
    const els = Array.from(root.querySelectorAll<HTMLElement>(INTERACTIVE));
    const out: TouchTarget[] = [];
    const seen = new Set<HTMLElement>();
    for (const el of els) {
      if (seen.has(el)) continue;
      seen.add(el);
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue;
      if ((el as HTMLButtonElement).disabled) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      // Off-screen (collapsed drawer, hidden nav) — not currently tappable.
      if (r.bottom < 0 || r.right < 0) continue;
      const display = style.display;
      const parentIsTextFlow = !!el.parentElement &&
        /^(P|LI|SPAN|SMALL|LABEL|TD|DD|DT|FIGCAPTION)$/.test(el.parentElement.tagName);
      out.push({
        tag: el.tagName.toLowerCase(),
        role: el.getAttribute('role'),
        name: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 50),
        cls: String(el.className ?? '').slice(0, 100),
        width: Math.round(r.width * 10) / 10,
        height: Math.round(r.height * 10) / 10,
        x: Math.round(r.x),
        y: Math.round(r.y),
        inlineInText: display === 'inline' && parentIsTextFlow,
      });
    }
    return out;
  }, selector) as Promise<TouchTarget[]>;
}

/** Overlap area in px² between two rendered boxes. 0 means no collision. */
export function overlapArea(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/* ═══════════════════════════════════════════════════════════════════════
 * axe-core
 * ═══════════════════════════════════════════════════════════════════════ */

export interface AxeViolation {
  id: string;
  impact: string | null;
  help: string;
  helpUrl: string;
  nodes: Array<{ target: string[]; html: string; failureSummary: string }>;
}

/**
 * Resolve the axe-core standalone bundle without adding a dependency.
 *
 * `@axe-core/playwright` is NOT installed in this repo (checked against
 * package.json for the root, apps/host, packages/ui and packages/lib), but
 * `axe-core` itself IS present in node_modules. Injecting `axe.min.js`
 * directly is exactly what the official integration does; going through the
 * wrapper would buy nothing but a new dependency.
 *
 * Returns null when the bundle is genuinely absent so the caller can fail (or
 * skip) with a MACHINE-CHECKABLE condition — `test.skip(literal)` is banned in
 * this directory (see helpers/auth.ts).
 */
export function resolveAxeBundle(): string | null {
  let dir = process.cwd();
  for (let i = 0; i < 8; i += 1) {
    const candidate = path.join(dir, 'node_modules', 'axe-core', 'axe.min.js');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export async function runAxe(page: Page, axePath: string): Promise<AxeViolation[]> {
  await page.addScriptTag({ path: axePath });
  return page.evaluate(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const axe = (window as any).axe;
    const results = await axe.run(document, {
      resultTypes: ['violations'],
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return results.violations.map((v: any) => ({
      id: v.id,
      impact: v.impact ?? null,
      help: v.help,
      helpUrl: v.helpUrl,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      nodes: v.nodes.slice(0, 5).map((n: any) => ({
        target: n.target,
        html: String(n.html ?? '').slice(0, 200),
        failureSummary: String(n.failureSummary ?? '').slice(0, 300),
      })),
    }));
  });
}

export function summariseAxe(violations: AxeViolation[]): string {
  if (violations.length === 0) return 'no violations';
  const bySeverity = violations.reduce<Record<string, number>>((acc, v) => {
    const k = v.impact ?? 'unknown';
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {});
  const head = Object.entries(bySeverity)
    .map(([k, n]) => `${k}=${n}`)
    .join(' ');
  const detail = violations
    .map(
      (v) =>
        `  [${v.impact ?? 'unknown'}] ${v.id}: ${v.help}\n` +
        v.nodes.map((n) => `      ${n.target.join(' ')} — ${n.html}`).join('\n'),
    )
    .join('\n');
  return `${head}\n${detail}`;
}

/* ═══════════════════════════════════════════════════════════════════════
 * Core Web Vitals
 * ═══════════════════════════════════════════════════════════════════════ */

export interface WebVitals {
  /** Largest Contentful Paint, ms since navigation start. */
  lcp: number | null;
  /** Cumulative Layout Shift (unitless), excluding input-driven shifts. */
  cls: number;
  /** Total Blocking Time proxy: sum over long tasks of (duration - 50ms). */
  tbt: number;
  longTasks: number;
  /** Longest single long task, ms — the INP-risk proxy. */
  longestTask: number;
}

/**
 * Arm the observers BEFORE navigation. LCP and layout-shift entries are only
 * reliably retrievable if an observer is registered during page setup —
 * `buffered: true` recovers entries emitted before registration but only
 * within the same document.
 *
 * ⚠️ A dev-server measurement is NOT a production measurement. `next dev`
 * serves unminified, unsplit, source-mapped bundles and compiles routes on
 * demand, so LCP and TBT here are inflated by an unknown factor and must
 * never be quoted as evidence that the production targets are met. CLS is
 * the one signal that carries over reasonably: layout stability is a
 * function of reserved space, not of bundle size, so a large CLS in dev is a
 * real defect while a small CLS in dev is only weak evidence.
 */
export async function armWebVitals(page: Page): Promise<void> {
  await page.addInitScript(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    w.__cwv = { lcp: null, cls: 0, tbt: 0, longTasks: 0, longestTask: 0 };
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) w.__cwv.lcp = entry.startTime;
      }).observe({ type: 'largest-contentful-paint', buffered: true });
    } catch { /* observer type unsupported */ }
    try {
      new PerformanceObserver((list) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for (const entry of list.getEntries() as any[]) {
          if (!entry.hadRecentInput) w.__cwv.cls += entry.value;
        }
      }).observe({ type: 'layout-shift', buffered: true });
    } catch { /* observer type unsupported */ }
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          w.__cwv.longTasks += 1;
          w.__cwv.tbt += Math.max(0, entry.duration - 50);
          w.__cwv.longestTask = Math.max(w.__cwv.longestTask, entry.duration);
        }
      }).observe({ type: 'longtask', buffered: true });
    } catch { /* observer type unsupported */ }
  });
}

export async function collectWebVitals(page: Page): Promise<WebVitals> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return page.evaluate(() => (window as any).__cwv as WebVitals);
}

/* ═══════════════════════════════════════════════════════════════════════
 * Console / network hygiene
 * ═══════════════════════════════════════════════════════════════════════ */

export interface Diagnostics {
  consoleErrors: string[];
  pageErrors: string[];
  failedRequests: string[];
  httpErrors: string[];
}

/**
 * Attach listeners BEFORE `page.goto`. Returns a live-updating record.
 *
 * Under neutralised credentials the app's own Supabase calls are contained by
 * `installBackendContainment`, so anything that still lands here is either a
 * real client-side defect or a request the containment net does not cover —
 * both worth reporting.
 */
export function attachDiagnostics(page: Page): Diagnostics {
  const d: Diagnostics = {
    consoleErrors: [],
    pageErrors: [],
    failedRequests: [],
    httpErrors: [],
  };
  page.on('console', (msg) => {
    if (msg.type() === 'error') d.consoleErrors.push(msg.text().slice(0, 300));
  });
  page.on('pageerror', (err) => d.pageErrors.push((err.stack ?? err.message).slice(0, 500)));
  page.on('requestfailed', (req) => {
    d.failedRequests.push(`${req.method()} ${req.url()} — ${req.failure()?.errorText ?? 'unknown'}`);
  });
  page.on('response', (res) => {
    if (res.status() >= 400) d.httpErrors.push(`${res.status()} ${res.request().method()} ${res.url()}`);
  });
  return d;
}

/* ═══════════════════════════════════════════════════════════════════════
 * Artifacts
 * ═══════════════════════════════════════════════════════════════════════ */

export const AUDIT_ARTIFACT_DIR = path.join('test-results', 'ui-responsive-a11y');

export async function shot(page: Page, name: string): Promise<string> {
  fs.mkdirSync(AUDIT_ARTIFACT_DIR, { recursive: true });
  const file = path.join(AUDIT_ARTIFACT_DIR, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  return file;
}

export function writeJson(name: string, data: unknown): string {
  fs.mkdirSync(AUDIT_ARTIFACT_DIR, { recursive: true });
  const file = path.join(AUDIT_ARTIFACT_DIR, `${name}.json`);
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
  return file;
}

/**
 * Verbatim copy from `apps/host/src/app/global-error.tsx` — the boundary that
 * renders ONLY when the root layout itself throws. Asserting its absence
 * first converts "every locator timed out" into one accurate message naming
 * the real cause (see e2e/ui-error-states.spec.ts's 2026-08-08 incident).
 */
export const GLOBAL_ERROR_COPY = 'The app could not load. Please try again.';

export async function assertTreeAlive(page: Page, route: string): Promise<void> {
  await expect(
    page.getByText(GLOBAL_ERROR_COPY),
    `The ROOT-LAYOUT error boundary (app/global-error.tsx) rendered on ${route}. The whole ` +
      'React tree came down, so no layout measurement below means anything.',
  ).toHaveCount(0);
}
