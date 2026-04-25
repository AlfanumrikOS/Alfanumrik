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
      ],
      thresholds: {
        // Global threshold — aspirational, does not fail CI yet
        statements: 60,
        branches: 60,
        functions: 60,
        lines: 60,
        // Per-file thresholds for critical business logic
        'src/lib/xp-rules.ts': {
          statements: 90,
          branches: 90,
          functions: 90,
          lines: 90,
        },
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
