import { test, expect, type Page, type Route } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { mockStudentSession } from './helpers/auth';

/**
 * Honest data-state contract for the student surfaces (/progress, /learn,
 * /exam-prep, QuizSetup) — browser-level enforcement.
 *
 * ── What defect this exists to catch ─────────────────────────────────────
 * Every surface below used to render its REASSURING EMPTY STATE when a fetch
 * FAILED. A student whose knowledge-gap query 500'd was told "No knowledge
 * gaps detected!" — a clean bill of academic health the app had no evidence
 * for. A student whose profile read failed was told "Your progress will show
 * up here", i.e. that their history did not exist. Those are not cosmetic
 * bugs: they are the app asserting facts about a child's learning that it
 * does not know.
 *
 * The repair introduced three distinct states per source — error / pending /
 * empty — and the invariant this spec pins is:
 *
 *   A reassuring empty state may render ONLY when the fetch that summarises
 *   it actually succeeded and actually returned nothing.
 *
 * Each test therefore asserts BOTH directions:
 *   forward  — request fails  → honest error card, reassuring copy ABSENT
 *   reverse  — request succeeds and is genuinely empty → reassuring copy
 *              present, error card ABSENT
 * A one-directional test would pass against a page that simply never shows
 * the empty state at all, which is a different (and also wrong) product.
 *
 * ── Why this is browser-level and not (only) a unit test ─────────────────
 * `apps/host/src/__tests__/app/progress-data-load-error.test.tsx` and its
 * siblings already assert the render logic against a mocked module boundary.
 * What they CANNOT reach, and what this spec adds, is:
 *   1. the real client → PostgREST/Next-API request path (the failure is
 *      injected as a real HTTP 500 on the wire, not as a stubbed return value),
 *   2. real layout — `boundingBox()` proves the retry control is genuinely
 *      >= 44x44 CSS px as rendered, at nine real viewports, rather than
 *      proving a class string is present in the markup,
 *   3. the a11y contract as the accessibility tree actually exposes it
 *      (`getByRole('alert')` / `[role="status"][aria-busy="true"]`).
 *
 * ── Safety: this spec touches NO live backend ────────────────────────────
 * `installStudentBackend()` intercepts EVERY `**\/rest/v1/**` (PostgREST) and
 * `**\/functions/v1/**` (Edge Function) request plus the two Next.js API
 * routes these surfaces call, and `mockStudentSession({ anyProjectRef: true })`
 * intercepts the Supabase auth endpoints. No request reaches a Supabase
 * project, no row is read or written, no fixture student is required and no
 * secret is needed. There is no Razorpay surface in this file at all.
 *
 * IMPORTANT ORDERING (same rule as e2e/helpers/quiz-backend.ts): Playwright
 * resolves route handlers in REVERSE registration order, so
 * `installStudentBackend()` must be called BEFORE `mockStudentSession()` —
 * otherwise the broad `**\/rest/v1/**` handler shadows the `students` /
 * `get_user_role` mocks and AuthContext never resolves.
 *
 * Run: npx playwright test e2e/ui-error-states.spec.ts
 */

/* ── Copy under test ──────────────────────────────────────────────────────
 * Pinned verbatim from the components so a silent copy change is a failing
 * test rather than a silently-unasserted one. */
const COPY = {
  progress: {
    coreError: "Couldn't load your progress",
    corePending: 'Loading your progress…',
    coreEmpty: 'Your progress will show up here',
    perfError: "Couldn't load your Performance Score",
    perfEmptyPromise: 'Performance Score will be calculated soon',
    gapsError: "Couldn't check your knowledge gaps",
    gapsPending: 'Checking your knowledge gaps…',
    gapsEmpty: 'No knowledge gaps detected!',
    deepAnalysisTab: 'Deep Analysis',
    // Substring, not anchored: the rendered accessible name carries a leading
    // 🔄 glyph, and anchoring on the emoji makes the locator hostage to an
    // icon change that is not what this test is about. `/retry/i` is still
    // unambiguous here — the stale-refresh control says "Refresh", the tabs
    // say Overview / Deep Analysis, and the header control is "Go back".
    retry: /retry/i,
  },
  learn: {
    error: "Couldn't load chapters",
    empty: 'No chapters available yet',
    retry: /try again/i,
    subjectPrompt: /Choose a subject to study/i,
  },
  examPrep: {
    error: "Couldn't load your study plan",
    generateCta: /Generate My Study Plan/i,
  },
  quizSetup: {
    notice: /Couldn't load chapters right now/i,
    empty: /No chapters available for this subject yet/i,
    practiceMode: /practice mode/i,
    startQuiz: /start .*quiz/i,
  },
  // Second half of the frontend-honesty sweep (2026-08-09).
  notifications: {
    error: 'Failed to load notifications',
    empty: 'No notifications yet',
    retry: /retry/i,
  },
  leaderboard: {
    error: 'Failed to load data',
    empty: 'No rankings yet',
    retry: /retry/i,
  },
} as const;

/** The nine viewports the student surfaces must survive. */
const VIEWPORTS = [
  { name: '320x568', width: 320, height: 568 },
  { name: '360x800', width: 360, height: 800 },
  { name: '390x844', width: 390, height: 844 },
  { name: '412x915', width: 412, height: 915 },
  { name: '768x1024', width: 768, height: 1024 },
  { name: '1024x768', width: 1024, height: 768 },
  { name: '1280x800', width: 1280, height: 800 },
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1920x1080', width: 1920, height: 1080 },
] as const;

const ARTIFACT_DIR = path.join('test-results', 'ui-error-states');

/** WCAG 2.5.8 / repo convention: every interactive control is >= 44x44 px. */
const MIN_TOUCH_TARGET_PX = 44;

/**
 * PostgREST-shaped error body. The `code` deliberately is NOT `PGRST116`:
 * several loaders treat PGRST116 (".single() matched no rows") as the
 * legitimate empty case rather than a failure, so using it here would inject
 * a success, not a failure.
 */
const FORCED_ERROR_BODY = {
  code: 'E2E500',
  message: 'e2e: forced data-source failure',
  details: 'Injected by e2e/ui-error-states.spec.ts via page.route() — no live backend involved.',
  hint: null,
};

/* ── Fixtures ─────────────────────────────────────────────────────────── */

const SCIENCE_SUBJECT = {
  code: 'science',
  name: 'Science',
  nameHi: 'विज्ञान',
  icon: '🔬',
  color: '#22C55E',
  subjectKind: 'cbse_core',
  isCore: true,
  isLocked: false,
};

/** A student with real history — so /progress must NOT take the first-run branch. */
const RETURNING_PROFILE = {
  id: 'e2e-profile-1',
  student_id: 'mock-student-id-0000-0000-0000-000000000001',
  subject: 'science',
  xp: 320,
  total_sessions: 12,
  total_time_minutes: 140,
  total_questions_asked: 100,
  total_questions_answered_correctly: 71,
};

const SCIENCE_SUBJECT_ROW = {
  id: 'e2e-subject-1',
  code: 'science',
  name: 'Science',
  name_hi: 'विज्ञान',
  is_active: true,
  display_order: 1,
};

/* ── Route behaviours ─────────────────────────────────────────────────── */

type Behaviour =
  | { kind: 'ok'; body: unknown }
  | { kind: 'fail'; status?: number }
  /** Never answers until `until` resolves — used to pin the pending state. */
  | { kind: 'hold'; until: Promise<void>; thenBody?: unknown };

/** A promise the test can release, so a held route can never hang teardown. */
function deferred(): { promise: Promise<void>; release: () => void } {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

async function serve(route: Route, behaviour: Behaviour): Promise<void> {
  if (behaviour.kind === 'hold') {
    await behaviour.until;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(behaviour.thenBody ?? []),
    });
    return;
  }
  if (behaviour.kind === 'fail') {
    await route.fulfill({
      status: behaviour.status ?? 500,
      contentType: 'application/json',
      body: JSON.stringify(FORCED_ERROR_BODY),
    });
    return;
  }
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(behaviour.body),
  });
}

interface BackendConfig {
  /** PostgREST table reads, keyed by table name (e.g. `performance_scores`). */
  tables?: Record<string, Behaviour>;
  /** PostgREST RPC calls, keyed by function name (e.g. `get_knowledge_gaps`). */
  rpcs?: Record<string, Behaviour>;
  /** GET /api/student/subjects (useAllowedSubjects). */
  subjects?: Behaviour;
  /** GET /api/student/chapters (getChaptersForSubject). */
  chapters?: Behaviour;
}

/**
 * Intercept every backend call these surfaces make. Anything not named in
 * `cfg` resolves as an empty, successful read — so a source the test is not
 * exercising can never accidentally render its own error card and pollute the
 * assertion, and can never reach a real network.
 *
 * MUST be called BEFORE `mockStudentSession()` (see the file header).
 */
async function installStudentBackend(page: Page, cfg: BackendConfig = {}): Promise<void> {
  // Registered FIRST (= considered LAST) so the specific handlers below win.
  // This is a containment guarantee, not a fixture: any Next.js API route one
  // of these surfaces calls opportunistically (rhythm, pulse, feature-flag
  // checks, learner-state writers) is answered here instead of being executed
  // by the dev server against whatever backend that server is bound to.
  //
  // It does NOT make the run safe on its own. page.route() only sees requests
  // the BROWSER makes; anything the Next.js server does with its own ambient
  // env (e.g. /api/v1/health authenticating against api.razorpay.com) is
  // invisible to it. Boot the dev server with neutralised credentials.
  //
  // ── Why the catch-all is not a bare `{}` (2026-08-08) ──────────────────
  // It used to be. `{}` is not a shape any of these endpoints can actually
  // return, and answering a ROOT-LAYOUT endpoint with a fabricated shape does
  // not test the page — it tests the layout's tolerance for a response that
  // cannot occur. `/api/tenant/config` is fetched by TenantConfigProvider in
  // the root layout; fed `{}` it crashed on mount, React unwound past the
  // layout's <ErrorBoundary> (which only wraps `children`), and every one of
  // this file's tests saw `app/global-error.tsx` — "Something went wrong" —
  // instead of the surface under test. 26/26 failed for a reason that had
  // nothing to do with the assertions.
  //
  // So: layout-level endpoints get their REAL no-op shape (the exact body the
  // route returns for a non-tenant B2C visitor, which is what localhost is),
  // and only genuinely unknown routes fall through to `{}`.
  const LAYOUT_ENDPOINTS: Record<string, unknown> = {
    // apps/host/src/app/api/tenant/config/route.ts → NO_TENANT_BODY
    '/api/tenant/config': { isTenantContext: false },
    // /api/school-config → SchoolContext's positive `data.isSchoolContext`
    // guard. It only fetches on a subdomain host so localhost never hits it;
    // pinned anyway so the containment net stays shape-honest.
    '/api/school-config': { isSchoolContext: false },
  };
  await page.route('**/api/**', (route) => {
    const { pathname } = new URL(route.request().url());
    const body = Object.prototype.hasOwnProperty.call(LAYOUT_ENDPOINTS, pathname)
      ? LAYOUT_ENDPOINTS[pathname]
      : {};
    return route.fulfill({
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

  // Edge Functions (quiz-generator etc.) — never reached by these surfaces,
  // stubbed so a stray call cannot leave the browser.
  await page.route('**/functions/v1/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
  );

  await page.route('**/api/student/subjects**', (route) =>
    serve(route, cfg.subjects ?? { kind: 'ok', body: { subjects: [SCIENCE_SUBJECT] } }),
  );

  await page.route('**/api/student/chapters**', (route) =>
    serve(route, cfg.chapters ?? { kind: 'ok', body: { chapters: [] } }),
  );
}

/**
 * Verbatim copy from `apps/host/src/app/global-error.tsx` — the boundary that
 * renders ONLY when the root layout itself (a provider, not a page) throws.
 * Distinct from `app/error.tsx`, whose heading is an <h2> next to a 🦊 and
 * whose body reads "Foxy ran into a problem loading this page."
 */
const GLOBAL_ERROR_COPY = 'The app could not load. Please try again.';

/**
 * Install the mocked session and land on `route`, failing with a diagnostic
 * (rather than a mystery locator timeout) if the auth gate bounced us or the
 * whole React tree came down.
 *
 * ── Why the global-error assertion is here (2026-08-08) ──────────────────
 * On the first run of this file all 26 tests failed with the SAME page
 * snapshot: `global-error.tsx`. Every assertion below had timed out looking
 * for a per-source error card on a page whose entire tree had unmounted, and
 * the reported symptom ("expected role=alert, found nothing") pointed at the
 * error-state work rather than at the actual cause — a TypeError in
 * TenantConfigProvider. Checking for the global boundary FIRST converts that
 * whole failure class from N misleading locator timeouts into one accurate
 * message naming the real boundary.
 */
async function gotoAuthed(page: Page, route: string): Promise<void> {
  // page.on('pageerror') is the only channel that carries the real exception;
  // the DOM snapshot of global-error.tsx deliberately shows the user nothing.
  const uncaught: string[] = [];
  page.on('pageerror', (err) => uncaught.push(err.stack ?? err.message));

  await mockStudentSession(page, { anyProjectRef: true });
  await page.goto(route);
  await page.waitForLoadState('domcontentloaded');
  await expect
    .poll(() => page.url(), {
      timeout: 20_000,
      message:
        `Expected to stay on ${route} with the mocked student session, but the page ` +
        'navigated away. The mocked session resolves via helpers/auth.ts ' +
        '`anyProjectRef: true` (a localStorage read shim), so this means the auth ' +
        'contract changed — not that a fixture is missing.',
    })
    .not.toMatch(/\/(login|welcome|onboarding)(\?|$)/);

  await expect(
    page.getByText(GLOBAL_ERROR_COPY),
    `The ROOT-LAYOUT error boundary (app/global-error.tsx) rendered on ${route}, so the ` +
      'whole React tree came down and no per-source error card could ever appear. This is ' +
      'NOT an assertion problem in this file — a provider mounted OUTSIDE the layout\'s ' +
      '<ErrorBoundary> threw during mount. Uncaught exception(s) below:\n' +
      (uncaught.join('\n---\n') || '(none captured — check the browser console)'),
  ).toHaveCount(0);
}

/** Rendered size of a control, as laid out — not the declared class string. */
async function boxOf(page: Page, name: RegExp | string) {
  const control = page.getByRole('button', { name }).first();
  await expect(control).toBeVisible();
  const box = await control.boundingBox();
  expect(box, 'retry control must have a rendered bounding box').not.toBeNull();
  return box!;
}

async function screenshot(page: Page, name: string): Promise<void> {
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(ARTIFACT_DIR, `${name}.png`), fullPage: true });
}

/* ═══════════════════════════════════════════════════════════════════════
 * /progress — core (subject profiles)
 * ═══════════════════════════════════════════════════════════════════════ */

test.describe('/progress — core profile load', () => {
  test('a failed profile read renders the honest error card, never the first-run empty state', async ({
    page,
  }) => {
    await installStudentBackend(page, {
      tables: { student_learning_profiles: { kind: 'fail' } },
    });
    await gotoAuthed(page, '/progress');

    const alert = page.getByRole('alert').filter({ hasText: COPY.progress.coreError });
    await expect(alert).toBeVisible({ timeout: 20_000 });

    // The load-bearing negative: a failed read must never be reported to the
    // student as "you have no history".
    await expect(page.getByText(COPY.progress.coreEmpty)).toHaveCount(0);
    // ...nor as an accuracy number derived from zero rows.
    await expect(alert).toContainText(/Your progress is safe/i);
  });

  test('a successful read with genuinely no history renders the first-run empty state and no error card', async ({
    page,
  }) => {
    // Reverse direction. Without this, a page that simply never renders the
    // welcome card would pass the test above.
    await installStudentBackend(page, {
      tables: {
        student_learning_profiles: { kind: 'ok', body: [] },
        subjects: { kind: 'ok', body: [SCIENCE_SUBJECT_ROW] },
      },
    });
    await gotoAuthed(page, '/progress');

    await expect(page.getByText(COPY.progress.coreEmpty)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(COPY.progress.coreError)).toHaveCount(0);
  });

  test('while the profile read is in flight the pending state is announced and neither empty nor error copy shows', async ({
    page,
  }) => {
    const gate = deferred();
    await installStudentBackend(page, {
      tables: {
        student_learning_profiles: {
          kind: 'hold',
          until: gate.promise,
          thenBody: [RETURNING_PROFILE],
        },
        subjects: { kind: 'ok', body: [SCIENCE_SUBJECT_ROW] },
      },
    });
    await gotoAuthed(page, '/progress');

    // WCAG 2.2 AA 4.1.3: the shimmer alone is invisible to a screen reader.
    const pending = page.locator('[role="status"][aria-busy="true"]').filter({
      hasText: COPY.progress.corePending,
    });
    await expect(pending).toBeVisible({ timeout: 20_000 });

    // "Not yet known" is neither "nothing" nor "broken".
    await expect(page.getByText(COPY.progress.coreEmpty)).toHaveCount(0);
    await expect(page.getByText(COPY.progress.coreError)).toHaveCount(0);

    gate.release();
    await expect(pending).toHaveCount(0, { timeout: 20_000 });
  });

  test('the error card retry control is a real 44px target with an accessible name', async ({
    page,
  }) => {
    await installStudentBackend(page, {
      tables: { student_learning_profiles: { kind: 'fail' } },
    });
    await gotoAuthed(page, '/progress');
    await expect(page.getByText(COPY.progress.coreError)).toBeVisible({ timeout: 20_000 });

    const box = await boxOf(page, COPY.progress.retry);
    expect(box.height, 'retry height').toBeGreaterThanOrEqual(MIN_TOUCH_TARGET_PX);
    expect(box.width, 'retry width').toBeGreaterThanOrEqual(MIN_TOUCH_TARGET_PX);

    const name = await page.getByRole('button', { name: COPY.progress.retry }).first().textContent();
    expect((name ?? '').trim().length, 'retry control must have an accessible name').toBeGreaterThan(0);
  });
});

/* ═══════════════════════════════════════════════════════════════════════
 * /progress — knowledge gaps (the highest-stakes reassuring empty)
 * ═══════════════════════════════════════════════════════════════════════ */

test.describe('/progress — knowledge gaps', () => {
  /** Reach the Deep Analysis tab, where the gaps section lives. */
  async function openDeepAnalysis(page: Page): Promise<void> {
    await page.getByRole('button', { name: COPY.progress.deepAnalysisTab }).click();
  }

  test('a failed gap check is never reported as a clean bill of health', async ({ page }) => {
    await installStudentBackend(page, {
      tables: {
        student_learning_profiles: { kind: 'ok', body: [RETURNING_PROFILE] },
        subjects: { kind: 'ok', body: [SCIENCE_SUBJECT_ROW] },
      },
      rpcs: { get_knowledge_gaps: { kind: 'fail' } },
    });
    await gotoAuthed(page, '/progress');
    await openDeepAnalysis(page);

    await expect(
      page.getByRole('alert').filter({ hasText: COPY.progress.gapsError }),
    ).toBeVisible({ timeout: 20_000 });

    // THE defect: telling a student their academics are clear because a
    // request failed.
    await expect(page.getByText(COPY.progress.gapsEmpty)).toHaveCount(0);
  });

  test('a successful gap check that finds nothing does render the clean bill of health', async ({
    page,
  }) => {
    await installStudentBackend(page, {
      tables: {
        student_learning_profiles: { kind: 'ok', body: [RETURNING_PROFILE] },
        subjects: { kind: 'ok', body: [SCIENCE_SUBJECT_ROW] },
      },
      rpcs: { get_knowledge_gaps: { kind: 'ok', body: [] } },
    });
    await gotoAuthed(page, '/progress');
    await openDeepAnalysis(page);

    await expect(page.getByText(COPY.progress.gapsEmpty)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(COPY.progress.gapsError)).toHaveCount(0);
  });

  test('while the gap check is in flight neither the all-clear nor the error card shows', async ({
    page,
  }) => {
    const gate = deferred();
    await installStudentBackend(page, {
      tables: {
        student_learning_profiles: { kind: 'ok', body: [RETURNING_PROFILE] },
        subjects: { kind: 'ok', body: [SCIENCE_SUBJECT_ROW] },
      },
      rpcs: { get_knowledge_gaps: { kind: 'hold', until: gate.promise, thenBody: [] } },
    });
    await gotoAuthed(page, '/progress');
    await openDeepAnalysis(page);

    const pending = page.locator('[role="status"][aria-busy="true"]').filter({
      hasText: COPY.progress.gapsPending,
    });
    await expect(pending).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(COPY.progress.gapsEmpty)).toHaveCount(0);
    await expect(page.getByText(COPY.progress.gapsError)).toHaveCount(0);

    gate.release();
    await expect(page.getByText(COPY.progress.gapsEmpty)).toBeVisible({ timeout: 20_000 });
  });
});

/* ═══════════════════════════════════════════════════════════════════════
 * /progress — Performance Score
 * ═══════════════════════════════════════════════════════════════════════ */

test.describe('/progress — Performance Score', () => {
  test('a failed first load never renders the "will be calculated soon" promise', async ({
    page,
  }) => {
    // "Performance Score will be calculated soon" is a promise the app can
    // only make once it KNOWS there is no score row. After a 500 it knows
    // nothing.
    await installStudentBackend(page, {
      tables: {
        student_learning_profiles: { kind: 'ok', body: [RETURNING_PROFILE] },
        subjects: { kind: 'ok', body: [SCIENCE_SUBJECT_ROW] },
        performance_scores: { kind: 'fail' },
      },
    });
    await gotoAuthed(page, '/progress');

    await expect(
      page.getByRole('alert').filter({ hasText: COPY.progress.perfError }),
    ).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(COPY.progress.perfEmptyPromise)).toHaveCount(0);
  });

  test('an unknown coin balance is never rendered as a confident zero', async ({ page }) => {
    // The header coin chip is hidden until the balance is actually known;
    // a failed read must not produce "0 coins".
    await installStudentBackend(page, {
      tables: {
        student_learning_profiles: { kind: 'ok', body: [RETURNING_PROFILE] },
        subjects: { kind: 'ok', body: [SCIENCE_SUBJECT_ROW] },
        coin_balances: { kind: 'fail' },
      },
    });
    await gotoAuthed(page, '/progress');

    const header = page.locator('header').first();
    await expect(header).toBeVisible({ timeout: 20_000 });
    await expect(header.getByText(/^0$/)).toHaveCount(0);
  });
});

/* ═══════════════════════════════════════════════════════════════════════
 * /learn — chapter list
 * ═══════════════════════════════════════════════════════════════════════ */

test.describe('/learn — chapter list', () => {
  async function pickScience(page: Page): Promise<void> {
    await expect(page.getByText(COPY.learn.subjectPrompt)).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: /Science/i }).first().click();
  }

  test('a failed chapter read never claims the syllabus is empty', async ({ page }) => {
    await installStudentBackend(page, { chapters: { kind: 'fail' } });
    await gotoAuthed(page, '/learn');
    await pickScience(page);

    await expect(
      page.getByRole('alert').filter({ hasText: COPY.learn.error }),
    ).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(COPY.learn.empty)).toHaveCount(0);
    // The copy must actively disown the wrong inference, not just be neutral.
    await expect(page.getByText(/doesn't mean your course is empty/i)).toBeVisible();
  });

  test('the chapter-failure retry control is a real 44px target', async ({ page }) => {
    await installStudentBackend(page, { chapters: { kind: 'fail' } });
    await gotoAuthed(page, '/learn');
    await pickScience(page);
    await expect(page.getByText(COPY.learn.error)).toBeVisible({ timeout: 20_000 });

    const box = await boxOf(page, COPY.learn.retry);
    expect(box.height, 'try-again height').toBeGreaterThanOrEqual(MIN_TOUCH_TARGET_PX);
    expect(box.width, 'try-again width').toBeGreaterThanOrEqual(MIN_TOUCH_TARGET_PX);
  });

  test('a successful read of a genuinely empty syllabus does render the empty state', async ({
    page,
  }) => {
    await installStudentBackend(page, { chapters: { kind: 'ok', body: { chapters: [] } } });
    await gotoAuthed(page, '/learn');
    await pickScience(page);

    await expect(page.getByText(COPY.learn.empty)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(COPY.learn.error)).toHaveCount(0);
  });
});

/* ═══════════════════════════════════════════════════════════════════════
 * /exam-prep — study plan
 * ═══════════════════════════════════════════════════════════════════════ */

test.describe('/exam-prep — study plan', () => {
  test('a failed plan read never drops the student into the generate flow', async ({ page }) => {
    // Falling through to "generate a plan" after a 500 tells a student who HAS
    // a plan that they have none — and invites them to overwrite it.
    await installStudentBackend(page, {
      rpcs: { get_study_plan: { kind: 'fail' } },
      tables: { study_plans: { kind: 'fail' } },
    });
    await gotoAuthed(page, '/exam-prep');

    await expect(
      page.getByRole('alert').filter({ hasText: COPY.examPrep.error }),
    ).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('button', { name: COPY.examPrep.generateCta })).toHaveCount(0);
    await expect(page.getByText(/doesn't mean you have no plan/i)).toBeVisible();
  });

  test('the plan-failure recovery controls are real 44px targets', async ({ page }) => {
    await installStudentBackend(page, {
      rpcs: { get_study_plan: { kind: 'fail' } },
      tables: { study_plans: { kind: 'fail' } },
    });
    await gotoAuthed(page, '/exam-prep');
    await expect(page.getByText(COPY.examPrep.error)).toBeVisible({ timeout: 20_000 });

    for (const label of [/try again/i, /create a new plan/i]) {
      const box = await boxOf(page, label);
      expect(box.height, `${label} height`).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET_PX);
      expect(box.width, `${label} width`).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET_PX);
    }
  });

  test('a successful read showing genuinely no plan does render the generate flow', async ({
    page,
  }) => {
    await installStudentBackend(page, {
      rpcs: { get_study_plan: { kind: 'ok', body: { has_plan: false } } },
    });
    await gotoAuthed(page, '/exam-prep');

    await expect(page.getByRole('button', { name: COPY.examPrep.generateCta })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText(COPY.examPrep.error)).toHaveCount(0);
  });
});

/* ═══════════════════════════════════════════════════════════════════════
 * QuizSetup — chapter picker
 * ═══════════════════════════════════════════════════════════════════════ */

test.describe('QuizSetup — chapter picker', () => {
  async function openChapterStep(page: Page): Promise<void> {
    await page.getByRole('button', { name: COPY.quizSetup.practiceMode }).click();
    await page.getByRole('button', { name: /science/i }).first().click();
  }

  test('a failed chapter read is a notice, not a dead end, and never claims the subject has no chapters', async ({
    page,
  }) => {
    await installStudentBackend(page, { chapters: { kind: 'fail' } });
    await gotoAuthed(page, '/quiz');
    await openChapterStep(page);

    const notice = page.locator('[role="status"]').filter({ hasText: COPY.quizSetup.notice });
    await expect(notice).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(COPY.quizSetup.empty)).toHaveCount(0);

    // Chapter selection is optional, so a chapter-read failure must NOT block
    // the student from starting an all-chapters quiz.
    await expect(page.getByRole('button', { name: COPY.quizSetup.startQuiz })).toBeEnabled();
  });

  test('a successful read of a subject with genuinely no chapters does render the empty copy', async ({
    page,
  }) => {
    await installStudentBackend(page, { chapters: { kind: 'ok', body: { chapters: [] } } });
    await gotoAuthed(page, '/quiz');
    await openChapterStep(page);

    await expect(page.getByText(COPY.quizSetup.empty)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(COPY.quizSetup.notice)).toHaveCount(0);
  });
});

/* ═══════════════════════════════════════════════════════════════════════
 * /notifications and /leaderboard — second half of the sweep (2026-08-09)
 *
 * The TODO(backend) that deferred the remaining supabase.ts read helpers said
 * "None of them currently feeds a surface that turns emptiness into a
 * reassuring CLAIM." Quality review disproved that: getStudentNotifications
 * fed "No notifications yet" after a failed RPC, and getLeaderboard fed
 * "No rankings yet". Both helpers now return ServiceResult and both pages gate
 * their reassuring empty on the absence of an error.
 *
 * The unit layer (notifications-mark-all-read-failure.test.tsx,
 * leaderboard-data-load-error.test.tsx) can only assert the DECLARED
 * min-h/min-w classes — JSDOM loads no stylesheet. This is the layer that
 * measures the control as laid out, which is what caught /progress at 42px.
 * ═══════════════════════════════════════════════════════════════════════ */

test.describe('/notifications — inbox load', () => {
  test('a failed read never claims the student has no notifications', async ({ page }) => {
    await installStudentBackend(page, {
      rpcs: { get_student_notifications: { kind: 'fail' } },
    });
    await gotoAuthed(page, '/notifications');

    await expect(
      page.getByRole('alert').filter({ hasText: COPY.notifications.error }),
    ).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(COPY.notifications.empty)).toHaveCount(0);
  });

  test('the inbox-failure retry control is a real 44px target', async ({ page }) => {
    await installStudentBackend(page, {
      rpcs: { get_student_notifications: { kind: 'fail' } },
    });
    await gotoAuthed(page, '/notifications');
    await expect(page.getByText(COPY.notifications.error)).toBeVisible({ timeout: 20_000 });

    const box = await boxOf(page, COPY.notifications.retry);
    expect(box.height, 'notifications retry height').toBeGreaterThanOrEqual(MIN_TOUCH_TARGET_PX);
    expect(box.width, 'notifications retry width').toBeGreaterThanOrEqual(MIN_TOUCH_TARGET_PX);
  });

  test('a successful read of a genuinely empty inbox does render the empty state', async ({
    page,
  }) => {
    await installStudentBackend(page, {
      rpcs: {
        get_student_notifications: { kind: 'ok', body: { unread_count: 0, notifications: [] } },
      },
    });
    await gotoAuthed(page, '/notifications');

    await expect(page.getByText(COPY.notifications.empty)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(COPY.notifications.error)).toHaveCount(0);
  });
});

test.describe('/leaderboard — rankings load', () => {
  test('a failed read never claims there are no rankings', async ({ page }) => {
    // getLeaderboard degrades RPC → students table, so BOTH must fail for the
    // read to be a failure rather than a fallback.
    await installStudentBackend(page, {
      rpcs: { get_leaderboard: { kind: 'fail' } },
      tables: { students: { kind: 'fail' } },
    });
    await gotoAuthed(page, '/leaderboard');

    await expect(
      page.getByRole('alert').filter({ hasText: COPY.leaderboard.error }),
    ).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(COPY.leaderboard.empty)).toHaveCount(0);
  });

  test('the rankings-failure retry control is a real 44px target', async ({ page }) => {
    await installStudentBackend(page, {
      rpcs: { get_leaderboard: { kind: 'fail' } },
      tables: { students: { kind: 'fail' } },
    });
    await gotoAuthed(page, '/leaderboard');
    await expect(page.getByText(COPY.leaderboard.error)).toBeVisible({ timeout: 20_000 });

    const box = await boxOf(page, COPY.leaderboard.retry);
    expect(box.height, 'leaderboard retry height').toBeGreaterThanOrEqual(MIN_TOUCH_TARGET_PX);
    expect(box.width, 'leaderboard retry width').toBeGreaterThanOrEqual(MIN_TOUCH_TARGET_PX);
  });

  test('a successful read of a genuinely empty board does render the empty state', async ({
    page,
  }) => {
    await installStudentBackend(page, {
      rpcs: { get_leaderboard: { kind: 'ok', body: [] } },
    });
    await gotoAuthed(page, '/leaderboard');

    await expect(page.getByText(COPY.leaderboard.empty)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(COPY.leaderboard.error)).toHaveCount(0);
  });
});

/* ═══════════════════════════════════════════════════════════════════════
 * Viewport sweep — /progress in its never-before-rendered failure state
 *
 * One test per viewport (not one test looping nine viewports) so a single
 * breakpoint failing is reported as a single failure with its own trace and
 * its own screenshot, instead of masking the eight that follow it.
 *
 * The screenshots are artifacts, never the assertion — pixel comparison is
 * OS/font-render dependent (same rationale as
 * e2e/visual-regression/design-system-tokens.spec.ts). The GATE at every
 * viewport is the same three device-independent properties: the honest error
 * renders, the reassuring lie does not, and the recovery control is tappable.
 * ═══════════════════════════════════════════════════════════════════════ */

test.describe('/progress error state — viewport sweep', () => {
  for (const vp of VIEWPORTS) {
    test(`core-failure state holds at ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await installStudentBackend(page, {
        tables: { student_learning_profiles: { kind: 'fail' } },
      });
      await gotoAuthed(page, '/progress');

      await expect(
        page.getByRole('alert').filter({ hasText: COPY.progress.coreError }),
      ).toBeVisible({ timeout: 20_000 });

      await screenshot(page, `progress-core-error-${vp.name}`);

      await expect(page.getByText(COPY.progress.coreEmpty)).toHaveCount(0);

      const box = await boxOf(page, COPY.progress.retry);
      expect(box.height, `retry height @ ${vp.name}`).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET_PX);
      expect(box.width, `retry width @ ${vp.name}`).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET_PX);
      // The recovery control must be reachable inside the viewport, not
      // pushed off the right edge by the narrowest breakpoint.
      expect(box.x + box.width, `retry right edge @ ${vp.name}`).toBeLessThanOrEqual(vp.width);
    });
  }
});
