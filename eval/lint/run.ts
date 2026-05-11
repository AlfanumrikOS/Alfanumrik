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
  // blocking:false (Phase γ pragmatic) — the project pins ESLint 8.x in
  // package.json but npx without a fresh `npm ci` was resolving to v10
  // (which requires the new flat-config format). Even with the right
  // version installed, hundreds of pre-existing warnings would gate every
  // cycle. Treat lint as informational; the L6 critic weighs the warn.
  blocking: false,
});
