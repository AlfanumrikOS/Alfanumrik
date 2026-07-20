import { defineConfig, devices } from '@playwright/test';

const certificationBaseURL =
  process.env.CERTIFICATION_RUN_ENABLED === 'true'
    ? process.env.CERTIFICATION_BASE_URL
    : undefined;
const configuredBaseURL = process.env.BASE_URL || certificationBaseURL;
const localBaseURL = 'http://localhost:3000';
// CI run against an in-job server (the advisory `e2e` job sets
// BASE_URL=http://127.0.0.1:3000 and serves the built standalone artifact).
// Distinct from (a) local dev runs (no BASE_URL → dev server, slow cold
// compiles) and (b) CI runs against a deployed target
// (e2e-critical-paths → https://alfanumrik.com, network latency), both of
// which keep the historical 90s budget.
const isCiLocalServerRun =
  !!process.env.CI && /^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(configuredBaseURL || '');
const expectV3ProductionDenial = process.env.V3_EXPECT_PREVIEW_404 === 'true';
const localWebServerProbe = expectV3ProductionDenial
  ? { port: 3000 }
  : { url: localBaseURL };

export default defineConfig({
  testDir: './e2e',
  // 90s was sized for dev-server cold compiles and deployed-target latency.
  // Against the in-job production server a healthy test finishes in seconds,
  // so there the timeout exists only to absorb failure hangs — run
  // 29716158705 burned ~21 worker-minutes on 14 timeout attempts alone. 60s
  // caps that hang budget without touching local dev or deployed-target runs.
  // Per-test test.setTimeout() overrides (e.g. navigation crawl 120s,
  // account-deletion redirect 150s) are unaffected.
  timeout: isCiLocalServerRun ? 60_000 : 90_000,
  retries: 1,
  // CI runners are 4-core; Playwright's CI default (50% of cores = 2 workers)
  // left half the machine idle in run 29716158705 while the suite is
  // network-wait-bound and the app server is a separate lightweight process.
  // 4 workers ONLY for the in-job-server run (advisory `e2e` job) — fixed 4
  // (not '100%') so a future larger runner can't oversubscribe the co-located
  // Next.js server. CI runs against a DEPLOYED target (e2e-critical-paths →
  // https://alfanumrik.com, synthetic-monitor) keep their previous 2-worker
  // profile (the old CI default, now explicit) so this speed-up doesn't
  // quadruple concurrent load on production. Local behavior unchanged
  // (1 worker).
  workers: isCiLocalServerRun ? 4 : (process.env.CI ? 2 : 1),
  // Certification journey specs (e2e/certification/**, added 2026-07-02) are
  // PREPARATION ONLY for the certification program's Stage 2/3 — see
  // e2e/certification/helpers/cert-gate.ts. They are excluded from
  // collection ENTIRELY (not just skipped) unless CERTIFICATION_RUN_ENABLED
  // is explicitly 'true', so a plain `npm run test:e2e` (and CI's
  // `npx playwright test --project=chromium`) never even lists them, let
  // alone attempts to run them. Each spec also self-gates at the
  // test.describe level as defense-in-depth for direct/explicit invocations.
  // Safe to list locally (no browser, no network) via:
  //   CERTIFICATION_RUN_ENABLED=true npx playwright test e2e/certification --list
  testIgnore: process.env.CERTIFICATION_RUN_ENABLED === 'true' ? undefined : ['**/certification/**'],
  // CI invokes `--project=chromium`; keep that command contract explicit so a
  // missing project cannot be mistaken for an executed browser suite. Firefox
  // and WebKit are added only when their binaries and role journeys become
  // blocking certification gates.
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  use: {
    // CI uses Playwright's pinned browser. Constrained review environments may
    // provide a compatible audited Chromium binary without changing test code.
    launchOptions: process.env.PLAYWRIGHT_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH }
      : undefined,
    // Normal/local/CI runs keep BASE_URL (default localhost). During a
    // certification run (CERTIFICATION_RUN_ENABLED=true) fall back to
    // CERTIFICATION_BASE_URL so the cert specs' relative `page.goto('/...')`
    // navigations resolve against the target. (Each cert spec ALSO sets its
    // own baseURL via `test.use({ baseURL: CERTIFICATION_BASE_URL })`, so this
    // is belt-and-suspenders — it changes nothing for non-certification runs.)
    baseURL: configuredBaseURL || localBaseURL,
    // Vercel "Protection Bypass for Automation": when CERTIFICATION_BYPASS_SECRET
    // is set (a certification run against an SSO-protected Vercel Preview), send
    // the bypass header on every request, and ask Vercel to set a bypass cookie
    // so subsequent same-context navigations (the multi-page cert journeys) also
    // pass the SSO wall. Omitted entirely when the secret is unset, so nothing
    // changes for normal/local runs. This is ADDITIVE: it does not enable the
    // suite — the CERTIFICATION_RUN_ENABLED + CERTIFICATION_BASE_URL gates still apply.
    extraHTTPHeaders: process.env.CERTIFICATION_BYPASS_SECRET
      ? {
          'x-vercel-protection-bypass': process.env.CERTIFICATION_BYPASS_SECRET,
          'x-vercel-set-bypass-cookie': 'true',
        }
      : {},
    trace: 'on-first-retry',
  },
  // A relative navigation is meaningful only when an application is actually
  // serving it. Start the local host whenever the caller did not supply an
  // explicit deployment target, including the advisory PR E2E job in CI.
  // External certification/critical-path runs set a base URL and never start
  // or mutate a local/remote service through this config.
  webServer: configuredBaseURL ? undefined : {
    // The V3 denial gate must exercise the artifact produced by `next build`,
    // not a development server whose NODE_ENV would make the preview route
    // available. Normal local/advisory E2E keeps the existing dev-server path.
    command: expectV3ProductionDenial
      ? 'node apps/host/.next/standalone/apps/host/server.js'
      : 'npm run dev',
    // Warm the exact dev preview before starting its 60 assertions. The
    // production denial route intentionally returns 404, so its built server
    // uses a TCP readiness probe instead of treating that denial as not-ready.
    ...localWebServerProbe,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
