import { defineConfig } from 'vitest/config';
import path from 'node:path';

// Minimal vitest config for mesh-only test files (sandbox, evaluator,
// L1/L2 shaping, L6 critic guards). Avoids the project's main
// vitest.config.ts which imports @vitejs/plugin-react — currently
// unresolved on main and blocking ANY test run, including pure-TS
// utility tests that have nothing to do with React.
//
// Use: npx vitest run --config vitest.mesh.config.ts
//
// When the project's broader test infrastructure is fixed (the
// @vitejs/plugin-react issue surfaces as an L5 evaluator failure
// every mesh cycle), this file can be deleted.
export default defineConfig({
  test: {
    include: [
      'src/__tests__/agents/**/*.test.ts',
      'src/__tests__/eval/**/*.test.ts',
      'src/__tests__/state/**/*.test.ts',
    ],
    globals: true,
    testTimeout: 15000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
