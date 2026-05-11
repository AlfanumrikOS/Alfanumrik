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
  blocking: true,
});
