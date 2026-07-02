import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: 1,
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
  use: {
    // Normal/local/CI runs keep BASE_URL (default localhost). During a
    // certification run (CERTIFICATION_RUN_ENABLED=true) fall back to
    // CERTIFICATION_BASE_URL so the cert specs' relative `page.goto('/...')`
    // navigations resolve against the target. (Each cert spec ALSO sets its
    // own baseURL via `test.use({ baseURL: CERTIFICATION_BASE_URL })`, so this
    // is belt-and-suspenders — it changes nothing for non-certification runs.)
    baseURL:
      process.env.BASE_URL ||
      (process.env.CERTIFICATION_RUN_ENABLED === 'true' ? process.env.CERTIFICATION_BASE_URL : undefined) ||
      'http://localhost:3000',
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
  webServer: process.env.CI ? undefined : {
    command: 'npm run dev',
    port: 3000,
    reuseExistingServer: true,
  },
});
