import { defineConfig, devices } from '@playwright/test';

const certificationBaseURL =
  process.env.CERTIFICATION_RUN_ENABLED === 'true'
    ? process.env.CERTIFICATION_BASE_URL
    : undefined;
const configuredBaseURL = process.env.BASE_URL || certificationBaseURL;
const localBaseURL = 'http://localhost:3000';

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  retries: 1,
  workers: process.env.CI ? undefined : 1,
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
    command: 'npm run dev',
    url: localBaseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
