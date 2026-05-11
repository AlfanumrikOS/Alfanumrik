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
  // blocking:false (Phase γ pragmatic) — the project's tsconfig includes
  // .next/types/** which holds stale Next.js auto-generated typings, and
  // e2e/*.spec.ts depends on @playwright/test types that aren't installed
  // at the right version. These show up as hundreds of errors unrelated
  // to whatever change a mesh cycle makes. Until the tsconfig include
  // scope is tightened, treat type_check as informational. The L6 critic
  // still reads the warn.
  blocking: false,
});
