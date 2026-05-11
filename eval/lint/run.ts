/**
 * L5 Evaluator — lint
 *
 * Wraps `eslint src/`. See eval/_lib/README.md for the wrapper pattern.
 * Always blocking — lint errors must reject a critic decision regardless
 * of risk_tier.
 *
 * Usage:
 *   npm run eval:lint
 *   npm run eval:lint -- --json
 *   npx tsx eval/lint/run.ts --task-id <uuid> --cycle-id <uuid>
 */

import { runCommandEvaluator } from '../_lib/command-evaluator';

void runCommandEvaluator({
  evaluator: 'lint',
  command: 'npx',
  args: ['eslint', 'src/', '--ext', '.ts,.tsx'],
  blocking: true,
});
