import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

// ── Integration test exclusion ──
// Tests under `src/__tests__/migrations/**` and `src/__tests__/scripts/**`
// require a live Supabase Postgres backend (real CHECK constraints, triggers,
// views, UNIQUE indexes). They cannot run with placeholder env vars and would
// always fail in PR CI. They are run by a separate `test:integration` script
// gated on real `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` secrets.
const INTEGRATION_TEST_PATTERNS = [
  'src/__tests__/migrations/**',
  'src/__tests__/scripts/**',
];

const isIntegrationRun = process.env.RUN_INTEGRATION_TESTS === '1';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/__tests__/setup.ts'],
    include: isIntegrationRun
      ? INTEGRATION_TEST_PATTERNS.map((p) => `${p}/*.{test,spec}.{ts,tsx}`)
      : ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: isIntegrationRun
      ? ['node_modules/**']
      : [
          'node_modules/**',
          ...INTEGRATION_TEST_PATTERNS,
        ],
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json'],
      include: ['src/lib/**'],
      exclude: [
        'src/__tests__/**',
        'node_modules/**',
        'src/app/**/page.tsx',
        // Server / integration territory: tests live in src/__tests__/migrations
        // and src/__tests__/scripts (the integration-only suite gated on real
        // STAGING_SUPABASE_* secrets in CI). They are NOT exercised by the unit
        // run, so including them in unit-coverage drags global below threshold
        // for no useful signal. Coverage for these paths is the responsibility
        // of the integration-tests workflow job.
        'src/lib/ai/**',
        'src/lib/domains/**',
        'src/lib/identity/**',
        'src/lib/middleware/**',
        // Generated / wrapper files with nothing meaningful to test.
        'src/lib/types.ts',
        'src/lib/constants.ts',
      ],
      thresholds: {
        // Global threshold for the unit-tested core of `src/lib/**` (minus the
        // exclusions above). Was previously labelled "aspirational" with a 60%
        // target, but `continue-on-error: true` masked that reality never
        // exceeded ~37%. Now that CI is a hard gate (P0-D launch fix), the
        // floor must reflect actual present coverage. Aspirational target
        // remains 60% — ratchet upward via the testing chain (see TODOs).
        //
        // Installment 1 (2026-04-28, PR test/global-coverage-installment-1):
        // raised floors after adding 8 pure-utility test files covering
        // voice.ts, whatsapp-templates.ts, foxy-lines.ts, email-templates.ts,
        // share.ts, sanitize.ts, useDebounce.ts, utils.ts. Measured run
        // 44.20 / 39.78 / 46.86 / 45.47 → floors set 1 point below to leave
        // safety margin.
        // Installment 2 (2026-04-28, PR test/global-coverage-installment-2):
        // added 10 test files for pure-fn server helpers + Foxy/quiz pure
        // libs: scoring.ts, anon-id.ts, score-config.ts, slo.ts, plans.ts,
        // cache.ts (mocked redis), sentry-client-redact.ts, request-timing.ts
        // (mocked logger), posthog-client.ts, feedback-engine.ts (mocked
        // sounds), and the entire quiz-engine.ts pure-fn library. Measured
        // run 49.97 / 45.40 / 53.70 / 51.06 → floors set ~1 point below.
        // TODO(testing): installment 3 should target the next layer of
        // pure-fn helpers — admin-auth.ts (still 14%), middleware-helpers.ts
        // (18%), rbac.ts pure parts (25%), usage.ts (12%, needs Supabase
        // mocks), oauth-manager.ts edge cases — aiming +5 points to clear
        // the 55%-statements milestone and put the 60% aspirational target
        // within one more installment.
        statements: 48,
        branches: 44,
        functions: 52,
        lines: 50,
        // Per-file thresholds for critical business logic.
        // P14 review chains (assessment + testing) own restoring xp-rules
        // branches → 90% and cognitive-engine all-metrics → 80%; thresholds
        // here reflect current reality as a hard floor that prevents further
        // drift while the gap is closed.
        // TODO(assessment): restore xp-rules.ts branches threshold to 90 by
        // adding tests for the daily-cap clamp, perfect-score combo, and
        // streak-bonus edge cases.
        'src/lib/xp-rules.ts': {
          statements: 90,
          branches: 90,
          functions: 90,
          lines: 90,
        },
        // P22 (learning graph) defense floor restored 2026-04-28: coverage
        // closure tests in src/__tests__/lib/cognitive-engine-coverage.test.ts
        // hit IRT 3PL Newton-Raphson convergence + clamping, SM-2 schedule
        // decay + EF floor + quality<3 reset, error-classification (slip/
        // guess) thresholds, BKT adaptive parameter branches, generateQuiz-
        // Params switch cases, calculateChapterPriority urgency tiers,
        // generateExamStudyPlan (last-day / last-week / normal), predict-
        // ExamScore confidence, classifyImageText heuristics, and compute-
        // MonthlyReportMetrics. Actual coverage: 100/98.8/100/100. Floor
        // pinned at 80 to leave 1-2 branches of headroom for refactors.
        'src/lib/cognitive-engine.ts': {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
        'src/lib/exam-engine.ts': {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
