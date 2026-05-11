/**
 * L5 Evaluator — type_check
 *
 * Wraps `tsc --noEmit`. See eval/_lib/README.md for the wrapper pattern.
 * Always blocking — TS errors must reject a critic decision regardless
 * of risk_tier.
 *
 * Usage:
 *   npm run eval:type-check
 *   npm run eval:type-check -- --json
 *   npx tsx eval/type-check/run.ts --task-id <uuid> --cycle-id <uuid>
 */

import { runCommandEvaluator } from '../_lib/command-evaluator';

void runCommandEvaluator({
  evaluator: 'type_check',
  command: 'npx',
  args: ['tsc', '--noEmit'],
  blocking: true,
});
