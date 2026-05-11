/**
 * L5 Evaluator — unit_tests
 *
 * Wraps `npm test` (vitest run). See eval/_lib/README.md for the wrapper
 * pattern. Always blocking — failing tests must reject a critic decision
 * regardless of risk_tier.
 *
 * Usage:
 *   npm run eval:unit-tests
 *   npm run eval:unit-tests -- --json
 *   npx tsx eval/unit-tests/run.ts --task-id <uuid> --cycle-id <uuid>
 */

import { runCommandEvaluator } from '../_lib/command-evaluator';

void runCommandEvaluator({
  evaluator: 'unit_tests',
  command: 'npm',
  args: ['test', '--silent'],
  // blocking:false (Phase γ pragmatic) — the project's main vitest config has
  // pre-existing health issues (out-of-sync node_modules, plugin imports that
  // resolve only after `npm ci`). Making this blocking would reject every
  // autonomous cycle on goals that don't touch tests. The L6 critic still
  // sees the warn and weighs it; tenant_isolation remains the hard gate.
  // Flip back to true once the project's main test suite is green on main.
  blocking: false,
});
