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
    baseURL: process.env.BASE_URL || 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  webServer: process.env.CI ? undefined : {
    command: 'npm run dev',
    port: 3000,
    reuseExistingServer: true,
  },
});
